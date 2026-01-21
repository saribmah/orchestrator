import { useEffect, useState, useRef } from "react";
import {
  getSession,
  subscribeToEvents,
  respondToQuestion,
  resumeSession,
  type SessionState,
  type ServerEvent,
} from "../api.ts";

interface SessionViewProps {
  sessionId: string;
  onBack: () => void;
}

interface LogEntry {
  id: string;
  type: string;
  timestamp: string;
  content: string;
  level?: string;
}

export function SessionView({ sessionId, onBack }: SessionViewProps) {
  const [session, setSession] = useState<SessionState | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isResuming, setIsResuming] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadSession();
    const unsubscribe = subscribeToEvents(
      sessionId,
      handleEvent,
      () => setConnected(false)
    );
    setConnected(true);

    return () => unsubscribe();
  }, [sessionId]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  async function loadSession() {
    try {
      const state = await getSession(sessionId);
      setSession(state);

      // Convert history to log entries
      if (state.history && state.history.length > 0) {
        const historyLogs: LogEntry[] = [];
        let lastIteration = -1;

        for (const entry of state.history) {
          // Add iteration header when iteration changes
          if (entry.iteration !== lastIteration && entry.iteration > 0) {
            historyLogs.push({
              id: `iteration-${entry.iteration}-${entry.timestamp}`,
              type: "iteration",
              timestamp: entry.timestamp,
              content: `Iteration ${entry.iteration}/${state.maxIterations}`,
            });
            lastIteration = entry.iteration;
          }

          // Add the agent entry
          const roleLabel = entry.role === "prompt-generator"
            ? "Generated prompt"
            : entry.role === "implementer"
            ? "Implementation complete"
            : "Review complete";

          historyLogs.push({
            id: `history-${historyLogs.length}-${entry.timestamp}`,
            type: "agent_complete",
            timestamp: entry.timestamp,
            content: `[${entry.agent}] ${roleLabel}`,
          });
        }

        // Add final status if session is complete
        if (state.status === "approved" || state.status === "failed") {
          historyLogs.push({
            id: `final-status`,
            type: state.status === "approved" ? "success" : "error",
            timestamp: state.history[state.history.length - 1]?.timestamp || new Date().toISOString(),
            content: state.status === "approved"
              ? `SUCCESS: Implementation approved in ${state.iteration} iteration(s)`
              : `Implementation ${state.status}`,
          });
        }

        setLogs(historyLogs);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load session");
    }
  }

  function handleEvent(event: ServerEvent) {
    const data = event.data;
    const id = `${event.timestamp}-${Math.random()}`;

    // Helper to add log entry only if not duplicate
    const addLogEntry = (entry: LogEntry) => {
      setLogs((prev) => {
        // Check if we already have this entry (by content and approximate time)
        const isDuplicate = prev.some(
          (e) => e.content === entry.content && e.type === entry.type
        );
        if (isDuplicate) return prev;
        return [...prev, entry];
      });
    };

    switch (event.type) {
      case "session_started":
        addLogEntry({
          id,
          type: "session_started",
          timestamp: event.timestamp,
          content: data.resumed
            ? `Session resumed: ${data.sessionId}`
            : `Session started: ${data.sessionId}`,
        });
        break;

      case "status":
        if (data.status) {
          // Reset resuming state when session starts running
          if (["implementing", "prompting", "reviewing"].includes(data.status as string)) {
            setIsResuming(false);
          }
          setSession((prev) =>
            prev
              ? {
                  ...prev,
                  status: data.status as string,
                  iteration: (data.iteration as number) ?? prev.iteration,
                }
              : prev
          );
        }
        break;

      case "log":
        addLogEntry({
          id,
          type: "log",
          timestamp: event.timestamp,
          content: data.message as string,
          level: data.level as string,
        });
        break;

      case "iteration":
        addLogEntry({
          id,
          type: "iteration",
          timestamp: event.timestamp,
          content: `Iteration ${data.iteration}/${data.maxIterations} - ${data.phase}`,
        });
        setSession((prev) =>
          prev
            ? {
                ...prev,
                iteration: data.iteration as number,
              }
            : prev
        );
        break;

      case "agent_start":
        addLogEntry({
          id,
          type: "agent_start",
          timestamp: event.timestamp,
          content: `[${data.agent}] Starting ${data.role}...`,
        });
        break;

      case "agent_complete":
        addLogEntry({
          id,
          type: data.success ? "agent_complete" : "agent_error",
          timestamp: event.timestamp,
          content: `[${data.agent}] ${data.role} ${data.success ? "complete" : "failed"}`,
        });
        break;

      case "question":
        setPendingQuestion(data.question as string);
        break;

      case "complete":
        setSession((prev) =>
          prev
            ? {
                ...prev,
                status: data.status as string,
              }
            : prev
        );
        addLogEntry({
          id,
          type: data.status === "approved" ? "success" : "error",
          timestamp: event.timestamp,
          content:
            data.status === "approved"
              ? `SUCCESS: Implementation approved in ${data.iterations} iteration(s)`
              : `Implementation ${data.status}`,
        });
        break;

      case "error":
        addLogEntry({
          id,
          type: "error",
          timestamp: event.timestamp,
          content: data.message as string,
        });
        break;
    }
  }

  async function handleQuestionResponse(answer: boolean) {
    try {
      await respondToQuestion(sessionId, answer);
      setPendingQuestion(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to respond");
    }
  }

  async function handleResume() {
    try {
      setIsResuming(true);
      setError(null);
      await resumeSession(sessionId, { interactive: false, verbose: false });
      // Session will now emit events through the SSE connection
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to resume session");
      setIsResuming(false);
    }
  }

  function isResumable(status: string): boolean {
    // Can only resume sessions that have stopped (not currently active or already approved)
    return ["failed", "idle"].includes(status);
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case "approved":
        return "status-success";
      case "failed":
        return "status-error";
      case "implementing":
      case "reviewing":
      case "prompting":
      case "committing":
        return "status-active";
      default:
        return "status-pending";
    }
  }

  function getLogClass(entry: LogEntry): string {
    if (entry.type === "session_started") return "log-session-started";
    if (entry.type === "iteration") return "log-iteration";
    if (entry.type === "success") return "log-success";
    if (entry.type === "error" || entry.type === "agent_error") return "log-error";
    if (entry.level === "verbose") return "log-verbose";
    return "log-info";
  }

  if (error) {
    return (
      <div className="session-view">
        <div className="page-header">
          <button className="btn btn-ghost" onClick={onBack}>
            ← Back
          </button>
          <h2>Session Error</h2>
        </div>
        <div className="error-message">{error}</div>
      </div>
    );
  }

  return (
    <div className="session-view">
      <div className="page-header">
        <button className="btn btn-ghost" onClick={onBack}>
          ← Back
        </button>
        <h2>Session: {sessionId}</h2>
        <div className={`status-badge ${connected ? "connected" : "disconnected"}`}>
          {connected ? "Live" : "Disconnected"}
        </div>
      </div>

      {session && (
        <div className="session-info">
          <div className="session-info-row">
            <span className={`status-pill large ${getStatusColor(session.status)}`}>
              {session.status}
            </span>
            <span className="iteration-badge">
              Iteration {session.iteration}/{session.maxIterations}
            </span>
            {isResumable(session.status) && (
              <button
                className="btn btn-primary btn-small"
                onClick={handleResume}
                disabled={isResuming}
              >
                {isResuming ? "Resuming..." : "Resume Session"}
              </button>
            )}
          </div>
          <p className="session-feature-full">{session.feature}</p>
          <p className="session-dir">Working directory: {session.workingDir}</p>
        </div>
      )}

      {pendingQuestion && (
        <div className="question-modal">
          <div className="question-content">
            <h3>Action Required</h3>
            <p>{pendingQuestion}</p>
            <div className="question-actions">
              <button
                className="btn btn-secondary"
                onClick={() => handleQuestionResponse(false)}
              >
                No
              </button>
              <button
                className="btn btn-primary"
                onClick={() => handleQuestionResponse(true)}
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="logs-container">
        <div className="logs-header">
          <h3>Activity Log</h3>
          <span className="log-count">{logs.length} entries</span>
        </div>
        <div className="logs-scroll">
          {logs.length === 0 ? (
            <div className="logs-empty">Waiting for events...</div>
          ) : (
            logs.map((entry) => (
              <div key={entry.id} className={`log-entry ${getLogClass(entry)}`}>
                <span className="log-time">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
                <span className="log-content">{entry.content}</span>
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
}
