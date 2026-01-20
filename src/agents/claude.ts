import { spawn, spawnSync } from "bun";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { AgentResult } from "../types";

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

export async function runClaude(
  prompt: string,
  workingDir: string,
  verbose: boolean = false,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<AgentResult> {
  try {
    if (verbose) {
      console.log("\n[Claude] Starting implementation...");
      console.log("[Claude] Working directory:", workingDir);
      console.log("[Claude] Executable:", CLAUDE_PATH);
    }

    const proc = spawn([CLAUDE_PATH, "-p", prompt, "--dangerously-skip-permissions"], {
      cwd: workingDir,
      stdin: "ignore", // Close stdin so Claude doesn't wait for input
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        PATH: process.env.PATH,
      },
    });

    // Read stdout and stderr concurrently with timeout
    // Also wait for process exit with timeout
    const exitPromise = proc.exited;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Claude timed out after ${timeoutMs / 1000}s`)), timeoutMs);
    });

    // Start reading streams immediately (don't await yet)
    const stdoutPromise = readStreamWithTimeout(proc.stdout, timeoutMs);
    const stderrPromise = readStreamWithTimeout(proc.stderr, timeoutMs);

    // Wait for exit or timeout
    let exitCode: number;
    try {
      exitCode = await Promise.race([exitPromise, timeoutPromise]);
    } catch (error) {
      // Timeout - try to kill the process
      try {
        proc.kill();
      } catch {}
      throw error;
    }

    // Now get the output (should be ready since process exited)
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);

    if (verbose) {
      console.log("[Claude] Exit code:", exitCode);
      console.log("[Claude] Output length:", stdout.length);
    }

    if (exitCode !== 0) {
      return {
        success: false,
        output: stdout,
        error: stderr || `Claude exited with code ${exitCode}`,
      };
    }

    if (verbose) {
      console.log("[Claude] Implementation complete");
    }

    return {
      success: true,
      output: stdout,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      output: "",
      error: `Failed to run Claude: ${errorMessage}`,
    };
  }
}
