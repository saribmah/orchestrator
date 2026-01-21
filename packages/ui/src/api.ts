const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3100";

export interface SessionSummary {
  id: string;
  feature: string;
  status: string;
  iteration: number;
  maxIterations: number;
  createdAt: string;
}

export interface SessionState {
  id: string;
  feature: string;
  iteration: number;
  maxIterations: number;
  status: string;
  history: Array<{
    agent: string;
    role: string;
    content: string;
    timestamp: string;
    iteration: number;
  }>;
  workingDir: string;
  generatedPrompt?: string;
  createdAt: string;
}

export interface NewSessionOptions {
  feature: string;
  maxIterations: number;
  interactive: boolean;
  verbose: boolean;
  workingDir: string;
  autoCommit: boolean;
}

export interface ServerEvent {
  type: string;
  sessionId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export async function getHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function listSessions(): Promise<string[]> {
  const res = await fetch(`${API_URL}/sessions`);
  if (!res.ok) throw new Error("Failed to list sessions");
  const data = await res.json();
  return data.sessions;
}

export async function getSession(sessionId: string): Promise<SessionState> {
  const res = await fetch(`${API_URL}/sessions/${sessionId}`);
  if (!res.ok) throw new Error("Session not found");
  return res.json();
}

export async function startSession(options: NewSessionOptions): Promise<string> {
  const res = await fetch(`${API_URL}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      feature: options.feature,
      options: {
        maxIterations: options.maxIterations,
        interactive: options.interactive,
        verbose: options.verbose,
        workingDir: options.workingDir,
        autoCommit: options.autoCommit,
      },
    }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || "Failed to start session");
  }
  const data = await res.json();
  return data.sessionId;
}

export async function resumeSession(
  sessionId: string,
  options: { interactive: boolean; verbose: boolean }
): Promise<void> {
  const res = await fetch(`${API_URL}/sessions/${sessionId}/resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ options }),
  });
  if (!res.ok) throw new Error("Failed to resume session");
}

export async function respondToQuestion(
  sessionId: string,
  answer: boolean
): Promise<void> {
  const res = await fetch(`${API_URL}/sessions/${sessionId}/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answer }),
  });
  if (!res.ok) throw new Error("Failed to respond");
}

export function subscribeToEvents(
  sessionId: string,
  onEvent: (event: ServerEvent) => void,
  onError?: (error: Error) => void
): () => void {
  const eventSource = new EventSource(`${API_URL}/sessions/${sessionId}/events`);

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as ServerEvent;
      onEvent(data);
    } catch (e) {
      console.error("Failed to parse event:", e);
    }
  };

  eventSource.onerror = () => {
    onError?.(new Error("Connection lost"));
  };

  return () => eventSource.close();
}

// ============ Queue API ============

export interface QueueItem {
  id: string;
  feature: string;
  options: {
    maxIterations: number;
    interactive: boolean;
    verbose: boolean;
    workingDir: string;
    autoCommit: boolean;
  };
  status: "pending" | "running" | "completed" | "failed";
  sessionId?: string;
  addedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface QueueState {
  items: QueueItem[];
  isProcessing: boolean;
  currentItemId?: string;
}

export interface QueueItemOptions {
  feature: string;
  maxIterations?: number;
  verbose?: boolean;
  workingDir?: string;
  autoCommit?: boolean;
}

export async function getQueue(): Promise<QueueState> {
  const res = await fetch(`${API_URL}/queue`);
  if (!res.ok) throw new Error("Failed to get queue");
  return res.json();
}

export async function addToQueue(options: QueueItemOptions): Promise<QueueItem> {
  const res = await fetch(`${API_URL}/queue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      feature: options.feature,
      options: {
        maxIterations: options.maxIterations ?? 5,
        interactive: false,
        verbose: options.verbose ?? false,
        workingDir: options.workingDir ?? "/",
        autoCommit: options.autoCommit ?? false,
      },
    }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || "Failed to add to queue");
  }
  const data = await res.json();
  return data.item;
}

export async function addManyToQueue(items: QueueItemOptions[]): Promise<QueueItem[]> {
  const res = await fetch(`${API_URL}/queue/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: items.map((item) => ({
        feature: item.feature,
        options: {
          maxIterations: item.maxIterations ?? 5,
          interactive: false,
          verbose: item.verbose ?? false,
          workingDir: item.workingDir ?? "/",
          autoCommit: item.autoCommit ?? false,
        },
      })),
    }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || "Failed to add items to queue");
  }
  const data = await res.json();
  return data.items;
}

export async function removeFromQueue(itemId: string): Promise<void> {
  const res = await fetch(`${API_URL}/queue/${itemId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to remove from queue");
}

export async function clearQueue(): Promise<number> {
  const res = await fetch(`${API_URL}/queue`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to clear queue");
  const data = await res.json();
  return parseInt(data.message.match(/\d+/)?.[0] || "0", 10);
}

export function subscribeToQueueEvents(
  onEvent: (event: ServerEvent) => void,
  onError?: (error: Error) => void
): () => void {
  const eventSource = new EventSource(`${API_URL}/queue/events`);

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as ServerEvent;
      onEvent(data);
    } catch (e) {
      console.error("Failed to parse queue event:", e);
    }
  };

  eventSource.onerror = () => {
    onError?.(new Error("Queue connection lost"));
  };

  return () => eventSource.close();
}
