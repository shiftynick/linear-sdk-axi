import { assertNoUnknownFlags, getFlag, parseLimit } from "../args.js";
import type { TeamContext } from "../client.js";
import { teamFlagSuffix } from "../client.js";
import { formatCountLine } from "../format.js";
import { AxiError } from "../errors.js";
import { listIssueLabels, resolveTeamFromContext } from "../linear.js";
import {
  field,
  renderHelp,
  renderList,
  renderOutput,
  type FieldDef,
} from "../toon.js";

export const LABEL_HELP = `usage: linear-sdk-axi label list [--team <key>] [--limit <n>]
List workspace labels, optionally including only labels usable by one team.

flags:
  --team <key>, --limit (default 50)
examples:
  linear-sdk-axi label list
  linear-sdk-axi label list --team ENG
`;

const labelSchema: FieldDef[] = [
  field("id"),
  field("name"),
  field("scope"),
];

export async function labelCommand(
  args: string[],
  ctx?: TeamContext,
): Promise<string> {
  const [action, ...rest] = args;
  if (!action || action === "--help") return LABEL_HELP.trimEnd();
  if (action !== "list") {
    throw new AxiError(`Unknown label subcommand: ${action}`, "VALIDATION_ERROR", [
      "Run `linear-sdk-axi label --help`",
    ]);
  }
  assertNoUnknownFlags(rest, ["--team", "--limit"], "label list");
  const limit = parseLimit(getFlag(rest, "--limit"), 50);
  const team = ctx?.teamKey ? await resolveTeamFromContext(ctx) : undefined;
  const labels = await listIssueLabels();
  const usable = team?.id
    ? labels.filter((label) => !label.teamId || String(label.teamId) === String(team.id))
    : labels;
  const items = usable.slice(0, limit).map((label) => ({
    id: label.id ? String(label.id) : null,
    name: label.name ? String(label.name) : null,
    scope: label.teamId ? team?.key ?? "team" : "workspace",
  }));
  const suffix = teamFlagSuffix(ctx);
  return renderOutput([
    formatCountLine({ count: items.length, limit, totalCount: usable.length }),
    renderList("labels", items, labelSchema, "0 labels"),
    renderHelp([
      `Use \`--label <name|id>\` with \`linear-sdk-axi issue create${suffix}\``,
      `Use \`--add-label <name|id>\` with \`linear-sdk-axi issue update <id>${suffix}\``,
    ]),
  ]);
}
