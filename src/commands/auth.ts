import {
  beginOAuthLogin,
  configuredOAuthClientId,
  finishOAuthLogin,
  getOAuthStatus,
  logoutOAuth,
  waitForOAuthCallback,
} from "../auth.js";
import {
  assertNoUnknownFlags,
  hasFlag,
  optionalFlagArg,
  requireFlagArg,
} from "../args.js";
import { AxiError } from "../errors.js";
import { field, renderDetail, renderHelp, renderOutput } from "../toon.js";

export const AUTH_HELP = `usage: linear-sdk-axi auth <status|login|finish|logout> [flags]
Manage either API-key or OAuth authentication without putting credentials in command arguments.

commands:
  status                                    show configured auth mode (never secrets)
  login --client-id <id> [--manual]         start OAuth Authorization Code + PKCE login
  finish --code <code> --state <state>      finish a headless/manual OAuth login
  logout                                    remove saved OAuth credentials

OAuth redirect URI: http://127.0.0.1:14566/oauth/callback
flags:
  login: --client-id <id>, --manual
  finish: --code <code>, --state <state>
examples:
  linear-sdk-axi auth status
  linear-sdk-axi auth login --client-id <client-id>
  linear-sdk-axi auth login --client-id <client-id> --manual
`;

function authResult(method: string, status: string): string {
  return renderOutput([
    renderDetail("auth", { method, status }, [field("method"), field("status")]),
    renderHelp([
      "Run `linear-sdk-axi doctor` to verify read-only workspace access",
    ]),
  ]);
}

function oauthError(error: unknown): AxiError {
  if (error instanceof AxiError) return error;
  const message = error instanceof Error ? error.message : "OAuth sign-in failed";
  return new AxiError(message, "AUTH_REQUIRED", [
    "Retry `linear-sdk-axi auth login --client-id <client-id>`",
    "Use `--manual` if the local callback cannot be reached",
  ]);
}

async function status(): Promise<string> {
  const oauth = await getOAuthStatus();
  const apiKeyConfigured = Boolean(process.env.LINEAR_API_KEY);
  const method = apiKeyConfigured ? "api-key" : oauth.configured ? "oauth" : "none";
  return renderOutput([
    renderDetail(
      "auth",
      {
        method,
        apiKeyConfigured: apiKeyConfigured ? "yes" : "no",
        oauthConfigured: oauth.configured ? "yes" : "no",
        oauthClientConfigured: oauth.clientIdConfigured ? "yes" : "no",
        oauthSession: oauth.configured
          ? oauth.expired
            ? "expired"
            : "active"
          : "none",
        expiresAt: oauth.expiresAt ? new Date(oauth.expiresAt).toISOString() : null,
      },
      [
        field("method"),
        field("apiKeyConfigured"),
        field("oauthConfigured"),
        field("oauthClientConfigured"),
        field("oauthSession"),
        field("expiresAt"),
      ],
    ),
    renderHelp(
      method === "none"
        ? [
            "Set LINEAR_API_KEY for automation",
            "Or run `linear-sdk-axi auth login --client-id <client-id>`",
          ]
        : ["Run `linear-sdk-axi doctor` to verify read-only workspace access"],
    ),
  ]);
}

async function login(args: string[]): Promise<string> {
  assertNoUnknownFlags(args, ["--client-id", "--manual"], "auth login");
  if (args.some((arg) => arg.startsWith("--manual="))) {
    throw new AxiError("--manual does not take a value", "VALIDATION_ERROR");
  }
  const clientId = configuredOAuthClientId(optionalFlagArg(args, "--client-id"));
  if (!clientId) {
    throw new AxiError("OAuth client id is required", "VALIDATION_ERROR", [
      "Register an OAuth app with redirect URI http://127.0.0.1:14566/oauth/callback",
      "Pass --client-id <client-id> or set LINEAR_SDK_AXI_OAUTH_CLIENT_ID",
    ]);
  }

  const started = await beginOAuthLogin(clientId);
  if (hasFlag(args, "--manual")) {
    return renderOutput([
      renderDetail(
        "oauth",
        {
          authorizationUrl: started.authorizationUrl,
          state: started.state,
          redirectUri: started.redirectUri,
        },
        [field("authorizationUrl"), field("state"), field("redirectUri")],
      ),
      renderHelp([
        "Open authorizationUrl, then copy code and state from the redirect URL",
        "Run `linear-sdk-axi auth finish --code <code> --state <state>`",
      ]),
    ]);
  }

  process.stderr.write(
    `Open this URL to authorize Linear:\n${started.authorizationUrl}\nWaiting for ${started.redirectUri} ...\n`,
  );
  try {
    const code = await waitForOAuthCallback(started.state);
    await finishOAuthLogin({ code, state: started.state });
    return authResult("oauth", "connected");
  } catch (error) {
    throw oauthError(error);
  }
}

async function finish(args: string[]): Promise<string> {
  assertNoUnknownFlags(args, ["--code", "--state"], "auth finish");
  try {
    await finishOAuthLogin({
      code: requireFlagArg(args, "--code"),
      state: requireFlagArg(args, "--state"),
    });
    return authResult("oauth", "connected");
  } catch (error) {
    throw oauthError(error);
  }
}

async function logout(args: string[]): Promise<string> {
  assertNoUnknownFlags(args, [], "auth logout");
  const removed = await logoutOAuth();
  return renderOutput([
    renderDetail(
      "auth",
      { method: "oauth", status: removed ? "logged-out" : "not-configured" },
      [field("method"), field("status")],
    ),
    renderHelp([
      "LINEAR_API_KEY, if set, remains available for noninteractive authentication",
    ]),
  ]);
}

export async function authCommand(args: string[]): Promise<string> {
  const [action, ...rest] = args;
  switch (action) {
    case "status":
      assertNoUnknownFlags(rest, [], "auth status");
      return status();
    case "login":
      return login(rest);
    case "finish":
      return finish(rest);
    case "logout":
      return logout(rest);
    default:
      throw new AxiError("Unknown auth action", "VALIDATION_ERROR", [
        "Run `linear-sdk-axi auth --help`",
      ]);
  }
}
