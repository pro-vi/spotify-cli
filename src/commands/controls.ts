/**
 * Session controls — shuffle, repeat, seek, like, unlike, play-now.
 */
import chalk from "chalk";
import { AppleScriptTransport } from "../applescript.ts";
import {
  setShuffle,
  setRepeat,
  seekToPosition,
  saveTracks,
  removeTracks,
  playNow,
} from "../spotify.ts";
import { success, error, output, exitWithError, formatTime } from "../output.ts";
import { normalizeTrackUri } from "./queue.ts";
import { appendTrackLog } from "../log.ts";

// ---------- shuffle ----------

export async function shuffleCommand(arg?: string): Promise<void> {
  const transport = new AppleScriptTransport();
  try {
    if (arg === undefined) {
      // Show current shuffle state from AppleScript transport
      const playback = await transport.getPlaybackInfo();
      output(success("shuffle", { shuffle: playback.shuffle }), (d) => console.log(`  Shuffle: ${chalk.cyan(d.shuffle ? "on" : "off")}`));
      return;
    }

    const state = arg.toLowerCase();
    if (state !== "on" && state !== "off") {
      output(
        error("shuffle", "unknown", "Invalid shuffle state", {
          suggestion: "Usage: sp shuffle [on|off]",
        })
      );
      process.exit(1);
      return;
    }

    await setShuffle(state === "on");
    output(success("shuffle", { shuffle: state === "on" }), (d) => console.log(chalk.green(`  ✓ Shuffle: ${d.shuffle ? "on" : "off"}`)));
  } catch (e) {
    exitWithError("shuffle", e);
  }
}

// ---------- repeat ----------

export async function repeatCommand(arg?: string): Promise<void> {
  const transport = new AppleScriptTransport();
  try {
    if (arg === undefined) {
      // Show current repeat state from AppleScript transport
      const playback = await transport.getPlaybackInfo();
      output(success("repeat", { repeat: playback.repeat }), (d) => console.log(`  Repeat: ${chalk.cyan(d.repeat)}`));
      return;
    }

    const state = arg.toLowerCase();
    if (state !== "off" && state !== "track" && state !== "context") {
      output(
        error("repeat", "unknown", "Invalid repeat mode", {
          suggestion: "Usage: sp repeat [off|track|context]",
        })
      );
      process.exit(1);
      return;
    }

    await setRepeat(state);
    output(success("repeat", { repeat: state }), (d) => console.log(chalk.green(`  ✓ Repeat: ${d.repeat}`)));
  } catch (e) {
    exitWithError("repeat", e);
  }
}

// ---------- seek ----------

/**
 * Parse a time string into milliseconds.
 * Accepts:
 *   - plain seconds: "90" -> 90000
 *   - mm:ss format: "1:30" -> 90000
 */
function parseTime(input: string): number | null {
  // mm:ss format
  if (input.includes(":")) {
    const parts = input.split(":");
    if (parts.length !== 2) return null;
    const minStr = parts[0];
    const secStr = parts[1];
    if (minStr === undefined || secStr === undefined) return null;
    const min = parseInt(minStr, 10);
    const sec = parseInt(secStr, 10);
    if (isNaN(min) || isNaN(sec) || min < 0 || sec < 0 || sec >= 60) return null;
    return (min * 60 + sec) * 1000;
  }

  // Plain seconds
  const secs = parseFloat(input);
  if (isNaN(secs) || secs < 0) return null;
  return Math.round(secs * 1000);
}

export async function seekCommand(time: string): Promise<void> {
  try {
    const positionMs = parseTime(time);
    if (positionMs === null) {
      output(
        error("seek", "unknown", `Invalid time format: "${time}"`, {
          suggestion: "Usage: sp seek <seconds> or sp seek <mm:ss> (e.g. sp seek 90 or sp seek 1:30)",
        })
      );
      process.exit(1);
      return;
    }

    await seekToPosition(positionMs);
    output(success("seek", { position_ms: positionMs }), (d) => console.log(chalk.green(`  ✓ Seeked to ${formatTime(d.position_ms)}`)));
  } catch (e) {
    exitWithError("seek", e);
  }
}

// ---------- like ----------

export async function likeCommand(): Promise<void> {
  const transport = new AppleScriptTransport();
  try {
    const trackInfo = await transport.getTrackInfo();
    if (!trackInfo) {
      output(
        error("like", "not_playing", "No track is currently playing", {
          suggestion: "Play a track first",
        })
      );
      process.exit(1);
      return;
    }

    if (trackInfo.uri.startsWith("spotify:episode:")) {
      output(error("like", "unsupported_item", "Cannot like podcasts/episodes with this command"));
      process.exit(1);
      return;
    }

    await saveTracks([trackInfo.id]);

    output(
      success("like", {
        uri: trackInfo.uri,
        name: trackInfo.name,
        saved: true,
      }),
      (data) => {
        console.log(chalk.green(`  ✓ Liked: "${data.name}"`));
      }
    );
  } catch (e) {
    exitWithError("like", e);
  }
}

// ---------- unlike ----------

export async function unlikeCommand(): Promise<void> {
  const transport = new AppleScriptTransport();
  try {
    const trackInfo = await transport.getTrackInfo();
    if (!trackInfo) {
      output(
        error("unlike", "not_playing", "No track is currently playing", {
          suggestion: "Play a track first",
        })
      );
      process.exit(1);
      return;
    }

    if (trackInfo.uri.startsWith("spotify:episode:")) {
      output(error("unlike", "unsupported_item", "Cannot unlike podcasts/episodes with this command"));
      process.exit(1);
      return;
    }

    await removeTracks([trackInfo.id]);

    output(
      success("unlike", {
        uri: trackInfo.uri,
        name: trackInfo.name,
        saved: false,
      }),
      (data) => {
        console.log(chalk.green(`  ✓ Unliked: "${data.name}"`));
      }
    );
  } catch (e) {
    exitWithError("unlike", e);
  }
}

// ---------- play-now ----------

export async function playNowCommand(input: string): Promise<void> {
  try {
    const uri = normalizeTrackUri(input);
    await playNow([uri]);

    output(
      success("play-now", {
        uri,
        playing: true,
      }),
      (data) => {
        console.log(chalk.green(`  ▶ Now playing: ${data.uri}`));
      }
    );

    await appendTrackLog("play-now", uri);
  } catch (e) {
    exitWithError("play-now", e);
  }
}
