import { useState, useEffect } from "react";
import { Landing } from "./components/Landing.tsx";
import { NewSession } from "./components/NewSession.tsx";
import { SessionList } from "./components/SessionList.tsx";
import { SessionView } from "./components/SessionView.tsx";
import { QueueView } from "./components/QueueView.tsx";
import { getHealth, startSession, type NewSessionOptions } from "./api.ts";
import "./styles.css";

type View = "landing" | "new-session" | "session-list" | "session-view" | "queue";

export function App() {
  const [view, setView] = useState<View>("landing");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [serverConnected, setServerConnected] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    checkServerHealth();
    const interval = setInterval(checkServerHealth, 5000);
    return () => clearInterval(interval);
  }, []);

  async function checkServerHealth() {
    const connected = await getHealth();
    setServerConnected(connected);
  }

  async function handleNewSession(options: NewSessionOptions) {
    try {
      setIsSubmitting(true);
      const sessionId = await startSession(options);
      setSelectedSessionId(sessionId);
      setView("session-view");
    } catch (e) {
      console.error("Failed to start session:", e);
      alert(e instanceof Error ? e.message : "Failed to start session");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleSelectSession(sessionId: string) {
    setSelectedSessionId(sessionId);
    setView("session-view");
  }

  return (
    <div className="app">
      {view === "landing" && (
        <Landing
          onNewSession={() => setView("new-session")}
          onViewSessions={() => setView("session-list")}
          onViewQueue={() => setView("queue")}
          serverConnected={serverConnected}
        />
      )}

      {view === "new-session" && (
        <NewSession
          onSubmit={handleNewSession}
          onCancel={() => setView("landing")}
          isSubmitting={isSubmitting}
        />
      )}

      {view === "session-list" && (
        <SessionList
          onSelect={handleSelectSession}
          onBack={() => setView("landing")}
        />
      )}

      {view === "session-view" && selectedSessionId && (
        <SessionView
          sessionId={selectedSessionId}
          onBack={() => setView("session-list")}
        />
      )}

      {view === "queue" && (
        <QueueView
          onBack={() => setView("landing")}
          onViewSession={handleSelectSession}
        />
      )}
    </div>
  );
}
