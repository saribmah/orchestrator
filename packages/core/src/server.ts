import { orchestrate } from "./orchestrator.ts";
import { loadState, listSessions, getSessionsDir, generateSessionId } from "./state.ts";
import type { OrchestrationState, OrchestratorOptions, ServerEvent } from "./types.ts";

const DEFAULT_PORT = 3100;

// SSE stream writer
interface SSEWriter {
  writer: WritableStreamDefaultWriter<Uint8Array>;
  closed: boolean;
}

// Active sessions with their event streams and pending questions
interface ActiveSession {
  state: OrchestrationState | null;
  eventStreams: Set<SSEWriter>;
  pendingQuestion: {
    resolve: (answer: boolean) => void;
    question: string;
  } | null;
}

const activeSessions = new Map<string, ActiveSession>();

function getOrCreateSession(sessionId: string): ActiveSession {
  if (!activeSessions.has(sessionId)) {
    activeSessions.set(sessionId, {
      state: null,
      eventStreams: new Set(),
      pendingQuestion: null,
    });
  }
  return activeSessions.get(sessionId)!;
}

function broadcastEvent(sessionId: string, event: ServerEvent): void {
  const session = activeSessions.get(sessionId);
  if (!session) {
    console.log(`[SSE] No session found for ${sessionId}`);
    return;
  }

  const data = `data: ${JSON.stringify(event)}\n\n`;
  const encoder = new TextEncoder();
  const encoded = encoder.encode(data);

  console.log(`[SSE] Broadcasting ${event.type} to ${session.eventStreams.size} streams for session ${sessionId}`);

  const deadWriters: SSEWriter[] = [];

  for (const streamInfo of session.eventStreams) {
    if (streamInfo.closed) {
      deadWriters.push(streamInfo);
      continue;
    }
    streamInfo.writer.write(encoded).catch(() => {
      console.log(`[SSE] Stream write failed`);
      streamInfo.closed = true;
      deadWriters.push(streamInfo);
    });
  }

  // Clean up dead writers
  for (const writer of deadWriters) {
    session.eventStreams.delete(writer);
    console.log(`[SSE] Removed dead stream, ${session.eventStreams.size} remaining`);
  }
}

// Send keep-alive pings to all sessions
setInterval(() => {
  const now = new Date().toISOString();
  const encoder = new TextEncoder();

  for (const [_sessionId, session] of activeSessions) {
    if (session.eventStreams.size > 0) {
      const ping = `:ping ${now}\n\n`;
      const encoded = encoder.encode(ping);
      const deadWriters: SSEWriter[] = [];

      for (const streamInfo of session.eventStreams) {
        if (streamInfo.closed) {
          deadWriters.push(streamInfo);
          continue;
        }
        streamInfo.writer.write(encoded).catch(() => {
          streamInfo.closed = true;
          deadWriters.push(streamInfo);
        });
      }

      for (const writer of deadWriters) {
        session.eventStreams.delete(writer);
      }
    }
  }
}, 15000);

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // CORS headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // GET /health - Health check
  if (path === "/health" && req.method === "GET") {
    return Response.json({ status: "ok" }, { headers: corsHeaders });
  }

  // GET /sessions - List all sessions
  if (path === "/sessions" && req.method === "GET") {
    const sessions = listSessions();
    return Response.json({ sessions, sessionsDir: getSessionsDir() }, { headers: corsHeaders });
  }

  // POST /sessions - Start a new session
  if (path === "/sessions" && req.method === "POST") {
    const body = await req.json();
    const { feature, options } = body as {
      feature: string;
      options: Partial<OrchestratorOptions>;
    };

    if (!feature) {
      return Response.json({ error: "Feature is required" }, { status: 400, headers: corsHeaders });
    }

    const orchestratorOptions: OrchestratorOptions = {
      maxIterations: options?.maxIterations ?? 5,
      interactive: options?.interactive ?? true,
      verbose: options?.verbose ?? false,
      workingDir: options?.workingDir ?? process.cwd(),
    };

    // Generate session ID upfront so we can return it to the client
    const sessionId = generateSessionId();
    getOrCreateSession(sessionId);

    // Start orchestration in background
    const sessionPromise = orchestrate(
      feature,
      orchestratorOptions,
      {
        onEvent: (event) => {
          broadcastEvent(event.sessionId, event);
        },
        onQuestion: async (question) => {
          return new Promise((resolve) => {
            const session = getOrCreateSession(sessionId);
            session.pendingQuestion = { resolve, question };
            broadcastEvent(sessionId, {
              type: "question",
              sessionId,
              timestamp: new Date().toISOString(),
              data: { question, questionId: Date.now().toString() },
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
        const session = activeSessions.get(finalState.id);
        if (session) {
          session.state = finalState;
        }
      })
      .catch((error) => {
        console.error(`Session ${sessionId} failed:`, error);
        broadcastEvent(sessionId, {
          type: "error",
          sessionId,
          timestamp: new Date().toISOString(),
          data: { message: error?.message || "Unknown error", fatal: true },
        });
        broadcastEvent(sessionId, {
          type: "complete",
          sessionId,
          timestamp: new Date().toISOString(),
          data: { status: "failed", iterations: 0 },
        });
      });

    // Return session ID so client can connect to events immediately
    return Response.json(
      {
        sessionId,
        message: "Session started",
        note: "Connect to /sessions/:id/events for real-time updates",
      },
      { status: 202, headers: corsHeaders },
    );
  }

  // GET /sessions/:id - Get session state
  const sessionMatch = path.match(/^\/sessions\/([^/]+)$/);
  if (sessionMatch && sessionMatch[1] && req.method === "GET") {
    const sessionId = sessionMatch[1];
    const state = await loadState(sessionId);

    if (!state) {
      return Response.json({ error: "Session not found" }, { status: 404, headers: corsHeaders });
    }

    return Response.json(state, { headers: corsHeaders });
  }

  // POST /sessions/:id/resume - Resume a session
  const resumeMatch = path.match(/^\/sessions\/([^/]+)\/resume$/);
  if (resumeMatch && resumeMatch[1] && req.method === "POST") {
    const sessionId = resumeMatch[1];
    const body = await req.json();
    const { options } = body as { options?: Partial<OrchestratorOptions> };

    const savedState = await loadState(sessionId);
    if (!savedState) {
      return Response.json({ error: "Session not found" }, { status: 404, headers: corsHeaders });
    }

    const orchestratorOptions: OrchestratorOptions = {
      maxIterations: savedState.maxIterations,
      interactive: options?.interactive ?? true,
      verbose: options?.verbose ?? false,
      workingDir: savedState.workingDir,
    };

    // Resume orchestration in background
    const sessionPromise = orchestrate(
      savedState.feature,
      orchestratorOptions,
      {
        onEvent: (event) => {
          broadcastEvent(event.sessionId, event);
        },
        onQuestion: async (question) => {
          return new Promise((resolve) => {
            const session = getOrCreateSession(sessionId);
            session.pendingQuestion = { resolve, question };
            broadcastEvent(sessionId, {
              type: "question",
              sessionId,
              timestamp: new Date().toISOString(),
              data: { question, questionId: Date.now().toString() },
            });
          });
        },
      },
      savedState,
    );

    sessionPromise.then((finalState) => {
      const session = activeSessions.get(finalState.id);
      if (session) {
        session.state = finalState;
      }
    });

    return Response.json(
      { message: "Session resumed", sessionId },
      { status: 202, headers: corsHeaders },
    );
  }

  // POST /sessions/:id/respond - Respond to a question
  const respondMatch = path.match(/^\/sessions\/([^/]+)\/respond$/);
  if (respondMatch && respondMatch[1] && req.method === "POST") {
    const sessionId = respondMatch[1];
    const body = await req.json();
    const { answer } = body as { answer: boolean };

    const session = activeSessions.get(sessionId);
    if (!session?.pendingQuestion) {
      return Response.json(
        { error: "No pending question for this session" },
        { status: 400, headers: corsHeaders },
      );
    }

    session.pendingQuestion.resolve(answer);
    session.pendingQuestion = null;

    return Response.json({ message: "Response recorded" }, { headers: corsHeaders });
  }

  // GET /sessions/:id/events - SSE stream for session events
  const eventsMatch = path.match(/^\/sessions\/([^/]+)\/events$/);
  if (eventsMatch && eventsMatch[1] && req.method === "GET") {
    const sessionId = eventsMatch[1];
    const session = getOrCreateSession(sessionId);

    // Use TransformStream for better control over SSE
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Add this writer to the session
    const streamInfo: SSEWriter = { writer, closed: false };
    session.eventStreams.add(streamInfo);
    console.log(`[SSE] Stream connected for session ${sessionId}, total: ${session.eventStreams.size}`);

    // Send initial connection event
    const event: ServerEvent = {
      type: "status",
      sessionId,
      timestamp: new Date().toISOString(),
      data: { connected: true },
    };
    writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)).catch(() => {
      streamInfo.closed = true;
      session.eventStreams.delete(streamInfo);
    });

    return new Response(readable, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
}

const port = parseInt(process.env.PORT || String(DEFAULT_PORT), 10);

console.log(`Orchestrator server starting on port ${port}...`);

Bun.serve({
  port,
  fetch: handleRequest,
  // Set high idle timeout for SSE connections (255 is max in Bun)
  idleTimeout: 255,
});

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
`);
