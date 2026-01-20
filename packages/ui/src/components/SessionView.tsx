import { useEffect, useState, useRef } from "react";
import {
  getSession,
  subscribeToEvents,
  respondToQuestion,
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load session");
    }
  }

  function handleEvent(event: ServerEvent) {
    const data = event.data;
    const id = `${event.timestamp}-${Math.random()}`;

    switch (event.type) {
      case "status":
        if (data.status) {
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
        setLogs((prev) => [
          ...prev,
          {
            id,
            type: "log",
            timestamp: event.timestamp,
            content: data.message as string,
            level: data.level as string,
          },
        ]);
        break;

      case "iteration":
        setLogs((prev) => [
          ...prev,
          {
            id,
            type: "iteration",
            timestamp: event.timestamp,
            content: `Iteration ${data.iteration}/${data.maxIterations} - ${data.phase}`,
          },
        ]);
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
        setLogs((prev) => [
          ...prev,
          {
            id,
            type: "agent_start",
            timestamp: event.timestamp,
            content: `[${data.agent}] Starting ${data.role}...`,
          },
        ]);
        break;

      case "agent_complete":
        setLogs((prev) => [
          ...prev,
          {
            id,
            type: data.success ? "agent_complete" : "agent_error",
            timestamp: event.timestamp,
            content: `[${data.agent}] ${data.role} ${data.success ? "complete" : "failed"}`,
          },
        ]);
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
        setLogs((prev) => [
          ...prev,
          {
            id,
            type: data.status === "approved" ? "success" : "error",
            timestamp: event.timestamp,
            content:
              data.status === "approved"
                ? `SUCCESS: Implementation approved in ${data.iterations} iteration(s)`
                : `Implementation ${data.status}`,
          },
        ]);
        break;

      case "error":
        setLogs((prev) => [
          ...prev,
          {
            id,
            type: "error",
            timestamp: event.timestamp,
            content: data.message as string,
          },
        ]);
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

  function getStatusColor(status: string): string {
    switch (status) {
      case "approved":
        return "status-success";
      case "failed":
        return "status-error";
      case "implementing":
      case "reviewing":
      case "prompting":
        return "status-active";
      default:
        return "status-pending";
    }
  }

  function getLogClass(entry: LogEntry): string {
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
