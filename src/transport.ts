/**
 * Transport interface — abstraction over playback control.
 * Implemented by AppleScript transport for local Spotify app.
 */

export interface Transport {
  play(): Promise<void>;
  pause(): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  setVolume(n: number): Promise<void>;
  getVolume(): Promise<number>;
  getCurrentTrackId(): Promise<string | null>;
  getState(): Promise<"playing" | "paused" | "stopped">;
}

export interface TrackInfo {
  uri: string;
  id: string;
  name: string;
  artist: string;
  album: string;
  duration_ms: number;
}

export interface PlaybackInfo {
  is_playing: boolean;
  progress_ms: number;
  shuffle: boolean;
  repeat: "off" | "track" | "context";
  volume: number;
}

export interface FullLocalState {
  track: TrackInfo | null;
  playback: PlaybackInfo;
  state: "playing" | "paused" | "stopped";
}
