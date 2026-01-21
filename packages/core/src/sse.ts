import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { bus, emitEvent } from "./bus.ts";
import type { ServerEvent } from "./types.ts";

// Track active SSE connections per session for logging
const activeConnections = new Map<string, number>();

function incrementConnections(sessionId: string): number {
  const current = activeConnections.get(sessionId) || 0;
  activeConnections.set(sessionId, current + 1);
  return current + 1;
}

function decrementConnections(sessionId: string): number {
  const current = activeConnections.get(sessionId) || 0;
  const newCount = Math.max(0, current - 1);
  if (newCount === 0) {
    activeConnections.delete(sessionId);
  } else {
    activeConnections.set(sessionId, newCount);
  }
  return newCount;
}

/**
 * Get the number of active SSE connections for a session
 */
export function getConnectionCount(sessionId: string): number {
  return activeConnections.get(sessionId) || 0;
}

/**
 * Get total number of active SSE connections across all sessions
 */
export function getTotalConnectionCount(): number {
  let total = 0;
  for (const count of activeConnections.values()) {
    total += count;
  }
  return total;
}

/**
 * Create an SSE stream handler for a session
 * Subscribes to the event bus and forwards events to the client
 * Replays any buffered events that occurred before the client connected
 */
export function createSSEHandler(sessionId: string) {
  return async (c: Context) => {
    return streamSSE(c, async (stream) => {
      let closed = false;
      const connectionCount = incrementConnections(sessionId);
      console.log(`[SSE] Stream connected for session ${sessionId}, total: ${connectionCount}`);

      // Send initial connection event first
      const connectEvent: ServerEvent = {
        type: "status",
        sessionId,
        timestamp: new Date().toISOString(),
        data: { connected: true },
      };
      await stream.writeSSE({ data: JSON.stringify(connectEvent) });

      // Subscribe to bus events for this session
      // The bus will automatically replay any buffered events
      const unsubscribe = bus.subscribe(
        sessionId,
        (event: ServerEvent) => {
          if (!closed) {
            try {
              stream.writeSSE({
                data: JSON.stringify(event),
              });
            } catch {
              closed = true;
            }
          }
        },
        true, // replay buffered events
      );

      // Keep the connection alive until client disconnects
      while (!closed) {
        if (stream.aborted) {
          closed = true;
          break;
        }
        await stream.sleep(1000);
      }

      // Cleanup
      unsubscribe();
      const remaining = decrementConnections(sessionId);
      console.log(`[SSE] Stream disconnected for session ${sessionId}, remaining: ${remaining}`);
    });
  };
}

/**
 * Start the keep-alive ping interval
 * Sends periodic pings to all sessions with active connections
 */
export function startKeepAlive(intervalMs = 15000): () => void {
  const interval = setInterval(() => {
    const now = new Date().toISOString();

    for (const [sessionId, count] of activeConnections.entries()) {
      if (count > 0) {
        emitEvent("ping", sessionId, { timestamp: now });
      }
    }
  }, intervalMs);

  return () => clearInterval(interval);
}

/**
 * Broadcast an event to a specific session via the bus
 */
export function broadcastToSession(sessionId: string, event: ServerEvent): void {
  bus.publish(event);
}

/**
 * Emit a typed event to a session
 */
export function emitSessionEvent(
  type: ServerEvent["type"],
  sessionId: string,
  data: unknown,
): void {
  emitEvent(type, sessionId, data);
}
