import { assertNoUnknownFlags } from "../args.js";
import { AxiError } from "../errors.js";
import {
  field,
  renderHelp,
  renderList,
  renderOutput,
  type FieldDef,
} from "../toon.js";

export const USAGE_HELP = `usage: linear-axi usage [topic]
Show a compact two-tier map of invocable commands, without loading full help.

topics: issue, project, cycle, team, account, setup
examples:
  linear-axi usage
  linear-axi usage issue
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
      { goal: "my open work", command: "linear-axi issue list" },
      {
        goal: "full-text search",
        command: "linear-axi issue search \"...\" [--team <key>] [--comments]",
      },
      {
        goal: "team or state slice",
        command: "linear-axi issue list --team <key> --state <name|type>",
      },
      { goal: "inspect", command: "linear-axi issue view <id> [--comments] [--full]" },
      {
        goal: "create safely",
        command: "linear-axi issue create --title \"...\" --team <key> --label <name|id> --dry-run",
      },
      {
        goal: "change fields",
        command: "linear-axi issue update <id> --add-label <name|id> [--remove-label <name|id>]",
      },
      {
        goal: "comment threads",
        command: "linear-axi issue comment list <id> [--full]",
      },
      {
        goal: "reply in thread",
        command: "linear-axi issue comment <id> --reply-to <comment-id> --body \"...\"",
      },
      { goal: "complete", command: "linear-axi issue close <id> [--dry-run]" },
    ],
    next: [
      "Use Linear identifiers or UUIDs for <id>",
      "Issue writes support --dry-run; update and close are idempotent",
    ],
  },
  project: {
    summary: "List project progress or inspect one project",
    entries: [
      { goal: "list", command: "linear-axi project list [--team <key>]" },
      { goal: "inspect", command: "linear-axi project view <id|name> [--full]" },
    ],
    next: ["Project details include issue counts by workflow state"],
  },
  cycle: {
    summary: "Read cycle progress, timing, and descriptions",
    entries: [
      { goal: "list", command: "linear-axi cycle list [--team <key>]" },
      { goal: "inspect", command: "linear-axi cycle view <id> [--full]" },
    ],
    next: ["Cycles are read-only; list output includes the id needed for view"],
  },
  team: {
    summary: "Discover teams and their workflow states",
    entries: [
      { goal: "list teams", command: "linear-axi team list" },
      { goal: "workflow states", command: "linear-axi status --team <key>" },
      { goal: "workflow alias", command: "linear-axi workflow --team <key>" },
    ],
    next: ["Carry the team key into issue and project commands"],
  },
  account: {
    summary: "Inspect the current user or verify the Linear connection",
    entries: [
      { goal: "current user", command: "linear-axi me" },
      { goal: "connection doctor", command: "linear-axi doctor" },
      { goal: "dashboard", command: "linear-axi" },
    ],
    next: ["Doctor is read-only and reports workspace and accessible teams"],
  },
  setup: {
    summary: "Install optional ambient Linear context for agent sessions",
    entries: [
      { goal: "install hooks", command: "linear-axi setup hooks" },
      { goal: "show this map", command: "linear-axi usage [topic]" },
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
      ["Run `linear-axi usage` to list topics"],
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
          detail: `linear-axi usage ${topic}`,
        })),
        TOPIC_SCHEMA,
      ),
      renderHelp([
        "Run `linear-axi usage <topic>` for exact command forms",
        "Use `--help` only when you need the exhaustive flag reference",
      ]),
    ]);
  }

  const topic = TOPICS[requested];
  if (!topic) {
    throw new AxiError(
      `Unknown usage topic: ${requested}`,
      "VALIDATION_ERROR",
      ["Run `linear-axi usage` to list topics"],
    );
  }

  return renderOutput([
    `tier: ${requested}`,
    renderList("commands", topic.entries, ENTRY_SCHEMA),
    renderHelp(topic.next),
  ]);
}
