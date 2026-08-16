import { encode } from "@toon-format/toon";
import {
  assertNoUnknownFlags,
  getFlag,
  hasFlag,
  optionalFlagArg,
  parseLimit,
  repeatableFlagArgs,
  requirePositional,
  takeBoolFlag,
} from "../args.js";
import { takeBody, truncateBody, wasTruncated } from "../body.js";
import type { TeamContext } from "../client.js";
import { teamFlagSuffix } from "../client.js";
import { AxiError } from "../errors.js";
import { formatCountLine } from "../format.js";
import { PAGINATION_FLAGS, parsePagination, singlePage } from "../pagination.js";
import {
  completedStateId,
  createComment,
  createIssue,
  createIssueRelation,
  deleteIssueRelation,
  getIssue,
  getIssueChildren,
  getIssueComments,
  getIssueLabels,
  getIssueParent,
  getIssueRelations,
  getViewer,
  hydrateIssue,
  isStateType,
  listIssues,
  resolveAssigneeId,
  resolveCycleId,
  resolveProjectId,
  resolveStateId,
  resolveTeam,
  resolveTeamFromContext,
  resolveLabelIds,
  searchIssues,
  updateIssue,
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
import { assertVerificationMode, verifyWrite } from "../verification.js";

export const ISSUE_HELP = `usage: linear-sdk-axi issue <subcommand>
subcommands[8]:
  list, search <query>, view <id>, create, update <id>, relation <list|add|remove>, comment <id>, comment list <id>, close <id>
flags{list}:
  --team <key>, --project <id|name>, --assignee <me|userid|email|name>, --state <name|type>, --unblocked, --limit (page size, default 30), --after <cursor>, --all --max-items <n>, --fields <a,b,c>
flags{search}:
  --team <key>, --limit (page size, default 20), --after <cursor>, --all --max-items <n>, --comments
flags{view}:
  --full, --comments, --sub-issues
flags{create}:
  --title (required), --team (required unless only one team), --description/--body/--body-file, --assignee, --state, --project, --cycle <id>, --priority <0-4>, --estimate <n>, --due-date <YYYY-MM-DD>, --parent, --label (repeatable), --dry-run, --verify
flags{update}:
  --title, --description/--body/--body-file, --assignee, --state, --project, --cycle <id|none>, --priority <0-4>, --estimate <n|none>, --due-date <YYYY-MM-DD|none>, --parent <id|none>, --add-label/--remove-label (repeatable), --dry-run, --verify
flags{relation list}:
  --limit (page size, default 50), --after <cursor>, --all --max-items <n>
flags{relation add}:
  exactly one: --blocks, --blocked-by, --related, --duplicate-of; --dry-run, --verify
flags{relation remove}:
  --id <relation-id> or exactly one of --blocks, --blocked-by, --related, --duplicate-of; --dry-run, --verify
flags{comment}:
  --body or --body-file (required), --reply-to <comment-id>, --dry-run, --verify
flags{comment list}:
  --full, --limit (page size, default 50), --after <cursor>, --all --max-items <n>
flags{close}:
  --dry-run, --verify
examples:
  linear-sdk-axi issue list
  linear-sdk-axi issue list --team ENG --state started
  linear-sdk-axi issue search "login timeout" --team ENG
  linear-sdk-axi issue view ENG-123
  linear-sdk-axi issue view ENG-123 --full --comments
  linear-sdk-axi issue create --title "Fix login" --team ENG --dry-run
  linear-sdk-axi issue update ENG-123 --state Done --priority 2
  linear-sdk-axi issue relation list ENG-123
  linear-sdk-axi issue relation add ENG-123 --blocks ENG-124 --dry-run
  linear-sdk-axi issue relation remove ENG-123 --blocks ENG-124 --dry-run
  linear-sdk-axi issue comment ENG-123 --body "Shipped"
  linear-sdk-axi issue comment list ENG-123
  linear-sdk-axi issue comment ENG-123 --reply-to <comment-id> --body "Reply"
  linear-sdk-axi issue close ENG-123
`;

const listSchema: FieldDef[] = [
  field("identifier"),
  field("title"),
  field("state"),
  field("team"),
];

const EXTRA_FIELDS: Record<string, FieldDef> = {
  url: field("url"),
  assignee: field("assignee"),
  description: custom("description", (item) =>
    truncateBody(item.description, 200),
  ),
  stateType: field("stateType"),
  commentCount: field("commentCount"),
  project: field("projectName", "project"),
  cycleId: field("cycleId"),
  priority: field("priority"),
  estimate: field("estimate"),
  dueDate: field("dueDate"),
  id: field("id"),
};

function parseFields(raw: string | undefined): FieldDef[] {
  if (raw === undefined) return [];
  if (raw.trim() === "") {
    throw new AxiError("--fields requires at least one field", "VALIDATION_ERROR");
  }
  const requested = [
    ...new Set(
      raw
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean),
    ),
  ];
  const unknown = requested.filter((f) => !(f in EXTRA_FIELDS));
  if (unknown.length > 0) {
    throw new AxiError(
      `Unknown field(s): ${unknown.join(", ")}. Available: ${Object.keys(EXTRA_FIELDS).sort().join(", ")}`,
      "VALIDATION_ERROR",
    );
  }
  return requested.map((name) => EXTRA_FIELDS[name]);
}

export async function issueCommand(
  args: string[],
  ctx?: TeamContext,
): Promise<string> {
  const sub = args[0];
  if (!sub) {
    return ISSUE_HELP.trimEnd();
  }
  switch (sub) {
    case "list":
      return listIssuesCommand(args, ctx);
    case "search":
      return searchIssuesCommand(args, ctx);
    case "view":
      return viewIssueCommand(args, ctx);
    case "create":
      return createIssueCommand(args, ctx);
    case "update":
    case "edit":
      return updateIssueCommand(args, ctx);
    case "relation":
      return relationIssueCommand(args, ctx);
    case "comment":
      return commentIssueCommand(args, ctx);
    case "close":
      return closeIssueCommand(args, ctx);
    default:
      throw new AxiError(
        `Unknown issue subcommand: ${sub}`,
        "VALIDATION_ERROR",
        ["Run `linear-sdk-axi issue --help`"],
      );
  }
}

async function searchIssuesCommand(
  args: string[],
  ctx?: TeamContext,
): Promise<string> {
  assertNoUnknownFlags(args, ["--team", "--comments", ...PAGINATION_FLAGS], "issue search");
  const term = requirePositional(args, 1, "search query");
  const pagination = parsePagination(args, 20);
  const includeComments = hasFlag(args, "--comments");
  let teamId: string | undefined;
  if (ctx?.teamKey) {
    const team = await resolveTeamFromContext(ctx);
    teamId = team.id ? String(team.id) : undefined;
  }
  const result = await searchIssues(term, { pagination, teamId, includeComments });
  const hydrated = await Promise.all(result.nodes.map(hydrateIssue));
  const suffix = teamFlagSuffix(ctx);
  return renderOutput([
    formatCountLine({
      count: hydrated.length,
      limit: result.pagination.hasNextPage ? pagination.maxItems : undefined,
      ...(teamId ? {} : { totalCount: result.totalCount }),
    }),
    renderList("issues", hydrated, listSchema, "0 matching issues"),
    renderPagination(result.pagination),
    renderHelp([
      `Run \`linear-sdk-axi issue view <id>${suffix}\` for details`,
      `Run \`linear-sdk-axi issue search "..."${suffix}\` to refine the query`,
    ]),
  ]);
}

function buildIssueFilter(opts: {
  assigneeId?: string;
  projectId?: string;
  state?: string;
  teamId?: string;
  unblocked?: boolean;
  defaultUncompleted: boolean;
}): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (opts.assigneeId) {
    filter.assignee = { id: { eq: opts.assigneeId } };
  }
  if (opts.teamId) {
    filter.team = { id: { eq: opts.teamId } };
  }
  if (opts.projectId) {
    filter.project = { id: { eq: opts.projectId } };
  }
  if (opts.state) {
    if (isStateType(opts.state)) {
      filter.state = { type: { eq: opts.state.toLowerCase() } };
    } else {
      filter.state = { name: { eqIgnoreCase: opts.state } };
    }
  } else if (opts.defaultUncompleted) {
    filter.state = { type: { nin: ["completed", "canceled"] } };
  }
  if (opts.unblocked) {
    filter.hasBlockedByRelations = { eq: false };
  }
  return filter;
}

async function listIssuesCommand(
  args: string[],
  ctx?: TeamContext,
): Promise<string> {
  assertNoUnknownFlags(
    args,
    ["--team", "--project", "--assignee", "--state", "--unblocked", "--fields", ...PAGINATION_FLAGS],
    "issue list",
  );
  const assigneeRaw = optionalFlagArg(args, "--assignee");
  const projectRaw = optionalFlagArg(args, "--project");
  const stateRaw = optionalFlagArg(args, "--state");
  const unblocked = hasFlag(args, "--unblocked");
  const pagination = parsePagination(args, 30);
  const extraDefs = parseFields(getFlag(args, "--fields"));
  const hasExplicit =
    Boolean(assigneeRaw) || Boolean(stateRaw) || Boolean(projectRaw) || Boolean(ctx?.teamKey);

  let assigneeId: string | undefined;
  if (assigneeRaw) {
    assigneeId = await resolveAssigneeId(assigneeRaw);
  } else if (!hasExplicit) {
    const me = await getViewer();
    assigneeId = me.id ? String(me.id) : undefined;
  }

  let teamId: string | undefined;
  if (ctx?.teamKey) {
    const team = await resolveTeamFromContext(ctx);
    teamId = team.id ? String(team.id) : undefined;
  }

  const projectId = projectRaw ? await resolveProjectId(projectRaw) : undefined;

  // Default: assigned-to-me uncompleted unless --assignee/--state/--team given.
  const filter = buildIssueFilter({
    assigneeId,
    projectId,
    state: stateRaw,
    teamId,
    unblocked,
    defaultUncompleted: !hasExplicit,
  });

  const result = await listIssues({ pagination, filter });
  const hydrated = await Promise.all(result.nodes.map(hydrateIssue));
  const schema = extraDefs.length > 0 ? [...listSchema, ...extraDefs] : listSchema;
  const emptyLabel = !hasExplicit
    ? "0 assigned uncompleted issues"
    : "0 matching issues";
  const suffix = teamFlagSuffix(ctx);
  const help = [
    `Run \`linear-sdk-axi issue view <id>${suffix}\` for details`,
    `Run \`linear-sdk-axi issue create --title "..."${suffix}\` to create an issue`,
  ];
  if (projectRaw) {
    help.push(`Run \`linear-sdk-axi project view ${JSON.stringify(projectRaw)} --issues${suffix}\` for the project summary`);
  }
  if (result.pagination.hasNextPage) {
    help.unshift(
      `Run \`linear-sdk-axi issue list --after ${result.pagination.endCursor}${suffix}\` to continue`,
    );
  }
  return renderOutput([
    formatCountLine({
      count: hydrated.length,
      limit: result.pagination.hasNextPage ? pagination.maxItems : undefined,
      totalCount: result.totalCount,
    }),
    renderList("issues", hydrated, schema, emptyLabel),
    renderPagination(result.pagination),
    renderHelp(help),
  ]);
}

async function viewIssueCommand(
  args: string[],
  ctx?: TeamContext,
): Promise<string> {
  assertNoUnknownFlags(args, ["--full", "--comments", "--sub-issues", "--team"], "issue view");
  const id = requirePositional(args, 1, "issue id");
  const full = hasFlag(args, "--full");
  const withComments = hasFlag(args, "--comments");
  const withSubIssues = hasFlag(args, "--sub-issues");
  const issue = await getIssue(id);
  const hydrated = await hydrateIssue(issue);
  const fetchedComments = withComments
    ? (await getIssueComments(issue, singlePage(50))).nodes
    : undefined;
  const parent = await getIssueParent(issue);
  const hydratedParent = parent ? await hydrateIssue(parent) : undefined;
  const truncated = !full && wasTruncated(hydrated.description, 500);
  const description = full
    ? hydrated.description
    : truncateBody(hydrated.description, 500);
  const item: Record<string, unknown> = {
    ...hydrated,
    commentCount: fetchedComments?.length ?? hydrated.commentCount,
    description,
    parent: hydratedParent
      ? `${hydratedParent.identifier} ${hydratedParent.title}`.trim()
      : null,
  };
  const schema: FieldDef[] = [
    field("identifier"),
    field("title"),
    field("state"),
    field("stateType"),
    field("assignee"),
    field("team"),
    field("parent"),
    field("projectName", "project"),
    field("cycleId"),
    field("priority"),
    field("estimate"),
    field("dueDate"),
    field("url"),
    field("commentCount"),
    field("description"),
  ];
  const blocks: string[] = [renderDetail("issue", item, schema)];
  if (withComments) {
    const commentItems = (fetchedComments ?? []).map((c) => ({
      id: c.id ?? null,
      author: c.author ?? null,
      body: full ? c.body : truncateBody(c.body, 800),
    }));
    blocks.push(
      renderList(
        "comments",
        commentItems,
        [field("id"), field("author"), field("body")],
        "0 comments",
      ),
    );
  }
  if (withSubIssues) {
    const children = await getIssueChildren(issue);
    const hydratedChildren = await Promise.all(children.map(hydrateIssue));
    blocks.push(
      renderList("subIssues", hydratedChildren, listSchema, "0 sub-issues"),
    );
  }
  const suffix = teamFlagSuffix(ctx);
  const help: string[] = [];
  if (truncated) {
    help.push(
      `Run \`linear-sdk-axi issue view ${hydrated.identifier} --full${suffix}\` to see complete description`,
    );
  }
  if (!withComments) {
    help.push(
      `Run \`linear-sdk-axi issue view ${hydrated.identifier} --comments${suffix}\` to include comments`,
    );
  }
  if (!withSubIssues) {
    help.push(
      `Run \`linear-sdk-axi issue view ${hydrated.identifier} --sub-issues${suffix}\` to include sub-issues`,
    );
  }
  help.push(
    `Run \`linear-sdk-axi issue close ${hydrated.identifier}${suffix}\` to complete this issue`,
  );
  blocks.push(renderHelp(help));
  return renderOutput(blocks);
}

async function plannedOrWrite(
  dryRun: boolean,
  mutation: string,
  input: Record<string, unknown>,
  write: () => Promise<string>,
): Promise<string> {
  if (dryRun) {
    return renderOutput([
      encode({ dryRun: true, mutation, input }),
      renderHelp(["Re-run without --dry-run to apply"]),
    ]);
  }
  return write();
}

function requestedFields(
  values: Record<string, unknown>,
  requested: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.keys(requested).map((key) => [key, values[key]]),
  );
}

async function readIssueState(
  id: string,
  intended: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const issue = await getIssue(id);
  const hydrated = await hydrateIssue(issue);
  const labels = Object.prototype.hasOwnProperty.call(intended, "labelIds")
    ? await getIssueLabels(issue)
    : [];
  return requestedFields({
    title: hydrated.title,
    description: hydrated.description,
    assigneeId: hydrated.assigneeId ?? null,
    stateId: hydrated.stateId ?? null,
    stateType: hydrated.stateType,
    projectId: hydrated.projectId ?? null,
    cycleId: hydrated.cycleId ?? null,
    priority: hydrated.priority,
    estimate: hydrated.estimate,
    dueDate: hydrated.dueDate,
    parentId: hydrated.raw.parentId ? String(hydrated.raw.parentId) : null,
    teamId: hydrated.teamId ?? null,
    labelIds: labels.map((label) => String(label.id)).sort(),
  }, intended);
}

async function relationPresence(
  sourceId: string,
  intended: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const issue = await getIssue(sourceId);
  const relations = await getIssueRelations(issue, {
    pageSize: 50,
    all: true,
    maxItems: 250,
  });
  const matching = relations.nodes.find((relation) =>
    (intended.relationId ? relation.id === intended.relationId : true) &&
    (intended.type ? relation.type === intended.type : true) &&
    (intended.direction && intended.direction !== "either"
      ? relation.direction === intended.direction
      : true) &&
    (intended.targetId ? relation.issue.id === intended.targetId : true));
  return { ...intended, present: Boolean(matching) };
}

async function resolveParentIssue(
  value: string,
  opts: { teamId?: string; issueId?: string },
) {
  const parent = await hydrateIssue(await getIssue(value));
  if (opts.issueId && parent.id === opts.issueId) {
    throw new AxiError("An issue cannot be its own parent", "VALIDATION_ERROR");
  }
  if (opts.teamId && parent.teamId && parent.teamId !== opts.teamId) {
    throw new AxiError(
      `Parent issue ${parent.identifier} belongs to team ${parent.team}, not this issue's team`,
      "VALIDATION_ERROR",
      ["Parent and sub-issue must belong to the same team"],
    );
  }
  return parent;
}

function parseIntegerFlag(
  value: string | undefined,
  flag: string,
  options: { min: number; max?: number; allowNone?: boolean },
): number | null | undefined {
  if (value === undefined) return undefined;
  if (options.allowNone && value.toLowerCase() === "none") return null;
  if (!/^-?\d+$/.test(value)) {
    throw new AxiError(`${flag} must be an integer`, "VALIDATION_ERROR");
  }
  const numeric = Number(value);
  if (numeric < options.min || (options.max !== undefined && numeric > options.max)) {
    const range = options.max === undefined ? `${options.min} or greater` : `${options.min}-${options.max}`;
    throw new AxiError(`${flag} must be ${range}`, "VALIDATION_ERROR");
  }
  return numeric;
}

function parseDueDate(
  value: string | undefined,
  allowNone: boolean,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (allowNone && value.toLowerCase() === "none") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AxiError("--due-date must use YYYY-MM-DD", "VALIDATION_ERROR");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new AxiError("--due-date must be a valid calendar date", "VALIDATION_ERROR");
  }
  return value;
}

async function createIssueCommand(
  args: string[],
  ctx?: TeamContext,
): Promise<string> {
  assertNoUnknownFlags(
    args,
    [
      "--title",
      "--team",
      "--description",
      "--body",
      "--body-file",
      "--assignee",
      "--state",
      "--project",
      "--cycle",
      "--priority",
      "--estimate",
      "--due-date",
      "--parent",
      "--label",
      "--dry-run",
      "--verify",
    ],
    "issue create",
  );
  const title = optionalFlagArg(args, "--title");
  if (!title) {
    throw new AxiError("--title is required", "VALIDATION_ERROR", [
      'Run `linear-sdk-axi issue create --title "..." --team <key>`',
    ]);
  }
  const dryRun = takeBoolFlag(args, "--dry-run") || hasFlag(args, "--dry-run");
  const verify = hasFlag(args, "--verify");
  assertVerificationMode(dryRun, verify);
  const description = takeBody(args, {
    required: false,
    inlineFlags: ["--body", "--description"],
  });
  const assigneeRaw = optionalFlagArg(args, "--assignee");
  const stateRaw = optionalFlagArg(args, "--state");
  const projectRaw = optionalFlagArg(args, "--project");
  const cycleRaw = optionalFlagArg(args, "--cycle");
  const priority = parseIntegerFlag(optionalFlagArg(args, "--priority"), "--priority", {
    min: 0,
    max: 4,
  });
  const estimate = parseIntegerFlag(optionalFlagArg(args, "--estimate"), "--estimate", {
    min: 0,
  });
  const dueDate = parseDueDate(optionalFlagArg(args, "--due-date"), false);
  const parentRaw = optionalFlagArg(args, "--parent");
  const labelRaw = repeatableFlagArgs(args, "--label");

  const team = await resolveTeam(ctx?.teamKey);
  const input: Record<string, unknown> = {
    teamId: team.id,
    title,
  };
  if (description !== undefined) input.description = description;
  if (assigneeRaw) input.assigneeId = await resolveAssigneeId(assigneeRaw);
  if (stateRaw) input.stateId = await resolveStateId(team, stateRaw);
  if (projectRaw) input.projectId = await resolveProjectId(projectRaw);
  if (cycleRaw) input.cycleId = await resolveCycleId(cycleRaw, String(team.id));
  if (priority !== undefined) input.priority = priority;
  if (estimate !== undefined) input.estimate = estimate;
  if (dueDate !== undefined) input.dueDate = dueDate;
  if (parentRaw) {
    const parent = await resolveParentIssue(parentRaw, { teamId: String(team.id) });
    input.parentId = parent.id;
  }
  if (labelRaw.length > 0) {
    input.labelIds = await resolveLabelIds(labelRaw, { teamId: String(team.id) });
  }

  const suffix = teamFlagSuffix(ctx) || ` --team ${team.key ?? team.id}`;
  return plannedOrWrite(dryRun, "createIssue", input, async () => {
    const created = await createIssue(input);
    const hydrated = await hydrateIssue(created);
    const labels = labelRaw.length > 0 ? await getIssueLabels(created) : [];
    const blocks = [
      renderDetail("issue", {
        ...hydrated,
        labels: labels.map((label) => label.name ?? label.id).join(", "),
      }, [
        field("identifier"),
        field("title"),
        field("state"),
        field("team"),
        ...(cycleRaw || priority !== undefined || estimate !== undefined || dueDate !== undefined
          ? [field("cycleId"), field("priority"), field("estimate"), field("dueDate")]
          : []),
        ...(labelRaw.length > 0 ? [field("labels")] : []),
        field("url"),
      ]),
      renderHelp([
        `Run \`linear-sdk-axi issue view ${hydrated.identifier}${suffix}\` for details`,
        `Run \`linear-sdk-axi issue comment ${hydrated.identifier} --body "..."${suffix}\` to comment`,
      ]),
    ];
    if (verify) {
      blocks.push(await verifyWrite(input, () => readIssueState(hydrated.id, input)));
    }
    return renderOutput(blocks);
  });
}

function sameText(a: string | undefined | null, b: string | undefined | null): boolean {
  return (a ?? "") === (b ?? "");
}

async function updateIssueCommand(
  args: string[],
  ctx?: TeamContext,
): Promise<string> {
  assertNoUnknownFlags(
    args,
    [
      "--title",
      "--description",
      "--body",
      "--body-file",
      "--assignee",
      "--state",
      "--project",
      "--cycle",
      "--priority",
      "--estimate",
      "--due-date",
      "--parent",
      "--add-label",
      "--remove-label",
      "--dry-run",
      "--verify",
      "--team",
    ],
    "issue update",
  );
  const id = requirePositional(args, 1, "issue id");
  const dryRun = hasFlag(args, "--dry-run");
  const verify = hasFlag(args, "--verify");
  assertVerificationMode(dryRun, verify);
  const title = optionalFlagArg(args, "--title");
  const description = takeBody(args, {
    required: false,
    inlineFlags: ["--body", "--description"],
  });
  const assigneeRaw = optionalFlagArg(args, "--assignee");
  const stateRaw = optionalFlagArg(args, "--state");
  const projectRaw = optionalFlagArg(args, "--project");
  const cycleRaw = optionalFlagArg(args, "--cycle");
  const priority = parseIntegerFlag(optionalFlagArg(args, "--priority"), "--priority", {
    min: 0,
    max: 4,
  });
  const estimate = parseIntegerFlag(optionalFlagArg(args, "--estimate"), "--estimate", {
    min: 0,
    allowNone: true,
  });
  const dueDate = parseDueDate(optionalFlagArg(args, "--due-date"), true);
  const parentRaw = optionalFlagArg(args, "--parent");
  const addLabelRaw = repeatableFlagArgs(args, "--add-label");
  const removeLabelRaw = repeatableFlagArgs(args, "--remove-label");

  if (
    title === undefined &&
    description === undefined &&
    assigneeRaw === undefined &&
    stateRaw === undefined &&
    projectRaw === undefined &&
    cycleRaw === undefined &&
    priority === undefined &&
    estimate === undefined &&
    dueDate === undefined &&
    parentRaw === undefined &&
    addLabelRaw.length === 0 &&
    removeLabelRaw.length === 0
  ) {
    throw new AxiError(
      "issue update requires at least one editable flag",
      "VALIDATION_ERROR",
    );
  }

  const issue = await getIssue(id);
  const current = await hydrateIssue(issue);
  const input: Record<string, unknown> = {};
  const planned: Record<string, unknown> = {};
  let intendedLabelIds: string[] | undefined;

  if (title !== undefined) {
    planned.title = title;
    if (!sameText(title, current.title)) input.title = title;
  }
  if (description !== undefined) {
    planned.description = description;
    if (!sameText(description, current.description)) input.description = description;
  }
  if (assigneeRaw !== undefined) {
    const assigneeId = await resolveAssigneeId(assigneeRaw);
    planned.assigneeId = assigneeId;
    if (assigneeId !== current.assigneeId) input.assigneeId = assigneeId;
  }
  if (stateRaw !== undefined) {
    const team = current.teamId
      ? await resolveTeam(current.teamId)
      : await resolveTeamFromContext(ctx);
    const stateId = await resolveStateId(team, stateRaw);
    planned.stateId = stateId;
    if (stateId !== current.stateId) input.stateId = stateId;
  }
  if (projectRaw !== undefined) {
    const projectId = await resolveProjectId(projectRaw);
    planned.projectId = projectId;
    if (projectId !== current.projectId) input.projectId = projectId;
  }
  if (cycleRaw !== undefined) {
    const cycleId = cycleRaw.toLowerCase() === "none"
      ? null
      : await resolveCycleId(cycleRaw, current.teamId);
    planned.cycleId = cycleId;
    if (cycleId !== current.cycleId) input.cycleId = cycleId;
  }
  if (priority !== undefined) {
    planned.priority = priority;
    if (priority !== current.priority) input.priority = priority;
  }
  if (estimate !== undefined) {
    planned.estimate = estimate;
    if (estimate !== current.estimate) input.estimate = estimate;
  }
  if (dueDate !== undefined) {
    planned.dueDate = dueDate;
    if (dueDate !== current.dueDate) input.dueDate = dueDate;
  }
  if (parentRaw !== undefined) {
    const parentId = parentRaw.toLowerCase() === "none"
      ? null
      : (await resolveParentIssue(parentRaw, {
        teamId: current.teamId,
        issueId: current.id,
      })).id;
    const currentParentId = current.raw.parentId
      ? String(current.raw.parentId)
      : null;
    planned.parentId = parentId;
    if (parentId !== currentParentId) input.parentId = parentId;
  }
  if (addLabelRaw.length > 0 || removeLabelRaw.length > 0) {
    const [addLabelIds, removeLabelIds] = await Promise.all([
      resolveLabelIds(addLabelRaw, { teamId: current.teamId }),
      resolveLabelIds(removeLabelRaw, { teamId: current.teamId }),
    ]);
    const conflicting = addLabelIds.filter((id) => removeLabelIds.includes(id));
    if (conflicting.length > 0) {
      throw new AxiError(
        "A label cannot be added and removed in the same update",
        "VALIDATION_ERROR",
      );
    }
    const currentLabelIds = (await getIssueLabels(issue)).map((label) => String(label.id));
    planned.addedLabelIds = addLabelIds;
    planned.removedLabelIds = removeLabelIds;
    intendedLabelIds = [...new Set([...currentLabelIds, ...addLabelIds])]
      .filter((labelId) => !removeLabelIds.includes(labelId))
      .sort();
    const addedLabelIds = addLabelIds.filter((id) => !currentLabelIds.includes(id));
    const removedLabelIds = removeLabelIds.filter((id) => currentLabelIds.includes(id));
    if (addedLabelIds.length > 0) input.addedLabelIds = addedLabelIds;
    if (removedLabelIds.length > 0) input.removedLabelIds = removedLabelIds;
  }

  const suffix = teamFlagSuffix(ctx);
  const ident = current.identifier;
  const verificationIntended = {
    ...Object.fromEntries(
      Object.entries(planned).filter(([key]) =>
        key !== "addedLabelIds" && key !== "removedLabelIds"),
    ),
    ...(intendedLabelIds ? { labelIds: intendedLabelIds } : {}),
  };

  if (Object.keys(input).length === 0) {
    if (dryRun) {
      return renderOutput([
        encode({
          dryRun: true,
          mutation: "updateIssue",
          noop: true,
          identifier: ident,
          input: planned,
        }),
      ]);
    }
    const blocks = [
      renderDetail(
        "issue",
        { ...current, message: "already in desired state (no-op)" },
        [
          field("identifier"),
          field("title"),
          field("state"),
          field("team"),
          field("message"),
        ],
      ),
      renderHelp([
        `Run \`linear-sdk-axi issue view ${ident}${suffix}\` for details`,
      ]),
    ];
    if (verify) {
      blocks.push(await verifyWrite(
        verificationIntended,
        () => readIssueState(current.id, verificationIntended),
      ));
    }
    return renderOutput(blocks);
  }

  return plannedOrWrite(
    dryRun,
    "updateIssue",
    { id: current.id, ...input },
    async () => {
      const updated = await updateIssue(current.id, input);
      const hydrated = await hydrateIssue(updated);
      const requestedLabelChanges =
        addLabelRaw.length > 0 || removeLabelRaw.length > 0;
      const labels = requestedLabelChanges ? await getIssueLabels(updated) : [];
      const blocks = [
        renderDetail("issue", {
          ...hydrated,
          labels: labels.map((label) => label.name ?? label.id).join(", "),
        }, [
          field("identifier"),
          field("title"),
          field("state"),
          field("assignee"),
          field("team"),
          ...(cycleRaw !== undefined || priority !== undefined || estimate !== undefined || dueDate !== undefined
            ? [field("cycleId"), field("priority"), field("estimate"), field("dueDate")]
            : []),
          ...(requestedLabelChanges ? [field("labels")] : []),
        ]),
        renderHelp([
          `Run \`linear-sdk-axi issue view ${hydrated.identifier}${suffix}\` for details`,
        ]),
      ];
      if (verify) {
        blocks.push(await verifyWrite(
          verificationIntended,
          () => readIssueState(current.id, verificationIntended),
        ));
      }
      return renderOutput(blocks);
    },
  );
}

type RelationOption = {
  flag: string;
  label: string;
  type: "blocks" | "related" | "duplicate";
  direction: "outgoing" | "incoming" | "either";
};

const RELATION_OPTIONS: RelationOption[] = [
  { flag: "--blocks", label: "blocks", type: "blocks", direction: "outgoing" },
  { flag: "--blocked-by", label: "blocked-by", type: "blocks", direction: "incoming" },
  { flag: "--related", label: "related", type: "related", direction: "either" },
  { flag: "--duplicate-of", label: "duplicate-of", type: "duplicate", direction: "outgoing" },
];

function relationLabel(type: string, direction: "outgoing" | "incoming"): string {
  if (type === "blocks") return direction === "outgoing" ? "blocks" : "blocked-by";
  if (type === "duplicate") return direction === "outgoing" ? "duplicate-of" : "duplicate";
  return type;
}

function hasValueFlag(args: string[], flag: string): boolean {
  return args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
}

async function relationIssueCommand(
  args: string[],
  ctx?: TeamContext,
): Promise<string> {
  const sub = args[1];
  if (sub === "list") return listIssueRelationsCommand(args, ctx);
  if (sub === "add") return addIssueRelationCommand(args, ctx);
  if (sub === "remove") return removeIssueRelationCommand(args, ctx);
  throw new AxiError(
    `Unknown issue relation subcommand: ${sub ?? "(missing)"}`,
    "VALIDATION_ERROR",
    ["Run `linear-sdk-axi issue --help`"],
  );
}

async function listIssueRelationsCommand(
  args: string[],
  ctx?: TeamContext,
): Promise<string> {
  assertNoUnknownFlags(args, ["--team", ...PAGINATION_FLAGS], "issue relation list");
  const id = requirePositional(args, 2, "issue id");
  const pagination = parsePagination(args, 50);
  const issue = await getIssue(id);
  const source = await hydrateIssue(issue);
  const relations = await getIssueRelations(issue, pagination);
  const items = relations.nodes.map((relation) => ({
    id: relation.id,
    relation: relationLabel(relation.type, relation.direction),
    issue: `${relation.issue.identifier} ${relation.issue.title}`.trim(),
    state: relation.issue.state,
  }));
  const suffix = teamFlagSuffix(ctx);
  return renderOutput([
    formatCountLine({
      count: items.length,
      limit: relations.pagination.hasNextPage ? pagination.maxItems : undefined,
      totalCount: relations.totalCount,
    }),
    renderList(
      "relations",
      items,
      [field("id"), field("relation"), field("issue"), field("state")],
      "0 relations",
    ),
    renderPagination(relations.pagination),
    renderHelp([
      `Run \`linear-sdk-axi issue view <id>${suffix}\` to inspect a related issue`,
      `Run \`linear-sdk-axi issue relation add ${source.identifier} --blocks <id> --dry-run${suffix}\` to plan a relation`,
    ]),
  ]);
}

async function addIssueRelationCommand(
  args: string[],
  ctx?: TeamContext,
): Promise<string> {
  assertNoUnknownFlags(
    args,
    ["--blocks", "--blocked-by", "--related", "--duplicate-of", "--dry-run", "--verify", "--team"],
    "issue relation add",
  );
  const sourceArg = requirePositional(args, 2, "source issue id");
  const selected = RELATION_OPTIONS.filter((option) => hasValueFlag(args, option.flag));
  if (selected.length !== 1) {
    throw new AxiError(
      "issue relation add requires exactly one of --blocks, --blocked-by, --related, or --duplicate-of",
      "VALIDATION_ERROR",
    );
  }
  const option = selected[0];
  const targetArg = optionalFlagArg(args, option.flag);
  if (!targetArg) {
    throw new AxiError(`${option.flag} requires a related issue id`, "VALIDATION_ERROR");
  }
  const [sourceIssue, targetIssue] = await Promise.all([
    getIssue(sourceArg),
    getIssue(targetArg),
  ]);
  const [source, target] = await Promise.all([
    hydrateIssue(sourceIssue),
    hydrateIssue(targetIssue),
  ]);
  if (source.id === target.id) {
    throw new AxiError("An issue cannot relate to itself", "VALIDATION_ERROR");
  }
  const relations = await getIssueRelations(sourceIssue);
  const alreadyExists = relations.nodes.some(
    (relation) =>
      relation.type === option.type &&
      relation.issue.id === target.id &&
      (option.direction === "either" || relation.direction === option.direction),
  );
  const input = option.direction === "incoming"
    ? { issueId: target.id, relatedIssueId: source.id, type: option.type }
    : { issueId: source.id, relatedIssueId: target.id, type: option.type };
  const dryRun = hasFlag(args, "--dry-run");
  const verify = hasFlag(args, "--verify");
  assertVerificationMode(dryRun, verify);
  const suffix = teamFlagSuffix(ctx);
  const verificationIntended = {
    type: option.type,
    direction: option.direction,
    targetId: target.id,
    present: true,
  };

  if (alreadyExists) {
    const blocks = [
      renderDetail(
        "relation",
        {
          source: source.identifier,
          relation: option.label,
          target: target.identifier,
          message: "already exists (no-op)",
        },
        [field("source"), field("relation"), field("target"), field("message")],
      ),
      renderHelp([
        `Run \`linear-sdk-axi issue relation list ${source.identifier}${suffix}\` to inspect relations`,
      ]),
    ];
    if (verify) {
      blocks.push(await verifyWrite(
        verificationIntended,
        () => relationPresence(source.id, verificationIntended),
      ));
    }
    return renderOutput(blocks);
  }

  return plannedOrWrite(dryRun, "createIssueRelation", input, async () => {
    const created = await createIssueRelation(input);
    const blocks = [
      renderDetail(
        "relation",
        {
          id: created.id ?? null,
          source: source.identifier,
          relation: option.label,
          target: target.identifier,
        },
        [field("id"), field("source"), field("relation"), field("target")],
      ),
      renderHelp([
        `Run \`linear-sdk-axi issue relation list ${source.identifier}${suffix}\` to inspect relations`,
      ]),
    ];
    if (verify) {
      blocks.push(await verifyWrite(
        verificationIntended,
        () => relationPresence(source.id, verificationIntended),
      ));
    }
    return renderOutput(blocks);
  });
}

async function removeIssueRelationCommand(
  args: string[],
  ctx?: TeamContext,
): Promise<string> {
  assertNoUnknownFlags(
    args,
    ["--id", "--blocks", "--blocked-by", "--related", "--duplicate-of", "--dry-run", "--verify", "--team"],
    "issue relation remove",
  );
  const sourceArg = requirePositional(args, 2, "source issue id");
  const dryRun = hasFlag(args, "--dry-run");
  const verify = hasFlag(args, "--verify");
  assertVerificationMode(dryRun, verify);
  const relationId = optionalFlagArg(args, "--id");
  const selected = RELATION_OPTIONS.filter((option) => hasValueFlag(args, option.flag));
  if ((relationId ? 1 : 0) + selected.length !== 1) {
    throw new AxiError(
      "issue relation remove requires --id or exactly one semantic edge flag",
      "VALIDATION_ERROR",
    );
  }

  const sourceIssue = await getIssue(sourceArg);
  const source = await hydrateIssue(sourceIssue);
  const relations = await getIssueRelations(sourceIssue, {
    pageSize: 50,
    all: true,
    maxItems: 250,
  });
  let matches = relations.nodes;
  let label: string;
  let targetIdentifier: string;

  if (relationId) {
    matches = matches.filter((relation) => relation.id === relationId);
    if (matches.length === 0) {
      throw new AxiError(
        `Relation ${relationId} was not found on ${source.identifier}`,
        "NOT_FOUND",
        [`Run \`linear-sdk-axi issue relation list ${source.identifier}\``],
      );
    }
    label = relationLabel(matches[0].type, matches[0].direction);
    targetIdentifier = matches[0].issue.identifier;
  } else {
    const option = selected[0];
    const targetArg = optionalFlagArg(args, option.flag)!;
    const target = await hydrateIssue(await getIssue(targetArg));
    matches = matches.filter(
      (relation) =>
        relation.type === option.type &&
        relation.issue.id === target.id &&
        (option.direction === "either" || relation.direction === option.direction),
    );
    label = option.label;
    targetIdentifier = target.identifier;
    if (matches.length === 0) {
      const verificationIntended = {
        type: option.type,
        direction: option.direction,
        targetId: target.id,
        present: false,
      };
      const blocks = [
        renderDetail(
          "relation",
          {
            source: source.identifier,
            relation: label,
            target: targetIdentifier,
            message: "already absent (no-op)",
          },
          [field("source"), field("relation"), field("target"), field("message")],
        ),
      ];
      if (verify) {
        blocks.push(await verifyWrite(
          verificationIntended,
          () => relationPresence(source.id, verificationIntended),
        ));
      }
      return renderOutput(blocks);
    }
  }

  if (matches.length > 1) {
    throw new AxiError(
      `More than one ${label} relation matches ${source.identifier} and ${targetIdentifier}`,
      "VALIDATION_ERROR",
      [
        `Run \`linear-sdk-axi issue relation list ${source.identifier}\``,
        "Retry with --id <relation-id>",
      ],
    );
  }

  const match = matches[0];
  const suffix = teamFlagSuffix(ctx);
  const verificationIntended = { relationId: match.id, present: false };
  return plannedOrWrite(dryRun, "deleteIssueRelation", { id: match.id }, async () => {
    await deleteIssueRelation(match.id);
    const blocks = [
      renderDetail(
        "relation",
        {
          id: match.id,
          source: source.identifier,
          relation: label,
          target: targetIdentifier,
          action: "removed",
        },
        [field("id"), field("source"), field("relation"), field("target"), field("action")],
      ),
      renderHelp([
        `Run \`linear-sdk-axi issue relation list ${source.identifier}${suffix}\` to inspect relations`,
      ]),
    ];
    if (verify) {
      blocks.push(await verifyWrite(
        verificationIntended,
        () => relationPresence(source.id, verificationIntended),
      ));
    }
    return renderOutput(blocks);
  });
}

async function commentIssueCommand(
  args: string[],
  ctx?: TeamContext,
): Promise<string> {
  if (args[1] === "list") {
    return listIssueCommentsCommand(args, ctx);
  }
  assertNoUnknownFlags(
    args,
    ["--body", "--body-file", "--description", "--reply-to", "--dry-run", "--verify", "--team"],
    "issue comment",
  );
  const id = requirePositional(args, 1, "issue id");
  const dryRun = hasFlag(args, "--dry-run");
  const verify = hasFlag(args, "--verify");
  assertVerificationMode(dryRun, verify);
  const body = takeBody(args, { required: true, inlineFlags: ["--body"] });
  const replyTo = optionalFlagArg(args, "--reply-to");
  const issue = await getIssue(id);
  const hydrated = await hydrateIssue(issue);
  if (replyTo) {
    const comments = (await getIssueComments(issue, singlePage(50))).nodes;
    if (!comments.some((comment) => comment.id === replyTo)) {
      throw new AxiError(
        `Comment ${replyTo} is not part of issue ${hydrated.identifier}`,
        "NOT_FOUND",
        [`Run \`linear-sdk-axi issue comment list ${hydrated.identifier}${teamFlagSuffix(ctx)}\` to find a reply target`],
      );
    }
  }
  const input = { issueId: hydrated.id, body, ...(replyTo ? { parentId: replyTo } : {}) };
  const suffix = teamFlagSuffix(ctx);
  return plannedOrWrite(dryRun, "createComment", input, async () => {
    const comment = await createComment(input);
    const blocks = [
      renderDetail(
        "comment",
        {
          issue: hydrated.identifier,
          replyTo: replyTo ?? null,
          body: truncateBody(comment.body ?? body, 800),
        },
        [field("issue"), field("replyTo"), field("body")],
      ),
      renderHelp([
        `Run \`linear-sdk-axi issue view ${hydrated.identifier}${suffix}\` for details`,
      ]),
    ];
    if (verify) {
      if (!comment.id) {
        throw new AxiError(
          "Write applied but Linear returned no comment id for verification",
          "UNKNOWN",
        );
      }
      const intended = {
        id: String(comment.id),
        body,
        parentId: replyTo ?? null,
      };
      blocks.push(await verifyWrite(intended, async () => {
        const freshIssue = await getIssue(hydrated.id);
        const comments = await getIssueComments(freshIssue, {
          pageSize: 50,
          all: true,
          maxItems: 250,
        });
        const observed = comments.nodes.find((item) => String(item.id) === intended.id);
        return observed
          ? { id: String(observed.id), body: observed.body, parentId: observed.parentId ?? null }
          : { id: null, body: null, parentId: null };
      }));
    }
    return renderOutput(blocks);
  });
}

async function listIssueCommentsCommand(
  args: string[],
  ctx?: TeamContext,
): Promise<string> {
  assertNoUnknownFlags(args, ["--full", "--team", ...PAGINATION_FLAGS], "issue comment list");
  const id = requirePositional(args, 2, "issue id");
  const full = hasFlag(args, "--full");
  const pagination = parsePagination(args, 50);
  const issue = await getIssue(id);
  const hydrated = await hydrateIssue(issue);
  const comments = await getIssueComments(issue, pagination);
  const items = comments.nodes.map((comment) => ({
    id: comment.id ?? null,
    replyTo: comment.parentId ?? null,
    author: comment.author ?? null,
    createdAt: comment.createdAt ?? null,
    resolvedAt: comment.resolvedAt ?? null,
    body: full ? comment.body : truncateBody(comment.body, 800),
  }));
  const suffix = teamFlagSuffix(ctx);
  return renderOutput([
    renderList(
      "comments",
      items,
      [
        field("id"),
        field("replyTo"),
        field("author"),
        field("createdAt"),
        field("resolvedAt"),
        field("body"),
      ],
      "0 comments",
    ),
    renderPagination(comments.pagination),
    renderHelp([
      `Run \`linear-sdk-axi issue comment ${hydrated.identifier} --reply-to <comment-id> --body "..."${suffix}\` to reply`,
      full
        ? `Run \`linear-sdk-axi issue view ${hydrated.identifier}${suffix}\` for the issue`
        : `Run \`linear-sdk-axi issue comment list ${hydrated.identifier} --full${suffix}\` for complete comment text`,
    ]),
  ]);
}

async function closeIssueCommand(
  args: string[],
  ctx?: TeamContext,
): Promise<string> {
  assertNoUnknownFlags(args, ["--dry-run", "--verify", "--team"], "issue close");
  const id = requirePositional(args, 1, "issue id");
  const dryRun = hasFlag(args, "--dry-run");
  const verify = hasFlag(args, "--verify");
  assertVerificationMode(dryRun, verify);
  const issue = await getIssue(id);
  const current = await hydrateIssue(issue);
  const suffix = teamFlagSuffix(ctx);

  if (current.stateType.toLowerCase() === "completed") {
    if (dryRun) {
      return renderOutput([
        encode({
          dryRun: true,
          mutation: "closeIssue",
          noop: true,
          identifier: current.identifier,
        }),
      ]);
    }
    const blocks = [
      renderDetail(
        "issue",
        { ...current, message: "already completed (no-op)" },
        [
          field("identifier"),
          field("state"),
          field("stateType"),
          field("message"),
        ],
      ),
      renderHelp([
        `Run \`linear-sdk-axi issue view ${current.identifier}${suffix}\` for details`,
      ]),
    ];
    if (verify) {
      const intended = { stateType: "completed" };
      blocks.push(await verifyWrite(intended, () => readIssueState(current.id, intended)));
    }
    return renderOutput(blocks);
  }

  const team = current.teamId
    ? await resolveTeam(current.teamId)
    : await resolveTeamFromContext(ctx);
  const stateId = await completedStateId(team);
  const input = { stateId };

  return plannedOrWrite(
    dryRun,
    "closeIssue",
    { id: current.id, ...input },
    async () => {
      const updated = await updateIssue(current.id, input);
      const hydrated = await hydrateIssue(updated);
      const blocks = [
        renderDetail("issue", hydrated, [
          field("identifier"),
          field("title"),
          field("state"),
          field("stateType"),
        ]),
        renderHelp([
          `Run \`linear-sdk-axi issue view ${hydrated.identifier}${suffix}\` for details`,
        ]),
      ];
      if (verify) {
        const intended = { stateId };
        blocks.push(await verifyWrite(intended, () => readIssueState(current.id, intended)));
      }
      return renderOutput(blocks);
    },
  );
}
