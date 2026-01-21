import { useState } from "react";
import type { NewSessionOptions } from "../api.ts";

interface NewSessionProps {
  onSubmit: (options: NewSessionOptions) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

export function NewSession({ onSubmit, onCancel, isSubmitting }: NewSessionProps) {
  const [feature, setFeature] = useState("");
  const [workingDir, setWorkingDir] = useState("");
  const [maxIterations, setMaxIterations] = useState(5);
  const [autoMode, setAutoMode] = useState(false);
  const [verbose, setVerbose] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!feature.trim()) return;

    onSubmit({
      feature: feature.trim(),
      workingDir: workingDir.trim() || process.cwd?.() || "/",
      maxIterations,
      interactive: !autoMode,
      verbose,
    });
  };

  return (
    <div className="new-session">
      <div className="page-header">
        <button className="btn btn-ghost" onClick={onCancel}>
          ← Back
        </button>
        <h2>Start New Session</h2>
      </div>

      <form onSubmit={handleSubmit} className="session-form">
        <div className="form-group">
          <label htmlFor="feature">Feature Description *</label>
          <textarea
            id="feature"
            value={feature}
            onChange={(e) => setFeature(e.target.value)}
            placeholder="Describe the feature you want to implement..."
            rows={6}
            required
            disabled={isSubmitting}
          />
          <span className="form-hint">
            Be specific about what you want. Include acceptance criteria if possible.
          </span>
        </div>

        <div className="form-group">
          <label htmlFor="workingDir">Working Directory</label>
          <input
            type="text"
            id="workingDir"
            value={workingDir}
            onChange={(e) => setWorkingDir(e.target.value)}
            placeholder="/path/to/your/project"
            disabled={isSubmitting}
          />
          <span className="form-hint">
            The directory where the agents will work. Leave empty for current directory.
          </span>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="maxIterations">Max Iterations</label>
            <input
              type="number"
              id="maxIterations"
              value={maxIterations}
              onChange={(e) => setMaxIterations(parseInt(e.target.value) || 5)}
              min={1}
              max={10000}
              disabled={isSubmitting}
            />
            <span className="form-hint">Maximum review cycles before stopping</span>
          </div>
        </div>

        <div className="form-group">
          <label>Options</label>
          <div className="checkbox-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={autoMode}
                onChange={(e) => setAutoMode(e.target.checked)}
                disabled={isSubmitting}
              />
              <span>Auto Mode</span>
              <span className="checkbox-hint">Run without prompts or confirmations</span>
            </label>

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={verbose}
                onChange={(e) => setVerbose(e.target.checked)}
                disabled={isSubmitting}
              />
              <span>Verbose Output</span>
              <span className="checkbox-hint">Show full agent outputs</span>
            </label>
          </div>
        </div>

        <div className="form-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!feature.trim() || isSubmitting}
          >
            {isSubmitting ? "Starting..." : "Start Session"}
          </button>
        </div>
      </form>
    </div>
  );
}
