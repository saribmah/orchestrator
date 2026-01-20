import { spawn } from "bun";
import { unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { AgentResult } from "../types";

// Default timeout: 5 minutes for codex operations
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

async function readStreamWithTimeout(
  stream: ReadableStream<Uint8Array> | null,
  timeoutMs: number,
): Promise<string> {
  if (!stream) return "";

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  const decoder = new TextDecoder();

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Stream read timeout")), timeoutMs);
  });

  try {
    while (true) {
      const readPromise = reader.read();
      const result = await Promise.race([readPromise, timeoutPromise]);

      if (result.done) break;
      if (result.value) {
        chunks.push(result.value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Concatenate all chunks
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return decoder.decode(combined);
}

export async function runCodexPromptGenerator(
  feature: string,
  workingDir: string,
  verbose: boolean = false,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<AgentResult> {
  const outputFile = join(tmpdir(), `codex-prompt-${Date.now()}.txt`);

  try {
    if (verbose) {
      console.log("\n[Codex] Generating implementation prompt...");
    }

    const prompt = `Given this feature request: "${feature}", generate a detailed implementation prompt for another AI coding agent. Include specific files to create/modify, acceptance criteria, and implementation steps. Be concise but thorough. Do not make any changes, just analyze and provide the prompt.`;

    // Use read-only sandbox so codex only generates a prompt without making changes
    // Use --output-last-message to capture just the final response
    const proc = spawn(
      [
        "codex",
        "exec",
        "--sandbox",
        "read-only",
        "-C",
        workingDir,
        "--output-last-message",
        outputFile,
        prompt,
      ],
      {
        cwd: workingDir,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    // Read streams with timeout
    const exitPromise = proc.exited;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Codex timed out after ${timeoutMs / 1000}s`)), timeoutMs);
    });

    const stdoutPromise = readStreamWithTimeout(proc.stdout, timeoutMs);
    const stderrPromise = readStreamWithTimeout(proc.stderr, timeoutMs);

    let exitCode: number;
    try {
      exitCode = await Promise.race([exitPromise, timeoutPromise]);
    } catch (error) {
      try {
        proc.kill();
      } catch {}
      throw error;
    }

    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);

    if (verbose) {
      console.log("[Codex] Exit code:", exitCode);
      console.log("[Codex] stdout length:", stdout.length);
      console.log("[Codex] stderr length:", stderr.length);
    }

    if (exitCode !== 0) {
      return {
        success: false,
        output: stdout || stderr,
        error: stderr || `Codex exited with code ${exitCode}`,
      };
    }

    // Read the output file for the final message
    let output: string;
    try {
      const file = Bun.file(outputFile);
      output = await file.text();
    } catch {
      // Fall back to stdout/stderr if file doesn't exist
      output = stdout.trim() || stderr.trim();
    }

    if (verbose) {
      console.log("[Codex] Prompt generation complete");
      console.log("[Codex] Output length:", output.length);
    }

    // Clean up temp file
    try {
      await unlink(outputFile);
    } catch {
      // Ignore cleanup errors
    }

    return {
      success: true,
      output,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    // Clean up temp file on error
    try {
      await unlink(outputFile);
    } catch {
      // Ignore cleanup errors
    }

    return {
      success: false,
      output: "",
      error: `Failed to run Codex prompt generator: ${errorMessage}`,
    };
  }
}

export async function runCodexReview(
  feature: string,
  workingDir: string,
  verbose: boolean = false,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<AgentResult> {
  const outputFile = join(tmpdir(), `codex-review-${Date.now()}.txt`);

  try {
    if (verbose) {
      console.log("\n[Codex] Reviewing implementation...");
    }

    // Use codex exec with read-only sandbox for review
    // This allows us to provide feature context
    const reviewPrompt = `Review the uncommitted changes in this repository against the original feature request.

FEATURE REQUEST:
${feature}

INSTRUCTIONS:
1. Run "git diff" to see all uncommitted changes
2. Evaluate if the changes correctly implement the feature request
3. Check for bugs, missing functionality, or issues
4. If the implementation is complete and correct, respond with "APPROVED"
5. If changes are needed, provide specific feedback on what needs to be fixed

Do not make any changes - only analyze and provide your review verdict.`;

    const proc = spawn(
      [
        "codex",
        "exec",
        "--sandbox",
        "read-only",
        "-C",
        workingDir,
        "--output-last-message",
        outputFile,
        reviewPrompt,
      ],
      {
        cwd: workingDir,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    // Read streams with timeout
    const exitPromise = proc.exited;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Codex review timed out after ${timeoutMs / 1000}s`)),
        timeoutMs,
      );
    });

    const stdoutPromise = readStreamWithTimeout(proc.stdout, timeoutMs);
    const stderrPromise = readStreamWithTimeout(proc.stderr, timeoutMs);

    let exitCode: number;
    try {
      exitCode = await Promise.race([exitPromise, timeoutPromise]);
    } catch (error) {
      try {
        proc.kill();
      } catch {}
      throw error;
    }

    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);

    if (verbose) {
      console.log("[Codex] Review exit code:", exitCode);
      console.log("[Codex] stdout length:", stdout.length);
      console.log("[Codex] stderr length:", stderr.length);
    }

    if (exitCode !== 0) {
      return {
        success: false,
        output: stdout || stderr,
        error: stderr || `Codex review exited with code ${exitCode}`,
      };
    }

    // Read the output file for the final message
    let output: string;
    try {
      const file = Bun.file(outputFile);
      output = await file.text();
    } catch {
      // Fall back to stdout/stderr if file doesn't exist
      output = stdout.trim() || stderr.trim();
    }

    if (verbose) {
      console.log("[Codex] Review complete");
      console.log("[Codex] Output length:", output.length);
    }

    // Clean up temp file
    try {
      await unlink(outputFile);
    } catch {
      // Ignore cleanup errors
    }

    return {
      success: true,
      output,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    // Clean up temp file on error
    try {
      await unlink(outputFile);
    } catch {
      // Ignore cleanup errors
    }

    return {
      success: false,
      output: "",
      error: `Failed to run Codex review: ${errorMessage}`,
    };
  }
}

export function isApproved(reviewOutput: string): boolean {
  const normalizedOutput = reviewOutput.toUpperCase();
  return (
    normalizedOutput.includes("APPROVED") ||
    normalizedOutput.includes("LGTM") ||
    normalizedOutput.includes("LOOKS GOOD")
  );
}

export function extractFeedback(reviewOutput: string): string {
  // Remove any approval markers and clean up the feedback
  const lines = reviewOutput
    .split("\n")
    .filter((line) => {
      const upper = line.toUpperCase();
      return !upper.includes("APPROVED") && line.trim().length > 0;
    })
    .join("\n");

  return lines.trim() || reviewOutput;
}
