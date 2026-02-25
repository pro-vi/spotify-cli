/**
 * Device command — list devices or transfer playback.
 */
import chalk from "chalk";
import { getDevices, transferPlayback, type SpotifyDeviceInfo } from "../spotify.ts";
import { success, error, output, exitWithError } from "../output.ts";

export async function deviceCommand(target?: string): Promise<void> {
  try {
    const devices = await getDevices();

    if (!target) {
      // List all devices
      if (devices.length === 0) {
        output(
          error("device", "no_active_device", "No devices found", {
            suggestion: "Open Spotify on a device and try again",
          })
        );
        process.exit(1);
        return;
      }

      output(
        success("device", { devices }),
        (data) => {
          console.log("  Devices:");
          for (const d of data.devices as SpotifyDeviceInfo[]) {
            const indicator = d.is_active ? chalk.green("▶") : " ";
            const name = d.is_active ? chalk.green(d.name) : d.name;
            console.log(`  ${indicator} ${name}  (${d.type}, ${d.volume_percent}%)`);
          }
        }
      );
      return;
    }

    // Transfer playback to a device
    const lowerTarget = target.toLowerCase();

    // Try exact ID match first, then case-insensitive name substring
    let match = devices.find((d) => d.id === target);
    if (!match) {
      match = devices.find((d) => d.name.toLowerCase().includes(lowerTarget));
    }

    if (!match) {
      const available = devices.map((d) => d.name).join(", ");
      output(
        error("device", "unknown", `No device matching "${target}"`, {
          suggestion: `Available devices: ${available || "none"}`,
        })
      );
      process.exit(1);
      return;
    }

    await transferPlayback(match.id);

    output(
      success("device", { device: match }),
      (data) => {
        const d = data.device as SpotifyDeviceInfo;
        console.log(chalk.green(`  ✓ Playing on: ${d.name}`));
      }
    );
  } catch (e) {
    exitWithError("device", e);
  }
}
