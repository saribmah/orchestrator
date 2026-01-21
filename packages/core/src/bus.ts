import type { ServerEvent } from "./types.ts";

export type BusEventHandler = (event: ServerEvent) => void;

interface Subscription {
  id: string;
  sessionId: string | "*"; // "*" for all sessions
  handler: BusEventHandler;
}

interface BufferedEvent {
  event: ServerEvent;
  timestamp: number;
}

const EVENT_BUFFER_MAX_SIZE = 100; // Max events per session
const EVENT_BUFFER_TTL_MS = 30000; // 30 seconds

class EventBus {
  private subscriptions = new Map<string, Subscription>();
  private subscriptionCounter = 0;
  private eventBuffers = new Map<string, BufferedEvent[]>();

  /**
   * Subscribe to events for a specific session or all sessions
   * @param sessionId - Session ID to subscribe to, or "*" for all sessions
   * @param handler - Callback function to handle events
   * @param replayBuffered - Whether to replay buffered events (default: true)
   * @returns Unsubscribe function
   */
  subscribe(
    sessionId: string | "*",
    handler: BusEventHandler,
    replayBuffered = true,
  ): () => void {
    const id = `sub_${++this.subscriptionCounter}`;
    this.subscriptions.set(id, { id, sessionId, handler });

    // Replay buffered events for this session
    if (replayBuffered && sessionId !== "*") {
      const buffered = this.getBufferedEvents(sessionId);
      for (const { event } of buffered) {
        try {
          handler(event);
        } catch (error) {
          console.error(`[Bus] Error replaying event to subscription ${id}:`, error);
        }
      }
    }

    return () => {
      this.subscriptions.delete(id);
    };
  }

  /**
   * Publish an event to all matching subscribers
   * @param event - The event to publish
   */
  publish(event: ServerEvent): void {
    // Buffer the event (skip pings)
    if (event.type !== "ping") {
      this.bufferEvent(event);
    }

    for (const subscription of this.subscriptions.values()) {
      // Match if subscriber wants all events or if session ID matches
      if (subscription.sessionId === "*" || subscription.sessionId === event.sessionId) {
        try {
          subscription.handler(event);
        } catch (error) {
          console.error(`[Bus] Error in event handler for subscription ${subscription.id}:`, error);
        }
      }
    }
  }

  /**
   * Buffer an event for late-joining subscribers
   */
  private bufferEvent(event: ServerEvent): void {
    const sessionId = event.sessionId;
    if (!this.eventBuffers.has(sessionId)) {
      this.eventBuffers.set(sessionId, []);
    }

    const buffer = this.eventBuffers.get(sessionId)!;
    buffer.push({
      event,
      timestamp: Date.now(),
    });

    // Trim old events
    this.cleanBuffer(sessionId);
  }

  /**
   * Clean old events from buffer
   */
  private cleanBuffer(sessionId: string): void {
    const buffer = this.eventBuffers.get(sessionId);
    if (!buffer) return;

    const now = Date.now();
    const cutoff = now - EVENT_BUFFER_TTL_MS;

    // Remove expired events
    const filtered = buffer.filter((b) => b.timestamp > cutoff);

    // Trim to max size (keep most recent)
    if (filtered.length > EVENT_BUFFER_MAX_SIZE) {
      filtered.splice(0, filtered.length - EVENT_BUFFER_MAX_SIZE);
    }

    if (filtered.length === 0) {
      this.eventBuffers.delete(sessionId);
    } else {
      this.eventBuffers.set(sessionId, filtered);
    }
  }

  /**
   * Get buffered events for a session
   */
  getBufferedEvents(sessionId: string): BufferedEvent[] {
    this.cleanBuffer(sessionId);
    return this.eventBuffers.get(sessionId) || [];
  }

  /**
   * Clear buffer for a session
   */
  clearBuffer(sessionId: string): void {
    this.eventBuffers.delete(sessionId);
  }

  /**
   * Get the number of active subscriptions
   */
  get subscriberCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Get the number of subscribers for a specific session
   */
  getSessionSubscriberCount(sessionId: string): number {
    let count = 0;
    for (const subscription of this.subscriptions.values()) {
      if (subscription.sessionId === "*" || subscription.sessionId === sessionId) {
        count++;
      }
    }
    return count;
  }
}

// Singleton event bus instance
export const bus = new EventBus();

// Helper function to create and publish events
export function emitEvent(
  type: ServerEvent["type"],
  sessionId: string,
  data: unknown,
): void {
  bus.publish({
    type,
    sessionId,
    timestamp: new Date().toISOString(),
    data,
  });
}
