# Spotify DJ CLI — Foundation Spec v3

## Goal
A CLI (`sp`) that an AI agent can use as a DJ interface. Agent-parseable output, expressive commands, composable. Human also uses it directly.

## Binary
- Entry: `src/index.ts`
- Linked globally as `sp` via `bun link`
- Runtime: Bun (`#!/usr/bin/env bun`, no build step)
- CLI router: `cac` (Phase 1 — Phase 2 adds 4+ commands)
- `sp` (bare) and `sp now` are identical — `cac` default action calls the `now` handler

## Auth — PKCE OAuth

### Flow
- `sp auth` opens browser, catches redirect on `http://127.0.0.1:8888/callback`
  - Note: Spotify dashboard requires http, and only accepts `127.0.0.1` not `localhost`
  - Port probe: try 8888 first, fallback to next free port (register `http://127.0.0.1:8889/callback` in dashboard too)
- `sp auth --no-browser` prints URL, waits for user to paste redirect (timeout: 5 min, then clean error exit)
- To add scopes (Phase 2): re-run `sp auth` with full desired scope set — Spotify PKCE does not support incremental scope upgrades; a new full authorization is required each time

### Token storage
- `~/.config/sp/` created with `0700`
- `~/.config/sp/token.json` written with `0600`
- Atomic writes: write to `~/.config/sp/.token.tmp`, then `rename()` to `token.json`
- Lockfile: `~/.config/sp/token.lock` — held during refresh only; timeout 10s (prevents crashed process from blocking); poll with 100ms sleep, max 100 attempts
- On refresh failure: delete token, emit error `{ type: "auth_required" }`, exit 1

### Required scopes (Phase 1)
- `user-read-playback-state`
- `user-modify-playback-state`
- `user-read-recently-played`
- `user-read-currently-playing`
- `user-top-read`

### `sp auth` + `--json`
- All intermediate status ("waiting for redirect...", "opening browser...") → stderr only
- Final result only → stdout as `{ ok, command, schema_version, data: { scopes } }`

## Module Structure
```
src/
  index.ts              # CLI entry, cac router, default action = now
  auth.ts               # PKCE flow, token storage, refresh, lockfile
  spotify.ts            # Web API client: typed fetch, auto-refresh, backoff
  applescript.ts        # AppleScript transport implementation
  transport.ts          # Transport interface (see below)
  output.ts             # TTY detection, pretty vs JSON, error schema
  log.ts                # Session logging utilities
  commands/
    now.ts
    playback.ts         # play/pause/toggle/next/prev/vol  (NOT transport.ts — naming collision avoided)
    controls.ts         # shuffle/repeat/seek/like/unlike/play-now
    search.ts
    queue.ts
    history.ts
    top.ts
    playlist.ts         # list/create/add/show subcommands
    session.ts          # session tracking, export, list, clear, log
    dj.ts               # DJ context briefing for agent bootstrap
    device.ts           # list/transfer active device
```

## Transport Interface (`src/transport.ts`)
```ts
interface Transport {
  play(): Promise<void>
  pause(): Promise<void>
  next(): Promise<void>
  prev(): Promise<void>
  setVolume(n: number): Promise<void>
  getVolume(): Promise<number>
  getCurrentTrackId(): Promise<string | null>
  getState(): Promise<"playing" | "paused" | "stopped">
}
```
`applescript.ts` implements this for Phase 1. Web API Connect can slot in later.

## Output Contract (all commands)

### TTY detection
- `process.stdout.isTTY === true` → pretty colored output
- `process.stdout.isTTY === false` (piped/scripted) → JSON automatically
- `--json` flag forces JSON regardless
- `SP_OUTPUT=json` env var forces JSON regardless
- **ANSI escape codes never appear in JSON output**

### JSON envelope (every response)
```json
{
  "ok": true,
  "command": "now",
  "schema_version": 1,
  "data": { ... },
  "warnings": []
}
```

### Error envelope
```json
{
  "ok": false,
  "command": "now",
  "schema_version": 1,
  "error": {
    "type": "not_playing",
    "message": "...",
    "retryable": false,
    "suggestion": "Open Spotify and start playing something"
  }
}
```

### Error types (stable)
- `auth_required` — no token or refresh failed
- `rate_limited` — 429; include `retry_after_ms`
- `no_active_device` — API can't find a device
- `not_playing` — Spotify open, nothing playing
- `applescript_permission` — macOS automation permission not granted
- `app_not_running` — Spotify process not running
- `unsupported_item` — podcast, ad, local file
- `network` — fetch failed
- `unknown`

Errors → stderr in pretty mode, stdout in JSON mode.

## Commands — Phase 1

### `sp` / `sp now`

**Hybrid approach — 2 calls:**
1. **AppleScript** → `track_id`, `is_playing`, `progress_ms`, `duration_ms`, `shuffle`, `repeat`, `volume`
2. **Web API: playback state** (`/me/player`) → `device.id`, `device.name`, `device.is_active` only (everything else already from AppleScript)

AppleScript is authoritative for playback state. The API call for playback state is solely for device context.

**JSON output shape:**
```json
{
  "ok": true,
  "command": "now",
  "schema_version": 1,
  "data": {
    "item_type": "track",
    "track": {
      "uri": "spotify:track:xxx",
      "id": "xxx",
      "name": "Powder Blue",
      "artists": [{ "name": "TVAM" }],
      "album": { "name": "Powder Blue" },
      "duration_ms": 216000
    },
    "playback": {
      "is_playing": true,
      "progress_ms": 112000,
      "shuffle": false,
      "repeat": "off",
      "volume": 80
    },
    "device": {
      "id": "...",
      "name": "MacBook Pro",
      "is_active": true
    }
  },
  "warnings": []
}
```

**Edge cases:**
- App not running → `{ ok: false, error: { type: "app_not_running" } }`
- Nothing playing → `{ ok: true, data: { item_type: null, track: null, playback: { is_playing: false, shuffle: false, repeat: "off", volume: 80 }, device: {...} | null } }`
  — `playback.shuffle/repeat/volume` still present; `device` present if API responds
- Podcast/ad → `{ ok: true, data: { item_type: "episode", track: null, playback: {...}, device: {...} }, warnings: ["unsupported item type"] }`

### `sp play` / `sp pause`
Via AppleScript. Returns `{ ok: true, data: { state: "playing" | "paused" } }`.
`sp toggle` kept for human use only — **not recommended for agents** (non-deterministic without confirmed prior state).

### `sp next` / `sp prev`
Via AppleScript. Returns `{ ok: true }`.
Note for agents: no synchronous confirmation of new track — follow with `sp now` to get new context.

### `sp vol [0-100]`
Via AppleScript. Reads back actual volume after set.
Returns `{ ok: true, data: { volume: 50 } }`.

### `sp auth`
PKCE flow. Returns `{ ok: true, data: { scopes: [...] } }` on success.

## Rate Limiting
- Exponential backoff with jitter on 429
- Surface `retry_after_ms` in error JSON
- Document: agents should not poll `sp now` faster than ~2s

## Phase 2
- `sp search <query>` — returns `[{ uri, id, name, artists, album }]` (implemented)
- `sp queue <uri|id|url>` — accepts spotify URIs, open.spotify.com URLs, bare IDs (implemented)
- `sp history [--limit N]` (implemented)
- `sp device` — list/select active device (implemented)

> **Note:** Spotify deprecated the `GET /audio-features` and `GET /recommendations` endpoints for apps created after November 2024. Commands depending on those endpoints are not available for new Spotify app registrations.

## Agent Usage Pattern
```bash
sp now --json              # full context: track.uri, device.id
sp search "query" --json   # find tracks by name/artist
sp queue spotify:track:xxx # queue DJ pick
sp play                    # explicit (not sp toggle)
sp next                    # skip; follow with sp now for new context
```
