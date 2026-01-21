import { runClaude } from "./agents/claude.ts";
import {
  runCodexPromptGenerator,
  runCodexReview,
  isApproved,
  extractFeedback,
} from "./agents/codex.ts";
import { buildFeedbackPrompt } from "./prompts/templates.ts";
import { saveState, generateSessionId } from "./state.ts";
import type {
  OrchestrationState,
  OrchestratorOptions,
  EventCallback,
  ServerEvent,
} from "./types.ts";

export interface OrchestratorCallbacks {
  onEvent: EventCallback;
  onQuestion: (question: string) => Promise<boolean>;
}

function createEvent(
  type: ServerEvent["type"],
  sessionId: string,
  data: unknown,
): ServerEvent {
  return {
    type,
    sessionId,
    timestamp: new Date().toISOString(),
    data,
  };
}

export async function orchestrate(
  feature: string,
  options: OrchestratorOptions,
  callbacks: OrchestratorCallbacks,
  resumeState?: OrchestrationState,
  sessionId?: string,
): Promise<OrchestrationState> {
  const state: OrchestrationState = resumeState || {
    id: sessionId || generateSessionId(),
    feature,
    iteration: 0,
    maxIterations: options.maxIterations,
    status: "prompting",
    history: [],
    workingDir: options.workingDir,
    generatedPrompt: undefined,
    lastFailedStep: undefined,
    createdAt: new Date().toISOString(),
  };

  const emit = (type: ServerEvent["type"], data: unknown) => {
    callbacks.onEvent(createEvent(type, state.id, data));
  };

  if (resumeState) {
    options.workingDir = resumeState.workingDir;
  }

  let resumingFromStep = resumeState?.lastFailedStep;
  let resumingIteration = resumeState?.iteration || 0;

  emit("log", {
    level: "info",
    message: `Session: ${state.id}`,
  });
  emit("log", {
    level: "info",
    message: `Feature: ${state.feature.slice(0, 100)}${state.feature.length > 100 ? "..." : ""}`,
  });
  emit("log", {
    level: "info",
    message: `Working directory: ${options.workingDir}`,
  });

  if (resumeState) {
    emit("log", {
      level: "info",
      message: `Resuming from iteration: ${state.iteration}, step: ${resumingFromStep || state.status}`,
    });
  }

  let generatedPrompt = state.generatedPrompt;

  // Step 1: Generate implementation prompt using Codex
  if (!generatedPrompt) {
    emit("iteration", {
      iteration: 1,
      maxIterations: state.maxIterations,
      phase: "PROMPTING",
    });

    emit("agent_start", { agent: "codex", role: "prompt-generator" });

    state.status = "prompting";
    state.lastFailedStep = "prompting";
    await saveState(state);

    const promptResult = await runCodexPromptGenerator(
      state.feature,
      options.workingDir,
    );

    emit("agent_complete", {
      agent: "codex",
      role: "prompt-generator",
      output: promptResult.output,
      success: promptResult.success,
    });

    if (!promptResult.success) {
      emit("error", { message: promptResult.error || "Failed to generate prompt", fatal: true });
      state.status = "failed";
      await saveState(state);
      return state;
    }

    generatedPrompt = promptResult.output;
    state.generatedPrompt = generatedPrompt;
    state.lastFailedStep = undefined;

    state.history.push({
      agent: "codex",
      role: "prompt-generator",
      content: generatedPrompt,
      timestamp: new Date(),
      iteration: 0,
    });

    await saveState(state);

    if (options.verbose) {
      emit("log", { level: "verbose", message: generatedPrompt });
    }

    if (options.interactive) {
      const proceed = await callbacks.onQuestion("Proceed with implementation?");
      if (!proceed) {
        emit("log", { level: "info", message: "Aborted by user" });
        state.status = "failed";
        await saveState(state);
        return state;
      }
    }
  } else {
    emit("log", { level: "info", message: "Using saved prompt from previous session" });
  }

  // Main loop: Implement -> Review -> Repeat
  let feedback: string | undefined;

  if (resumeState && state.history.length > 0) {
    const lastReview = [...state.history].reverse().find((h) => h.role === "reviewer");
    if (lastReview && !isApproved(lastReview.content)) {
      feedback = extractFeedback(lastReview.content);
    }
  }

  while (state.iteration < state.maxIterations) {
    const shouldSkipImplementation =
      resumingFromStep === "reviewing" && state.iteration === resumingIteration;

    if (!shouldSkipImplementation) {
      state.iteration++;
    }

    // Step 2: Claude implements
    if (!shouldSkipImplementation) {
      state.status = "implementing";
      state.lastFailedStep = "implementing";
      await saveState(state);

      emit("iteration", {
        iteration: state.iteration,
        maxIterations: state.maxIterations,
        phase: "IMPLEMENTING",
      });

      emit("status", {
        status: state.status,
        iteration: state.iteration,
        maxIterations: state.maxIterations,
      });

      const implementPrompt =
        state.iteration === 1 || !feedback
          ? generatedPrompt!
          : buildFeedbackPrompt(state.feature, feedback, state.iteration);

      if (options.interactive && state.iteration > 1 && feedback) {
        emit("log", { level: "info", message: `Reviewer Feedback:\n${feedback}` });

        const proceed = await callbacks.onQuestion("Continue with next iteration?");
        if (!proceed) {
          emit("log", { level: "info", message: "Aborted by user" });
          state.status = "failed";
          await saveState(state);
          return state;
        }
      }

      emit("agent_start", { agent: "claude", role: "implementer" });

      const implementResult = await runClaude(implementPrompt, options.workingDir);

      emit("agent_complete", {
        agent: "claude",
        role: "implementer",
        output: implementResult.output,
        success: implementResult.success,
      });

      if (!implementResult.success) {
        emit("error", {
          message: implementResult.error || "Claude implementation failed",
          fatal: true,
        });
        state.status = "failed";
        await saveState(state);
        return state;
      }

      state.history.push({
        agent: "claude",
        role: "implementer",
        content: implementResult.output,
        timestamp: new Date(),
        iteration: state.iteration,
      });

      state.lastFailedStep = undefined;
      await saveState(state);

      if (options.verbose) {
        emit("log", { level: "verbose", message: implementResult.output });
      }
    } else {
      emit("iteration", {
        iteration: state.iteration,
        maxIterations: state.maxIterations,
        phase: "RESUMING REVIEW",
      });
      emit("log", {
        level: "info",
        message: "Skipping implementation - resuming at review step",
      });
    }

    // Step 3: Codex reviews
    state.status = "reviewing";
    state.lastFailedStep = "reviewing";
    await saveState(state);

    emit("status", {
      status: state.status,
      iteration: state.iteration,
      maxIterations: state.maxIterations,
    });

    emit("agent_start", { agent: "codex", role: "reviewer" });

    const reviewResult = await runCodexReview(state.feature, options.workingDir);

    emit("agent_complete", {
      agent: "codex",
      role: "reviewer",
      output: reviewResult.output,
      success: reviewResult.success,
    });

    if (!reviewResult.success) {
      emit("error", { message: reviewResult.error || "Codex review failed", fatal: true });
      state.status = "failed";
      await saveState(state);
      return state;
    }

    state.history.push({
      agent: "codex",
      role: "reviewer",
      content: reviewResult.output,
      timestamp: new Date(),
      iteration: state.iteration,
    });

    state.lastFailedStep = undefined;
    await saveState(state);

    if (options.verbose) {
      emit("log", { level: "verbose", message: reviewResult.output });
    }

    // Step 4: Check if approved
    if (isApproved(reviewResult.output)) {
      state.status = "approved";
      await saveState(state);
      emit("complete", { status: "approved", iterations: state.iteration });
      return state;
    }

    feedback = extractFeedback(reviewResult.output);
    emit("log", { level: "info", message: "Changes requested - continuing to next iteration" });

    if (shouldSkipImplementation) {
      resumingFromStep = undefined;
      resumingIteration = 0;
      state.iteration++;
    }
  }

  // Max iterations reached
  emit("log", {
    level: "info",
    message: `Max iterations (${state.maxIterations}) reached without approval`,
  });

  if (options.interactive) {
    const continueAnyway = await callbacks.onQuestion("Continue with additional iterations?");
    if (continueAnyway) {
      state.maxIterations += 3;
      state.lastFailedStep = undefined;
      await saveState(state);
      return orchestrate(state.feature, options, callbacks, state);
    }
  }

  state.status = "failed";
  await saveState(state);
  emit("complete", { status: "failed", iterations: state.iteration });
  return state;
}
