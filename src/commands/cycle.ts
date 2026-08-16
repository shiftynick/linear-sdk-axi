import { assertNoUnknownFlags, getFlag, hasFlag, parseLimit, requirePositional } from "../args.js";
import { truncateBody, wasTruncated } from "../body.js";
import type { TeamContext } from "../client.js";
import { teamFlagSuffix } from "../client.js";
import { AxiError } from "../errors.js";
import { formatCountLine } from "../format.js";
import {
  getCycle,
  hydrateCycle,
  listCycles,
  resolveTeamFromContext,
} from "../linear.js";
import {
  field,
  renderDetail,
  renderHelp,
  renderList,
  renderOutput,
  type FieldDef,
} from "../toon.js";

export const CYCLE_HELP = `usage: linear-sdk-axi cycle <list|view> [id]
Read-only Linear cycles.

subcommands: list, view <id>
flags{list}: --team <key>, --limit (default 20), --help
flags{view}: --team <key>, --full, --help
examples:
  linear-sdk-axi cycle list
  linear-sdk-axi cycle list --team ENG
  linear-sdk-axi cycle view <id>
  linear-sdk-axi cycle view <id> --full
`;

const listSchema: FieldDef[] = [
  field("id"),
  field("name"),
  field("state"),
  field("progress"),
];

function formatProgress(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "unknown";
  return `${Math.round((value <= 1 ? value * 100 : value))}%`;
}

function formatDate(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

function formatName(cycle: Awaited<ReturnType<typeof hydrateCycle>>): string {
  const prefix = cycle.teamKey && cycle.number !== null
    ? `${cycle.teamKey}-${cycle.number}`
    : cycle.number !== null
      ? `#${cycle.number}`
      : cycle.teamKey ?? "Cycle";
  return cycle.name ? `${prefix} ${cycle.name}` : prefix;
}

export async function cycleCommand(
  args: string[],
  ctx?: TeamContext,
): Promise<string> {
  const sub = args[0];
  if (!sub || sub === "list") return listCyclesCommand(args, ctx);
  if (sub === "view") return viewCycleCommand(args, ctx);
  throw new AxiError(`Unknown cycle subcommand: ${sub}`, "VALIDATION_ERROR", [
    "Run `linear-sdk-axi cycle --help`",
  ]);
}

async function listCyclesCommand(
  args: string[],
  ctx?: TeamContext,
): Promise<string> {
  assertNoUnknownFlags(args, ["--team", "--limit"], "cycle list");
  const limit = parseLimit(getFlag(args, "--limit"), 20);
  const team = ctx?.teamKey ? await resolveTeamFromContext(ctx) : undefined;
  const result = await listCycles({ first: limit, team });
  const cycles = await Promise.all(result.nodes.map(hydrateCycle));
  const items = cycles.map((cycle) => ({
    id: cycle.id || null,
    name: formatName(cycle),
    state: cycle.state,
    progress: formatProgress(cycle.progress),
  }));
  const suffix = teamFlagSuffix(ctx);
  const help = [
    `Run \`linear-sdk-axi cycle view <id>${suffix}\` for dates and description`,
  ];
  if (result.hasNextPage || result.totalCount > limit) {
    help.unshift(
      `Run \`linear-sdk-axi cycle list --limit ${Math.max(limit * 2, 50)}${suffix}\` to see more`,
    );
  }
  return renderOutput([
    formatCountLine({ count: items.length, limit, totalCount: result.totalCount }),
    renderList("cycles", items, listSchema, "0 cycles"),
    renderHelp(help),
  ]);
}

async function viewCycleCommand(
  args: string[],
  ctx?: TeamContext,
): Promise<string> {
  assertNoUnknownFlags(args, ["--team", "--full"], "cycle view");
  const id = requirePositional(args, 1, "cycle id");
  const full = hasFlag(args, "--full");
  const cycle = await hydrateCycle(await getCycle(id));
  const truncated = !full && wasTruncated(cycle.description, 500);
  const suffix = teamFlagSuffix(ctx);
  const item = {
    id: cycle.id || null,
    name: formatName(cycle),
    state: cycle.state,
    team: cycle.team,
    progress: formatProgress(cycle.progress),
    startsAt: formatDate(cycle.startsAt),
    endsAt: formatDate(cycle.endsAt),
    description: full ? cycle.description : truncateBody(cycle.description, 500),
  };
  const help = [
    `Run \`linear-sdk-axi issue list${suffix}\` to list issues`,
  ];
  if (truncated) {
    help.unshift(
      `Run \`linear-sdk-axi cycle view ${cycle.id} --full${suffix}\` to see complete description`,
    );
  }
  return renderOutput([
    renderDetail("cycle", item, [
      field("id"),
      field("name"),
      field("state"),
      field("team"),
      field("progress"),
      field("startsAt"),
      field("endsAt"),
      field("description"),
    ]),
    renderHelp(help),
  ]);
}
