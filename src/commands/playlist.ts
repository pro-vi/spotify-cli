/**
 * Playlist commands — list, create, add, show.
 */
import chalk from "chalk";
import { CONFIG_PATH } from "../auth.ts";
import {
  getCurrentUser,
  getUserPlaylists,
  createPlaylist,
  addTracksToPlaylist,
  getPlaylistTracks,
} from "../spotify.ts";
import { success, error, output, exitWithError } from "../output.ts";
import { normalizeTrackUri } from "./queue.ts";

// ---------- user ID cache ----------

async function getUserId(): Promise<string> {
  // Check config cache first
  try {
    const file = Bun.file(CONFIG_PATH);
    if (await file.exists()) {
      const config = (await file.json()) as Record<string, unknown>;
      if (typeof config['user_id'] === "string" && config['user_id']) {
        return config['user_id'];
      }
    }
  } catch {
    // ignore
  }

  // Fetch from API and cache
  const user = await getCurrentUser();
  if (!user) throw new Error("Failed to fetch user profile");
  try {
    let config: Record<string, unknown> = {};
    const file = Bun.file(CONFIG_PATH);
    if (await file.exists()) {
      config = (await file.json()) as Record<string, unknown>;
    }
    config['user_id'] = user.id;
    const tmpPath = CONFIG_PATH + ".tmp";
    await Bun.write(tmpPath, JSON.stringify(config, null, 2));
    const { chmod, rename: fsRename } = await import("fs/promises");
    await chmod(tmpPath, 0o600);
    await fsRename(tmpPath, CONFIG_PATH);
  } catch {
    // Cache write failure is non-fatal
  }

  return user.id;
}

// ---------- playlist list ----------

interface PlaylistListData {
  playlists: Array<{
    id: string;
    name: string;
    tracks_total: number;
    public: boolean;
  }>;
}

function prettyPlaylistList(data: PlaylistListData): void {
  if (data.playlists.length === 0) {
    console.log(chalk.dim("  No playlists found"));
    return;
  }

  data.playlists.forEach((pl, i) => {
    const num = chalk.dim(`${(i + 1).toString().padStart(2)}.`);
    const trackCount = chalk.dim(`(${pl.tracks_total} tracks)`);
    console.log(`  ${num} ${chalk.bold(pl.name)} ${trackCount}`);
  });
}

export async function playlistListCommand(): Promise<void> {
  try {
    const playlists = await getUserPlaylists();
    const data: PlaylistListData = {
      playlists: playlists.map((pl) => ({
        id: pl.id,
        name: pl.name,
        tracks_total: pl.tracks?.total ?? 0,
        public: pl.public ?? false,
      })),
    };
    output(success("playlist list", data), prettyPlaylistList);
  } catch (e) {
    exitWithError("playlist list", e);
  }
}

// ---------- playlist create ----------

interface PlaylistCreateData {
  id: string;
  name: string;
  uri: string;
}

function prettyPlaylistCreate(data: PlaylistCreateData): void {
  console.log(chalk.green(`  ✓ Created: "${data.name}" (id: ${data.id})`));
}

export async function playlistCreateCommand(name: string): Promise<void> {
  try {
    const userId = await getUserId();
    const result = await createPlaylist(userId, name);
    if (!result) throw new Error("Failed to create playlist");
    const data: PlaylistCreateData = {
      id: result.id,
      name: result.name,
      uri: result.uri,
    };
    output(success("playlist create", data), prettyPlaylistCreate);
  } catch (e) {
    exitWithError("playlist create", e);
  }
}

// ---------- playlist add ----------

interface PlaylistAddData {
  playlist_id: string;
  added: number;
  uris: string[];
}

function prettyPlaylistAdd(data: PlaylistAddData): void {
  console.log(chalk.green(`  ✓ Added ${data.added} track${data.added === 1 ? "" : "s"} to playlist ${data.playlist_id}`));
}

export async function playlistAddCommand(playlistId: string, inputs: string[]): Promise<void> {
  try {
    if (inputs.length === 0) {
      output(
        error("playlist add", "unknown", "No track URIs provided", {
          suggestion: "Usage: sp playlist add <playlist-id> <uri> [uri2 uri3 ...]",
        })
      );
      process.exit(1);
      return;
    }

    const uris = inputs.map((input) => normalizeTrackUri(input));
    await addTracksToPlaylist(playlistId, uris);

    const data: PlaylistAddData = {
      playlist_id: playlistId,
      added: uris.length,
      uris,
    };
    output(success("playlist add", data), prettyPlaylistAdd);
  } catch (e) {
    exitWithError("playlist add", e);
  }
}

// ---------- playlist show ----------

interface PlaylistShowData {
  id: string;
  name: string;
  tracks: Array<{
    uri: string;
    id: string;
    name: string;
    artists: Array<{ name: string }>;
    album: { name: string };
  }>;
}

function prettyPlaylistShow(data: PlaylistShowData): void {
  console.log(chalk.bold(`  ${data.name}\n`));

  if (data.tracks.length === 0) {
    console.log(chalk.dim("  No tracks in playlist"));
    return;
  }

  data.tracks.forEach((track, i) => {
    const num = chalk.dim(`${(i + 1).toString().padStart(2)}.`);
    const artists = track.artists.map((a) => a.name).join(", ");
    console.log(`  ${num} ${chalk.bold(track.name)} ${chalk.dim("—")} ${artists} ${chalk.dim(`(${track.album.name})`)}`);
  });
}

export async function playlistShowCommand(playlistId: string): Promise<void> {
  try {
    const result = await getPlaylistTracks(playlistId);
    const data: PlaylistShowData = {
      id: playlistId,
      name: result.name,
      tracks: result.tracks,
    };
    output(success("playlist show", data), prettyPlaylistShow);
  } catch (e) {
    exitWithError("playlist show", e);
  }
}
