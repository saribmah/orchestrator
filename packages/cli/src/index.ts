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
  orchestrator --queue "<feature>" [options]
  orchestrator --queue-list
  orchestrator --queue-file <file> [options]

Options:
  -f, --file <file>         Read feature description from file
  -r, --resume              Resume last session (or specific session with --session)
  -s, --session <id>        Session ID to resume (use with --resume)
  -n, --max-iterations <n>  Maximum review cycles (default: 5)
  -i, --interactive         Prompt before each step (default: true)
  --auto                    Run without prompts
  --auto-commit             Automatically commit changes after approval
  -v, --verbose             Show full agent outputs
  -C, --working-dir <dir>   Directory to work in (default: cwd)
  --server                  Start as server only (no CLI interaction)
  --server-url <url>        Connect to existing server (default: ${DEFAULT_SERVER_URL})
  -h, --help                Show this help message

Queue Options:
  --queue                   Add feature to queue instead of running immediately
  --queue-list              Show current queue status
  --queue-file <file>       Add multiple features from file (one per line)
  --queue-clear             Clear all pending queue items
  --queue-watch             Watch queue progress with live updates

Examples:
  orchestrator "Add user authentication with JWT"
  orchestrator -f feature.md -C ./my-project
  orchestrator --resume -v
  orchestrator --resume --session 20250120-143052
  orchestrator "Add dark mode toggle" --max-iterations 5 --verbose
  orchestrator "Refactor database layer" --auto
  orchestrator --server  # Start server only

  # Queue examples
  orchestrator --queue "Add login page" -C ./my-project
  orchestrator --queue-file features.txt --auto-commit
  orchestrator --queue-list
  orchestrator --queue-watch

Sessions are saved to: ~/.orchestrator/sessions/
`;

interface ServerEvent {
  type: string;
  sessionId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

interface QueueItem {
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

interface QueueState {
  items: QueueItem[];
  isProcessing: boolean;
  currentItemId?: string;
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

// Queue functions
async function getQueueState(serverUrl: string): Promise<QueueState> {
  const res = await fetch(`${serverUrl}/queue`);
  if (!res.ok) throw new Error("Failed to get queue state");
  return res.json();
}

async function addToQueue(
  serverUrl: string,
  feature: string,
  options: {
    maxIterations: number;
    verbose: boolean;
    workingDir: string;
    autoCommit: boolean;
  },
): Promise<QueueItem> {
  const res = await fetch(`${serverUrl}/queue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      feature,
      options: {
        maxIterations: options.maxIterations,
        interactive: false,
        verbose: options.verbose,
        workingDir: options.workingDir,
        autoCommit: options.autoCommit,
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

async function addManyToQueue(
  serverUrl: string,
  items: Array<{
    feature: string;
    options: {
      maxIterations: number;
      verbose: boolean;
      workingDir: string;
      autoCommit: boolean;
    };
  }>,
): Promise<QueueItem[]> {
  const res = await fetch(`${serverUrl}/queue/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: items.map((item) => ({
        feature: item.feature,
        options: {
          maxIterations: item.options.maxIterations,
          interactive: false,
          verbose: item.options.verbose,
          workingDir: item.options.workingDir,
          autoCommit: item.options.autoCommit,
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

async function clearQueuePending(serverUrl: string): Promise<number> {
  const res = await fetch(`${serverUrl}/queue`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to clear queue");
  const data = await res.json();
  return parseInt(data.message.match(/\d+/)?.[0] || "0", 10);
}

function printQueueStatus(queue: QueueState) {
  console.log("\n" + "=".repeat(60));
  console.log("QUEUE STATUS");
  console.log("=".repeat(60));

  if (queue.items.length === 0) {
    console.log("\nQueue is empty");
    return;
  }

  const running = queue.items.filter((i) => i.status === "running");
  const pending = queue.items.filter((i) => i.status === "pending");
  const completed = queue.items.filter((i) => i.status === "completed");
  const failed = queue.items.filter((i) => i.status === "failed");

  if (running.length > 0) {
    console.log("\n[RUNNING]");
    for (const item of running) {
      console.log(`  ${item.id}: ${item.feature.slice(0, 60)}${item.feature.length > 60 ? "..." : ""}`);
      console.log(`    Session: ${item.sessionId || "N/A"}`);
      console.log(`    Started: ${new Date(item.startedAt!).toLocaleString()}`);
    }
  }

  if (pending.length > 0) {
    console.log("\n[PENDING] (" + pending.length + " items)");
    for (const item of pending) {
      console.log(`  ${item.id}: ${item.feature.slice(0, 60)}${item.feature.length > 60 ? "..." : ""}`);
    }
  }

  if (completed.length > 0) {
    console.log("\n[COMPLETED] (" + completed.length + " items)");
    for (const item of completed.slice(-5)) {
      console.log(`  ${item.id}: ${item.feature.slice(0, 60)}${item.feature.length > 60 ? "..." : ""}`);
    }
    if (completed.length > 5) {
      console.log(`  ... and ${completed.length - 5} more`);
    }
  }

  if (failed.length > 0) {
    console.log("\n[FAILED] (" + failed.length + " items)");
    for (const item of failed.slice(-5)) {
      console.log(`  ${item.id}: ${item.feature.slice(0, 60)}${item.feature.length > 60 ? "..." : ""}`);
      if (item.error) {
        console.log(`    Error: ${item.error}`);
      }
    }
  }

  console.log("\n" + "=".repeat(60));
}

async function watchQueue(serverUrl: string, verbose: boolean): Promise<void> {
  console.log("\n[Queue] Watching queue progress (Ctrl+C to stop)...\n");

  const response = await fetch(`${serverUrl}/queue/events`);
  if (!response.ok || !response.body) {
    throw new Error("Failed to connect to queue event stream");
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
          handleQueueEvent(event, verbose);
        } catch {
          // Skip malformed events
        }
      }
    }
  }
}

function handleQueueEvent(event: ServerEvent, verbose: boolean) {
  const data = event.data;
  const timestamp = new Date().toLocaleTimeString();

  switch (event.type) {
    case "queue_item_added":
      console.log(`[${timestamp}] Added to queue: ${(data.feature as string)?.slice(0, 50)}...`);
      break;

    case "queue_item_started":
      console.log(`[${timestamp}] Started: ${data.itemId} (Session: ${data.sessionId})`);
      break;

    case "queue_item_completed":
      console.log(`[${timestamp}] Completed: ${data.itemId}`);
      break;

    case "queue_item_failed":
      console.log(`[${timestamp}] Failed: ${data.itemId} - ${data.error}`);
      break;

    case "log":
      if (verbose || data.level !== "verbose") {
        console.log(`  ${data.message}`);
      }
      break;

    case "agent_start":
      console.log(`  [${data.agent}] Starting ${data.role}...`);
      break;

    case "agent_complete":
      console.log(`  [${data.agent}] ${data.role} ${data.success ? "complete" : "failed"}`);
      break;

    case "iteration":
      console.log(`  Iteration ${data.iteration}/${data.maxIterations}`);
      break;
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
      "auto-commit": { type: "boolean", default: false },
      verbose: { type: "boolean", short: "v", default: false },
      "working-dir": { type: "string", short: "C", default: process.cwd() },
      server: { type: "boolean", default: false },
      "server-url": { type: "string", default: DEFAULT_SERVER_URL },
      help: { type: "boolean", short: "h", default: false },
      // Queue options
      queue: { type: "boolean", default: false },
      "queue-list": { type: "boolean", default: false },
      "queue-file": { type: "string" },
      "queue-clear": { type: "boolean", default: false },
      "queue-watch": { type: "boolean", default: false },
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
  const autoCommit = values["auto-commit"] as boolean;

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

  // Queue commands
  try {
    // Queue list
    if (values["queue-list"]) {
      const queue = await getQueueState(serverUrl);
      printQueueStatus(queue);
      cleanup();
      process.exit(0);
    }

    // Queue clear
    if (values["queue-clear"]) {
      const cleared = await clearQueuePending(serverUrl);
      console.log(`Cleared ${cleared} pending item(s) from queue`);
      cleanup();
      process.exit(0);
    }

    // Queue watch
    if (values["queue-watch"]) {
      await watchQueue(serverUrl, verbose);
      cleanup();
      process.exit(0);
    }

    // Add from file to queue
    if (values["queue-file"]) {
      const filePath = values["queue-file"] as string;
      let features: string[];

      try {
        const file = Bun.file(filePath);
        const content = await file.text();

        // Try parsing as JSON array first
        try {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) {
            features = parsed.map((item: string | { feature: string }) =>
              typeof item === "string" ? item : item.feature
            );
          } else {
            throw new Error("Not an array");
          }
        } catch {
          // Treat as one feature per line
          features = content
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith("#"));
        }
      } catch {
        console.error(`Error: Could not read file "${filePath}"`);
        cleanup();
        process.exit(1);
      }

      if (features.length === 0) {
        console.error("Error: No features found in file");
        cleanup();
        process.exit(1);
      }

      const options = {
        maxIterations: parseInt(values["max-iterations"] as string, 10),
        verbose,
        workingDir: values["working-dir"] as string,
        autoCommit,
      };

      const items = await addManyToQueue(
        serverUrl,
        features.map((feature) => ({ feature, options }))
      );

      console.log(`Added ${items.length} feature(s) to queue:`);
      for (const item of items) {
        console.log(`  - ${item.id}: ${item.feature.slice(0, 50)}${item.feature.length > 50 ? "..." : ""}`);
      }

      if (values["queue-watch"]) {
        await watchQueue(serverUrl, verbose);
      }

      cleanup();
      process.exit(0);
    }

    // Add single item to queue
    if (values.queue) {
      const feature = positionals[0];
      if (!feature) {
        console.error("Error: Feature description is required with --queue");
        cleanup();
        process.exit(1);
      }

      const item = await addToQueue(serverUrl, feature, {
        maxIterations: parseInt(values["max-iterations"] as string, 10),
        verbose,
        workingDir: values["working-dir"] as string,
        autoCommit,
      });

      console.log(`Added to queue: ${item.id}`);
      console.log(`Feature: ${item.feature.slice(0, 60)}${item.feature.length > 60 ? "..." : ""}`);

      const queue = await getQueueState(serverUrl);
      const pending = queue.items.filter((i) => i.status === "pending").length;
      const running = queue.items.filter((i) => i.status === "running").length;
      console.log(`Queue status: ${running} running, ${pending} pending`);

      cleanup();
      process.exit(0);
    }
  } catch (error) {
    console.error("\nQueue error:", error);
    cleanup();
    process.exit(1);
  }

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
          options: { interactive, verbose, autoCommit },
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
          autoCommit,
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
