/**
 * Auth module — PKCE OAuth flow, token storage, refresh, lockfile.
 */
import { join } from "path";
import { homedir } from "os";
import { mkdir, rename, unlink, open, chmod } from "fs/promises";

const CONFIG_DIR = join(homedir(), ".config", "sp");
const TOKEN_PATH = join(CONFIG_DIR, "token.json");
const TOKEN_TMP_PATH = join(CONFIG_DIR, ".token.tmp");
const LOCK_PATH = join(CONFIG_DIR, "token.lock");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");

const SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-recently-played",
  "user-read-currently-playing",
  "user-top-read",
  "user-library-read",
  "user-library-modify",
  "playlist-read-private",
  "playlist-modify-private",
  "playlist-modify-public",
];

export interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
  scopes: string[];
}

interface SpConfig {
  client_id: string;
}

// ---------- config ----------

async function ensureConfigDir(): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
}

export async function getClientId(): Promise<string> {
  // 1. Env var takes priority
  const envId = process.env["SPOTIFY_CLIENT_ID"];
  if (envId) return envId;

  // 2. Stored config
  try {
    const file = Bun.file(CONFIG_PATH);
    if (await file.exists()) {
      const config = (await file.json()) as SpConfig;
      if (config.client_id) return config.client_id;
    }
  } catch {
    // ignore
  }

  throw Object.assign(new Error("No Spotify Client ID found. Set SPOTIFY_CLIENT_ID env var or run `sp auth`."), {
    type: "auth_required",
  });
}

export async function saveClientId(clientId: string): Promise<void> {
  await ensureConfigDir();
  let config: Record<string, unknown> = {};
  try {
    const file = Bun.file(CONFIG_PATH);
    if (await file.exists()) {
      config = (await file.json()) as Record<string, unknown>;
    }
  } catch {
    // start fresh
  }
  config['client_id'] = clientId;
  const tmpPath = CONFIG_PATH + ".tmp";
  await Bun.write(tmpPath, JSON.stringify(config, null, 2));
  await chmod(tmpPath, 0o600);
  await rename(tmpPath, CONFIG_PATH);
}

// ---------- PKCE helpers ----------

function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64url(array);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64url(new Uint8Array(digest));
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateState(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return base64url(array);
}

// ---------- token storage ----------

export async function loadToken(): Promise<TokenData | null> {
  try {
    const file = Bun.file(TOKEN_PATH);
    if (!(await file.exists())) return null;
    const data = (await file.json()) as TokenData;
    return data;
  } catch {
    return null;
  }
}

async function saveToken(token: TokenData): Promise<void> {
  await ensureConfigDir();
  // Atomic write: write to tmp, then rename
  await Bun.write(TOKEN_TMP_PATH, JSON.stringify(token, null, 2));
  await chmod(TOKEN_TMP_PATH, 0o600);
  await rename(TOKEN_TMP_PATH, TOKEN_PATH);
}

async function deleteToken(): Promise<void> {
  try {
    await unlink(TOKEN_PATH);
  } catch {
    // ignore if doesn't exist
  }
}

// ---------- lockfile ----------

async function acquireLock(timeoutMs = 10_000, pollMs = 100): Promise<() => Promise<void>> {
  const deadline = Date.now() + timeoutMs;
  await ensureConfigDir();

  while (Date.now() < deadline) {
    try {
      const fh = await open(LOCK_PATH, "wx");
      await fh.writeFile(String(process.pid));
      await fh.close();
      return async () => {
        try {
          await unlink(LOCK_PATH);
        } catch {
          // ignore
        }
      };
    } catch (e) {
      if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "EEXIST") {
        // Check if the locking process is still alive
        try {
          const lockContent = await Bun.file(LOCK_PATH).text();
          const lockPid = parseInt(lockContent.trim(), 10);
          if (!isNaN(lockPid) && lockPid !== process.pid) {
            try {
              process.kill(lockPid, 0); // signal 0 = existence check only
            } catch {
              // Process is dead — remove stale lock and retry immediately
              await unlink(LOCK_PATH).catch(() => {});
              continue;
            }
          }
        } catch {
          // Can't read lock file — just wait
        }
        await Bun.sleep(pollMs);
        continue;
      }
      throw e;
    }
  }
  throw new Error("Failed to acquire token lock (timeout)");
}

// ---------- token refresh ----------

export async function getValidToken(): Promise<TokenData> {
  const token = await loadToken();
  if (!token) {
    throw Object.assign(new Error("Not authenticated. Run `sp auth` first."), {
      type: "auth_required",
    });
  }

  // If token still valid (with 60s buffer), return it
  if (token.expires_at > Date.now() + 60_000) {
    return token;
  }

  // Need to refresh
  const releaseLock = await acquireLock();
  try {
    // Re-check after acquiring lock (another process may have refreshed)
    const freshToken = await loadToken();
    if (freshToken && freshToken.expires_at > Date.now() + 60_000) {
      return freshToken;
    }

    const clientId = await getClientId();
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: token.refresh_token,
        client_id: clientId,
      }),
    });

    if (!response.ok) {
      await deleteToken();
      throw Object.assign(new Error("Token refresh failed. Run `sp auth` again."), {
        type: "auth_required",
      });
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
    };

    const newToken: TokenData = {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? token.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
      scopes: data.scope.split(" "),
    };

    await saveToken(newToken);
    return newToken;
  } finally {
    await releaseLock();
  }
}

// ---------- PKCE auth flow ----------

export interface AuthOptions {
  noBrowser?: boolean;
  json?: boolean;
}

function statusMsg(msg: string, json: boolean): void {
  // In JSON mode, all intermediate status goes to stderr
  if (json) {
    process.stderr.write(msg + "\n");
  } else {
    process.stdout.write(msg + "\n");
  }
}

export async function runAuthFlow(options: AuthOptions = {}): Promise<{ scopes: string[] }> {
  const { noBrowser = false, json = false } = options;

  // Get or prompt for client ID
  let clientId: string;
  try {
    clientId = await getClientId();
  } catch {
    // Prompt user for client ID
    statusMsg("No Spotify Client ID found.", json);
    statusMsg("Create an app at https://developer.spotify.com/dashboard", json);
    statusMsg("Set redirect URI to http://127.0.0.1:8888/callback", json);
    statusMsg("", json);

    const response = prompt("Enter your Spotify Client ID:");
    if (!response) {
      throw new Error("Client ID is required");
    }
    clientId = response.trim();
    await saveClientId(clientId);
    statusMsg("Client ID saved.", json);
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateState();

  if (noBrowser) {
    // No-browser flow doesn't need a local server — pick a fixed redirect URI
    const redirectUri = "http://127.0.0.1:8888/callback";

    const authUrl = new URL("https://accounts.spotify.com/authorize");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", SCOPES.join(" "));
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("state", state);

    statusMsg("\nOpen this URL in your browser:", json);
    statusMsg(authUrl.toString(), json);
    statusMsg("\nAfter authorizing, paste the full redirect URL here:", json);

    const redirectInput = prompt("Redirect URL:");
    if (!redirectInput) {
      throw new Error("No redirect URL provided");
    }

    const url = new URL(redirectInput.trim());
    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");

    if (returnedState !== state) {
      throw new Error("State mismatch — possible CSRF attack");
    }
    if (!code) {
      const error = url.searchParams.get("error");
      throw new Error(`Authorization failed: ${error ?? "no code returned"}`);
    }

    return await exchangeCode(code, codeVerifier, redirectUri, clientId);
  }

  // Browser flow — start local server directly (no probe-and-release TOCTOU race)
  statusMsg("Starting auth flow...", json);

  // We need resolve/reject accessible from the fetch handler, so we use a
  // deferred promise pattern.
  let resolveAuth: (value: { scopes: string[] }) => void;
  let rejectAuth: (reason: Error) => void;
  const authPromise = new Promise<{ scopes: string[] }>((resolve, reject) => {
    resolveAuth = resolve;
    rejectAuth = reject;
  });

  let timeout: ReturnType<typeof setTimeout>;

  // The fetch handler for the auth callback server
  const authFetch = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (url.pathname !== "/callback") {
      return new Response("Not found", { status: 404 });
    }

    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    const err = url.searchParams.get("error");

    if (err) {
      clearTimeout(timeout);
      setTimeout(() => server.stop(true), 100);
      rejectAuth(new Error(`Authorization failed: ${err}`));
      return new Response(
        "<html><body><h1>Authorization failed</h1><p>You can close this tab.</p></body></html>",
        { headers: { "Content-Type": "text/html" } }
      );
    }

    if (returnedState !== state) {
      clearTimeout(timeout);
      setTimeout(() => server.stop(true), 100);
      rejectAuth(new Error("State mismatch"));
      return new Response("State mismatch", { status: 400 });
    }

    if (!code) {
      clearTimeout(timeout);
      setTimeout(() => server.stop(true), 100);
      rejectAuth(new Error("No code returned"));
      return new Response("No code", { status: 400 });
    }

    try {
      const result = await exchangeCode(code, codeVerifier, redirectUri, clientId);
      clearTimeout(timeout);
      setTimeout(() => server.stop(true), 100);
      resolveAuth(result);
      return new Response(
        "<html><body><h1>Authenticated!</h1><p>You can close this tab and return to the terminal.</p></body></html>",
        { headers: { "Content-Type": "text/html" } }
      );
    } catch (e) {
      clearTimeout(timeout);
      setTimeout(() => server.stop(true), 100);
      rejectAuth(e instanceof Error ? e : new Error(String(e)));
      return new Response("Token exchange failed", { status: 500 });
    }
  };

  // Start server immediately (no probe-and-release):
  // Try preferred port 8888; if it fails, try 8889 (both should be registered
  // in the Spotify dashboard); if both are busy, surface a clear error.
  let server: ReturnType<typeof Bun.serve>;
  let port: number;
  try {
    server = Bun.serve({ port: 8888, hostname: "127.0.0.1", fetch: authFetch });
    port = 8888;
  } catch {
    try {
      server = Bun.serve({ port: 8889, hostname: "127.0.0.1", fetch: authFetch });
      port = 8889;
    } catch {
      throw new Error(
        "Could not bind to port 8888 or 8889. Ensure one of these ports is free and both redirect URIs " +
        "(http://127.0.0.1:8888/callback and http://127.0.0.1:8889/callback) are registered in your Spotify app dashboard."
      );
    }
  }
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  timeout = setTimeout(() => {
    server.stop(true);
    rejectAuth(new Error("Auth flow timed out (5 minutes)"));
  }, 5 * 60 * 1000);

  const authUrl = new URL("https://accounts.spotify.com/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", SCOPES.join(" "));
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("state", state);

  statusMsg(`Listening on http://127.0.0.1:${port}/callback`, json);

  // Open browser
  Bun.spawn(["open", authUrl.toString()], { stdout: "ignore", stderr: "ignore" });
  statusMsg("Opened browser for Spotify authorization...", json);

  return authPromise;
}

async function exchangeCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
  clientId: string
): Promise<{ scopes: string[] }> {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
  };

  const token: TokenData = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    scopes: data.scope.split(" "),
  };

  await saveToken(token);
  return { scopes: token.scopes };
}
