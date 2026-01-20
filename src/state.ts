import { existsSync, mkdirSync, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { OrchestrationState } from "./types";

const STATE_DIR = join(homedir(), ".orchestrator");
const SESSIONS_DIR = join(STATE_DIR, "sessions");

export function ensureStateDir(): void {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

export function generateSessionId(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function getSessionFilePath(sessionId: string): string {
  return join(SESSIONS_DIR, `session-${sessionId}.json`);
}

export async function saveState(state: OrchestrationState): Promise<void> {
  ensureStateDir();
  const filePath = getSessionFilePath(state.id);
  await Bun.write(filePath, JSON.stringify(state, null, 2));
}

export async function loadState(sessionId?: string): Promise<OrchestrationState | null> {
  ensureStateDir();

  // If specific session ID provided, load that one
  if (sessionId) {
    const filePath = getSessionFilePath(sessionId);
    if (!existsSync(filePath)) {
      return null;
    }
    try {
      const file = Bun.file(filePath);
      const content = await file.text();
      return JSON.parse(content) as OrchestrationState;
    } catch {
      return null;
    }
  }

  // Otherwise, find the most recent session
  const latestId = getLatestSessionId();
  if (!latestId) {
    return null;
  }

  return loadState(latestId);
}

export function getLatestSessionId(): string | null {
  ensureStateDir();

  if (!existsSync(SESSIONS_DIR)) {
    return null;
  }

  const files = readdirSync(SESSIONS_DIR)
    .filter((f) => f.startsWith("session-") && f.endsWith(".json"))
    .map((f) => f.replace("session-", "").replace(".json", ""))
    .sort()
    .reverse();

  return files[0] || null;
}

export function listSessions(): string[] {
  ensureStateDir();

  if (!existsSync(SESSIONS_DIR)) {
    return [];
  }

  return readdirSync(SESSIONS_DIR)
    .filter((f) => f.startsWith("session-") && f.endsWith(".json"))
    .map((f) => f.replace("session-", "").replace(".json", ""))
    .sort()
    .reverse();
}

export function getStateFilePath(sessionId?: string): string {
  if (sessionId) {
    return getSessionFilePath(sessionId);
  }
  const latestId = getLatestSessionId();
  if (latestId) {
    return getSessionFilePath(latestId);
  }
  return SESSIONS_DIR;
}
