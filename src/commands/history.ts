/**
 * sp history — show recently played tracks.
 */
import chalk from "chalk";
import { getRecentlyPlayed } from "../spotify.ts";
import { success, output, exitWithError, timeAgo } from "../output.ts";

interface HistoryData {
  tracks: Array<{
    uri: string;
    id: string;
    name: string;
    artists: Array<{ name: string }>;
    album: { name: string };
    played_at: string;
  }>;
}

function prettyHistory(data: HistoryData, warnings: string[]): void {
  if (data.tracks.length === 0) {
    console.log(chalk.dim("  No recently played tracks"));
    return;
  }

  for (const track of data.tracks) {
    const artists = track.artists.map((a) => a.name).join(", ");
    const time = chalk.dim(timeAgo(track.played_at).padEnd(10));
    console.log(`  ${time} ${chalk.bold(track.name)} ${chalk.dim("—")} ${artists}`);
  }

  for (const w of warnings) {
    console.log(chalk.yellow(`\n  ⚠ ${w}`));
  }
}

export async function historyCommand(limit: number = 20): Promise<void> {
  try {
    const tracks = await getRecentlyPlayed(limit);
    const data: HistoryData = { tracks };
    output(success("history", data), prettyHistory);
  } catch (e) {
    exitWithError("history", e);
  }
}
