/**
 * sp top — show your top tracks.
 */
import chalk from "chalk";
import { getTopTracks } from "../spotify.ts";
import { success, output, exitWithError } from "../output.ts";

type TimeRange = "short" | "medium" | "long";

interface TopData {
  range: TimeRange;
  tracks: Array<{
    uri: string;
    id: string;
    name: string;
    artists: Array<{ name: string }>;
    album: { name: string };
  }>;
}

const RANGE_LABELS: Record<TimeRange, string> = {
  short: "last 4 weeks",
  medium: "last 6 months",
  long: "all time",
};

function prettyTop(data: TopData, warnings: string[]): void {
  if (data.tracks.length === 0) {
    console.log(chalk.dim("  No top tracks found"));
    return;
  }

  console.log(chalk.dim(`  Top tracks (${RANGE_LABELS[data.range]}):\n`));
  data.tracks.forEach((track, i) => {
    const artists = track.artists.map((a) => a.name).join(", ");
    const num = chalk.dim(`${(i + 1).toString().padStart(2)}.`);
    console.log(`  ${num} ${chalk.bold(track.name)} ${chalk.dim("—")} ${artists}`);
  });

  for (const w of warnings) {
    console.log(chalk.yellow(`\n  ⚠ ${w}`));
  }
}

export async function topCommand(limit: number = 20, range: TimeRange = "medium"): Promise<void> {
  try {
    const timeRange = `${range}_term` as "short_term" | "medium_term" | "long_term";
    const tracks = await getTopTracks(limit, timeRange);
    const data: TopData = { range, tracks };
    output(success("top", data), prettyTop);
  } catch (e) {
    exitWithError("top", e);
  }
}
