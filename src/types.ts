export type OrchestrationStatus =
  | "prompting"
  | "implementing"
  | "reviewing"
  | "approved"
  | "failed";

export interface AgentResponse {
  agent: "claude" | "codex";
  role: "prompt-generator" | "implementer" | "reviewer";
  content: string;
  timestamp: Date;
  iteration: number;
}

export interface OrchestrationState {
  feature: string;
  iteration: number;
  maxIterations: number;
  status: OrchestrationStatus;
  history: AgentResponse[];
  workingDir: string;
  generatedPrompt?: string;
  lastFailedStep?: "prompting" | "implementing" | "reviewing";
}

export interface OrchestratorOptions {
  maxIterations: number;
  interactive: boolean;
  verbose: boolean;
  workingDir: string;
}

export interface AgentResult {
  success: boolean;
  output: string;
  error?: string;
}
