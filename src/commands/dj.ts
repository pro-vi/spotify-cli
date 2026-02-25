/**
 * sp dj — complete context snapshot for a DJ agent.
 * Returns state + queue + session + taste (top + history) in one call.
 *
 * Default output is markdown (for LLM consumption).
 * JSON only when --json is explicitly passed.
 */
import { AppleScriptTransport } from "../applescript.ts";
import { getQueue, getTopTracks, getRecentlyPlayed } from "../spotify.ts";
import { readLog, isQueueAction, isSkipAction } from "../log.ts";
import { success, output, exitWithError, formatTime, isJsonMode } from "../output.ts";
import { getCurrentSession } from "./session.ts";

interface DjData {
  state: {
    track: {
      uri: string;
      id: string;
      name: string;
      artists: Array<{ name: string }>;
      album: { name: string };
      duration_ms: number;
    } | null;
    playback: {
      is_playing: boolean;
      progress_ms: number;
      remaining_ms: number;
      shuffle: boolean;
      repeat: "off" | "track" | "context";
      volume: number;
    };
  };
  queue: {
    depth: number;
    tracks: Array<{
      uri: string;
      id: string;
      name: string;
      artists: Array<{ name: string }>;
      album: { name: string };
    }>;
  };
  session: {
    started_at: string | null;
    tracks_queued: number;
    skips: number;
  };
  taste: {
    top_tracks: Array<{
      uri: string;
      id: string;
      name: string;
      artists: Array<{ name: string }>;
      album: { name: string };
    }>;
    recently_played: Array<{
      uri: string;
      id: string;
      name: string;
      artists: Array<{ name: string }>;
      album: { name: string };
      played_at: string;
    }>;
  };
}

function buildMarkdown(data: DjData, warnings: string[]): string {
  const lines: string[] = [];

  // Now Playing
  lines.push("## Now Playing");
  if (!data.state.track) {
    lines.push("Nothing playing");
  } else {
    const { track, playback } = data.state;
    const icon = playback.is_playing ? "▶" : "⏸";
    const artists = track.artists.map((a) => a.name).join(", ");
    const remaining = formatTime(playback.remaining_ms);
    lines.push(`${icon} ${track.name} — ${artists} (${remaining} left)`);
    lines.push(`  ${track.album.name}`);
  }

  lines.push("");

  // Queue
  lines.push(`## Queue (${data.queue.depth} ahead)`);
  if (data.queue.depth === 0) {
    lines.push("Empty");
  } else {
    const shown = data.queue.tracks.slice(0, 3);
    shown.forEach((t, i) => {
      const artists = t.artists.map((a) => a.name).join(", ");
      lines.push(`${i + 1}. ${t.name} — ${artists}`);
    });
    if (data.queue.depth > 3) {
      lines.push(`[...and ${data.queue.depth - 3} more]`);
    }
  }

  lines.push("");

  // Session
  lines.push("## Session");
  if (data.session.started_at) {
    const started = new Date(data.session.started_at).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
    lines.push(`${started} · ${data.session.tracks_queued} queued · ${data.session.skips} skips`);
  } else {
    lines.push("No active session");
  }

  lines.push("");

  // Your Taste
  lines.push("## Your Taste");

  // Top this month: deduplicated artist names from top_tracks, max 10
  const seenArtists = new Set<string>();
  const topArtists: string[] = [];
  for (const t of data.taste.top_tracks) {
    for (const a of t.artists) {
      if (!seenArtists.has(a.name)) {
        seenArtists.add(a.name);
        topArtists.push(a.name);
        if (topArtists.length >= 10) break;
      }
    }
    if (topArtists.length >= 10) break;
  }
  if (topArtists.length > 0) {
    lines.push(`Top this month: ${topArtists.join(", ")}`);
  }

  // Recent: last 5 from recently_played, one per line
  const recentSlice = data.taste.recently_played.slice(0, 5);
  if (recentSlice.length > 0) {
    lines.push("Recent:");
    for (const t of recentSlice) {
      const artist = t.artists.map((a) => a.name).join(" & ");
      lines.push(`- ${t.name} — ${artist}`);
    }
  }

  // Warnings
  if (warnings.length > 0) {
    lines.push("");
    for (const w of warnings) {
      lines.push(`⚠ ${w}`);
    }
  }

  return lines.join("\n");
}

export async function djCommand(): Promise<void> {
  const transport = new AppleScriptTransport();

  try {
    let queueUnavailable = false;
    let tasteUnavailable = false;
    let recentUnavailable = false;

    const [localState, queueState, topTracks, recentlyPlayed, logEntries] = await Promise.all([
      transport.getFullState(),
      getQueue().catch(() => { queueUnavailable = true; return { currently_playing: null, queue: [] }; }),
      getTopTracks(20, "short_term").catch(() => { tasteUnavailable = true; return []; }),
      getRecentlyPlayed(20).catch(() => { recentUnavailable = true; return []; }),
      readLog(),
    ]);

    const currentSession = getCurrentSession(logEntries);

    const track = localState.track;
    const isEpisode = track?.uri.startsWith("spotify:episode:");
    const trackData = track && !isEpisode ? {
      uri: track.uri, id: track.id, name: track.name,
      artists: [{ name: track.artist }], album: { name: track.album },
      duration_ms: track.duration_ms,
    } : null;

    const progress_ms = localState.playback.progress_ms;
    const remaining_ms = Math.max(0, (trackData?.duration_ms ?? 0) - progress_ms);

    const data: DjData = {
      state: {
        track: trackData,
        playback: {
          is_playing: localState.playback.is_playing,
          progress_ms, remaining_ms,
          shuffle: localState.playback.shuffle,
          repeat: localState.playback.repeat,
          volume: localState.playback.volume,
        },
      },
      queue: { depth: queueState.queue.length, tracks: queueState.queue },
      session: {
        started_at: currentSession?.started_at ?? null,
        tracks_queued: currentSession ? currentSession.entries.filter(isQueueAction).length : 0,
        skips: currentSession ? currentSession.entries.filter(isSkipAction).length : 0,
      },
      taste: { top_tracks: topTracks, recently_played: recentlyPlayed },
    };

    const warnings: string[] = [];
    if (queueUnavailable) warnings.push("queue unavailable — do not queue until resolved");
    if (tasteUnavailable) warnings.push("taste unavailable — top tracks could not be fetched");
    if (recentUnavailable) warnings.push("recently played unavailable — history could not be fetched");
    if (localState.playback.repeat === "track") warnings.push("repeat:track active");

    if (isJsonMode()) {
      output(success("dj", data, warnings));
    } else {
      process.stdout.write(buildMarkdown(data, warnings) + "\n");
    }
  } catch (e) {
    exitWithError("dj", e);
  }
}
