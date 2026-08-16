import { LinearClient } from "@linear/sdk";
import {
  refreshOAuthTokensIfNeeded,
  storedOAuthAccessToken,
} from "./auth.js";
import { AxiError, authRequiredError } from "./errors.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK models are lazy and polymorphic
export type LinearLike = {
  viewer: Promise<any>;
  issues: (opts?: any) => Promise<any>;
  searchIssues: (term: string, opts?: any) => Promise<any>;
  issue: (id: string) => Promise<any>;
  issueLabels: (opts?: any) => Promise<any>;
  teams: (opts?: any) => Promise<any>;
  team: (id: string) => Promise<any>;
  cycles: (opts?: any) => Promise<any>;
  cycle: (id: string) => Promise<any>;
  projects: (opts?: any) => Promise<any>;
  project: (id: string) => Promise<any>;
  createIssue: (input: any) => Promise<any>;
  updateIssue: (id: string, input: any) => Promise<any>;
  createIssueRelation: (input: any) => Promise<any>;
  createComment: (input: any) => Promise<any>;
  users?: (opts?: any) => Promise<any>;
  user?: (id: string) => Promise<any>;
};

let override: LinearLike | undefined;

export function setLinearClientForTests(c: LinearLike | undefined): void {
  override = c;
}

/** Refresh a saved OAuth token before commands construct the SDK client. */
export async function prepareLinearAuth(): Promise<void> {
  if (override || process.env.LINEAR_API_KEY) return;
  try {
    await refreshOAuthTokensIfNeeded();
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Saved OAuth session could not be refreshed";
    throw new AxiError(detail, "AUTH_REQUIRED", [
      "Run `linear-sdk-axi auth login --client-id <client-id>` to sign in again",
      "Or set LINEAR_API_KEY for noninteractive authentication",
    ]);
  }
}

export function getLinearClient(): LinearLike {
  if (override) return override;
  const apiKey = process.env.LINEAR_API_KEY;
  if (apiKey) return new LinearClient({ apiKey }) as unknown as LinearLike;
  const accessToken = storedOAuthAccessToken();
  if (accessToken) return new LinearClient({ accessToken }) as unknown as LinearLike;
  throw authRequiredError();
}

export type TeamContext = {
  teamKey?: string;
};

export function teamFlagSuffix(ctx?: TeamContext): string {
  return ctx?.teamKey ? ` --team ${ctx.teamKey}` : "";
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function parseTeamArgs(args: string[]): {
  teamKey: string | undefined;
  strippedArgs: string[];
} {
  const stripped: string[] = [];
  let teamKey: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--team") {
      const value = args[index + 1];
      if (value === undefined || value.trim() === "" || value.startsWith("-")) {
        throw new AxiError("--team requires a value", "VALIDATION_ERROR");
      }
      teamKey = value;
      index++;
      continue;
    }
    if (arg.startsWith("--team=")) {
      const value = arg.slice("--team=".length);
      if (value.trim() === "") {
        throw new AxiError("--team requires a value", "VALIDATION_ERROR");
      }
      teamKey = value;
      continue;
    }
    stripped.push(arg);
  }

  return { teamKey, strippedArgs: stripped };
}
