import { assertNoUnknownFlags } from "../args.js";
import { AxiError } from "../errors.js";
import {
  field,
  renderHelp,
  renderList,
  renderOutput,
  type FieldDef,
} from "../toon.js";

export const USAGE_HELP = `usage: linear-sdk-axi usage [topic]
Show a compact two-tier map of invocable commands, without loading full help.

topics: issue, label, project, cycle, team, account, auth, setup
examples:
  linear-sdk-axi usage
  linear-sdk-axi usage issue
`;

type UsageEntry = {
  goal: string;
  command: string;
};

type UsageTopic = {
  summary: string;
  entries: UsageEntry[];
  next: string[];
};

const TOPIC_SCHEMA: FieldDef[] = [
  field("topic"),
  field("summary"),
  field("detail"),
];

const ENTRY_SCHEMA: FieldDef[] = [field("goal"), field("command")];

const TOPICS: Record<string, UsageTopic> = {
  issue: {
    summary: "Find, inspect, create, update, discuss, or complete issues",
    entries: [
      { goal: "my open work", command: "linear-sdk-axi issue list" },
      { goal: "my unblocked work", command: "linear-sdk-axi issue list --unblocked" },
      {
        goal: "full-text search",
        command: "linear-sdk-axi issue search \"...\" [--team <key>] [--comments]",
      },
      {
        goal: "team or state slice",
        command: "linear-sdk-axi issue list --team <key> --state <name|type>",
      },
      {
        goal: "inspect hierarchy",
        command: "linear-sdk-axi issue view <id> [--comments] [--sub-issues] [--full]",
      },
      {
        goal: "create safely",
        command: "linear-sdk-axi issue create --title \"...\" --team <key> [--parent <id>] --label <name|id> --dry-run",
      },
      {
        goal: "change fields",
        command: "linear-sdk-axi issue update <id> [--parent <id|none>] --add-label <name|id> [--remove-label <name|id>]",
      },
      {
        goal: "inspect relations",
        command: "linear-sdk-axi issue relation list <id>",
      },
      {
        goal: "add relation safely",
        command: "linear-sdk-axi issue relation add <id> --blocks <id> --dry-run",
      },
      {
        goal: "comment threads",
        command: "linear-sdk-axi issue comment list <id> [--full]",
      },
      {
        goal: "reply in thread",
        command: "linear-sdk-axi issue comment <id> --reply-to <comment-id> --body \"...\"",
      },
      { goal: "complete", command: "linear-sdk-axi issue close <id> [--dry-run]" },
    ],
    next: [
      "Use Linear identifiers or UUIDs for <id>",
      "Issue writes support --dry-run; update and close are idempotent",
    ],
  },
  label: {
    summary: "Discover workspace or team labels before assigning them to issues",
    entries: [
      { goal: "list labels", command: "linear-sdk-axi label list [--team <key>]" },
      {
        goal: "create with labels",
        command: "linear-sdk-axi issue create --title \"...\" --team <key> --label <name|id>",
      },
      {
        goal: "change labels",
        command: "linear-sdk-axi issue update <id> --add-label <name|id> [--remove-label <name|id>]",
      },
    ],
    next: ["Team results include workspace labels plus labels scoped to that team"],
  },
  project: {
    summary: "List, inspect, create, or safely update named outcomes",
    entries: [
      { goal: "list", command: "linear-sdk-axi project list [--team <key>]" },
      { goal: "inspect", command: "linear-sdk-axi project view <id|name> [--full]" },
      {
        goal: "create safely",
        command: "linear-sdk-axi project create --name \"...\" --team <key> [--target-date YYYY-MM-DD] --dry-run",
      },
      {
        goal: "change outcome details",
        command: "linear-sdk-axi project update <id|name> [--priority 0-4] [--target-date YYYY-MM-DD|none] --dry-run",
      },
    ],
    next: [
      "A project is a named outcome, not an issue bucket",
      "Project writes support --dry-run and idempotent no-ops",
    ],
  },
  cycle: {
    summary: "Read cycle progress, timing, and descriptions",
    entries: [
      { goal: "list", command: "linear-sdk-axi cycle list [--team <key>]" },
      { goal: "inspect", command: "linear-sdk-axi cycle view <id> [--full]" },
    ],
    next: ["Cycles are read-only; list output includes the id needed for view"],
  },
  team: {
    summary: "Discover teams and their workflow states",
    entries: [
      { goal: "list teams", command: "linear-sdk-axi team list" },
      { goal: "workflow states", command: "linear-sdk-axi status --team <key>" },
      { goal: "workflow alias", command: "linear-sdk-axi workflow --team <key>" },
    ],
    next: ["Carry the team key into issue and project commands"],
  },
  account: {
    summary: "Inspect the current user or verify the Linear connection",
    entries: [
      { goal: "current user", command: "linear-sdk-axi me" },
      { goal: "connection doctor", command: "linear-sdk-axi doctor" },
      { goal: "dashboard", command: "linear-sdk-axi" },
    ],
    next: ["Doctor is read-only and reports workspace and accessible teams"],
  },
  auth: {
    summary: "Inspect credentials or sign in with a personal API key or OAuth",
    entries: [
      { goal: "inspect configured mode", command: "linear-sdk-axi auth status" },
      {
        goal: "interactive OAuth sign-in",
        command: "linear-sdk-axi auth login --client-id <client-id>",
      },
      {
        goal: "headless OAuth sign-in",
        command: "linear-sdk-axi auth login --client-id <client-id> --manual",
      },
      { goal: "forget OAuth session", command: "linear-sdk-axi auth logout" },
    ],
    next: ["LINEAR_API_KEY takes precedence for noninteractive automation"],
  },
  setup: {
    summary: "Install optional ambient Linear context for agent sessions",
    entries: [
      { goal: "install hooks", command: "linear-sdk-axi setup hooks" },
      { goal: "show this map", command: "linear-sdk-axi usage [topic]" },
    ],
    next: ["Session hooks are optional; the installable skill is the on-demand path"],
  },
};

export async function usageCommand(args: string[]): Promise<string> {
  assertNoUnknownFlags(args, [], "usage");
  const positional = args.filter((arg) => !arg.startsWith("-"));
  if (positional.length > 1) {
    throw new AxiError(
      "usage accepts at most one topic",
      "VALIDATION_ERROR",
      ["Run `linear-sdk-axi usage` to list topics"],
    );
  }

  const requested = positional[0]?.toLowerCase();
  if (!requested) {
    return renderOutput([
      "tier: overview",
      renderList(
        "topics",
        Object.entries(TOPICS).map(([topic, value]) => ({
          topic,
          summary: value.summary,
          detail: `linear-sdk-axi usage ${topic}`,
        })),
        TOPIC_SCHEMA,
      ),
      renderHelp([
        "Run `linear-sdk-axi usage <topic>` for exact command forms",
        "Use `--help` only when you need the exhaustive flag reference",
      ]),
    ]);
  }

  const topic = TOPICS[requested];
  if (!topic) {
    throw new AxiError(
      `Unknown usage topic: ${requested}`,
      "VALIDATION_ERROR",
      ["Run `linear-sdk-axi usage` to list topics"],
    );
  }

  return renderOutput([
    `tier: ${requested}`,
    renderList("commands", topic.entries, ENTRY_SCHEMA),
    renderHelp(topic.next),
  ]);
}
