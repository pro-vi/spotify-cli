/**
 * Playback commands — play, pause, toggle, next, prev, vol, seek.
 */
import chalk from "chalk";
import { AppleScriptTransport } from "../applescript.ts";
import { success, error, output, exitWithError } from "../output.ts";
import { appendLog } from "../log.ts";

export async function playCommand(): Promise<void> {
  const transport = new AppleScriptTransport();
  try {
    await transport.play();
    output(success("play", { state: "playing" }), () => console.log(chalk.green("  ▶ Playing")));
  } catch (e) {
    exitWithError("play", e);
  }
}

export async function pauseCommand(): Promise<void> {
  const transport = new AppleScriptTransport();
  try {
    await transport.pause();
    output(success("pause", { state: "paused" }), () => console.log(chalk.yellow("  ⏸ Paused")));
  } catch (e) {
    exitWithError("pause", e);
  }
}

export async function toggleCommand(): Promise<void> {
  const transport = new AppleScriptTransport();
  try {
    await transport.toggle();
    // Read back state
    const state = await transport.getState();
    output(success("toggle", { state }), (d) => console.log(d.state === "playing" ? chalk.green("  ▶ Playing") : chalk.yellow("  ⏸ Paused")));
  } catch (e) {
    exitWithError("toggle", e);
  }
}

export async function nextCommand(): Promise<void> {
  const transport = new AppleScriptTransport();
  try {
    await transport.next();
    output(success("next", {}), () => console.log(chalk.green("  ⏭ Skipped")));
    await appendLog({ action: "next" });
  } catch (e) {
    exitWithError("next", e);
  }
}

export async function prevCommand(): Promise<void> {
  const transport = new AppleScriptTransport();
  try {
    await transport.prev();
    output(success("prev", {}), () => console.log(chalk.green("  ⏮ Previous")));
    await appendLog({ action: "prev" });
  } catch (e) {
    exitWithError("prev", e);
  }
}

export async function volCommand(level?: string): Promise<void> {
  const transport = new AppleScriptTransport();
  try {
    if (level === undefined) {
      // Just read current volume
      const volume = await transport.getVolume();
      output(success("vol", { volume }), (d) => console.log(`  Volume: ${chalk.cyan(String(d.volume))}`));
      return;
    }

    const n = parseInt(level, 10);
    if (isNaN(n) || n < 0 || n > 100) {
      output(
        error("vol", "unknown", "Volume must be a number between 0 and 100", {
          suggestion: "Usage: sp vol [0-100]",
        })
      );
      process.exit(1);
      return;
    }

    await transport.setVolume(n);
    // Read back actual volume
    const actual = await transport.getVolume();
    output(success("vol", { volume: actual }), (d) => console.log(`  Volume: ${chalk.cyan(String(d.volume))}`));
  } catch (e) {
    exitWithError("vol", e);
  }
}
