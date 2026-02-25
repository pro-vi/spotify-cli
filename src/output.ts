/**
 * Output module — TTY detection, pretty vs JSON output, error schema.
 */
import chalk from "chalk";

// ---------- types ----------

export interface SuccessEnvelope<T = unknown> {
  ok: true;
  command: string;
  schema_version: 1;
  data: T;
  warnings: string[];
}

export interface ErrorEnvelope {
  ok: false;
  command: string;
  schema_version: 1;
  error: {
    type: ErrorType;
    message: string;
    retryable: boolean;
    suggestion?: string;
    retry_after_ms?: number;
  };
}

export type ErrorType =
  | "auth_required"
  | "rate_limited"
  | "no_active_device"
  | "not_playing"
  | "applescript_permission"
  | "app_not_running"
  | "unsupported_item"
  | "network"
  | "unknown";

export type Envelope<T = unknown> = SuccessEnvelope<T> | ErrorEnvelope;

// ---------- detection ----------

let forceJson = false;

export function setForceJson(v: boolean): void {
  forceJson = v;
}

export function isJsonMode(): boolean {
  return forceJson || process.env["SP_OUTPUT"] === "json";
}
// ---------- builders ----------

export function success<T>(command: string, data: T, warnings: string[] = []): SuccessEnvelope<T> {
  return { ok: true, command, schema_version: 1, data, warnings };
}

export function error(
  command: string,
  type: ErrorType,
  message: string,
  opts: { retryable?: boolean; suggestion?: string; retry_after_ms?: number } = {}
): ErrorEnvelope {
  return {
    ok: false,
    command,
    schema_version: 1,
    error: {
      type,
      message,
      retryable: opts.retryable ?? false,
      suggestion: opts.suggestion,
      ...(opts.retry_after_ms !== undefined ? { retry_after_ms: opts.retry_after_ms } : {}),
    },
  };
}

// ---------- output ----------

export function outputJson(envelope: Envelope): void {
  process.stdout.write(JSON.stringify(envelope) + "\n");
}

export function outputError(envelope: ErrorEnvelope): void {
  if (isJsonMode()) {
    outputJson(envelope);
  } else {
    process.stderr.write(chalk.red(`Error [${envelope.error.type}]: ${envelope.error.message}\n`));
    if (envelope.error.suggestion) {
      process.stderr.write(chalk.yellow(`  Suggestion: ${envelope.error.suggestion}\n`));
    }
  }
}

export function output<T>(envelope: Envelope<T>, prettyFn?: (data: T, warnings: string[]) => void): void {
  if (isJsonMode()) {
    outputJson(envelope);
  } else if (envelope.ok) {
    if (prettyFn) {
      prettyFn(envelope.data, envelope.warnings);
    } else {
      outputJson(envelope);
    }
  } else {
    outputError(envelope);
  }
}

// ---------- error mapping ----------

export function mapErrorType(err: unknown): { type: ErrorType; message: string; suggestion?: string; retry_after_ms?: number } {
  if (err instanceof Error) {
    if ("type" in err && typeof err.type === "string") {
      if (err.type === "app_not_running") {
        return {
          type: "app_not_running",
          message: "Spotify is not running",
          suggestion: "Open Spotify and try again",
        };
      }
      if (err.type === "applescript_permission") {
        return {
          type: "applescript_permission",
          message: "AppleScript permission denied",
          suggestion: "Grant terminal access in System Settings > Privacy & Security > Automation",
        };
      }
      if (err.type === "auth_required") {
        return {
          type: "auth_required",
          message: "Authentication required",
          suggestion: "Run `sp auth` to authenticate",
        };
      }
      if (err.type === "rate_limited") {
        const retryMs = "retry_after_ms" in err && typeof err.retry_after_ms === "number" ? err.retry_after_ms : undefined;
        return {
          type: "rate_limited",
          message: "Rate limited by Spotify API",
          suggestion: "Wait before retrying",
          retry_after_ms: retryMs,
        };
      }
    }
    if (err.message.includes("fetch") || err.message.includes("ECONNREFUSED")) {
      return {
        type: "network",
        message: err.message,
        suggestion: "Check your internet connection",
      };
    }
    return { type: "unknown", message: err.message };
  }
  return { type: "unknown", message: String(err) };
}

export function isNoActiveDeviceError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const msg = e.message.toLowerCase();
  return (
    msg.includes("no active device") ||
    ("status" in e && typeof e.status === "number" && e.status === 404 && msg.includes("player"))
  );
}

export function exitWithError(command: string, e: unknown): never {
  if (isNoActiveDeviceError(e)) {
    output(error(command, "no_active_device", "No active device found", {
      suggestion: "Open Spotify on a device and try again",
    }));
    process.exit(1);
  }
  const mapped = mapErrorType(e);
  output(error(command, mapped.type, mapped.message, { suggestion: mapped.suggestion, retry_after_ms: mapped.retry_after_ms }));
  process.exit(1);
}

// ---------- pretty helpers ----------

export function progressBar(current: number, total: number, width = 20): string {
  if (total <= 0) return "░".repeat(width);
  const ratio = Math.min(current / total, 1);
  const filled = Math.round(ratio * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

export function timeAgo(isoTs: string): string {
  const diffMs = Date.now() - new Date(isoTs).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
