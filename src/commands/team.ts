import { AxiError } from "../errors.js";
import { assertNoUnknownFlags, getFlag, parseLimit } from "../args.js";
import { formatCountLine } from "../format.js";
import { listTeams } from "../linear.js";
import {
  field,
  renderHelp,
  renderList,
  renderOutput,
  type FieldDef,
} from "../toon.js";

export const TEAM_HELP = `usage: linear-axi team list [--limit]
List Linear teams (key, name, issue count when cheap).

subcommands: list
flags{list}: --limit (default 50), --help
examples:
  linear-axi team list
`;

const teamSchema: FieldDef[] = [
  field("key"),
  field("name"),
  field("issueCount"),
];

export async function teamCommand(args: string[]): Promise<string> {
  const sub = args[0];
  if (!sub) {
    return listTeamsCommand(args);
  }
  switch (sub) {
    case "list":
      return listTeamsCommand(args);
    default:
      throw new AxiError(`Unknown team subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Run `linear-axi team --help`",
      ]);
  }
}

async function listTeamsCommand(args: string[]): Promise<string> {
  assertNoUnknownFlags(args, ["--limit"], "team list");
  const limit = parseLimit(getFlag(args, "--limit"), 50);
  const teams = await listTeams(limit);
  const items = teams.map((t) => ({
    key: t.key ?? null,
    name: t.name ?? null,
    issueCount:
      typeof t.issueCount === "number"
        ? t.issueCount
        : t.issueCount ?? null,
  }));
  return renderOutput([
    formatCountLine({ count: items.length, limit }),
    renderList("teams", items, teamSchema, "0 teams"),
    renderHelp([
      "Run `linear-axi issue list --team <key>` to list a team's issues",
      "Run `linear-axi status --team <key>` for workflow states",
    ]),
  ]);
}
