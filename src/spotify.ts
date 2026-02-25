/**
 * Spotify Web API client — typed fetch with auto-refresh and backoff.
 */
import { getValidToken } from "./auth.ts";
const API_BASE = "https://api.spotify.com/v1";
const MAX_RETRIES = 3;

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T | undefined> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const token = await getValidToken();

    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (response.ok) {
      if (response.status === 204) return undefined;
      const text = await response.text();
      if (!text) return undefined;
      try {
        return JSON.parse(text) as T;
      } catch {
        // Some endpoints return non-JSON success bodies (e.g. snapshot IDs)
        return undefined;
      }
    }

    if (response.status === 401) {
      // Token expired — next iteration will refresh
      continue;
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const retryMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 1000;
      // Exponential backoff with jitter
      const backoff = retryMs + Math.random() * 500 * (attempt + 1);

      if (attempt < MAX_RETRIES - 1) {
        await Bun.sleep(backoff);
        continue;
      }

      throw Object.assign(new Error("Rate limited by Spotify API"), {
        type: "rate_limited",
        retry_after_ms: retryMs,
      });
    }

    const body = await response.text();
    let msg = `Spotify API error (${response.status})`;
    try {
      const parsed = JSON.parse(body);
      msg = parsed.error?.message ?? msg;
    } catch {
      // use default message
    }

    throw Object.assign(new Error(msg), {
      status: response.status,
    });
  }

  throw Object.assign(new Error("Max retries exceeded"), { type: "auth_required" });
}

// ---------- Shared base track type ----------

export interface SpotifyTrackBase {
  uri: string;
  id: string;
  name: string;
  artists: Array<{ name: string }>;
  album: { name: string };
}

// ---------- API methods ----------

export interface SpotifyDevice {
  id: string;
  name: string;
  is_active: boolean;
}

export interface SpotifyPlayerState {
  device: SpotifyDevice;
  is_playing: boolean;
  item?: {
    type: "track" | "episode";
    uri: string;
    id: string;
    name: string;
    artists?: Array<{ name: string }>;
    album?: { name: string };
    duration_ms: number;
  };
  progress_ms: number;
  shuffle_state: boolean;
  repeat_state: "off" | "track" | "context";
}

export async function getPlayerState(): Promise<SpotifyPlayerState | null> {
  const result = await apiRequest<SpotifyPlayerState>("/me/player");
  return result ?? null;
}

// ---------- Search ----------

export interface SpotifySearchTrack extends SpotifyTrackBase {
  duration_ms: number;
}

export async function searchTracks(query: string, limit: number = 10): Promise<SpotifySearchTrack[]> {
  const params = new URLSearchParams({ q: query, type: "track", limit: String(limit) });
  const result = await apiRequest<{
    tracks: { items: SpotifySearchTrack[] };
  }>(`/search?${params.toString()}`);

  return result?.tracks?.items ?? [];
}

// ---------- Queue ----------

export async function queueTrack(uri: string): Promise<void> {
  const params = new URLSearchParams({ uri });
  await apiRequest<undefined>(`/me/player/queue?${params.toString()}`, {
    method: "POST",
  });
}

// ---------- Queue State ----------

export interface SpotifyQueueState {
  currently_playing: SpotifyTrackBase | null;
  queue: SpotifyTrackBase[];
}

export async function getQueue(): Promise<SpotifyQueueState> {
  const result = await apiRequest<{
    currently_playing: {
      type: string;
      uri: string;
      id: string;
      name: string;
      artists?: Array<{ name: string }>;
      album?: { name: string };
    } | null;
    queue: Array<{
      type: string;
      uri: string;
      id: string;
      name: string;
      artists?: Array<{ name: string }>;
      album?: { name: string };
    }>;
  }>("/me/player/queue");

  const mapTrack = (item: {
    type: string;
    uri: string;
    id: string;
    name: string;
    artists?: Array<{ name: string }>;
    album?: { name: string };
  }) => ({
    uri: item.uri,
    id: item.id,
    name: item.name,
    artists: (item.artists ?? []).map((a) => ({ name: a.name })),
    album: { name: item.album?.name ?? "" },
  });

  const cp = result?.currently_playing;
  return {
    currently_playing: cp && cp.type === "track" ? mapTrack(cp) : null,
    // Filter to tracks only (skip episodes)
    queue: (result?.queue ?? [])
      .filter((item) => item.type === "track")
      .map(mapTrack),
  };
}

// ---------- Recently Played ----------

export interface SpotifyRecentTrack extends SpotifyTrackBase {
  played_at: string;
}

export async function getRecentlyPlayed(limit: number = 20): Promise<SpotifyRecentTrack[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  const result = await apiRequest<{
    items: Array<{
      track: SpotifyTrackBase;
      played_at: string;
    }>;
  }>(`/me/player/recently-played?${params.toString()}`);

  return (result?.items ?? []).map((item) => ({
    ...item.track,
    played_at: item.played_at,
  }));
}

// ---------- Top Tracks ----------

export type SpotifyTopTrack = SpotifyTrackBase;

export async function getTopTracks(
  limit: number = 20,
  timeRange: "short_term" | "medium_term" | "long_term" = "medium_term"
): Promise<SpotifyTopTrack[]> {
  const params = new URLSearchParams({ limit: String(limit), time_range: timeRange });
  const result = await apiRequest<{
    items: SpotifyTopTrack[];
  }>(`/me/top/tracks?${params.toString()}`);

  return result?.items ?? [];
}

// ---------- Shuffle ----------

export async function setShuffle(state: boolean): Promise<void> {
  await apiRequest<undefined>(`/me/player/shuffle?state=${state}`, {
    method: "PUT",
  });
}

// ---------- Repeat ----------

export async function setRepeat(state: "off" | "track" | "context"): Promise<void> {
  await apiRequest<undefined>(`/me/player/repeat?state=${state}`, {
    method: "PUT",
  });
}

// ---------- Seek ----------

export async function seekToPosition(positionMs: number): Promise<void> {
  await apiRequest<undefined>(`/me/player/seek?position_ms=${positionMs}`, {
    method: "PUT",
  });
}

// ---------- Like / Unlike ----------

export async function saveTracks(ids: string[]): Promise<void> {
  await apiRequest<undefined>(`/me/tracks`, {
    method: "PUT",
    body: JSON.stringify({ ids }),
  });
}

export async function removeTracks(ids: string[]): Promise<void> {
  await apiRequest<undefined>(`/me/tracks`, {
    method: "DELETE",
    body: JSON.stringify({ ids }),
  });
}

// ---------- Play Now ----------

export async function playNow(uris: string[]): Promise<void> {
  await apiRequest<undefined>(`/me/player/play`, {
    method: "PUT",
    body: JSON.stringify({ uris }),
  });
}

// ---------- User Profile ----------

export interface SpotifyUserProfile {
  id: string;
  display_name: string;
}

export async function getCurrentUser(): Promise<SpotifyUserProfile | undefined> {
  return apiRequest<SpotifyUserProfile>("/me");
}

// ---------- Playlists ----------

export interface SpotifyPlaylistSummary {
  id: string;
  name: string;
  public: boolean;
  tracks: { total: number };
}

export async function getUserPlaylists(limit: number = 50): Promise<SpotifyPlaylistSummary[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  const result = await apiRequest<{
    items: SpotifyPlaylistSummary[];
  }>(`/me/playlists?${params.toString()}`);
  return result?.items ?? [];
}

export async function createPlaylist(userId: string, name: string): Promise<{ id: string; name: string; uri: string } | undefined> {
  return apiRequest<{ id: string; name: string; uri: string }>(
    `/users/${encodeURIComponent(userId)}/playlists`,
    {
      method: "POST",
      body: JSON.stringify({ name, public: false }),
    }
  );
}

export async function addTracksToPlaylist(playlistId: string, uris: string[]): Promise<void> {
  await apiRequest<undefined>(`/playlists/${encodeURIComponent(playlistId)}/tracks`, {
    method: "POST",
    body: JSON.stringify({ uris }),
  });
}

export type SpotifyPlaylistTrack = SpotifyTrackBase;

export async function getPlaylistTracks(
  playlistId: string,
  limit: number = 50
): Promise<{ name: string; tracks: SpotifyPlaylistTrack[] }> {
  // First get playlist name
  const playlist = await apiRequest<{ name: string }>(`/playlists/${encodeURIComponent(playlistId)}?fields=name`);

  const params = new URLSearchParams({
    limit: String(limit),
    fields: "items(track(uri,id,name,artists(name),album(name)))",
  });
  const result = await apiRequest<{
    items: Array<{ track: SpotifyTrackBase | null }>;
  }>(`/playlists/${encodeURIComponent(playlistId)}/tracks?${params.toString()}`);

  const tracks = (result?.items ?? [])
    .filter((item): item is { track: SpotifyTrackBase } => item.track !== null)
    .map((item) => item.track);

  return { name: playlist?.name ?? "Unknown", tracks };
}

// ---------- Get Track ----------

export type SpotifyTrack = SpotifyTrackBase;

export async function getTrack(id: string): Promise<SpotifyTrack | null> {
  try {
    const result = await apiRequest<SpotifyTrack>(`/tracks/${encodeURIComponent(id)}`);
    return result ?? null;
  } catch {
    return null;
  }
}

// ---------- Devices ----------

export interface SpotifyDeviceInfo {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  volume_percent: number;
}

export async function getDevices(): Promise<SpotifyDeviceInfo[]> {
  const result = await apiRequest<{ devices: SpotifyDeviceInfo[] }>("/me/player/devices");
  return result?.devices ?? [];
}

export async function transferPlayback(deviceId: string): Promise<void> {
  await apiRequest<undefined>("/me/player", {
    method: "PUT",
    body: JSON.stringify({ device_ids: [deviceId] }),
  });
}
