#!/usr/bin/env bun

import { parseArgs } from "util";
import { spawn, type Subprocess } from "bun";

const DEFAULT_SERVER_URL = "http://localhost:3100";

const HELP_TEXT = `
Orchestrator: Multi-Agent Feature Implementation Tool

Usage:
  orchestrator "<feature description>" [options]
  orchestrator -f <file> [options]
  orchestrator --resume [options]
  orchestrator --server [options]

Options:
  -f, --file <file>         Read feature description from file
  -r, --resume              Resume last session (or specific session with --session)
  -s, --session <id>        Session ID to resume (use with --resume)
  -n, --max-iterations <n>  Maximum review cycles (default: 5)
  -i, --interactive         Prompt before each step (default: true)
  --auto                    Run without prompts
  -v, --verbose             Show full agent outputs
  -C, --working-dir <dir>   Directory to work in (default: cwd)
  --server                  Start as server only (no CLI interaction)
  --server-url <url>        Connect to existing server (default: ${DEFAULT_SERVER_URL})
  -h, --help                Show this help message

Examples:
  orchestrator "Add user authentication with JWT"
  orchestrator -f feature.md -C ./my-project
  orchestrator --resume -v
  orchestrator --resume --session 20250120-143052
  orchestrator "Add dark mode toggle" --max-iterations 5 --verbose
  orchestrator "Refactor database layer" --auto
  orchestrator --server  # Start server only

Sessions are saved to: ~/.orchestrator/sessions/
`;

interface ServerEvent {
  type: string;
  sessionId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

function printHelp() {
  console.log(HELP_TEXT);
}

async function promptUser(message: string): Promise<boolean> {
  process.stdout.write(`\n${message} (y/n): `);
  for await (const line of console) {
    const answer = line.trim().toLowerCase();
    return answer === "y" || answer === "yes";
  }
  return false;
}

async function checkServerHealth(serverUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${serverUrl}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function startServer(): Promise<Subprocess> {
  const corePath = new URL("../../core/src/server.ts", import.meta.url).pathname;
  const proc = spawn(["bun", "run", corePath], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });

  // Wait for server to be ready
  let attempts = 0;
  while (attempts < 30) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (await checkServerHealth(DEFAULT_SERVER_URL)) {
      return proc;
    }
    attempts++;
  }

  proc.kill();
  throw new Error("Failed to start server");
}

async function listenToEvents(
  serverUrl: string,
  sessionId: string,
  verbose: boolean,
  onQuestion: (question: string) => Promise<boolean>,
): Promise<void> {
  const response = await fetch(`${serverUrl}/sessions/${sessionId}/events`);

  if (!response.ok || !response.body) {
    throw new Error("Failed to connect to event stream");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const event = JSON.parse(line.slice(6)) as ServerEvent;
          await handleEvent(event, serverUrl, sessionId, verbose, onQuestion);

          // Exit on completion
          if (event.type === "complete") {
            return;
          }
        } catch {
          // Skip malformed events
        }
      }
    }
  }
}

async function handleEvent(
  event: ServerEvent,
  serverUrl: string,
  sessionId: string,
  verbose: boolean,
  onQuestion: (question: string) => Promise<boolean>,
): Promise<void> {
  const data = event.data;

  switch (event.type) {
    case "status":
      if (data.status) {
        // Status update - no action needed
      }
      break;

    case "log":
      if (data.level === "verbose" && !verbose) {
        break;
      }
      if (data.level === "error") {
        console.error(`[Error] ${data.message}`);
      } else if (data.level === "verbose") {
        console.log("-".repeat(40));
        console.log(data.message);
        console.log("-".repeat(40));
      } else {
        console.log(`[Orchestrator] ${data.message}`);
      }
      break;

    case "iteration":
      console.log("\n" + "=".repeat(60));
      console.log(`Iteration ${data.iteration}/${data.maxIterations} - ${data.phase}`);
      console.log("=".repeat(60));
      break;

    case "agent_start":
      console.log(`\n[${data.agent}] Starting ${data.role}...`);
      break;

    case "agent_complete":
      if (data.success) {
        console.log(`[${data.agent}] ${data.role} complete`);
        if (verbose && data.output) {
          console.log("-".repeat(40));
          console.log(data.output);
          console.log("-".repeat(40));
        }
      } else {
        console.error(`[${data.agent}] ${data.role} failed`);
      }
      break;

    case "question": {
      const answer = await onQuestion(data.question as string);
      await fetch(`${serverUrl}/sessions/${sessionId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer }),
      });
      break;
    }

    case "complete":
      console.log("\n" + "=".repeat(60));
      if (data.status === "approved") {
        console.log("SUCCESS: Implementation approved!");
        console.log(`Completed in ${data.iterations} iteration(s)`);
      } else {
        console.log("Implementation did not complete successfully");
        console.log(`Final status: ${data.status}`);
      }
      console.log("=".repeat(60));
      break;

    case "error":
      console.error(`\n[Error] ${data.message}`);
      break;
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      file: { type: "string", short: "f" },
      resume: { type: "boolean", short: "r", default: false },
      session: { type: "string", short: "s" },
      "max-iterations": { type: "string", short: "n", default: "5" },
      interactive: { type: "boolean", short: "i", default: true },
      auto: { type: "boolean", default: false },
      verbose: { type: "boolean", short: "v", default: false },
      "working-dir": { type: "string", short: "C", default: process.cwd() },
      server: { type: "boolean", default: false },
      "server-url": { type: "string", default: DEFAULT_SERVER_URL },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const serverUrl = values["server-url"] as string;
  const verbose = values.verbose as boolean;
  const interactive = values.auto ? false : (values.interactive as boolean);

  // Server-only mode
  if (values.server) {
    console.log("Starting orchestrator server...");
    const corePath = new URL("../../core/src/server.ts", import.meta.url).pathname;
    const proc = spawn(["bun", "run", corePath], {
      stdout: "inherit",
      stderr: "inherit",
      env: { ...process.env },
    });
    await proc.exited;
    process.exit(0);
  }

  // Check if server is running, start if not
  let serverProc: Subprocess | null = null;
  if (!(await checkServerHealth(serverUrl))) {
    console.log("[Orchestrator] Starting server...");
    serverProc = await startServer();
    console.log("[Orchestrator] Server started");
  }

  const cleanup = () => {
    if (serverProc) {
      serverProc.kill();
    }
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  try {
    // Handle resume
    if (values.resume) {
      const sessionId = values.session as string | undefined;

      // Get sessions list to find the right one
      if (!sessionId) {
        const sessionsRes = await fetch(`${serverUrl}/sessions`);
        const sessionsData = await sessionsRes.json();
        if (!sessionsData.sessions || sessionsData.sessions.length === 0) {
          console.error("Error: No saved sessions found to resume");
          cleanup();
          process.exit(1);
        }
        console.log("Available sessions:", sessionsData.sessions.slice(0, 5).join(", "));
        console.log("Use --session <id> to specify which session to resume");
        cleanup();
        process.exit(1);
      }

      // Check session exists
      const sessionRes = await fetch(`${serverUrl}/sessions/${sessionId}`);
      if (!sessionRes.ok) {
        console.error(`Error: Session "${sessionId}" not found`);
        cleanup();
        process.exit(1);
      }

      console.log(`Resuming session ${sessionId}...`);

      // Start resume
      await fetch(`${serverUrl}/sessions/${sessionId}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          options: { interactive, verbose },
        }),
      });

      // Listen to events
      await listenToEvents(serverUrl, sessionId, verbose, promptUser);

      cleanup();
      process.exit(0);
    }

    // Get feature description
    let feature = positionals[0];

    if (values.file) {
      try {
        const file = Bun.file(values.file as string);
        feature = await file.text();
        feature = feature.trim();
      } catch {
        console.error(`Error: Could not read file "${values.file}"\n`);
        cleanup();
        process.exit(1);
      }
    }

    if (!feature) {
      console.error("Error: Feature description is required\n");
      printHelp();
      cleanup();
      process.exit(1);
    }

    console.log("\n" + "=".repeat(60));
    console.log("ORCHESTRATOR: Multi-Agent Feature Implementation");
    console.log("=".repeat(60));

    // Start new session
    const startRes = await fetch(`${serverUrl}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        feature,
        options: {
          maxIterations: parseInt(values["max-iterations"] as string, 10),
          interactive,
          verbose,
          workingDir: values["working-dir"] as string,
        },
      }),
    });

    if (!startRes.ok) {
      const error = await startRes.json();
      console.error("Error starting session:", error.error);
      cleanup();
      process.exit(1);
    }

    // Wait a moment for session to be created, then get ID from sessions list
    await new Promise((resolve) => setTimeout(resolve, 500));
    const sessionsRes = await fetch(`${serverUrl}/sessions`);
    const sessionsData = await sessionsRes.json();
    const sessionId = sessionsData.sessions[0];

    if (!sessionId) {
      console.error("Error: Could not determine session ID");
      cleanup();
      process.exit(1);
    }

    // Listen to events
    await listenToEvents(serverUrl, sessionId, verbose, promptUser);

    // Get final state to determine exit code
    const finalStateRes = await fetch(`${serverUrl}/sessions/${sessionId}`);
    const finalState = await finalStateRes.json();

    cleanup();
    process.exit(finalState.status === "approved" ? 0 : 1);
  } catch (error) {
    console.error("\nFatal error:", error);
    cleanup();
    process.exit(1);
  }
}

main();
