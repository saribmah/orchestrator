export type OrchestrationStatus =
  | "prompting"
  | "implementing"
  | "reviewing"
  | "committing"
  | "approved"
  | "failed"
  | "waiting_for_input";

export interface AgentResponse {
  agent: "claude" | "codex";
  role: "prompt-generator" | "implementer" | "reviewer" | "committer";
  content: string;
  timestamp: Date;
  iteration: number;
}

export interface OrchestrationState {
  id: string;
  feature: string;
  iteration: number;
  maxIterations: number;
  status: OrchestrationStatus;
  history: AgentResponse[];
  workingDir: string;
  generatedPrompt?: string;
  lastFailedStep?: "prompting" | "implementing" | "reviewing";
  createdAt: string;
  pendingQuestion?: string;
}

export interface OrchestratorOptions {
  maxIterations: number;
  interactive: boolean;
  verbose: boolean;
  workingDir: string;
  autoCommit: boolean;
}

export interface AgentResult {
  success: boolean;
  output: string;
  error?: string;
}

// Server event types for SSE
export type ServerEventType =
  | "session_started"
  | "status"
  | "log"
  | "agent_start"
  | "agent_complete"
  | "question"
  | "iteration"
  | "complete"
  | "error"
  | "ping";

export interface ServerEvent {
  type: ServerEventType;
  sessionId: string;
  timestamp: string;
  data: unknown;
}

export interface StatusEvent extends ServerEvent {
  type: "status";
  data: {
    status: OrchestrationStatus;
    iteration: number;
    maxIterations: number;
  };
}

export interface LogEvent extends ServerEvent {
  type: "log";
  data: {
    level: "info" | "error" | "verbose";
    message: string;
  };
}

export interface AgentStartEvent extends ServerEvent {
  type: "agent_start";
  data: {
    agent: "claude" | "codex";
    role: string;
  };
}

export interface AgentCompleteEvent extends ServerEvent {
  type: "agent_complete";
  data: {
    agent: "claude" | "codex";
    role: string;
    output: string;
    success: boolean;
  };
}

export interface QuestionEvent extends ServerEvent {
  type: "question";
  data: {
    question: string;
    questionId: string;
  };
}

export interface IterationEvent extends ServerEvent {
  type: "iteration";
  data: {
    iteration: number;
    maxIterations: number;
    phase: string;
  };
}

export interface CompleteEvent extends ServerEvent {
  type: "complete";
  data: {
    status: OrchestrationStatus;
    iterations: number;
  };
}

export interface ErrorEvent extends ServerEvent {
  type: "error";
  data: {
    message: string;
    fatal: boolean;
  };
}

// Event emitter callback type
export type EventCallback = (event: ServerEvent) => void;

// Queue types
export type QueueItemStatus = "pending" | "running" | "completed" | "failed";

export interface QueueItem {
  id: string;
  feature: string;
  options: OrchestratorOptions;
  status: QueueItemStatus;
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

// Queue event types
export type QueueEventType =
  | "queue_item_added"
  | "queue_item_started"
  | "queue_item_completed"
  | "queue_item_failed"
  | "queue_item_removed"
  | "queue_cleared";

export interface QueueEvent {
  type: QueueEventType;
  timestamp: string;
  data: {
    itemId?: string;
    item?: QueueItem;
    queue?: QueueState;
  };
}
