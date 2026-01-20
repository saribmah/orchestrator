export function buildImplementationPrompt(
  generatedPrompt: string,
  iteration: number,
  feedback?: string,
): string {
  let prompt = generatedPrompt;

  if (iteration > 1 && feedback) {
    prompt = `
PREVIOUS IMPLEMENTATION FEEDBACK (Iteration ${iteration - 1}):
${feedback}

Please address the feedback above and continue with the implementation.

ORIGINAL TASK:
${generatedPrompt}
`.trim();
  }

  return prompt;
}

export function buildFeedbackPrompt(
  originalFeature: string,
  feedback: string,
  iteration: number,
): string {
  return `
You are continuing to implement a feature. This is iteration ${iteration}.

ORIGINAL FEATURE REQUEST:
${originalFeature}

REVIEWER FEEDBACK FROM PREVIOUS ATTEMPT:
${feedback}

Please address all the feedback points and complete the implementation.
Do not explain what you're doing - just make the changes.
`.trim();
}

export function formatIterationHeader(
  iteration: number,
  maxIterations: number,
  status: string,
): string {
  return `\n${"=".repeat(60)}\nIteration ${iteration}/${maxIterations} - ${status}\n${"=".repeat(60)}`;
}
