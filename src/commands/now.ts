/**
 * sp now — show current playback state.
 * Hybrid: AppleScript for playback, Web API for device info.
 */
import chalk from "chalk";
import { AppleScriptTransport } from "../applescript.ts";
import { getPlayerState } from "../spotify.ts";
import {
  success,
  output,
  exitWithError,
  progressBar,
  formatTime,
} from "../output.ts";
import { loadToken } from "../auth.ts";

interface NowData {
  item_type: "track" | "episode" | null;
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
  device: {
    id: string;
    name: string;
    is_active: boolean;
  } | null;
}

function prettyNow(data: NowData, warnings: string[]): void {
  if (!data.track) {
    if (data.item_type === "episode") {
      console.log(chalk.yellow("  Podcast/episode playing (no track info)"));
    } else {
      console.log(chalk.dim("  Nothing playing"));
    }
    return;
  }

  const { track, playback } = data;
  const icon = playback.is_playing ? chalk.green("▶") : chalk.yellow("⏸");
  const artists = track.artists.map((a) => a.name).join(", ");

  console.log(`${icon}  ${chalk.bold(track.name)} ${chalk.dim("—")} ${artists}`);
  console.log(`   ${chalk.dim(track.album.name)}`);

  // Progress bar
  const bar = progressBar(playback.progress_ms, track.duration_ms);
  const elapsed = formatTime(playback.progress_ms);
  const total = formatTime(track.duration_ms);
  console.log(`   ${chalk.cyan(bar)}  ${chalk.dim(`${elapsed} / ${total}`)}`);

  // Warnings
  for (const w of warnings) {
    console.log(chalk.yellow(`   ⚠ ${w}`));
  }
}

export async function nowCommand(): Promise<void> {
  const transport = new AppleScriptTransport();

  try {
    const localState = await transport.getFullState();
    const warnings: string[] = [];

    // Nothing playing
    if (localState.state === "stopped" || !localState.track) {
      const data: NowData = {
        item_type: null,
        track: null,
        playback: {
          is_playing: false,
          progress_ms: 0,
          remaining_ms: 0,
          shuffle: localState.playback.shuffle,
          repeat: localState.playback.repeat,
          volume: localState.playback.volume,
        },
        device: null,
      };
      output(success("now", data), prettyNow);
      return;
    }

    const track = localState.track;
    const isEpisode = track.uri.startsWith("spotify:episode:");
    const itemType = isEpisode ? "episode" : "track";

    // Build track data for response
    const trackData = isEpisode
      ? null
      : {
          uri: track.uri,
          id: track.id,
          name: track.name,
          artists: [{ name: track.artist }],
          album: { name: track.album },
          duration_ms: track.duration_ms,
        };

    // Fetch device info from API
    let device: NowData["device"] = null;

    const token = await loadToken();
    const hasToken = token && token.expires_at > Date.now();

    if (hasToken) {
      const playerState = await getPlayerState().catch(() => null);
      if (playerState?.device) {
        device = {
          id: playerState.device.id,
          name: playerState.device.name,
          is_active: playerState.device.is_active,
        };
      }
    }

    const data: NowData = {
      item_type: itemType,
      track: trackData,
      playback: {
        is_playing: localState.playback.is_playing,
        progress_ms: localState.playback.progress_ms,
        remaining_ms: Math.max(0, (trackData?.duration_ms ?? 0) - localState.playback.progress_ms),
        shuffle: localState.playback.shuffle,
        repeat: localState.playback.repeat,
        volume: localState.playback.volume,
      },
      device,
    };

    output(success("now", data, warnings), prettyNow);
  } catch (e) {
    exitWithError("now", e);
  }
}
