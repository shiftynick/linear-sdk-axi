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
  getIssue,
  getIssueComments,
  getIssueLabels,
  getViewer,
  hydrateIssue,
  isStateType,
  listIssues,
  resolveAssigneeId,
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

export const ISSUE_HELP = `usage: linear-axi issue <subcommand>
subcommands[6]:
  list, search <query>, view <id>, create, update <id>, comment <id>, comment list <id>, close <id>
flags{list}:
  --team <key>, --assignee <me|userid|email|name>, --state <name|type>, --limit (default 30), --fields <a,b,c>
flags{search}:
  --team <key>, --limit (default 20), --comments
flags{view}:
  --full, --comments
flags{create}:
  --title (required), --team (required unless only one team), --description/--body, --assignee, --state, --project, --label (repeatable), --dry-run
flags{update}:
  --title, --description/--body, --assignee, --state, --project, --add-label/--remove-label (repeatable), --dry-run
flags{comment}:
  --body or --body-file (required), --reply-to <comment-id>, --dry-run
flags{close}:
  --dry-run
examples:
  linear-axi issue list
  linear-axi issue list --team ENG --state started
  linear-axi issue search "login timeout" --team ENG
  linear-axi issue view ENG-123
  linear-axi issue view ENG-123 --full --comments
  linear-axi issue create --title "Fix login" --team ENG --dry-run
  linear-axi issue update ENG-123 --state Done
  linear-axi issue comment ENG-123 --body "Shipped"
  linear-axi issue comment list ENG-123
  linear-axi issue comment ENG-123 --reply-to <comment-id> --body "Reply"
  linear-axi issue close ENG-123
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
    case "comment":
      return commentIssueCommand(args, ctx);
    case "close":
      return closeIssueCommand(args, ctx);
    default:
      throw new AxiError(
        `Unknown issue subcommand: ${sub}`,
        "VALIDATION_ERROR",
        ["Run `linear-axi issue --help`"],
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
      `Run \`linear-axi issue view <id>${suffix}\` for details`,
      `Run \`linear-axi issue search "..."${suffix}\` to refine the query`,
    ]),
  ]);
}

function buildIssueFilter(opts: {
  assigneeId?: string;
  state?: string;
  teamId?: string;
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
  return filter;
}

async function listIssuesCommand(
  args: string[],
  ctx?: TeamContext,
): Promise<string> {
  assertNoUnknownFlags(
    args,
    ["--team", "--assignee", "--state", "--limit", "--fields"],
    "issue list",
  );
  const assigneeRaw = optionalFlagArg(args, "--assignee");
  const stateRaw = optionalFlagArg(args, "--state");
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
    `Run \`linear-axi issue view <id>${suffix}\` for details`,
    `Run \`linear-axi issue create --title "..."${suffix}\` to create an issue`,
  ];
  if (hydrated.length === limit && result.totalCount > limit) {
    help.unshift(
      `Run \`linear-axi issue list --limit ${Math.max(limit * 2, 50)}${suffix}\` to see more`,
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
  assertNoUnknownFlags(args, ["--full", "--comments", "--team"], "issue view");
  const id = requirePositional(args, 1, "issue id");
  const full = hasFlag(args, "--full");
  const withComments = hasFlag(args, "--comments");
  const issue = await getIssue(id);
  const hydrated = await hydrateIssue(issue);
  const truncated = !full && wasTruncated(hydrated.description, 500);
  const description = full
    ? hydrated.description
    : truncateBody(hydrated.description, 500);
  const item: Record<string, unknown> = {
    ...hydrated,
    description,
  };
  const schema: FieldDef[] = [
    field("identifier"),
    field("title"),
    field("state"),
    field("stateType"),
    field("assignee"),
    field("team"),
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
  const suffix = teamFlagSuffix(ctx);
  const help: string[] = [];
  if (truncated) {
    help.push(
      `Run \`linear-axi issue view ${hydrated.identifier} --full${suffix}\` to see complete description`,
    );
  }
  if (!withComments) {
    help.push(
      `Run \`linear-axi issue view ${hydrated.identifier} --comments${suffix}\` to include comments`,
    );
  }
  help.push(
    `Run \`linear-axi issue close ${hydrated.identifier}${suffix}\` to complete this issue`,
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
      "--label",
      "--dry-run",
    ],
    "issue create",
  );
  const title = optionalFlagArg(args, "--title");
  if (!title) {
    throw new AxiError("--title is required", "VALIDATION_ERROR", [
      'Run `linear-axi issue create --title "..." --team <key>`',
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
        ...(labelRaw.length > 0 ? [field("labels")] : []),
        field("url"),
      ]),
      renderHelp([
        `Run \`linear-axi issue view ${hydrated.identifier}${suffix}\` for details`,
        `Run \`linear-axi issue comment ${hydrated.identifier} --body "..."${suffix}\` to comment`,
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
  const addLabelRaw = repeatableFlagArgs(args, "--add-label");
  const removeLabelRaw = repeatableFlagArgs(args, "--remove-label");

  if (
    title === undefined &&
    description === undefined &&
    assigneeRaw === undefined &&
    stateRaw === undefined &&
    projectRaw === undefined &&
    addLabelRaw.length === 0 &&
    removeLabelRaw.length === 0
  ) {
    throw new AxiError(
      "issue update requires at least one of --title, --body/--description, --assignee, --state, --project",
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
        `Run \`linear-axi issue view ${ident}${suffix}\` for details`,
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
          ...(requestedLabelChanges ? [field("labels")] : []),
        ]),
        renderHelp([
          `Run \`linear-axi issue view ${hydrated.identifier}${suffix}\` for details`,
        ]),
      ]);
    },
  );
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
        [`Run \`linear-axi issue comment list ${hydrated.identifier}${teamFlagSuffix(ctx)}\` to find a reply target`],
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
        `Run \`linear-axi issue view ${hydrated.identifier}${suffix}\` for details`,
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
      `Run \`linear-axi issue comment ${hydrated.identifier} --reply-to <comment-id> --body "..."${suffix}\` to reply`,
      full
        ? `Run \`linear-axi issue view ${hydrated.identifier}${suffix}\` for the issue`
        : `Run \`linear-axi issue comment list ${hydrated.identifier} --full${suffix}\` for complete comment text`,
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
        `Run \`linear-axi issue view ${current.identifier}${suffix}\` for details`,
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
          `Run \`linear-axi issue view ${hydrated.identifier}${suffix}\` for details`,
        ]),
      ]);
    },
  );
}
