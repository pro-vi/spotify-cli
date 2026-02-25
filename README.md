# sp -- Spotify DJ CLI for AI agents and humans

A command-line interface for controlling Spotify playback, designed for both AI agent DJ workflows and direct human use. Structured JSON output for programmatic control, pretty terminal output for humans. macOS only -- uses AppleScript for low-latency playback control and the Spotify Web API for search, queue, and library features.

## Requirements

- **macOS** (AppleScript is used for playback control)
- **[Bun](https://bun.sh/)** runtime (>= 1.0.0)
- **Spotify desktop app** installed and running
- **Spotify Premium** account (required for queue, device transfer, and play-now features)

## Installation

```bash
git clone https://github.com/pro-vi/spotify-cli.git
cd spotify-cli
bun install
bun link        # makes `sp` available globally
```

## Spotify App Setup

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and log in
2. Click **Create App**
3. Set a name and description (anything you like)
4. Add these **Redirect URIs**:
   - `http://127.0.0.1:8888/callback`
   - `http://127.0.0.1:8889/callback`
5. Save, then copy your **Client ID**

## Authentication

```bash
sp auth
```

On first run, you will be prompted for your Client ID. The auth flow opens your browser for Spotify OAuth (PKCE -- no client secret needed). Tokens are cached locally.

You can also set the Client ID via environment variable:

```bash
export SPOTIFY_CLIENT_ID=your_client_id_here
sp auth
```

## Commands

| Command | Description |
|---------|-------------|
| `sp` / `sp now` | Show current track, playback state, and device info |
| `sp play` | Start playback |
| `sp pause` | Pause playback |
| `sp toggle` | Toggle play/pause (not recommended for agents) |
| `sp next` | Skip to next track |
| `sp prev` | Go to previous track |
| `sp vol [0-100]` | Get or set volume |
| `sp seek <time>` | Seek to position (seconds or mm:ss) |
| `sp shuffle [on\|off]` | Get or set shuffle state |
| `sp repeat [off\|track\|context]` | Get or set repeat mode |
| `sp search <query>` | Search for tracks (`--limit <n>`) |
| `sp queue [uri]` | Add track to queue, or show queue (no args) |
| `sp play-now <uri>` | Immediately play a track (interrupts current) |
| `sp history` | Show recently played tracks (`--limit <n>`) |
| `sp top` | Show your top tracks (`--limit <n>`, `--range short\|medium\|long`) |
| `sp like` / `sp unlike` | Save/remove current track from Liked Songs |
| `sp playlist list` | List your playlists |
| `sp playlist create <name>` | Create a new playlist |
| `sp playlist add <id> <uri...>` | Add tracks to a playlist |
| `sp playlist show <id>` | Show playlist tracks |
| `sp session` | Show current DJ session |
| `sp session export` | Export session data |
| `sp session list` | List past sessions |
| `sp session clear` | Clear session data (`--force` to skip confirmation) |
| `sp log` | Show recent log entries (`--limit <n>`) |
| `sp dj` | Full DJ context briefing (state + queue + session + loop contract) |
| `sp device [target]` | List devices or transfer playback |
| `sp auth` | Authenticate with Spotify (`--no-browser` for manual flow) |

## JSON Output

All commands support structured JSON output:

```bash
sp now --json                  # --json flag
SP_OUTPUT=json sp now          # environment variable
sp now | cat                   # auto-detected when piped (non-TTY)
```

Every JSON response follows a consistent envelope:

```json
{
  "ok": true,
  "command": "now",
  "schema_version": 1,
  "data": { ... }
}
```

## Agent Usage Pattern

```bash
sp dj              # full context briefing (markdown)
sp dj --json       # structured JSON for agent harness
sp search "query" --json | jq '.data.tracks[0].uri'
sp queue spotify:track:xxx
sp next
sp now --json      # confirm what's playing after skip
```

## Configuration

Token and config files are stored in `~/.config/sp/`:

| File | Purpose |
|------|---------|
| `config.json` | Client ID and settings |
| `token.json` | OAuth token (file permissions: `0600`) |

The config directory is created with `0700` permissions.

## License

[MIT](LICENSE)
