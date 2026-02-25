/**
 * Append-only JSONL log for session tracking.
 * Log file: ~/.config/sp/log.jsonl
 */
import { mkdir, appendFile, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getTrack } from "./spotify.ts";

export interface LogEntry {
  ts: string;
  action: "queue" | "play-now" | "next" | "prev" | "session_end";
  uri?: string;
  name?: string;
  artist?: string;
}

const VALID_ACTIONS = new Set(["queue", "play-now", "next", "prev", "session_end"]);

const LOG_DIR = join(homedir(), ".config", "sp");
const LOG_FILE = join(LOG_DIR, "log.jsonl");

/**
 * Append a log entry atomically. Never throws — log failure must not break commands.
 */
export async function appendLog(entry: Omit<LogEntry, "ts">): Promise<void> {
  try {
    await mkdir(LOG_DIR, { recursive: true, mode: 0o700 });
    const full: LogEntry = { ts: new Date().toISOString(), ...entry };
    await appendFile(LOG_FILE, JSON.stringify(full) + "\n");
  } catch {
    // silently ignore — log failure must not break the command
  }
}

/**
 * Read all log entries, skipping malformed lines silently.
 */
export async function readLog(): Promise<LogEntry[]> {
  try {
    const content = await readFile(LOG_FILE, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim() !== "");
    const entries: LogEntry[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed.ts === "string" && VALID_ACTIONS.has(parsed.action)) {
          entries.push(parsed as LogEntry);
        }
      } catch {
        // skip malformed lines silently
      }
    }
    return entries;
  } catch {
    // file doesn't exist or can't be read
    return [];
  }
}

export function isQueueAction(e: LogEntry): boolean {
  return e.action === "queue" || e.action === "play-now";
}
export function isSkipAction(e: LogEntry): boolean {
  return e.action === "next" || e.action === "prev";
}

export async function appendTrackLog(action: "queue" | "play-now", uri: string): Promise<void> {
  const trackId = uri.split(":").pop() ?? "";
  const track = await getTrack(trackId).catch(() => null);
  if (track) {
    await appendLog({ action, uri, name: track.name, artist: track.artists[0]?.name });
  } else {
    await appendLog({ action, uri });
  }
}
