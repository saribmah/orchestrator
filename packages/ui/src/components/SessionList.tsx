import { useEffect, useState } from "react";
import { listSessions, getSession, type SessionState } from "../api.ts";

interface SessionListProps {
  onSelect: (sessionId: string) => void;
  onBack: () => void;
}

interface SessionInfo {
  id: string;
  state: SessionState | null;
  loading: boolean;
}

export function SessionList({ onSelect, onBack }: SessionListProps) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSessions();
  }, []);

  async function loadSessions() {
    try {
      setLoading(true);
      const sessionIds = await listSessions();
      const sessionInfos: SessionInfo[] = sessionIds.map((id) => ({
        id,
        state: null,
        loading: true,
      }));
      setSessions(sessionInfos);

      // Load details for each session
      for (const id of sessionIds.slice(0, 10)) {
        try {
          const state = await getSession(id);
          setSessions((prev) =>
            prev.map((s) => (s.id === id ? { ...s, state, loading: false } : s))
          );
        } catch {
          setSessions((prev) =>
            prev.map((s) => (s.id === id ? { ...s, loading: false } : s))
          );
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sessions");
    } finally {
      setLoading(false);
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

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString() + " " + date.toLocaleTimeString();
  }

  return (
    <div className="session-list">
      <div className="page-header">
        <button className="btn btn-ghost" onClick={onBack}>
          ← Back
        </button>
        <h2>Sessions</h2>
        <button className="btn btn-ghost" onClick={loadSessions} disabled={loading}>
          ↻ Refresh
        </button>
      </div>

      {loading && sessions.length === 0 && (
        <div className="loading">Loading sessions...</div>
      )}

      {error && <div className="error-message">{error}</div>}

      {!loading && sessions.length === 0 && (
        <div className="empty-state">
          <p>No sessions found</p>
          <button className="btn btn-primary" onClick={onBack}>
            Start a new session
          </button>
        </div>
      )}

      <div className="sessions-grid">
        {sessions.map((session) => (
          <div
            key={session.id}
            className="session-card"
            onClick={() => onSelect(session.id)}
          >
            <div className="session-card-header">
              <span className="session-id">{session.id}</span>
              {session.state && (
                <span className={`status-pill ${getStatusColor(session.state.status)}`}>
                  {session.state.status}
                </span>
              )}
            </div>

            {session.loading ? (
              <div className="session-card-loading">Loading...</div>
            ) : session.state ? (
              <>
                <p className="session-feature">
                  {session.state.feature.slice(0, 100)}
                  {session.state.feature.length > 100 ? "..." : ""}
                </p>
                <div className="session-card-footer">
                  <span>
                    Iteration {session.state.iteration}/{session.state.maxIterations}
                  </span>
                  <span>{formatDate(session.state.createdAt)}</span>
                </div>
              </>
            ) : (
              <p className="session-feature">Unable to load details</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
