import { useEffect, useState } from "react";
import {
  getQueue,
  addToQueue,
  removeFromQueue,
  clearQueue,
  subscribeToQueueEvents,
  subscribeToEvents,
  type QueueState,
  type QueueItem,
  type ServerEvent,
} from "../api.ts";

interface QueueViewProps {
  onBack: () => void;
  onViewSession: (sessionId: string) => void;
}

export function QueueView({ onBack, onViewSession }: QueueViewProps) {
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [newFeature, setNewFeature] = useState("");
  const [workingDir, setWorkingDir] = useState("");
  const [maxIterations, setMaxIterations] = useState(5);
  const [autoCommit, setAutoCommit] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [currentSessionLogs, setCurrentSessionLogs] = useState<string[]>([]);

  useEffect(() => {
    loadQueue();

    // Subscribe to queue events for updates
    const unsubscribeQueue = subscribeToQueueEvents(
      () => {
        // Reload queue on any queue event
        loadQueue();
      },
      (err) => console.error("Queue events error:", err)
    );

    return () => {
      unsubscribeQueue();
    };
  }, []);

  // Subscribe to current running session's events
  useEffect(() => {
    const currentItem = queue?.items.find((item) => item.status === "running");
    if (!currentItem?.sessionId) {
      setCurrentSessionLogs([]);
      return;
    }

    const unsubscribe = subscribeToEvents(
      currentItem.sessionId,
      (event: ServerEvent) => {
        if (event.type === "log" && event.data.message) {
          setCurrentSessionLogs((prev) => [...prev.slice(-50), event.data.message as string]);
        } else if (event.type === "agent_start") {
          setCurrentSessionLogs((prev) => [
            ...prev.slice(-50),
            `[${event.data.agent}] Starting ${event.data.role}...`,
          ]);
        } else if (event.type === "agent_complete") {
          setCurrentSessionLogs((prev) => [
            ...prev.slice(-50),
            `[${event.data.agent}] ${event.data.role} ${event.data.success ? "complete" : "failed"}`,
          ]);
        } else if (event.type === "complete") {
          loadQueue();
        }
      },
      () => {}
    );

    return () => unsubscribe();
  }, [queue?.currentItemId]);

  async function loadQueue() {
    try {
      const state = await getQueue();
      setQueue(state);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load queue");
    }
  }

  async function handleAddToQueue() {
    if (!newFeature.trim()) return;

    setIsAdding(true);
    try {
      await addToQueue({
        feature: newFeature.trim(),
        maxIterations,
        workingDir: workingDir.trim() || undefined,
        autoCommit,
      });
      setNewFeature("");
      setShowAddForm(false);
      await loadQueue();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add to queue");
    } finally {
      setIsAdding(false);
    }
  }

  async function handleRemove(itemId: string) {
    try {
      await removeFromQueue(itemId);
      await loadQueue();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove item");
    }
  }

  async function handleClearQueue() {
    if (!confirm("Clear all pending items from the queue?")) return;

    try {
      await clearQueue();
      await loadQueue();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to clear queue");
    }
  }

  function getStatusClass(status: QueueItem["status"]): string {
    switch (status) {
      case "pending":
        return "status-pending";
      case "running":
        return "status-active";
      case "completed":
        return "status-success";
      case "failed":
        return "status-error";
      default:
        return "";
    }
  }

  const pendingItems = queue?.items.filter((i) => i.status === "pending") || [];
  const runningItem = queue?.items.find((i) => i.status === "running");
  const completedItems = queue?.items.filter((i) => i.status === "completed" || i.status === "failed") || [];

  return (
    <div className="queue-view">
      <div className="page-header">
        <button className="btn btn-ghost" onClick={onBack}>
          ← Back
        </button>
        <h2>Feature Queue</h2>
        <div className="header-actions">
          <button
            className="btn btn-secondary"
            onClick={() => setShowAddForm(!showAddForm)}
          >
            {showAddForm ? "Cancel" : "+ Add Feature"}
          </button>
          {pendingItems.length > 0 && (
            <button className="btn btn-ghost" onClick={handleClearQueue}>
              Clear Pending
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="error-message" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      {showAddForm && (
        <div className="queue-add-form">
          <div className="form-group">
            <label htmlFor="feature">Feature Description</label>
            <textarea
              id="feature"
              value={newFeature}
              onChange={(e) => setNewFeature(e.target.value)}
              placeholder="Describe the feature to implement..."
              rows={4}
              disabled={isAdding}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="workingDir">Working Directory</label>
              <input
                type="text"
                id="workingDir"
                value={workingDir}
                onChange={(e) => setWorkingDir(e.target.value)}
                placeholder="/path/to/project"
                disabled={isAdding}
              />
            </div>
            <div className="form-group">
              <label htmlFor="maxIterations">Max Iterations</label>
              <input
                type="number"
                id="maxIterations"
                value={maxIterations}
                onChange={(e) => setMaxIterations(parseInt(e.target.value) || 5)}
                min={1}
                max={100}
                disabled={isAdding}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={autoCommit}
                onChange={(e) => setAutoCommit(e.target.checked)}
                disabled={isAdding}
              />
              <span>Auto Commit</span>
            </label>
          </div>

          <button
            className="btn btn-primary"
            onClick={handleAddToQueue}
            disabled={!newFeature.trim() || isAdding}
          >
            {isAdding ? "Adding..." : "Add to Queue"}
          </button>
        </div>
      )}

      {/* Running Item */}
      {runningItem && (
        <div className="queue-section">
          <h3>Currently Running</h3>
          <div className="queue-item running">
            <div className="queue-item-header">
              <span className={`status-pill ${getStatusClass(runningItem.status)}`}>
                {runningItem.status}
              </span>
              <span className="queue-item-id">{runningItem.id}</span>
              {runningItem.sessionId && (
                <button
                  className="btn btn-small btn-ghost"
                  onClick={() => onViewSession(runningItem.sessionId!)}
                >
                  View Session
                </button>
              )}
            </div>
            <p className="queue-item-feature">{runningItem.feature}</p>
            <div className="queue-item-meta">
              <span>Started: {new Date(runningItem.startedAt!).toLocaleTimeString()}</span>
              <span>Dir: {runningItem.options.workingDir}</span>
            </div>

            {currentSessionLogs.length > 0 && (
              <div className="queue-item-logs">
                {currentSessionLogs.slice(-5).map((log, i) => (
                  <div key={i} className="queue-log-entry">
                    {log}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pending Items */}
      {pendingItems.length > 0 && (
        <div className="queue-section">
          <h3>Pending ({pendingItems.length})</h3>
          <div className="queue-list">
            {pendingItems.map((item, index) => (
              <div key={item.id} className="queue-item pending">
                <div className="queue-item-header">
                  <span className="queue-position">#{index + 1}</span>
                  <span className={`status-pill ${getStatusClass(item.status)}`}>
                    {item.status}
                  </span>
                  <button
                    className="btn btn-small btn-ghost"
                    onClick={() => handleRemove(item.id)}
                  >
                    Remove
                  </button>
                </div>
                <p className="queue-item-feature">{item.feature}</p>
                <div className="queue-item-meta">
                  <span>Added: {new Date(item.addedAt).toLocaleTimeString()}</span>
                  <span>Max: {item.options.maxIterations} iterations</span>
                  {item.options.autoCommit && <span>Auto-commit</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Completed Items */}
      {completedItems.length > 0 && (
        <div className="queue-section">
          <h3>Completed ({completedItems.length})</h3>
          <div className="queue-list">
            {completedItems.slice().reverse().map((item) => (
              <div key={item.id} className={`queue-item ${item.status}`}>
                <div className="queue-item-header">
                  <span className={`status-pill ${getStatusClass(item.status)}`}>
                    {item.status}
                  </span>
                  <span className="queue-item-id">{item.id}</span>
                  {item.sessionId && (
                    <button
                      className="btn btn-small btn-ghost"
                      onClick={() => onViewSession(item.sessionId!)}
                    >
                      View Session
                    </button>
                  )}
                </div>
                <p className="queue-item-feature">{item.feature}</p>
                <div className="queue-item-meta">
                  {item.completedAt && (
                    <span>Completed: {new Date(item.completedAt).toLocaleTimeString()}</span>
                  )}
                  {item.error && <span className="error-text">{item.error}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!runningItem && pendingItems.length === 0 && completedItems.length === 0 && (
        <div className="queue-empty">
          <p>No items in the queue</p>
          <button
            className="btn btn-primary"
            onClick={() => setShowAddForm(true)}
          >
            Add First Feature
          </button>
        </div>
      )}
    </div>
  );
}
