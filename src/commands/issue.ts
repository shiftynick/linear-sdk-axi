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
import {
  completedStateId,
  createComment,
  createIssue,
  createIssueRelation,
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
  type FieldDef,
} from "../toon.js";

export const ISSUE_HELP = `usage: linear-sdk-axi issue <subcommand>
subcommands[8]:
  list, search <query>, view <id>, create, update <id>, relation <list|add>, comment <id>, comment list <id>, close <id>
flags{list}:
  --team <key>, --assignee <me|userid|email|name>, --state <name|type>, --unblocked, --limit (default 30), --fields <a,b,c>
flags{search}:
  --team <key>, --limit (default 20), --comments
flags{view}:
  --full, --comments, --sub-issues
flags{create}:
  --title (required), --team (required unless only one team), --description/--body, --assignee, --state, --project, --cycle <id>, --priority <0-4>, --estimate <n>, --due-date <YYYY-MM-DD>, --parent, --label (repeatable), --dry-run
flags{update}:
  --title, --description/--body, --assignee, --state, --project, --cycle <id|none>, --priority <0-4>, --estimate <n|none>, --due-date <YYYY-MM-DD|none>, --parent <id|none>, --add-label/--remove-label (repeatable), --dry-run
flags{relation list}:
  --limit (default 50)
flags{relation add}:
  exactly one: --blocks, --blocked-by, --related, --duplicate-of; --dry-run
flags{comment}:
  --body or --body-file (required), --reply-to <comment-id>, --dry-run
flags{close}:
  --dry-run
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
  assertNoUnknownFlags(args, ["--team", "--limit", "--comments"], "issue search");
  const term = requirePositional(args, 1, "search query");
  const limit = parseLimit(getFlag(args, "--limit"), 20);
  const includeComments = hasFlag(args, "--comments");
  let teamId: string | undefined;
  if (ctx?.teamKey) {
    const team = await resolveTeamFromContext(ctx);
    teamId = team.id ? String(team.id) : undefined;
  }
  const result = await searchIssues(term, { first: limit, teamId, includeComments });
  const hydrated = await Promise.all(result.nodes.map(hydrateIssue));
  const suffix = teamFlagSuffix(ctx);
  return renderOutput([
    formatCountLine({
      count: hydrated.length,
      limit,
      ...(teamId ? {} : { totalCount: result.totalCount }),
    }),
    renderList("issues", hydrated, listSchema, "0 matching issues"),
    renderHelp([
      `Run \`linear-sdk-axi issue view <id>${suffix}\` for details`,
      `Run \`linear-sdk-axi issue search "..."${suffix}\` to refine the query`,
    ]),
  ]);
}

function buildIssueFilter(opts: {
  assigneeId?: string;
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
    ["--team", "--assignee", "--state", "--unblocked", "--limit", "--fields"],
    "issue list",
  );
  const assigneeRaw = optionalFlagArg(args, "--assignee");
  const stateRaw = optionalFlagArg(args, "--state");
  const unblocked = hasFlag(args, "--unblocked");
  const limit = parseLimit(getFlag(args, "--limit"), 30);
  const extraDefs = parseFields(getFlag(args, "--fields"));
  const hasExplicit =
    Boolean(assigneeRaw) || Boolean(stateRaw) || Boolean(ctx?.teamKey);

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

  // Default: assigned-to-me uncompleted unless --assignee/--state/--team given.
  const filter = buildIssueFilter({
    assigneeId,
    state: stateRaw,
    teamId,
    unblocked,
    defaultUncompleted: !hasExplicit,
  });

  const result = await listIssues({ first: limit, filter });
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
  if (hydrated.length === limit && result.totalCount > limit) {
    help.unshift(
      `Run \`linear-sdk-axi issue list --limit ${Math.max(limit * 2, 50)}${suffix}\` to see more`,
    );
  }
  return renderOutput([
    formatCountLine({
      count: hydrated.length,
      limit,
      totalCount: result.totalCount,
    }),
    renderList("issues", hydrated, schema, emptyLabel),
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
  const parent = await getIssueParent(issue);
  const hydratedParent = parent ? await hydrateIssue(parent) : undefined;
  const truncated = !full && wasTruncated(hydrated.description, 500);
  const description = full
    ? hydrated.description
    : truncateBody(hydrated.description, 500);
  const item: Record<string, unknown> = {
    ...hydrated,
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
    const comments = await getIssueComments(issue);
    const commentItems = comments.map((c) => ({
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
    return renderOutput([
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
    ]);
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
      "--team",
    ],
    "issue update",
  );
  const id = requirePositional(args, 1, "issue id");
  const dryRun = hasFlag(args, "--dry-run");
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
    const currentLabelIds = Array.isArray(current.raw.labelIds)
      ? current.raw.labelIds.map(String)
      : [];
    planned.addedLabelIds = addLabelIds;
    planned.removedLabelIds = removeLabelIds;
    const addedLabelIds = addLabelIds.filter((id) => !currentLabelIds.includes(id));
    const removedLabelIds = removeLabelIds.filter((id) => currentLabelIds.includes(id));
    if (addedLabelIds.length > 0) input.addedLabelIds = addedLabelIds;
    if (removedLabelIds.length > 0) input.removedLabelIds = removedLabelIds;
  }

  const suffix = teamFlagSuffix(ctx);
  const ident = current.identifier;

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
    return renderOutput([
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
    ]);
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
      return renderOutput([
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
      ]);
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
  assertNoUnknownFlags(args, ["--limit", "--team"], "issue relation list");
  const id = requirePositional(args, 2, "issue id");
  const limit = parseLimit(getFlag(args, "--limit"), 50);
  const issue = await getIssue(id);
  const source = await hydrateIssue(issue);
  const relations = await getIssueRelations(issue, limit);
  const items = relations.map((relation) => ({
    relation: relationLabel(relation.type, relation.direction),
    issue: `${relation.issue.identifier} ${relation.issue.title}`.trim(),
    state: relation.issue.state,
  }));
  const suffix = teamFlagSuffix(ctx);
  return renderOutput([
    formatCountLine({ count: items.length, limit }),
    renderList(
      "relations",
      items,
      [field("relation"), field("issue"), field("state")],
      "0 relations",
    ),
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
    ["--blocks", "--blocked-by", "--related", "--duplicate-of", "--dry-run", "--team"],
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
  const alreadyExists = relations.some(
    (relation) =>
      relation.type === option.type &&
      relation.issue.id === target.id &&
      (option.direction === "either" || relation.direction === option.direction),
  );
  const input = option.direction === "incoming"
    ? { issueId: target.id, relatedIssueId: source.id, type: option.type }
    : { issueId: source.id, relatedIssueId: target.id, type: option.type };
  const dryRun = hasFlag(args, "--dry-run");
  const suffix = teamFlagSuffix(ctx);

  if (alreadyExists) {
    return renderOutput([
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
    ]);
  }

  return plannedOrWrite(dryRun, "createIssueRelation", input, async () => {
    const created = await createIssueRelation(input);
    return renderOutput([
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
    ]);
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
    ["--body", "--body-file", "--description", "--reply-to", "--dry-run", "--team"],
    "issue comment",
  );
  const id = requirePositional(args, 1, "issue id");
  const dryRun = hasFlag(args, "--dry-run");
  const body = takeBody(args, { required: true, inlineFlags: ["--body"] });
  const replyTo = optionalFlagArg(args, "--reply-to");
  const issue = await getIssue(id);
  const hydrated = await hydrateIssue(issue);
  if (replyTo) {
    const comments = await getIssueComments(issue);
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
    return renderOutput([
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
    ]);
  });
}

async function listIssueCommentsCommand(
  args: string[],
  ctx?: TeamContext,
): Promise<string> {
  assertNoUnknownFlags(args, ["--full", "--team"], "issue comment list");
  const id = requirePositional(args, 2, "issue id");
  const full = hasFlag(args, "--full");
  const issue = await getIssue(id);
  const hydrated = await hydrateIssue(issue);
  const comments = await getIssueComments(issue);
  const items = comments.map((comment) => ({
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
  assertNoUnknownFlags(args, ["--dry-run", "--team"], "issue close");
  const id = requirePositional(args, 1, "issue id");
  const dryRun = hasFlag(args, "--dry-run");
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
    return renderOutput([
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
    ]);
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
      return renderOutput([
        renderDetail("issue", hydrated, [
          field("identifier"),
          field("title"),
          field("state"),
          field("stateType"),
        ]),
        renderHelp([
          `Run \`linear-sdk-axi issue view ${hydrated.identifier}${suffix}\` for details`,
        ]),
      ]);
    },
  );
}
