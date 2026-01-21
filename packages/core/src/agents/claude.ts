import { spawn, spawnSync } from "bun";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { AgentResult } from "../types.ts";

function findClaudeExecutable(): string {
  // Check common locations for claude
  const locations = [
    join(homedir(), ".claude", "local", "claude"),
    join(homedir(), ".local", "bin", "claude"),
    "/usr/local/bin/claude",
  ];

  for (const loc of locations) {
    if (existsSync(loc)) {
      return loc;
    }
  }

  // Try to resolve via shell
  const result = spawnSync(["bash", "-lc", "which claude"]);
  const resolved = new TextDecoder().decode(result.stdout).trim();
  if (resolved && existsSync(resolved)) {
    return resolved;
  }

  // Fallback to just "claude" and hope it's in PATH
  return "claude";
}

const CLAUDE_PATH = findClaudeExecutable();

// Default timeout: 10 minutes per implementation
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

async function readStreamWithTimeout(
  stream: ReadableStream<Uint8Array> | null,
  timeoutMs: number,
  abortSignal?: { aborted: boolean },
): Promise<string> {
  if (!stream) return "";

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  const decoder = new TextDecoder();

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      if (!abortSignal?.aborted) {
        reject(new Error("Stream read timeout"));
      }
    }, timeoutMs);
  });

  try {
    while (true) {
      // Check if aborted
      if (abortSignal?.aborted) break;

      const readPromise = reader.read();
      const result = await Promise.race([readPromise, timeoutPromise]);

      if (result.done) break;
      if (result.value) {
        chunks.push(result.value);
      }
    }
  } catch (error) {
    // If aborted, don't rethrow - just return what we have
    if (abortSignal?.aborted) {
      // Continue to return collected chunks
    } else {
      throw error;
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    try {
      reader.releaseLock();
    } catch {
      // Ignore release errors
    }
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

export async function runClaude(
  prompt: string,
  workingDir: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<AgentResult> {
  const abortSignal = { aborted: false };
  let mainTimeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const proc = spawn([CLAUDE_PATH, "-p", prompt, "--dangerously-skip-permissions"], {
      cwd: workingDir,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        PATH: process.env.PATH,
      },
    });

    const exitPromise = proc.exited;
    const timeoutPromise = new Promise<never>((_, reject) => {
      mainTimeoutId = setTimeout(() => {
        reject(new Error(`Claude timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
    });

    // Start reading streams with abort signal
    const stdoutPromise = readStreamWithTimeout(proc.stdout, timeoutMs + 5000, abortSignal);
    const stderrPromise = readStreamWithTimeout(proc.stderr, timeoutMs + 5000, abortSignal);

    let exitCode: number;
    let timedOut = false;
    try {
      exitCode = await Promise.race([exitPromise, timeoutPromise]);
    } catch (error) {
      timedOut = true;
      // Signal streams to abort
      abortSignal.aborted = true;
      try {
        proc.kill();
      } catch {}

      // Wait a bit for streams to settle, then collect what we have
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Try to get partial output
      let partialStdout = "";
      let partialStderr = "";
      try {
        partialStdout = await Promise.race([
          stdoutPromise,
          new Promise<string>((resolve) => setTimeout(() => resolve(""), 500)),
        ]);
        partialStderr = await Promise.race([
          stderrPromise,
          new Promise<string>((resolve) => setTimeout(() => resolve(""), 500)),
        ]);
      } catch {
        // Ignore errors getting partial output
      }

      return {
        success: false,
        output: partialStdout,
        error: `Claude timed out after ${timeoutMs / 1000}s${partialStderr ? `: ${partialStderr}` : ""}`,
      };
    }

    // Clear the main timeout since process exited
    if (mainTimeoutId) clearTimeout(mainTimeoutId);

    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);

    if (exitCode !== 0) {
      return {
        success: false,
        output: stdout,
        error: stderr || `Claude exited with code ${exitCode}`,
      };
    }

    return {
      success: true,
      output: stdout,
    };
  } catch (error) {
    // Ensure abort signal is set
    abortSignal.aborted = true;
    if (mainTimeoutId) clearTimeout(mainTimeoutId);

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      output: "",
      error: `Failed to run Claude: ${errorMessage}`,
    };
  }
}

export function getClaudePath(): string {
  return CLAUDE_PATH;
}
