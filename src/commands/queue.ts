/**
 * sp queue <uri> — add a track to the playback queue.
 */
import chalk from "chalk";
import { queueTrack, getQueue } from "../spotify.ts";
import { success, output, exitWithError } from "../output.ts";
import { appendTrackLog } from "../log.ts";

interface QueueData {
  uri: string;
  queued: boolean;
}

function prettyQueue(data: QueueData): void {
  console.log(chalk.green(`  ✓ Queued: ${data.uri}`));
}

/**
 * Normalize a track identifier to a Spotify URI.
 * Accepts:
 *   - spotify:track:xxx
 *   - https://open.spotify.com/track/xxx?si=...
 *   - bare track ID (4iV5W9...)
 */
export function normalizeTrackUri(input: string): string {
  // Already a Spotify URI
  if (input.startsWith("spotify:track:")) {
    return input;
  }

  // Spotify URL
  if (input.startsWith("https://open.spotify.com/track/")) {
    const url = new URL(input);
    const trackId = url.pathname.replace("/track/", "");
    return `spotify:track:${trackId}`;
  }

  // Bare track ID
  return `spotify:track:${input}`;
}

export async function queueCommand(input: string): Promise<void> {
  try {
    const uri = normalizeTrackUri(input);
    await queueTrack(uri);

    const data: QueueData = { uri, queued: true };
    output(success("queue", data), prettyQueue);

    await appendTrackLog("queue", uri);
  } catch (e) {
    exitWithError("queue", e);
  }
}

// ---------- queue list ----------

interface QueueListData {
  currently_playing: {
    uri: string;
    id: string;
    name: string;
    artists: Array<{ name: string }>;
    album: { name: string };
  } | null;
  queue: Array<{
    uri: string;
    id: string;
    name: string;
    artists: Array<{ name: string }>;
    album: { name: string };
  }>;
  depth: number;
}

function prettyQueueList(data: QueueListData): void {
  if (!data.currently_playing && data.depth === 0) {
    console.log(chalk.dim("  Nothing playing, queue is empty"));
    return;
  }

  if (data.currently_playing) {
    const artists = data.currently_playing.artists.map((a) => a.name).join(", ");
    console.log(`  ${chalk.dim("Now")}  ${chalk.bold(data.currently_playing.name)} ${chalk.dim("—")} ${artists}`);
  }

  if (data.depth === 0) {
    console.log(chalk.dim("  Queue is empty"));
    return;
  }

  console.log();
  data.queue.forEach((track, i) => {
    const num = chalk.dim(`${(i + 1).toString().padStart(2)}.`);
    const artists = track.artists.map((a) => a.name).join(", ");
    console.log(`  ${num} ${chalk.bold(track.name)} ${chalk.dim("—")} ${artists}`);
  });
}

export async function queueListCommand(): Promise<void> {
  try {
    const state = await getQueue();
    const data: QueueListData = {
      currently_playing: state.currently_playing,
      queue: state.queue,
      depth: state.queue.length,
    };
    output(success("queue list", data), prettyQueueList);
  } catch (e) {
    exitWithError("queue list", e);
  }
}
