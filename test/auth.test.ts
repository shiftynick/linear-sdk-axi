import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginOAuthLogin,
  configuredOAuthClientId,
  finishOAuthLogin,
  getOAuthStatus,
  logoutOAuth,
  OAUTH_REDIRECT_URI,
} from "../src/auth.js";
import { authCommand } from "../src/commands/auth.js";

let configDirectory: string;
let savedAuthFile: string | undefined;
let savedClientId: string | undefined;

beforeEach(async () => {
  configDirectory = await mkdtemp(join(tmpdir(), "linear-sdk-axi-oauth-test-"));
  savedAuthFile = process.env.LINEAR_SDK_AXI_AUTH_FILE;
  savedClientId = process.env.LINEAR_SDK_AXI_OAUTH_CLIENT_ID;
  process.env.LINEAR_SDK_AXI_AUTH_FILE = join(configDirectory, "oauth.json");
  delete process.env.LINEAR_SDK_AXI_OAUTH_CLIENT_ID;
});

afterEach(async () => {
  if (savedAuthFile === undefined) delete process.env.LINEAR_SDK_AXI_AUTH_FILE;
  else process.env.LINEAR_SDK_AXI_AUTH_FILE = savedAuthFile;
  if (savedClientId === undefined) delete process.env.LINEAR_SDK_AXI_OAUTH_CLIENT_ID;
  else process.env.LINEAR_SDK_AXI_OAUTH_CLIENT_ID = savedClientId;
  vi.unstubAllGlobals();
  await rm(configDirectory, { recursive: true, force: true });
});

describe("OAuth PKCE session", () => {
  it("persists a pending PKCE login without an access token", async () => {
    const started = await beginOAuthLogin("test-client-id");
    const authorizationUrl = new URL(started.authorizationUrl);
    const saved = await readFile(process.env.LINEAR_SDK_AXI_AUTH_FILE!, "utf8");

    expect(authorizationUrl.origin).toBe("https://linear.app");
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("test-client-id");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(OAUTH_REDIRECT_URI);
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl.searchParams.get("state")).toBe(started.state);
    expect(saved).toContain("codeVerifier");
    expect(configuredOAuthClientId()).toBe("test-client-id");

    const status = await getOAuthStatus();
    expect(status).toMatchObject({ configured: false, clientIdConfigured: true });
  });

  it("refuses a mismatched OAuth state before sending a token request", async () => {
    await beginOAuthLogin("test-client-id");
    await expect(
      finishOAuthLogin({ code: "authorization-code", state: "wrong-state" }),
    ).rejects.toThrow(/state did not match/i);
  });

  it("exchanges an authorization code with PKCE and stores the refreshable session", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toContain("https://api.linear.app/oauth/token");
      expect(init?.method).toBe("POST");
      const form = new URLSearchParams(String(init?.body));
      expect(form.get("grant_type")).toBe("authorization_code");
      expect(form.get("client_id")).toBe("test-client-id");
      expect(form.get("code")).toBe("authorization-code");
      expect(form.get("redirect_uri")).toBe(OAUTH_REDIRECT_URI);
      expect(form.get("code_verifier")).toBeTruthy();
      return new Response(
        JSON.stringify({
          access_token: "test-access-token",
          refresh_token: "test-refresh-token",
          expires_in: 3600,
          scope: "read,write",
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const started = await beginOAuthLogin("test-client-id");

    const tokens = await finishOAuthLogin({
      code: "authorization-code",
      state: started.state,
    });

    expect(tokens).toMatchObject({
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
      scope: "read,write",
    });
    expect(await getOAuthStatus()).toMatchObject({ configured: true, expired: false });
  });

  it("renders a manual OAuth URL without calling Linear", async () => {
    const out = await authCommand([
      "login",
      "--client-id",
      "test-client-id",
      "--manual",
    ]);
    expect(out).toContain("authorizationUrl");
    expect(out).toContain("auth finish --code <code> --state <state>");
  });

  it("removes only the saved OAuth session", async () => {
    await beginOAuthLogin("test-client-id");
    expect(await logoutOAuth()).toBe(true);
    expect(await logoutOAuth()).toBe(false);
    expect(await getOAuthStatus()).toMatchObject({ configured: false, clientIdConfigured: false });
  });
});
