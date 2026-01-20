import { runClaude } from "./agents/claude";
import {
  runCodexPromptGenerator,
  runCodexReview,
  isApproved,
  extractFeedback,
} from "./agents/codex";
import {
  buildImplementationPrompt,
  buildFeedbackPrompt,
  formatIterationHeader,
} from "./prompts/templates";
import { saveState } from "./state";
import type {
  OrchestrationState,
  OrchestratorOptions,
  AgentResponse,
} from "./types";

async function promptUser(message: string): Promise<boolean> {
  process.stdout.write(`\n${message} (y/n): `);
  for await (const line of console) {
    const answer = line.trim().toLowerCase();
    return answer === "y" || answer === "yes";
  }
  return false;
}

export async function orchestrate(
  feature: string,
  options: OrchestratorOptions,
  resumeState?: OrchestrationState
): Promise<OrchestrationState> {
  const state: OrchestrationState = resumeState || {
    feature,
    iteration: 0,
    maxIterations: options.maxIterations,
    status: "prompting",
    history: [],
    workingDir: options.workingDir,
    generatedPrompt: undefined,
    lastFailedStep: undefined,
  };

  // Update options from resume state if needed
  if (resumeState) {
    options.workingDir = resumeState.workingDir;
  }

  // Track if we're resuming from a failed step (mutable - cleared after handling)
  let resumingFromStep = resumeState?.lastFailedStep;
  let resumingIteration = resumeState?.iteration || 0;

  console.log("\n" + "=".repeat(60));
  console.log("ORCHESTRATOR: Multi-Agent Feature Implementation");
  console.log("=".repeat(60));
  console.log(`Feature: ${state.feature.slice(0, 100)}${state.feature.length > 100 ? "..." : ""}`);
  console.log(`Max iterations: ${state.maxIterations}`);
  console.log(`Working directory: ${options.workingDir}`);
  if (resumeState) {
    console.log(`Resuming from iteration: ${state.iteration}, step: ${resumingFromStep || state.status}`);
  }
  console.log("=".repeat(60));

  let generatedPrompt = state.generatedPrompt;

  // Step 1: Generate implementation prompt using Codex (skip if resuming past this point)
  if (!generatedPrompt) {
    console.log(formatIterationHeader(1, state.maxIterations, "PROMPTING"));
    console.log("\n[Orchestrator] Asking Codex to generate implementation prompt...");

    state.status = "prompting";
    state.lastFailedStep = "prompting";
    await saveState(state);

    const promptResult = await runCodexPromptGenerator(
      state.feature,
      options.workingDir,
      options.verbose
    );

    if (!promptResult.success) {
      console.error("\n[Error] Failed to generate prompt:", promptResult.error);
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
      console.log("\n[Codex Generated Prompt]:");
      console.log("-".repeat(40));
      console.log(generatedPrompt);
      console.log("-".repeat(40));
    } else {
      console.log("[Codex] Generated implementation prompt");
    }

    if (options.interactive) {
      const proceed = await promptUser("Proceed with implementation?");
      if (!proceed) {
        console.log("\n[Orchestrator] Aborted by user");
        state.status = "failed";
        await saveState(state);
        return state;
      }
    }
  } else {
    console.log("[Orchestrator] Using saved prompt from previous session");
  }

  // Main loop: Implement -> Review -> Repeat
  let feedback: string | undefined;

  // Get last feedback if resuming
  if (resumeState && state.history.length > 0) {
    const lastReview = [...state.history].reverse().find(
      (h) => h.role === "reviewer"
    );
    if (lastReview && !isApproved(lastReview.content)) {
      feedback = extractFeedback(lastReview.content);
    }
  }

  while (state.iteration < state.maxIterations) {
    // Only increment if we're not resuming from a failed step in this iteration
    const shouldSkipImplementation = resumingFromStep === "reviewing" && state.iteration === resumingIteration;

    if (!shouldSkipImplementation) {
      state.iteration++;
    }

    // Step 2: Claude implements (skip if resuming from review step)
    if (!shouldSkipImplementation) {
      state.status = "implementing";
      state.lastFailedStep = "implementing";
      await saveState(state);

      console.log(
        formatIterationHeader(
          state.iteration,
          state.maxIterations,
          "IMPLEMENTING"
        )
      );

      const implementPrompt =
        state.iteration === 1 || !feedback
          ? generatedPrompt!
          : buildFeedbackPrompt(state.feature, feedback, state.iteration);

      if (options.interactive && state.iteration > 1 && feedback) {
        console.log("\n[Reviewer Feedback]:");
        console.log("-".repeat(40));
        console.log(feedback);
        console.log("-".repeat(40));

        const proceed = await promptUser("Continue with next iteration?");
        if (!proceed) {
          console.log("\n[Orchestrator] Aborted by user");
          state.status = "failed";
          await saveState(state);
          return state;
        }
      }

      console.log("\n[Orchestrator] Sending to Claude for implementation...");

      const implementResult = await runClaude(
        implementPrompt,
        options.workingDir,
        options.verbose
      );

      if (!implementResult.success) {
        console.error(
          "\n[Error] Claude implementation failed:",
          implementResult.error
        );
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
        console.log("\n[Claude Output]:");
        console.log("-".repeat(40));
        console.log(implementResult.output);
        console.log("-".repeat(40));
      } else {
        console.log("[Claude] Implementation complete");
      }
    } else {
      console.log(
        formatIterationHeader(
          state.iteration,
          state.maxIterations,
          "RESUMING REVIEW"
        )
      );
      console.log("[Orchestrator] Skipping implementation - resuming at review step");
    }

    // Step 3: Codex reviews
    state.status = "reviewing";
    state.lastFailedStep = "reviewing";
    await saveState(state);

    console.log("\n[Orchestrator] Asking Codex to review changes...");

    const reviewResult = await runCodexReview(
      state.feature,
      options.workingDir,
      options.verbose
    );

    if (!reviewResult.success) {
      console.error("\n[Error] Codex review failed:", reviewResult.error);
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
      console.log("\n[Codex Review]:");
      console.log("-".repeat(40));
      console.log(reviewResult.output);
      console.log("-".repeat(40));
    }

    // Step 4: Check if approved
    if (isApproved(reviewResult.output)) {
      state.status = "approved";
      await saveState(state);
      console.log("\n" + "=".repeat(60));
      console.log("SUCCESS: Implementation approved!");
      console.log(`Completed in ${state.iteration} iteration(s)`);
      console.log("=".repeat(60));
      return state;
    }

    // Extract feedback for next iteration
    feedback = extractFeedback(reviewResult.output);
    console.log("[Codex] Changes requested - continuing to next iteration");

    // Clear the resuming flags after handling the resumed review
    if (shouldSkipImplementation) {
      resumingFromStep = undefined;
      resumingIteration = 0;
      // Increment iteration now since we skipped it before
      state.iteration++;
    }
  }

  // Max iterations reached
  console.log("\n" + "=".repeat(60));
  console.log(
    `Max iterations (${state.maxIterations}) reached without approval`
  );
  console.log("=".repeat(60));

  if (options.interactive) {
    const continueAnyway = await promptUser(
      "Continue with additional iterations?"
    );
    if (continueAnyway) {
      state.maxIterations += 3;
      state.lastFailedStep = undefined;
      await saveState(state);
      return orchestrate(state.feature, options, state);
    }
  }

  state.status = "failed";
  await saveState(state);
  return state;
}
