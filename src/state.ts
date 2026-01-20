import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { OrchestrationState } from "./types";

const STATE_DIR = join(homedir(), ".orchestrator");
const STATE_FILE = join(STATE_DIR, "last-session.json");

export function ensureStateDir(): void {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true });
  }
}

export async function saveState(state: OrchestrationState): Promise<void> {
  ensureStateDir();
  await Bun.write(STATE_FILE, JSON.stringify(state, null, 2));
}

export async function loadState(): Promise<OrchestrationState | null> {
  if (!existsSync(STATE_FILE)) {
    return null;
  }
  try {
    const file = Bun.file(STATE_FILE);
    const content = await file.text();
    return JSON.parse(content) as OrchestrationState;
  } catch {
    return null;
  }
}

export function getStateFilePath(): string {
  return STATE_FILE;
}
