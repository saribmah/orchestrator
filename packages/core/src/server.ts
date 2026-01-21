import { Hono } from "hono";
import { cors } from "hono/cors";
import { orchestrate } from "./orchestrator.ts";
import { loadState, listSessions, getSessionsDir, generateSessionId } from "./state.ts";
import { bus, emitEvent } from "./bus.ts";
import { createSSEHandler, startKeepAlive } from "./sse.ts";
import type { OrchestrationState, OrchestratorOptions } from "./types.ts";

const DEFAULT_PORT = 3100;

// Pending questions for interactive sessions
interface PendingQuestion {
  resolve: (answer: boolean) => void;
  question: string;
}

const pendingQuestions = new Map<string, PendingQuestion>();

// Track active orchestration states
const activeSessionStates = new Map<string, OrchestrationState>();

// Start keep-alive pings for SSE connections
startKeepAlive(15000);

const app = new Hono();

// CORS middleware
app.use("*", cors());

// Health check
app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

// List all sessions
app.get("/sessions", (c) => {
  const sessions = listSessions();
  return c.json({ sessions, sessionsDir: getSessionsDir() });
});

// Start a new session
app.post("/sessions", async (c) => {
  const body = await c.req.json();
  const { feature, options } = body as {
    feature: string;
    options: Partial<OrchestratorOptions>;
  };

  if (!feature) {
    return c.json({ error: "Feature is required" }, 400);
  }

  const orchestratorOptions: OrchestratorOptions = {
    maxIterations: options?.maxIterations ?? 5,
    interactive: options?.interactive ?? true,
    verbose: options?.verbose ?? false,
    workingDir: options?.workingDir ?? process.cwd(),
    autoCommit: options?.autoCommit ?? false,
  };

  // Generate session ID upfront so we can return it to the client
  const sessionId = generateSessionId();

  // Start orchestration in background
  const sessionPromise = orchestrate(
    feature,
    orchestratorOptions,
    {
      onEvent: (event) => {
        // Publish to the event bus
        bus.publish(event);
      },
      onQuestion: async (question) => {
        return new Promise((resolve) => {
          pendingQuestions.set(sessionId, { resolve, question });
          emitEvent("question", sessionId, {
            question,
            questionId: Date.now().toString(),
          });
        });
      },
    },
    undefined,
    sessionId,
  );

  // Don't await - let it run in background
  sessionPromise
    .then((finalState) => {
      activeSessionStates.set(finalState.id, finalState);
    })
    .catch((error) => {
      console.error(`Session ${sessionId} failed:`, error);
      emitEvent("error", sessionId, {
        message: error?.message || "Unknown error",
        fatal: true,
      });
      emitEvent("complete", sessionId, {
        status: "failed",
        iterations: 0,
      });
    });

  // Return session ID so client can connect to events immediately
  return c.json(
    {
      sessionId,
      message: "Session started",
      note: "Connect to /sessions/:id/events for real-time updates",
    },
    202,
  );
});

// Get session state
app.get("/sessions/:id", async (c) => {
  const sessionId = c.req.param("id");
  const state = await loadState(sessionId);

  if (!state) {
    return c.json({ error: "Session not found" }, 404);
  }

  return c.json(state);
});

// Resume a session
app.post("/sessions/:id/resume", async (c) => {
  const sessionId = c.req.param("id");
  const body = await c.req.json();
  const { options } = body as { options?: Partial<OrchestratorOptions> };

  const savedState = await loadState(sessionId);
  if (!savedState) {
    return c.json({ error: "Session not found" }, 404);
  }

  const orchestratorOptions: OrchestratorOptions = {
    maxIterations: savedState.maxIterations,
    interactive: options?.interactive ?? true,
    verbose: options?.verbose ?? false,
    workingDir: savedState.workingDir,
    autoCommit: options?.autoCommit ?? false,
  };

  // Resume orchestration in background
  const sessionPromise = orchestrate(
    savedState.feature,
    orchestratorOptions,
    {
      onEvent: (event) => {
        bus.publish(event);
      },
      onQuestion: async (question) => {
        return new Promise((resolve) => {
          pendingQuestions.set(sessionId, { resolve, question });
          emitEvent("question", sessionId, {
            question,
            questionId: Date.now().toString(),
          });
        });
      },
    },
    savedState,
  );

  sessionPromise.then((finalState) => {
    activeSessionStates.set(finalState.id, finalState);
  });

  return c.json({ message: "Session resumed", sessionId }, 202);
});

// Respond to a question
app.post("/sessions/:id/respond", async (c) => {
  const sessionId = c.req.param("id");
  const body = await c.req.json();
  const { answer } = body as { answer: boolean };

  const pending = pendingQuestions.get(sessionId);
  if (!pending) {
    return c.json({ error: "No pending question for this session" }, 400);
  }

  pending.resolve(answer);
  pendingQuestions.delete(sessionId);

  return c.json({ message: "Response recorded" });
});

// SSE stream for session events
app.get("/sessions/:id/events", async (c) => {
  const sessionId = c.req.param("id");
  const handler = createSSEHandler(sessionId);
  return handler(c);
});

// Stats endpoint for debugging
app.get("/stats", (c) => {
  return c.json({
    busSubscribers: bus.subscriberCount,
    pendingQuestions: pendingQuestions.size,
    activeStates: activeSessionStates.size,
  });
});

const port = parseInt(process.env.PORT || String(DEFAULT_PORT), 10);

console.log(`Orchestrator server starting on port ${port}...`);

export default {
  port,
  fetch: app.fetch,
  idleTimeout: 255,
};

console.log(`Orchestrator server running at http://localhost:${port}`);
console.log(`
Endpoints:
  GET  /health              - Health check
  GET  /sessions            - List all sessions
  POST /sessions            - Start new session
  GET  /sessions/:id        - Get session state
  POST /sessions/:id/resume - Resume session
  POST /sessions/:id/respond - Respond to question
  GET  /sessions/:id/events - SSE event stream
  GET  /stats               - Server stats
`);
