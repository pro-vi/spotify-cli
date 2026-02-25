/**
 * sp search <query> — search for tracks on Spotify.
 */
import chalk from "chalk";
import { searchTracks } from "../spotify.ts";
import { success, output, exitWithError } from "../output.ts";

interface SearchData {
  query: string;
  tracks: Array<{
    uri: string;
    id: string;
    name: string;
    artists: Array<{ name: string }>;
    album: { name: string };
    duration_ms: number;
  }>;
}

function prettySearch(data: SearchData, warnings: string[]): void {
  if (data.tracks.length === 0) {
    console.log(chalk.yellow(`  No results found for "${data.query}"`));
    return;
  }

  console.log(chalk.dim(`  Results for "${data.query}":\n`));
  data.tracks.forEach((track, i) => {
    const artists = track.artists.map((a) => a.name).join(", ");
    const num = chalk.dim(`${(i + 1).toString().padStart(2)}.`);
    console.log(`  ${num} ${chalk.bold(track.name)} ${chalk.dim("—")} ${artists} ${chalk.dim(`(${track.album.name})`)}`);
  });

  for (const w of warnings) {
    console.log(chalk.yellow(`\n  ⚠ ${w}`));
  }
}

export async function searchCommand(query: string, limit: number = 10): Promise<void> {
  try {
    const tracks = await searchTracks(query, limit);
    const warnings: string[] = [];

    if (tracks.length === 0) {
      warnings.push("No results found");
    }

    const data: SearchData = { query, tracks };
    output(success("search", data, warnings), prettySearch);
  } catch (e) {
    exitWithError("search", e);
  }
}
