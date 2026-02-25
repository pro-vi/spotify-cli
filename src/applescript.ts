/**
 * AppleScript Transport — controls Spotify via osascript on macOS.
 */
import type { Transport, TrackInfo, PlaybackInfo, FullLocalState } from "./transport.ts";

async function osascript(script: string): Promise<string> {
  const proc = Bun.spawn(["osascript", "-e", script], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const msg = stderr.trim();
    // Detect common errors
    if (msg.includes("is not running") || msg.includes("not opened")) {
      throw Object.assign(new Error("Spotify is not running"), { type: "app_not_running" as const });
    }
    if (msg.includes("not allowed") || msg.includes("permission")) {
      throw Object.assign(new Error("AppleScript permission denied"), { type: "applescript_permission" as const });
    }
    throw Object.assign(new Error(`osascript failed: ${msg}`), { type: "unknown" as const });
  }

  return stdout.trim();
}

function tell(command: string): Promise<string> {
  return osascript(`tell application "Spotify" to ${command}`);
}

function isRunning(): Promise<boolean> {
  return osascript(
    'tell application "System Events" to (name of processes) contains "Spotify"'
  ).then((r) => r === "true");
}

export class AppleScriptTransport implements Transport {
  async ensureRunning(): Promise<void> {
    const running = await isRunning();
    if (!running) {
      throw Object.assign(new Error("Spotify is not running"), { type: "app_not_running" as const });
    }
  }

  async play(): Promise<void> {
    await this.ensureRunning();
    await tell("play");
  }

  async pause(): Promise<void> {
    await this.ensureRunning();
    await tell("pause");
  }

  async toggle(): Promise<void> {
    await this.ensureRunning();
    await tell("playpause");
  }

  async next(): Promise<void> {
    await this.ensureRunning();
    await tell("next track");
  }

  async prev(): Promise<void> {
    await this.ensureRunning();
    await tell("previous track");
  }

  async setVolume(n: number): Promise<void> {
    await this.ensureRunning();
    const clamped = Math.max(0, Math.min(100, Math.round(n)));
    await tell(`set sound volume to ${clamped}`);
  }

  async getVolume(): Promise<number> {
    await this.ensureRunning();
    const raw = await tell("get sound volume");
    return parseInt(raw, 10);
  }

  async getCurrentTrackId(): Promise<string | null> {
    await this.ensureRunning();
    const state = await this.getState();
    if (state === "stopped") return null;
    try {
      const uri = await tell("get id of current track");
      // uri is "spotify:track:xxx" — extract just the ID
      return uri.split(":").pop() ?? null;
    } catch {
      return null;
    }
  }

  async getState(): Promise<"playing" | "paused" | "stopped"> {
    await this.ensureRunning();
    const raw = await tell("get player state");
    if (raw === "playing") return "playing";
    if (raw === "paused") return "paused";
    return "stopped";
  }

  async getTrackInfo(): Promise<TrackInfo | null> {
    await this.ensureRunning();
    const state = await this.getState();
    if (state === "stopped") return null;

    try {
      // Run all track queries in parallel
      const [uri, name, artist, album, durationStr] = await Promise.all([
        tell("get id of current track"),
        tell("get name of current track"),
        tell("get artist of current track"),
        tell("get album of current track"),
        tell("get duration of current track"),
      ]);

      const id = uri.split(":").pop() ?? "";
      const duration_ms = parseInt(durationStr, 10);

      return { uri, id, name, artist, album, duration_ms };
    } catch {
      return null;
    }
  }

  async getPlaybackInfo(): Promise<PlaybackInfo> {
    await this.ensureRunning();

    const [stateStr, posStr, shuffleStr, repeatStr, volStr] = await Promise.all([
      tell("get player state"),
      tell("get player position").catch(() => "0"),
      tell("get shuffling").catch(() => "false"),
      tell("get repeating").catch(() => "false"),
      tell("get sound volume").catch(() => "50"),
    ]);

    const is_playing = stateStr === "playing";
    // player position is in seconds (float), convert to ms
    const progress_ms = Math.round(parseFloat(posStr) * 1000);
    const shuffle = shuffleStr === "true";
    // Spotify AppleScript only returns boolean for repeating
    // We map true -> "context", false -> "off"
    const repeat: "off" | "track" | "context" = repeatStr === "true" ? "context" : "off";
    const volume = parseInt(volStr, 10);

    return { is_playing, progress_ms, shuffle, repeat, volume };
  }

  async getFullState(): Promise<FullLocalState> {
    await this.ensureRunning();

    const [track, playback, state] = await Promise.all([
      this.getTrackInfo(),
      this.getPlaybackInfo(),
      this.getState(),
    ]);

    return { track, playback, state };
  }
}
