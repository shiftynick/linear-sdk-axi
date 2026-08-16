import { assertNoUnknownFlags } from "../args.js";
import type { TeamContext } from "../client.js";
import { teamFlagSuffix } from "../client.js";
import { getTeamStates, resolveTeamFromContext } from "../linear.js";
import {
  field,
  renderHelp,
  renderList,
  renderOutput,
  type FieldDef,
} from "../toon.js";

export const STATUS_HELP = `usage: linear-axi status [--team <key>]
List workflow states for the default or specified team.

flags: --team <key>, --help
alias: linear-axi workflow
examples:
  linear-axi status
  linear-axi status --team ENG
`;

const stateSchema: FieldDef[] = [
  field("name"),
  field("type"),
  field("position"),
];

export async function statusCommand(
  args: string[],
  ctx?: TeamContext,
): Promise<string> {
  assertNoUnknownFlags(args, ["--team"], "status");
  const team = await resolveTeamFromContext(ctx);
  const states = await getTeamStates(team);
  const items = states
    .slice()
    .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
    .map((s) => ({
      name: s.name ?? null,
      type: s.type ?? null,
      position: s.position ?? null,
    }));
  const suffix = teamFlagSuffix(ctx);
  return renderOutput([
    `team: ${team.key ?? team.name ?? team.id}`,
    renderList("states", items, stateSchema, "0 workflow states"),
    renderHelp([
      `Run \`linear-axi issue list${suffix}\` to list issues`,
      `Run \`linear-axi issue create --title "..."${suffix}\` to create an issue`,
    ]),
  ]);
}
