import { AxiError } from "../errors.js";
import {
  assertNoUnknownFlags,
  getFlag,
  getPositional,
  hasFlag,
  parseLimit,
  requirePositional,
} from "../args.js";
import { truncateBody, wasTruncated } from "../body.js";
import type { TeamContext } from "../client.js";
import { teamFlagSuffix } from "../client.js";
import { formatCountLine } from "../format.js";
import {
  getProject,
  listProjects,
  projectIssueCounts,
  resolveTeamFromContext,
} from "../linear.js";
import {
  custom,
  field,
  renderDetail,
  renderHelp,
  renderList,
  renderOutput,
  type FieldDef,
} from "../toon.js";

export const PROJECT_HELP = `usage: linear-sdk-axi project <list|view> [id]
List or view Linear projects.

subcommands: list, view <id|name>
flags{list}: --team <key>, --limit (default 30), --help
flags{view}: --full, --help
examples:
  linear-sdk-axi project list
  linear-sdk-axi project list --team ENG
  linear-sdk-axi project view "Launch"
  linear-sdk-axi project view <id> --full
`;

const listSchema: FieldDef[] = [
  field("name"),
  field("state"),
  field("progress"),
];

function formatProgress(value: unknown): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "unknown";
  const pct = value <= 1 ? Math.round(value * 100) : Math.round(value);
  return `${pct}%`;
}

export async function projectCommand(
  args: string[],
  ctx?: TeamContext,
): Promise<string> {
  const sub = args[0];
  if (!sub || sub === "list") {
    return listProjectsCommand(args, ctx);
  }
  switch (sub) {
    case "view":
      return viewProjectCommand(args, ctx);
    default:
      throw new AxiError(
        `Unknown project subcommand: ${sub}`,
        "VALIDATION_ERROR",
        ["Run `linear-sdk-axi project --help`"],
      );
  }
}

async function listProjectsCommand(
  args: string[],
  ctx?: TeamContext,
): Promise<string> {
  assertNoUnknownFlags(args, ["--limit", "--team"], "project list");
  const limit = parseLimit(getFlag(args, "--limit"), 30);
  let teamId: string | undefined;
  if (ctx?.teamKey) {
    const team = await resolveTeamFromContext(ctx);
    teamId = team.id ? String(team.id) : undefined;
  }
  const projects = await listProjects({ first: limit, teamId });
  const items = projects.map((p) => ({
    id: p.id ?? null,
    name: p.name ?? null,
    state: p.state ?? p.status ?? null,
    progress: formatProgress(p.progress),
    issueCount: typeof p.issueCount === "number" ? p.issueCount : null,
  }));
  const suffix = teamFlagSuffix(ctx);
  return renderOutput([
    formatCountLine({ count: items.length, limit }),
    renderList("projects", items, listSchema, "0 projects"),
    renderHelp([
      `Run \`linear-sdk-axi project view <id>${suffix}\` for details`,
      `Run \`linear-sdk-axi issue list${suffix}\` to list issues`,
    ]),
  ]);
}

async function viewProjectCommand(
  args: string[],
  ctx?: TeamContext,
): Promise<string> {
  assertNoUnknownFlags(args, ["--full", "--team"], "project view");
  const id = requirePositional(args, 1, "project id or name");
  const full = hasFlag(args, "--full");
  const project = await getProject(id);
  const description =
    typeof project.description === "string" ? project.description : "";
  const truncated = !full && wasTruncated(description, 500);
  const counts = await projectIssueCounts(project);
  const item = {
    id: project.id ?? null,
    name: project.name ?? null,
    state: project.state ?? project.status ?? null,
    progress: formatProgress(project.progress),
    url: project.url ?? null,
    description: full ? description : truncateBody(description, 500),
    issueCounts: counts,
  };
  const schema: FieldDef[] = [
    field("id"),
    field("name"),
    field("state"),
    field("progress"),
    field("url"),
    field("description"),
    custom("issueCounts", (it) => it.issueCounts),
  ];
  const suffix = teamFlagSuffix(ctx);
  const help: string[] = [];
  if (truncated) {
    const ident = getPositional(args, 1) ?? "<id>";
    help.push(
      `Run \`linear-sdk-axi project view ${ident} --full${suffix}\` to see complete description`,
    );
  }
  help.push(`Run \`linear-sdk-axi issue list${suffix}\` to list issues`);
  return renderOutput([
    renderDetail("project", item, schema),
    renderHelp(help),
  ]);
}
