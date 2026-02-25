#!/usr/bin/env bun
/**
 * sp — Spotify DJ CLI
 * Entry point: CLI router using cac.
 */
import cac from "cac";
import { setForceJson, output, success, error } from "./output.ts";
import { nowCommand } from "./commands/now.ts";
import { playCommand, pauseCommand, toggleCommand, nextCommand, prevCommand, volCommand } from "./commands/playback.ts";
import { runAuthFlow } from "./auth.ts";
import { searchCommand } from "./commands/search.ts";
import { queueCommand, queueListCommand } from "./commands/queue.ts";
import { historyCommand } from "./commands/history.ts";
import { topCommand } from "./commands/top.ts";
import {
  shuffleCommand,
  repeatCommand,
  seekCommand,
  likeCommand,
  unlikeCommand,
  playNowCommand,
} from "./commands/controls.ts";
import {
  playlistListCommand,
  playlistCreateCommand,
  playlistAddCommand,
  playlistShowCommand,
} from "./commands/playlist.ts";
import {
  sessionCommand,
  sessionExportCommand,
  sessionListCommand,
  sessionClearCommand,
  logCommand,
} from "./commands/session.ts";
import { djCommand } from "./commands/dj.ts";
import { deviceCommand } from "./commands/device.ts";

interface CliOptions {
  json?: boolean;
  limit?: string;
  range?: string;
  force?: boolean;
  browser?: boolean;
}

function parseLimit(raw: string | undefined, defaultVal: number): number {
  if (raw === undefined) return defaultVal;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < 1) {
    process.stderr.write(`  --limit must be a positive integer\n`);
    process.exit(1);
  }
  return n;
}

const cli = cac("sp");

// Global --json flag
cli.option("--json", "Force JSON output");

// sp now (default command)
cli.command("now", "Show current playback state").action(async () => {
  await nowCommand();
});

// sp play
cli.command("play", "Start playback").action(async () => {
  await playCommand();
});

// sp pause
cli.command("pause", "Pause playback").action(async () => {
  await pauseCommand();
});

// sp toggle
cli
  .command("toggle", "Toggle play/pause (not recommended for agents)")
  .action(async () => {
    await toggleCommand();
  });

// sp next
cli
  .command("next", "Skip to next track (follow with `sp now` for new context)")
  .action(async () => {
    await nextCommand();
  });

// sp prev
cli
  .command("prev", "Go to previous track (follow with `sp now` for new context)")
  .action(async () => {
    await prevCommand();
  });

// sp vol [level]
cli
  .command("vol [level]", "Get or set volume (0-100)")
  .action(async (level: string | undefined) => {
    await volCommand(level);
  });

// sp search <query>
cli
  .command("search <query>", "Search for tracks")
  .option("--limit <n>", "Number of results (default: 10)")
  .action(async (query: string, options: CliOptions) => {
    const limit = parseLimit(options.limit, 10);
    await searchCommand(query, limit);
  });

// sp queue [uri]  — no arg or "list" shows queue; uri adds a track
cli
  .command("queue [uri]", "Add a track to queue, or show queue with no args / 'list'")
  .action(async (uri: string | undefined) => {
    if (!uri || uri === "list") {
      await queueListCommand();
    } else {
      await queueCommand(uri);
    }
  });

// sp history
cli
  .command("history", "Show recently played tracks")
  .option("--limit <n>", "Number of results (default: 20, max: 50)")
  .action(async (options: CliOptions) => {
    const limit = parseLimit(options.limit, 20);
    await historyCommand(limit);
  });

// sp top
cli
  .command("top", "Show your top tracks")
  .option("--limit <n>", "Number of results (default: 20)")
  .option("--range <range>", "Time range: short, medium, long (default: medium)")
  .action(async (options: CliOptions) => {
    const limit = parseLimit(options.limit, 20);
    const VALID_RANGES = ["short", "medium", "long"];
    const range = options.range ?? "medium";
    if (!VALID_RANGES.includes(range)) {
      process.stderr.write(`Error: invalid --range "${range}". Must be one of: short, medium, long\n`);
      process.exit(1);
    }
    await topCommand(limit, range);
  });

// sp shuffle [on|off]
cli
  .command("shuffle [state]", "Get or set shuffle state (on|off)")
  .action(async (state: string | undefined) => {
    await shuffleCommand(state);
  });

// sp repeat [off|track|context]
cli
  .command("repeat [mode]", "Get or set repeat mode (off|track|context)")
  .action(async (mode: string | undefined) => {
    await repeatCommand(mode);
  });

// sp seek <time>
cli
  .command("seek <time>", "Seek to position (seconds or mm:ss)")
  .action(async (time: string) => {
    await seekCommand(time);
  });

// sp like
cli.command("like", "Save current track to Liked Songs").action(async () => {
  await likeCommand();
});

// sp unlike
cli.command("unlike", "Remove current track from Liked Songs").action(async () => {
  await unlikeCommand();
});

// sp play-now <uri>
cli
  .command("play-now <uri>", "Immediately play a track (interrupts current)")
  .action(async (uri: string) => {
    await playNowCommand(uri);
  });

// sp playlist <sub> [...args] — dispatches to playlist subcommands
cli
  .command("playlist <sub> [...args]", "Playlist commands: list, create <name>, add <id> <uri...>, show <id>")
  .action(async (sub: string, args: string[]) => {
    switch (sub) {
      case "list":
        await playlistListCommand();
        break;

      case "create": {
        const name = args[0];
        if (!name) {
          output(error("playlist create", "unknown", "Missing playlist name", {
            suggestion: "Usage: sp playlist create <name>",
          }));
          process.exit(1);
          return;
        }
        await playlistCreateCommand(name);
        break;
      }

      case "add": {
        const playlistId = args[0];
        const uris = args.slice(1);
        if (!playlistId || uris.length === 0) {
          output(error("playlist add", "unknown", "Missing playlist ID or track URIs", {
            suggestion: "Usage: sp playlist add <playlist-id> <uri> [uri2 uri3 ...]",
          }));
          process.exit(1);
          return;
        }
        await playlistAddCommand(playlistId, uris);
        break;
      }

      case "show": {
        const playlistId = args[0];
        if (!playlistId) {
          output(error("playlist show", "unknown", "Missing playlist ID", {
            suggestion: "Usage: sp playlist show <playlist-id>",
          }));
          process.exit(1);
          return;
        }
        await playlistShowCommand(playlistId);
        break;
      }

      default:
        output(error("playlist", "unknown", `Unknown subcommand: ${sub}`, {
          suggestion: "Available: list, create, add, show",
        }));
        process.exit(1);
    }
  });

// sp session <sub> — session tracking commands
cli
  .command("session [sub]", "Session commands: (bare), export, list, clear")
  .option("--force", "Skip confirmation for clear")
  .action(async (sub: string | undefined, options: CliOptions) => {
    switch (sub) {
      case undefined:
      case "":
        await sessionCommand();
        break;

      case "export":
        await sessionExportCommand();
        break;

      case "list":
        await sessionListCommand();
        break;

      case "clear":
        await sessionClearCommand(!!options.force);
        break;

      default:
        output(error("session", "unknown", `Unknown subcommand: ${sub}`, {
          suggestion: "Available: export, list, clear",
        }));
        process.exit(1);
    }
  });

// sp log — show recent log entries
cli
  .command("log", "Show last N log entries (like git log for DJ actions)")
  .option("--limit <n>", "Number of entries to show (default: 20)")
  .action(async (options: CliOptions) => {
    const limit = parseLimit(options.limit, 20);
    await logCommand(limit);
  });

// sp dj
cli
  .command("dj", "Bootstrap DJ agent loop — current state + queue + session + loop contract")
  .action(async () => {
    await djCommand();
  });
// sp device [target]
cli
  .command("device [target]", "List devices or transfer playback to a device")
  .action(async (target: string | undefined) => {
    await deviceCommand(target);
  });

// sp auth
cli
  .command("auth", "Authenticate with Spotify")
  .option("--no-browser", "Print URL instead of opening browser")
  .action(async (options: CliOptions) => {
    try {
      const result = await runAuthFlow({
        noBrowser: options.browser === false,
        json: !!options.json,
      });
      output(success("auth", result));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      output(error("auth", "auth_required", msg, { suggestion: "Try again or check your Client ID" }));
      process.exit(1);
    }
  });

// Default command (bare `sp`) runs `now`
cli.command("", "Show current playback state (same as `sp now`)").action(async () => {
  await nowCommand();
});

cli.help();
cli.version("0.1.0");

if (process.argv.includes("--json")) setForceJson(true);

cli.parse();
