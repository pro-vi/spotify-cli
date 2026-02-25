/**
 * sp session — session tracking commands.
 * Subcommands: (bare), export, list, clear
 */
import chalk from "chalk";
import { readLog, appendLog, isQueueAction, isSkipAction, type LogEntry } from "../log.ts";
import { success, output, isJsonMode, timeAgo } from "../output.ts";

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export interface Session {
  entries: LogEntry[];
  started_at: string;
}

/**
 * Group log entries into sessions.
 * A new session starts when:
 *   - There's a gap > 2 hours between consecutive entries
 *   - A "session_end" marker is encountered
 */
function groupSessions(entries: LogEntry[]): Session[] {
  if (entries.length === 0) return [];

  const sessions: Session[] = [];
  let current: LogEntry[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry === undefined) continue;

    // session_end marker: close current session and start fresh
    if (entry.action === "session_end") {
      if (current.length > 0) {
        sessions.push({ entries: current, started_at: current[0]!.ts });
        current = [];
      }
      continue;
    }

    if (current.length > 0) {
      const prevTs = new Date(current[current.length - 1]!.ts).getTime();
      const currTs = new Date(entry.ts).getTime();
      if (currTs - prevTs > TWO_HOURS_MS) {
        // Gap > 2 hours: close current session
        sessions.push({ entries: current, started_at: current[0]!.ts });
        current = [];
      }
    }

    current.push(entry);
  }

  if (current.length > 0) {
    sessions.push({ entries: current, started_at: current[0]!.ts });
  }

  return sessions;
}

/**
 * Check whether the log has an active (non-ended) current session.
 * Returns the current session if active, or null if the last entry is session_end
 * or there are no sessions.
 */
export function getCurrentSession(entries: LogEntry[]): Session | null {
  const sessions = groupSessions(entries);
  if (sessions.length === 0) return null;

  // If the last raw entry is session_end, there's no active session
  const lastEntry = entries[entries.length - 1];
  if (lastEntry && lastEntry.action === "session_end") return null;

  return sessions[sessions.length - 1] ?? null;
}

/**
 * Format a date for session list display.
 */
function formatSessionDate(isoTs: string): string {
  const date = new Date(isoTs);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const entryDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  if (entryDate.getTime() === today.getTime()) {
    return `Today ${time}`;
  }
  if (entryDate.getTime() === yesterday.getTime()) {
    return `Yesterday ${time}`;
  }
  return `${date.toLocaleDateString("en-GB", { month: "short", day: "numeric" })} ${time}`;
}

// ---------- sp session (bare) ----------

interface SessionData {
  started_at: string | null;
  tracks_queued: number;
  skips: number;
  tracks: Array<{
    uri?: string;
    name?: string;
    artist?: string;
    action: string;
    ts: string;
  }>;
}

export async function sessionCommand(): Promise<void> {
  const entries = await readLog();
  const current = getCurrentSession(entries);

  if (!current) {
    const data: SessionData = {
      started_at: null,
      tracks_queued: 0,
      skips: 0,
      tracks: [],
    };
    output(success("session", data), prettySession);
    return;
  }

  const tracksQueued = current.entries.filter(isQueueAction).length;
  const skips = current.entries.filter(isSkipAction).length;

  const tracks = current.entries.map(({ ts, action, uri, name, artist }) => ({
    ts, action, uri, name, artist,
  }));

  const data: SessionData = {
    started_at: current.started_at,
    tracks_queued: tracksQueued,
    skips,
    tracks,
  };

  output(success("session", data), prettySession);
}

function prettySession(data: SessionData): void {
  if (!data.started_at) {
    console.log(chalk.dim("  No active session."));
    return;
  }

  const ago = timeAgo(data.started_at);
  const skipLabel = data.skips === 1 ? "skip" : "skips";
  console.log(
    `  Session started ${chalk.cyan(ago)} — ${chalk.green(String(data.tracks_queued))} queued, ${chalk.yellow(String(data.skips))} ${skipLabel}\n`
  );

  let trackNum = 0;
  for (const entry of data.tracks) {
    if (entry.action === "next" || entry.action === "prev") {
      const symbol = entry.action === "next" ? "\u21B7" : "\u21B6";
      console.log(
        chalk.dim(`  ${symbol} [${entry.action}]`.padEnd(50)) + chalk.dim(timeAgo(entry.ts))
      );
    } else {
      trackNum++;
      const name = entry.name ?? "Unknown";
      const artist = entry.artist ?? "Unknown";
      const label = entry.action === "play-now" ? "played" : "queued";
      console.log(
        `  ${chalk.dim(String(trackNum) + ".")} ${chalk.white(name)} ${chalk.dim("\u2014")} ${chalk.dim(artist)}` +
          `  `.padEnd(Math.max(1, 45 - name.length - artist.length)) +
          chalk.dim(`${label} ${timeAgo(entry.ts)}`)
      );
    }
  }
}

// ---------- sp session export ----------

export async function sessionExportCommand(): Promise<void> {
  const entries = await readLog();
  const current = getCurrentSession(entries);

  if (!current) {
    output(success("session export", { tracks: [] }), () => {
      console.log(chalk.dim("  No active session."));
    });
    return;
  }

  const trackEntries = current.entries.filter(isQueueAction);

  const tracks = trackEntries.map((e) => ({
    ...(e.uri ? { uri: e.uri } : {}),
    ...(e.name ? { name: e.name } : {}),
    ...(e.artist ? { artist: e.artist } : {}),
  }));

  output(success("session export", { tracks }), () => {
    const date = new Date(current.started_at).toISOString().split("T")[0];
    console.log(`# Session ${date}`);
    trackEntries.forEach((e, i) => {
      const name = e.name ?? "Unknown";
      const artist = e.artist ?? "Unknown";
      const uriTag = e.uri ? `  [${e.uri}]` : "";
      console.log(`${i + 1}. ${name} \u2014 ${artist}${uriTag}`);
    });
  });
}

// ---------- sp session list ----------

interface SessionListEntry {
  index: number;
  started_at: string;
  tracks_queued: number;
  skips: number;
}

export async function sessionListCommand(): Promise<void> {
  const entries = await readLog();
  const sessions = groupSessions(entries);

  if (sessions.length === 0) {
    output(success("session list", { sessions: [] }), () => {
      console.log(chalk.dim("  No sessions found."));
    });
    return;
  }

  const list: SessionListEntry[] = sessions.map((s, i) => ({
    index: i + 1,
    started_at: s.started_at,
    tracks_queued: s.entries.filter(isQueueAction).length,
    skips: s.entries.filter(isSkipAction).length,
  }));

  output(success("session list", { sessions: list }), () => {
    for (const s of list) {
      const dateStr = formatSessionDate(s.started_at);
      const skipLabel = s.skips === 1 ? "skip" : "skips";
      console.log(
        `  ${chalk.dim(String(s.index) + ".")} ${chalk.white(dateStr.padEnd(20))} ${chalk.green(String(s.tracks_queued) + " queued")}  ${chalk.yellow(String(s.skips) + " " + skipLabel)}`
      );
    }
  });
}

// ---------- sp session clear ----------

export async function sessionClearCommand(force: boolean): Promise<void> {
  const entries = await readLog();
  const current = getCurrentSession(entries);

  if (!current) {
    output(success("session clear", { cleared: false, reason: "no_sessions" }), () => {
      console.log(chalk.dim("  No active session to clear."));
    });
    return;
  }

  if (!force) {
    if (!process.stdin.isTTY || isJsonMode()) {
      output(success("session clear", { cleared: false, reason: "cancelled" }), () => {
        console.log(chalk.dim("  Non-interactive mode — use --force to clear."));
      });
      return;
    }

    const tracksQueued = current.entries.filter(isQueueAction).length;

    // Ask for confirmation via stderr (TTY prompt)
    process.stderr.write(
      `  Clear current session? (${tracksQueued} tracks queued, started ${timeAgo(current.started_at)})\n` +
        `  Use --force to skip this prompt.\n`
    );

    // Read confirmation from stdin
    const rl = await import("node:readline");
    const iface = rl.createInterface({ input: process.stdin, output: process.stderr });
    const answer = await new Promise<string>((resolve) => {
      iface.question("  Confirm? [y/N] ", (ans) => {
        iface.close();
        resolve(ans.trim().toLowerCase());
      });
    });

    if (answer !== "y" && answer !== "yes") {
      output(success("session clear", { cleared: false, reason: "cancelled" }), () => {
        console.log(chalk.dim("  Cancelled."));
      });
      return;
    }
  }

  // Append session_end marker instead of deleting
  await appendLog({ action: "session_end" });

  output(success("session clear", { cleared: true }), () => {
    console.log(chalk.green("  \u2713 Session ended."));
  });
}

// ---------- sp log ----------

interface LogData {
  entries: Array<{
    ts: string;
    action: string;
    uri?: string;
    name?: string;
    artist?: string;
  }>;
}

export async function logCommand(limit: number): Promise<void> {
  const entries = await readLog();

  // Reverse so newest is first, then take the requested limit
  const reversed = [...entries].reverse().slice(0, limit);

  const data: LogData = {
    entries: reversed.map((e) => ({
      ts: e.ts,
      action: e.action,
      ...(e.uri ? { uri: e.uri } : {}),
      ...(e.name ? { name: e.name } : {}),
      ...(e.artist ? { artist: e.artist } : {}),
    })),
  };

  output(success("log", data), prettyLog);
}

function prettyLog(data: LogData): void {
  if (data.entries.length === 0) {
    console.log(chalk.dim("  No log entries."));
    return;
  }

  for (const entry of data.entries) {
    const ago = timeAgo(entry.ts).padEnd(10);

    if (entry.action === "session_end") {
      console.log(chalk.dim(`${ago} --- session end ---`));
      continue;
    }

    const action = entry.action.padEnd(10);

    if (entry.action === "next" || entry.action === "prev") {
      console.log(`${chalk.dim(ago)}${chalk.yellow(action)}${chalk.dim(`[${entry.action}]`)}`);
    } else {
      const name = entry.name ?? "Unknown";
      const artist = entry.artist ?? "Unknown";
      console.log(
        `${chalk.dim(ago)}${chalk.cyan(action)}${chalk.white(name)} ${chalk.dim("—")} ${chalk.dim(artist)}`
      );
    }
  }
}
