import { encode } from "@toon-format/toon";
import { AxiError } from "../errors.js";
import {
  assertNoUnknownFlags,
  getFlag,
  getPositional,
  hasFlag,
  optionalFlagArg,
  parseLimit,
  requirePositional,
  takeBoolFlag,
} from "../args.js";
import { takeBody, truncateBody, wasTruncated } from "../body.js";
import type { TeamContext } from "../client.js";
import { teamFlagSuffix } from "../client.js";
import { formatCountLine } from "../format.js";
import { PAGINATION_FLAGS, parsePagination } from "../pagination.js";
import {
  createProject,
  getProject,
  getProjectStatus,
  hydrateIssue,
  listIssues,
  listProjectStatuses,
  listProjects,
  projectIssueCounts,
  resolveTeam,
  resolveTeamFromContext,
  resolveProjectStatusId,
  updateProject,
} from "../linear.js";
import {
  custom,
  field,
  renderDetail,
  renderHelp,
  renderList,
  renderOutput,
  renderPagination,
  type FieldDef,
} from "../toon.js";
import { assertMaxLength, LINEAR_LIMITS } from "../validation.js";

export const PROJECT_HELP = `usage: linear-sdk-axi project <list|view|status|create|update> [id]
List, view, create, or update Linear projects.

subcommands: list, view <id|name>, status list, create, update <id|name>
flags{list}: --team <key>, --limit (page size, default 30), --after <cursor>, --all --max-items <n>, --help
flags{view}: --full, --issues, --team <key>, --limit (issue page size, default 20), --after <cursor>, --all --max-items <n>, --help
flags{status list}: --limit (default 50)
flags{create}: --name (required), --team (required unless only one team), --description/--body, --status <id|name|type>, --priority <0-4>, --start-date <YYYY-MM-DD>, --target-date <YYYY-MM-DD>, --dry-run
flags{update}: --name, --description/--body, --status <id|name|type>, --priority <0-4>, --start-date <YYYY-MM-DD|none>, --target-date <YYYY-MM-DD|none>, --dry-run
examples:
  linear-sdk-axi project list
  linear-sdk-axi project list --team ENG
  linear-sdk-axi project view "Launch"
  linear-sdk-axi project view <id> --full
  linear-sdk-axi project status list
  linear-sdk-axi project create --name "Launch" --team ENG --dry-run
  linear-sdk-axi project update "Launch" --target-date 2026-10-01 --dry-run
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
    case "status":
      return listProjectStatusesCommand(args, ctx);
    case "create":
      return createProjectCommand(args, ctx);
    case "update":
    case "edit":
      return updateProjectCommand(args, ctx);
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
  assertNoUnknownFlags(args, ["--team", ...PAGINATION_FLAGS], "project list");
  const pagination = parsePagination(args, 30);
  let teamId: string | undefined;
  if (ctx?.teamKey) {
    const team = await resolveTeamFromContext(ctx);
    teamId = team.id ? String(team.id) : undefined;
  }
  const projects = await listProjects({ pagination, teamId });
  const items = await Promise.all(projects.nodes.map(async (p) => {
    const status = await getProjectStatus(p);
    return {
      id: p.id ?? null,
      name: p.name ?? null,
      state: status?.name ?? p.state ?? null,
      progress: formatProgress(p.progress),
      issueCount: typeof p.issueCount === "number" ? p.issueCount : null,
    };
  }));
  const suffix = teamFlagSuffix(ctx);
  return renderOutput([
    formatCountLine({
      count: items.length,
      limit: projects.pagination.hasNextPage ? pagination.maxItems : undefined,
      totalCount: projects.totalCount,
    }),
    renderList("projects", items, listSchema, "0 projects"),
    renderPagination(projects.pagination),
    renderHelp([
      `Run \`linear-sdk-axi project view <id>${suffix}\` for details`,
      `Run \`linear-sdk-axi issue list${suffix}\` to list issues`,
    ]),
  ]);
}

async function listProjectStatusesCommand(
  args: string[],
  _ctx?: TeamContext,
): Promise<string> {
  const sub = args[1];
  if (sub !== "list") {
    throw new AxiError("Unknown project status action", "VALIDATION_ERROR", [
      "Run `linear-sdk-axi project status list`",
    ]);
  }
  assertNoUnknownFlags(args, ["--limit", "--team"], "project status list");
  const limit = parseLimit(getFlag(args, "--limit"), 50);
  const statuses = await listProjectStatuses(limit);
  const items = statuses.map((status) => ({
    id: status.id ?? null,
    name: status.name ?? null,
    type: status.type ?? null,
  }));
  return renderOutput([
    formatCountLine({ count: items.length, limit }),
    renderList(
      "projectStatuses",
      items,
      [field("id"), field("name"), field("type")],
      "0 project statuses",
    ),
    renderHelp([
      "Pass a status id, name, or type to `project create` or `project update`",
    ]),
  ]);
}

async function viewProjectCommand(
  args: string[],
  ctx?: TeamContext,
): Promise<string> {
  assertNoUnknownFlags(args, ["--full", "--issues", "--team", ...PAGINATION_FLAGS], "project view");
  const id = requirePositional(args, 1, "project id or name");
  const full = hasFlag(args, "--full");
  const includeIssues = hasFlag(args, "--issues");
  const paginationFlagsPresent = PAGINATION_FLAGS.some((flag) =>
    args.some((arg) => arg === flag || arg.startsWith(`${flag}=`)));
  if (!includeIssues && paginationFlagsPresent) {
    throw new AxiError("project view pagination flags require --issues", "VALIDATION_ERROR");
  }
  const project = await getProject(id);
  const status = await getProjectStatus(project);
  const description =
    typeof project.description === "string" ? project.description : "";
  const truncated = !full && wasTruncated(description, 500);
  const counts = await projectIssueCounts(project);
  const item = {
    id: project.id ?? null,
    name: project.name ?? null,
    state: status?.name ?? project.state ?? null,
    progress: formatProgress(project.progress),
    priority: typeof project.priority === "number" ? project.priority : null,
    startDate: project.startDate ?? null,
    targetDate: project.targetDate ?? null,
    url: project.url ?? null,
    description: full ? description : truncateBody(description, 500),
    issueCounts: counts,
  };
  const schema: FieldDef[] = [
    field("id"),
    field("name"),
    field("state"),
    field("progress"),
    field("priority"),
    field("startDate"),
    field("targetDate"),
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
  help.push(`Run \`linear-sdk-axi issue list --project ${String(project.id)}${suffix}\` to list project issues`);
  const blocks = [
    renderDetail("project", item, schema),
  ];
  if (includeIssues) {
    const pagination = parsePagination(args, 20);
    let teamId: string | undefined;
    if (ctx?.teamKey) {
      const team = await resolveTeamFromContext(ctx);
      teamId = team.id ? String(team.id) : undefined;
    }
    const result = await listIssues({
      pagination,
      filter: {
        project: { id: { eq: String(project.id) } },
        ...(teamId ? { team: { id: { eq: teamId } } } : {}),
      },
    });
    const issues = await Promise.all(result.nodes.map(hydrateIssue));
    blocks.push(
      formatCountLine({
        count: issues.length,
        limit: result.pagination.hasNextPage ? pagination.maxItems : undefined,
        totalCount: result.totalCount,
      }),
      renderList("issues", issues, [field("identifier"), field("title"), field("state"), field("team")], "0 project issues"),
      renderPagination(result.pagination),
    );
  }
  blocks.push(renderHelp(help));
  return renderOutput(blocks);
}

function parsePriority(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) {
    throw new AxiError("--priority must be an integer from 0 to 4", "VALIDATION_ERROR");
  }
  const priority = Number(value);
  if (priority < 0 || priority > 4) {
    throw new AxiError("--priority must be an integer from 0 to 4", "VALIDATION_ERROR");
  }
  return priority;
}

function parseDate(
  value: string | undefined,
  flag: "--start-date" | "--target-date",
  allowNone: boolean,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (allowNone && value.toLowerCase() === "none") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AxiError(`${flag} must use YYYY-MM-DD`, "VALIDATION_ERROR");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new AxiError(`${flag} must be a valid calendar date`, "VALIDATION_ERROR");
  }
  return value;
}

function plannedOrWrite(
  dryRun: boolean,
  mutation: string,
  input: Record<string, unknown>,
  write: () => Promise<string>,
): Promise<string> {
  if (!dryRun) return write();
  return Promise.resolve(
    renderOutput([
      encode({ dryRun: true, mutation, input }),
      renderHelp(["Re-run without --dry-run to apply"]),
    ]),
  );
}

async function projectDetail(
  project: Record<string, unknown>,
  action: "created" | "updated",
): Promise<string> {
  const status = await getProjectStatus(project);
  return renderOutput([
    renderDetail(
      "project",
      {
        id: project.id ?? null,
        name: project.name ?? null,
        state: status?.name ?? project.state ?? null,
        priority: typeof project.priority === "number" ? project.priority : null,
        startDate: project.startDate ?? null,
        targetDate: project.targetDate ?? null,
        url: project.url ?? null,
        action,
      },
      [
        field("id"),
        field("name"),
        field("state"),
        field("priority"),
        field("startDate"),
        field("targetDate"),
        field("url"),
        field("action"),
      ],
    ),
    renderHelp([
      `Run \`linear-sdk-axi project view ${String(project.id ?? "<id>")}\` for details`,
    ]),
  ]);
}

async function createProjectCommand(
  args: string[],
  ctx?: TeamContext,
): Promise<string> {
  assertNoUnknownFlags(
    args,
    [
      "--name",
      "--team",
      "--description",
      "--body",
      "--body-file",
      "--status",
      "--priority",
      "--start-date",
      "--target-date",
      "--dry-run",
    ],
    "project create",
  );
  const name = optionalFlagArg(args, "--name");
  if (!name) {
    throw new AxiError("--name is required", "VALIDATION_ERROR", [
      'Run `linear-sdk-axi project create --name "..." --team <key>`',
    ]);
  }
  const dryRun = takeBoolFlag(args, "--dry-run") || hasFlag(args, "--dry-run");
  const description = takeBody(args, {
    required: false,
    inlineFlags: ["--body", "--description"],
  });
  assertMaxLength(
    description,
    LINEAR_LIMITS.projectDescription,
    "project description",
  );
  const statusRaw = optionalFlagArg(args, "--status");
  const priority = parsePriority(optionalFlagArg(args, "--priority"));
  const startDate = parseDate(optionalFlagArg(args, "--start-date"), "--start-date", false);
  const targetDate = parseDate(optionalFlagArg(args, "--target-date"), "--target-date", false);
  const team = await resolveTeam(ctx?.teamKey);
  const input: Record<string, unknown> = {
    name,
    teamIds: [String(team.id)],
  };
  if (description !== undefined) input.description = description;
  if (statusRaw !== undefined) input.statusId = await resolveProjectStatusId(statusRaw);
  if (priority !== undefined) input.priority = priority;
  if (startDate !== undefined) input.startDate = startDate;
  if (targetDate !== undefined) input.targetDate = targetDate;

  return plannedOrWrite(dryRun, "createProject", input, async () => {
    const created = await createProject(input);
    return projectDetail(created, "created");
  });
}

async function updateProjectCommand(
  args: string[],
  ctx?: TeamContext,
): Promise<string> {
  assertNoUnknownFlags(
    args,
    [
      "--name",
      "--description",
      "--body",
      "--body-file",
      "--status",
      "--priority",
      "--start-date",
      "--target-date",
      "--dry-run",
      "--team",
    ],
    "project update",
  );
  const id = requirePositional(args, 1, "project id or name");
  const dryRun = takeBoolFlag(args, "--dry-run") || hasFlag(args, "--dry-run");
  const name = optionalFlagArg(args, "--name");
  const description = takeBody(args, {
    required: false,
    inlineFlags: ["--body", "--description"],
  });
  assertMaxLength(
    description,
    LINEAR_LIMITS.projectDescription,
    "project description",
  );
  const statusRaw = optionalFlagArg(args, "--status");
  const priority = parsePriority(optionalFlagArg(args, "--priority"));
  const startDate = parseDate(optionalFlagArg(args, "--start-date"), "--start-date", true);
  const targetDate = parseDate(optionalFlagArg(args, "--target-date"), "--target-date", true);
  if (
    name === undefined &&
    description === undefined &&
    statusRaw === undefined &&
    priority === undefined &&
    startDate === undefined &&
    targetDate === undefined
  ) {
    throw new AxiError("project update requires at least one editable flag", "VALIDATION_ERROR");
  }

  const project = await getProject(id);
  const projectStatus = await getProjectStatus(project);
  const input: Record<string, unknown> = {};
  const planned: Record<string, unknown> = {};
  if (name !== undefined) {
    planned.name = name;
    if (name !== project.name) input.name = name;
  }
  if (description !== undefined) {
    planned.description = description;
    if (description !== project.description) input.description = description;
  }
  if (statusRaw !== undefined) {
    const statusId = await resolveProjectStatusId(statusRaw);
    planned.statusId = statusId;
    if (statusId !== (projectStatus?.id ? String(projectStatus.id) : undefined)) {
      input.statusId = statusId;
    }
  }
  if (priority !== undefined) {
    planned.priority = priority;
    if (priority !== project.priority) input.priority = priority;
  }
  if (startDate !== undefined) {
    planned.startDate = startDate;
    if (startDate !== (project.startDate ?? null)) input.startDate = startDate;
  }
  if (targetDate !== undefined) {
    planned.targetDate = targetDate;
    if (targetDate !== (project.targetDate ?? null)) input.targetDate = targetDate;
  }

  if (Object.keys(input).length === 0) {
    if (dryRun) return plannedOrWrite(true, "updateProject", { id: project.id, ...planned }, async () => "");
    return renderOutput([
      renderDetail(
        "project",
        { id: project.id ?? null, name: project.name ?? null, message: "already in desired state (no-op)" },
        [field("id"), field("name"), field("message")],
      ),
      renderHelp([`Run \`linear-sdk-axi project view ${String(project.id ?? id)}\` for details`]),
    ]);
  }
  return plannedOrWrite(dryRun, "updateProject", { id: project.id, ...input }, async () => {
    const updated = await updateProject(String(project.id), input);
    return projectDetail(updated, "updated");
  });
}
