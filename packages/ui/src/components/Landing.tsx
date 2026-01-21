interface LandingProps {
  onNewSession: () => void;
  onViewSessions: () => void;
  onViewQueue: () => void;
  serverConnected: boolean;
}

export function Landing({
  onNewSession,
  onViewSessions,
  onViewQueue,
  serverConnected,
}: LandingProps) {
  return (
    <div className="landing">
      <div className="landing-header">
        <h1>Orchestrator</h1>
        <p className="subtitle">Multi-Agent Feature Implementation Tool</p>
        <div className={`status-badge ${serverConnected ? "connected" : "disconnected"}`}>
          {serverConnected ? "Server Connected" : "Server Disconnected"}
        </div>
      </div>

      <div className="landing-actions">
        <button
          className="btn btn-primary btn-large"
          onClick={onNewSession}
          disabled={!serverConnected}
        >
          <span className="btn-icon">+</span>
          Start New Session
        </button>

        <button
          className="btn btn-secondary btn-large"
          onClick={onViewQueue}
          disabled={!serverConnected}
        >
          <span className="btn-icon">⋮</span>
          Feature Queue
        </button>

        <button
          className="btn btn-secondary btn-large"
          onClick={onViewSessions}
          disabled={!serverConnected}
        >
          <span className="btn-icon">≡</span>
          View Sessions
        </button>
      </div>

      <div className="landing-info">
        <h3>How it works</h3>
        <ol>
          <li>
            <strong>Describe your feature</strong> - Provide a description of what you want to implement
          </li>
          <li>
            <strong>Codex generates a prompt</strong> - Analyzes your codebase and creates an implementation plan
          </li>
          <li>
            <strong>Claude implements</strong> - Makes the actual code changes
          </li>
          <li>
            <strong>Codex reviews</strong> - Checks the implementation and provides feedback
          </li>
          <li>
            <strong>Iterate until approved</strong> - The loop continues until the feature is complete
          </li>
        </ol>

        <h3>Feature Queue</h3>
        <p>
          Queue up multiple features to be implemented sequentially. Each feature will be processed one at a time, with the next feature starting automatically when the previous one completes.
        </p>
      </div>
    </div>
  );
}
