import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const OAUTH_AUTHORIZE_URL = "https://linear.app/oauth/authorize";
export const OAUTH_TOKEN_URL = "https://api.linear.app/oauth/token";
export const OAUTH_REDIRECT_URI = "http://127.0.0.1:14566/oauth/callback";
const OAUTH_SCOPES = "read,write";
const REFRESH_SKEW_MS = 2 * 60 * 1000;

export type OAuthTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
};

type PendingOAuthLogin = {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  createdAt: number;
};

type OAuthStore = {
  clientId?: string;
  tokens?: OAuthTokens;
  pending?: PendingOAuthLogin;
};

export type OAuthLoginStart = {
  authorizationUrl: string;
  state: string;
  redirectUri: string;
  clientId: string;
};

export type OAuthStatus = {
  configured: boolean;
  clientIdConfigured: boolean;
  expiresAt: number | null;
  expired: boolean;
};

export function oauthStorePath(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.LINEAR_SDK_AXI_AUTH_FILE ??
    join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "linear-sdk-axi", "oauth.json")
  );
}

async function readStore(path = oauthStorePath()): Promise<OAuthStore> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as OAuthStore;
  } catch {
    return {};
  }
}

function readStoreSync(path = oauthStorePath()): OAuthStore {
  try {
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, "utf8")) as OAuthStore;
  } catch {
    return {};
  }
}

async function writeStore(store: OAuthStore, path = oauthStorePath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  try {
    await chmod(path, 0o600);
  } catch {
    // Windows does not apply POSIX mode bits; the current user's profile owns the file.
  }
}

function base64Url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(48));
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function authorizationUrl(input: {
  clientId: string;
  state: string;
  challenge: string;
}): string {
  const url = new URL(OAUTH_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", OAUTH_REDIRECT_URI);
  url.searchParams.set("scope", OAUTH_SCOPES);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function configuredOAuthClientId(
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return (
    explicit ??
    env.LINEAR_SDK_AXI_OAUTH_CLIENT_ID ??
    readStoreSync(oauthStorePath(env)).clientId
  );
}

export async function beginOAuthLogin(clientId: string): Promise<OAuthLoginStart> {
  const { verifier, challenge } = pkcePair();
  const state = base64Url(randomBytes(24));
  const current = await readStore();
  await writeStore({
    ...current,
    clientId,
    pending: {
      state,
      codeVerifier: verifier,
      redirectUri: OAUTH_REDIRECT_URI,
      createdAt: Date.now(),
    },
  });
  return {
    authorizationUrl: authorizationUrl({ clientId, state, challenge }),
    state,
    redirectUri: OAUTH_REDIRECT_URI,
    clientId,
  };
}

function oauthFailure(response: Response): Error {
  return new Error(`Linear OAuth token request failed (${response.status})`);
}

async function tokenRequest(params: URLSearchParams): Promise<OAuthTokens> {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const text = await response.text();
  if (!response.ok) throw oauthFailure(response);
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("Linear OAuth token response was not JSON");
  }
  if (typeof data.access_token !== "string" || data.access_token.length === 0) {
    throw new Error("Linear OAuth token response did not include an access token");
  }
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : undefined;
  return {
    accessToken: data.access_token,
    ...(typeof data.refresh_token === "string" ? { refreshToken: data.refresh_token } : {}),
    ...(expiresIn ? { expiresAt: Date.now() + expiresIn * 1000 } : {}),
    ...(typeof data.scope === "string" ? { scope: data.scope } : {}),
  };
}

export async function finishOAuthLogin(input: {
  code: string;
  state: string;
}): Promise<OAuthTokens> {
  const current = await readStore();
  const pending = current.pending;
  if (!pending || !current.clientId) {
    throw new Error("No pending OAuth login. Run `linear-sdk-axi auth login` first.");
  }
  if (input.state !== pending.state) {
    throw new Error("OAuth state did not match the pending login; refusing to exchange the code.");
  }
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: current.clientId,
    code: input.code,
    redirect_uri: pending.redirectUri,
    code_verifier: pending.codeVerifier,
  });
  const tokens = await tokenRequest(params);
  await writeStore({ ...current, tokens, pending: undefined });
  return tokens;
}

export async function refreshOAuthTokensIfNeeded(): Promise<void> {
  const current = await readStore();
  const tokens = current.tokens;
  if (!tokens?.accessToken || !tokens.expiresAt || tokens.expiresAt > Date.now() + REFRESH_SKEW_MS) {
    return;
  }
  if (!tokens.refreshToken || !current.clientId) {
    throw new Error("Saved OAuth session cannot be refreshed. Run `linear-sdk-axi auth login` again.");
  }
  const refreshed = await tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: current.clientId,
      refresh_token: tokens.refreshToken,
    }),
  );
  await writeStore({
    ...current,
    tokens: {
      ...tokens,
      ...refreshed,
      refreshToken: refreshed.refreshToken ?? tokens.refreshToken,
    },
  });
}

export function storedOAuthAccessToken(): string | undefined {
  return readStoreSync().tokens?.accessToken;
}

export async function getOAuthStatus(): Promise<OAuthStatus> {
  const current = await readStore();
  const expiresAt = current.tokens?.expiresAt ?? null;
  return {
    configured: Boolean(current.tokens?.accessToken),
    clientIdConfigured: Boolean(current.clientId),
    expiresAt,
    expired: Boolean(expiresAt && expiresAt <= Date.now()),
  };
}

export async function logoutOAuth(): Promise<boolean> {
  try {
    await rm(oauthStorePath());
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function waitForOAuthCallback(state: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const callback = new URL(OAUTH_REDIRECT_URI);
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", OAUTH_REDIRECT_URI);
      if (url.pathname !== callback.pathname) {
        response.writeHead(404).end("Not found");
        return;
      }
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const oauthError = url.searchParams.get("error");
      if (oauthError) {
        response.writeHead(400, { "content-type": "text/plain" }).end("Linear authorization was not completed. You can return to the terminal.");
        finish(new Error(`Linear OAuth authorization failed: ${oauthError}`));
        return;
      }
      if (!code || returnedState !== state) {
        response.writeHead(400, { "content-type": "text/plain" }).end("Invalid OAuth callback. You can return to the terminal.");
        finish(new Error("OAuth callback did not include the expected code and state."));
        return;
      }
      response.writeHead(200, { "content-type": "text/plain" }).end("Linear authorization completed. You can return to the terminal.");
      finish(undefined, code);
    });
    const timeout = setTimeout(
      () => finish(new Error("Timed out waiting for the Linear OAuth callback. Retry or use `auth login --manual`.")),
      5 * 60 * 1000,
    );
    let settled = false;
    const settle = (error?: Error, code?: string) => {
      if (error) reject(error);
      else resolve(code as string);
    };
    const finish = (error?: Error, code?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (!server.listening) {
        settle(error, code);
        return;
      }
      server.close(() => settle(error, code));
    };
    server.once("error", (error) => finish(error));
    server.listen(Number(callback.port), callback.hostname);
  });
}
