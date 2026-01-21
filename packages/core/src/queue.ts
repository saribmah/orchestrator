import { orchestrate } from "./orchestrator.ts";
import { bus, emitEvent } from "./bus.ts";
import { generateSessionId } from "./state.ts";
import type {
  QueueItem,
  QueueState,
  QueueEvent,
  QueueEventType,
  OrchestratorOptions,
} from "./types.ts";

// Pending questions for interactive queue sessions
interface PendingQuestion {
  resolve: (answer: boolean) => void;
  question: string;
}

const pendingQuestions = new Map<string, PendingQuestion>();

function generateQueueItemId(): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const random = Math.random().toString(36).slice(2, 6);
  return `q-${timestamp}-${random}`;
}

function emitQueueEvent(type: QueueEventType, data: QueueEvent["data"]): void {
  const event: QueueEvent = {
    type,
    timestamp: new Date().toISOString(),
    data,
  };
  // Emit to a special "queue" channel
  bus.publish({
    type: "log" as const,
    sessionId: "__queue__",
    timestamp: event.timestamp,
    data: { level: "info", message: `[Queue] ${type}`, queueEvent: event },
  });
}

class SessionQueue {
  private state: QueueState = {
    items: [],
    isProcessing: false,
    currentItemId: undefined,
  };

  /**
   * Add a new item to the queue
   */
  add(feature: string, options: OrchestratorOptions): QueueItem {
    const item: QueueItem = {
      id: generateQueueItemId(),
      feature,
      options,
      status: "pending",
      addedAt: new Date().toISOString(),
    };

    this.state.items.push(item);
    emitQueueEvent("queue_item_added", { itemId: item.id, item, queue: this.getState() });

    // Auto-start processing if not already running
    if (!this.state.isProcessing) {
      this.processNext();
    }

    return item;
  }

  /**
   * Add multiple items to the queue
   */
  addMany(items: Array<{ feature: string; options: OrchestratorOptions }>): QueueItem[] {
    const addedItems: QueueItem[] = [];

    for (const { feature, options } of items) {
      const item: QueueItem = {
        id: generateQueueItemId(),
        feature,
        options,
        status: "pending",
        addedAt: new Date().toISOString(),
      };
      this.state.items.push(item);
      addedItems.push(item);
      emitQueueEvent("queue_item_added", { itemId: item.id, item, queue: this.getState() });
    }

    // Auto-start processing if not already running
    if (!this.state.isProcessing && addedItems.length > 0) {
      this.processNext();
    }

    return addedItems;
  }

  /**
   * Remove an item from the queue (only if pending)
   */
  remove(itemId: string): boolean {
    const index = this.state.items.findIndex(
      (item) => item.id === itemId && item.status === "pending"
    );

    if (index === -1) return false;

    this.state.items.splice(index, 1);
    emitQueueEvent("queue_item_removed", { itemId, queue: this.getState() });

    return true;
  }

  /**
   * Clear all pending items from the queue
   */
  clearPending(): number {
    const pendingCount = this.state.items.filter((item) => item.status === "pending").length;
    this.state.items = this.state.items.filter((item) => item.status !== "pending");
    emitQueueEvent("queue_cleared", { queue: this.getState() });
    return pendingCount;
  }

  /**
   * Get the current queue state
   */
  getState(): QueueState {
    return {
      ...this.state,
      items: [...this.state.items],
    };
  }

  /**
   * Get a specific item by ID
   */
  getItem(itemId: string): QueueItem | undefined {
    return this.state.items.find((item) => item.id === itemId);
  }

  /**
   * Respond to a pending question for a queue session
   */
  respondToQuestion(sessionId: string, answer: boolean): boolean {
    const pending = pendingQuestions.get(sessionId);
    if (!pending) return false;

    pending.resolve(answer);
    pendingQuestions.delete(sessionId);
    return true;
  }

  /**
   * Check if there's a pending question for a session
   */
  getPendingQuestion(sessionId: string): string | undefined {
    return pendingQuestions.get(sessionId)?.question;
  }

  /**
   * Process the next item in the queue
   */
  private async processNext(): Promise<void> {
    // Find the next pending item
    const nextItem = this.state.items.find((item) => item.status === "pending");

    if (!nextItem) {
      this.state.isProcessing = false;
      this.state.currentItemId = undefined;
      return;
    }

    this.state.isProcessing = true;
    this.state.currentItemId = nextItem.id;
    nextItem.status = "running";
    nextItem.startedAt = new Date().toISOString();

    // Generate session ID
    const sessionId = generateSessionId();
    nextItem.sessionId = sessionId;

    emitQueueEvent("queue_item_started", {
      itemId: nextItem.id,
      item: nextItem,
      queue: this.getState(),
    });

    try {
      const finalState = await orchestrate(
        nextItem.feature,
        nextItem.options,
        {
          onEvent: (event) => {
            // Publish to the event bus
            bus.publish(event);
          },
          onQuestion: async (question) => {
            return new Promise((resolve) => {
              pendingQuestions.set(sessionId, { resolve, question });
              emitEvent("question", sessionId, {
                question,
                questionId: Date.now().toString(),
              });
            });
          },
        },
        undefined,
        sessionId,
      );

      nextItem.completedAt = new Date().toISOString();

      if (finalState.status === "approved") {
        nextItem.status = "completed";
        emitQueueEvent("queue_item_completed", {
          itemId: nextItem.id,
          item: nextItem,
          queue: this.getState(),
        });
      } else {
        nextItem.status = "failed";
        nextItem.error = `Session ended with status: ${finalState.status}`;
        emitQueueEvent("queue_item_failed", {
          itemId: nextItem.id,
          item: nextItem,
          queue: this.getState(),
        });
      }
    } catch (error) {
      nextItem.status = "failed";
      nextItem.completedAt = new Date().toISOString();
      nextItem.error = error instanceof Error ? error.message : "Unknown error";

      emitQueueEvent("queue_item_failed", {
        itemId: nextItem.id,
        item: nextItem,
        queue: this.getState(),
      });

      // Emit error event for the session
      if (nextItem.sessionId) {
        emitEvent("error", nextItem.sessionId, {
          message: nextItem.error,
          fatal: true,
        });
        emitEvent("complete", nextItem.sessionId, {
          status: "failed",
          iterations: 0,
        });
      }
    }

    // Clean up pending question if any
    if (nextItem.sessionId) {
      pendingQuestions.delete(nextItem.sessionId);
    }

    // Process the next item
    this.processNext();
  }
}

// Singleton queue instance
export const queue = new SessionQueue();
