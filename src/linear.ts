import { AxiError, mapLinearError, withLinearErrors } from "./errors.js";
import { getLinearClient, isUuid, type TeamContext } from "./client.js";
import {
  paginate,
  singlePage,
  type CollectionResult,
  type PaginationRequest,
} from "./pagination.js";

const STATE_TYPES = [
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
] as const;

export type StateType = (typeof STATE_TYPES)[number];

export function isStateType(value: string): value is StateType {
  return (STATE_TYPES as readonly string[]).includes(value.toLowerCase());
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

function nodesOf(conn: AnyRec | undefined): AnyRec[] {
  if (!conn) return [];
  if (Array.isArray(conn.nodes)) return conn.nodes;
  if (Array.isArray(conn)) return conn;
  return [];
}

function totalOf(conn: AnyRec | undefined, fallback: number): number {
  if (conn && typeof conn.totalCount === "number") return conn.totalCount;
  return fallback;
}

async function awaitRel<T>(value: Promise<T> | T | undefined | null): Promise<T | undefined> {
  if (value == null) return undefined;
  return await value;
}

export type HydratedIssue = {
  id: string;
  identifier: string;
  title: string;
  description: string;
  url: string;
  commentCount: number;
  state: string;
  stateType: string;
  stateId: string | undefined;
  team: string;
  teamId: string | undefined;
  teamName: string | undefined;
  assignee: string | null;
  assigneeId: string | undefined;
  assigneeEmail: string | undefined;
  projectId: string | undefined;
  projectName: string | undefined;
  cycleId: string | undefined;
  priority: number | null;
  estimate: number | null;
  dueDate: string | null;
  raw: AnyRec;
};

export async function hydrateIssue(issue: AnyRec): Promise<HydratedIssue> {
  const [state, team, assignee, project] = await Promise.all([
    awaitRel(issue.state),
    awaitRel(issue.team),
    awaitRel(issue.assignee),
    awaitRel(issue.project),
  ]);
  return {
    id: String(issue.id ?? ""),
    identifier: String(issue.identifier ?? issue.id ?? ""),
    title: String(issue.title ?? ""),
    description: typeof issue.description === "string" ? issue.description : "",
    url: typeof issue.url === "string" ? issue.url : "",
    commentCount:
      typeof issue.commentCount === "number"
        ? issue.commentCount
        : typeof issue.commentsCount === "number"
          ? issue.commentsCount
          : 0,
    state: state?.name ? String(state.name) : "unknown",
    stateType: state?.type ? String(state.type) : "unknown",
    stateId: state?.id ? String(state.id) : undefined,
    team: team?.key ? String(team.key) : team?.name ? String(team.name) : "unknown",
    teamId: team?.id ? String(team.id) : undefined,
    teamName: team?.name ? String(team.name) : undefined,
    assignee: assignee?.name
      ? String(assignee.name)
      : assignee?.displayName
        ? String(assignee.displayName)
        : assignee?.email
          ? String(assignee.email)
          : null,
    assigneeId: assignee?.id ? String(assignee.id) : undefined,
    assigneeEmail: assignee?.email ? String(assignee.email) : undefined,
    projectId: project?.id ? String(project.id) : undefined,
    projectName: project?.name ? String(project.name) : undefined,
    cycleId: issue.cycleId ? String(issue.cycleId) : undefined,
    priority: typeof issue.priority === "number" ? issue.priority : null,
    estimate: typeof issue.estimate === "number" ? issue.estimate : null,
    dueDate: typeof issue.dueDate === "string" ? issue.dueDate : null,
    raw: issue,
  };
}

export async function getViewer(): Promise<AnyRec> {
  return withLinearErrors(async () => {
    const client = getLinearClient();
    return await client.viewer;
  });
}

export async function getViewerOrganization(
  viewer: AnyRec,
): Promise<AnyRec | undefined> {
  return withLinearErrors(async () => awaitRel(viewer.organization));
}

export async function getAssignedIssues(opts?: {
  first?: number;
  filter?: AnyRec;
}): Promise<{ nodes: AnyRec[]; totalCount: number; hasNextPage: boolean }> {
  return withLinearErrors(async () => {
    const me = await getViewer();
    if (typeof me.assignedIssues !== "function") {
      return { nodes: [], totalCount: 0, hasNextPage: false };
    }
    const conn = await me.assignedIssues({
      first: opts?.first ?? 30,
      ...(opts?.filter ? { filter: opts.filter } : {}),
    });
    const nodes = nodesOf(conn);
    return {
      nodes,
      totalCount: totalOf(conn, nodes.length),
      hasNextPage: Boolean(conn?.pageInfo?.hasNextPage),
    };
  });
}

export async function listIssues(opts: {
  pagination: PaginationRequest;
  filter?: AnyRec;
}): Promise<CollectionResult<AnyRec>> {
  return withLinearErrors(async () => {
    const client = getLinearClient();
    return paginate(opts.pagination, async ({ first, after }) =>
      client.issues({
        first,
        ...(after ? { after } : {}),
        ...(opts.filter ? { filter: opts.filter } : {}),
      }));
  });
}

export async function searchIssues(
  term: string,
  opts: {
    pagination: PaginationRequest;
    teamId?: string;
    includeComments?: boolean;
  },
): Promise<CollectionResult<AnyRec>> {
  return withLinearErrors(async () => {
    const client = getLinearClient();
    return paginate(opts.pagination, async ({ first, after }) =>
      client.searchIssues(term, {
        first,
        ...(after ? { after } : {}),
        ...(opts.teamId ? { teamId: opts.teamId } : {}),
        ...(opts.includeComments ? { includeComments: true } : {}),
      }));
  });
}

export async function getIssue(id: string): Promise<AnyRec> {
  return withLinearErrors(async () => {
    const client = getLinearClient();
    try {
      const issue = await client.issue(id);
      if (issue && (issue.id || issue.identifier)) return issue;
    } catch (err) {
      const mapped = mapLinearError(err);
      if (mapped.code !== "NOT_FOUND" && mapped.code !== "UNKNOWN") throw mapped;
    }
    const conn = await client.issues({
      filter: { identifier: { eq: id } },
      first: 1,
    });
    const issue = nodesOf(conn)[0];
    if (!issue) {
      throw new AxiError(`Issue ${id} not found`, "NOT_FOUND", [
        "Run `linear-sdk-axi issue list` to see assigned issues",
      ]);
    }
    return issue;
  });
}

export async function getIssueParent(issue: AnyRec): Promise<AnyRec | undefined> {
  return withLinearErrors(async () => {
    const parent = await awaitRel(issue.parent);
    if (!parent?.id) return undefined;
    return getIssue(String(parent.id));
  });
}

export async function getIssueChildren(issue: AnyRec, first = 50): Promise<AnyRec[]> {
  return withLinearErrors(async () => {
    if (typeof issue.children !== "function") return [];
    const children = nodesOf(await issue.children({ first }));
    return Promise.all(
      children.map(async (child) =>
        child?.id ? getIssue(String(child.id)) : child,
      ),
    );
  });
}

export type HydratedIssueRelation = {
  id: string;
  type: string;
  direction: "outgoing" | "incoming";
  issue: HydratedIssue;
};

async function hydrateIssueRelations(
  conn: AnyRec | undefined,
  direction: "outgoing" | "incoming",
): Promise<HydratedIssueRelation[]> {
  return Promise.all(
    nodesOf(conn).map(async (relation) => {
      const related = await awaitRel(
        direction === "outgoing" ? relation.relatedIssue : relation.issue,
      );
      const relatedId = related?.id ??
        (direction === "outgoing" ? relation.relatedIssueId : relation.issueId);
      if (!relatedId) {
        throw new AxiError("Issue relation is missing a related issue", "UNKNOWN");
      }
      return {
        id: String(relation.id ?? ""),
        type: String(relation.type ?? "unknown").toLowerCase(),
        direction,
        issue: await hydrateIssue(await getIssue(String(relatedId))),
      };
    }),
  );
}

export async function getIssueRelations(
  issue: AnyRec,
  pagination: PaginationRequest = singlePage(50),
): Promise<CollectionResult<HydratedIssueRelation>> {
  return withLinearErrors(async () => {
    type Directional = { raw: AnyRec; direction: "outgoing" | "incoming" };
    const result = await paginate<Directional>(pagination, async ({ first, after }) => {
      const incomingPhase = after?.startsWith("incoming:") ?? false;
      const rawCursor = after
        ? after.slice(after.indexOf(":") + 1) || undefined
        : undefined;
      const outgoingArgs = { first, ...(rawCursor && !incomingPhase ? { after: rawCursor } : {}) };
      const incomingArgs = { first, ...(rawCursor && incomingPhase ? { after: rawCursor } : {}) };

      if (incomingPhase) {
        const [outgoingProbe, incoming] = await Promise.all([
          typeof issue.relations === "function" ? issue.relations({ first: 1 }) : undefined,
          typeof issue.inverseRelations === "function" ? issue.inverseRelations(incomingArgs) : undefined,
        ]);
        const incomingNodes = nodesOf(incoming);
        const cursor = incoming?.pageInfo?.endCursor;
        return {
          nodes: incomingNodes.map((raw) => ({ raw, direction: "incoming" as const })),
          totalCount: totalOf(outgoingProbe, nodesOf(outgoingProbe).length) +
            totalOf(incoming, incomingNodes.length),
          pageInfo: {
            hasNextPage: Boolean(incoming?.pageInfo?.hasNextPage),
            endCursor: cursor ? `incoming:${cursor}` : null,
          },
        };
      }

      const [outgoing, incomingProbe] = await Promise.all([
        typeof issue.relations === "function" ? issue.relations(outgoingArgs) : undefined,
        typeof issue.inverseRelations === "function" ? issue.inverseRelations({ first: 1 }) : undefined,
      ]);
      const outgoingNodes = nodesOf(outgoing);
      const incomingTotal = totalOf(incomingProbe, nodesOf(incomingProbe).length);
      const outgoingTotal = totalOf(outgoing, outgoingNodes.length);
      if (outgoing?.pageInfo?.hasNextPage) {
        const cursor = outgoing.pageInfo.endCursor;
        return {
          nodes: outgoingNodes.map((raw) => ({ raw, direction: "outgoing" as const })),
          totalCount: outgoingTotal + incomingTotal,
          pageInfo: {
            hasNextPage: true,
            endCursor: cursor ? `outgoing:${cursor}` : null,
          },
        };
      }

      const remaining = first - outgoingNodes.length;
      const incoming = remaining > 0 && typeof issue.inverseRelations === "function"
        ? await issue.inverseRelations({ first: remaining })
        : incomingProbe;
      const incomingNodes = remaining > 0 ? nodesOf(incoming) : [];
      const incomingHasNext = remaining === 0
        ? incomingTotal > 0
        : Boolean(incoming?.pageInfo?.hasNextPage);
      const incomingCursor = remaining > 0 ? incoming?.pageInfo?.endCursor : null;
      return {
        nodes: [
          ...outgoingNodes.map((raw) => ({ raw, direction: "outgoing" as const })),
          ...incomingNodes.map((raw) => ({ raw, direction: "incoming" as const })),
        ],
        totalCount: outgoingTotal + incomingTotal,
        pageInfo: {
          hasNextPage: incomingHasNext,
          endCursor: incomingHasNext || incomingNodes.length > 0
            ? `incoming:${incomingCursor ?? ""}`
            : outgoing?.pageInfo?.endCursor
              ? `outgoing:${outgoing.pageInfo.endCursor}`
              : null,
        },
      };
    });

    const hydrated = await Promise.all(result.nodes.map(async ({ raw, direction }) =>
      (await hydrateIssueRelations({ nodes: [raw] }, direction))[0]));
    return { ...result, nodes: hydrated };
  });
}

export async function getIssueComments(
  issue: AnyRec,
  pagination: PaginationRequest,
): Promise<CollectionResult<AnyRec>> {
  return withLinearErrors(async () => {
    if (typeof issue.comments !== "function") {
      const nodes = Array.isArray(issue.comments)
        ? issue.comments.slice(0, pagination.maxItems)
        : [];
      return {
        nodes,
        totalCount: Array.isArray(issue.comments) ? issue.comments.length : 0,
        pagination: {
          endCursor: null,
          hasNextPage: false,
          pagesFetched: 1,
          capped: false,
        },
      };
    }
    const result = await paginate<AnyRec>(
      pagination,
      ({ first, after }) => issue.comments({ first, ...(after ? { after } : {}) }),
    );
    const hydrated: AnyRec[] = [];
    for (const node of result.nodes) {
      const user = await awaitRel(node.user ?? node.author);
      hydrated.push({
        id: node.id,
        body: typeof node.body === "string" ? node.body : "",
        author: user?.name ?? user?.displayName ?? user?.email ?? null,
        parentId: node.parentId ?? null,
        createdAt: node.createdAt ?? null,
        resolvedAt: node.resolvedAt ?? null,
      });
    }
    return { ...result, nodes: hydrated };
  });
}

export async function listTeams(first = 50): Promise<AnyRec[]> {
  return withLinearErrors(async () => {
    const client = getLinearClient();
    const conn = await client.teams({ first });
    return nodesOf(conn);
  });
}

export type HydratedCycle = {
  id: string;
  number: number | null;
  name: string;
  description: string;
  progress: number | null;
  startsAt: string | null;
  endsAt: string | null;
  state: string;
  team: string | null;
  teamKey: string | null;
  raw: AnyRec;
};

export async function hydrateCycle(cycle: AnyRec): Promise<HydratedCycle> {
  const team = await awaitRel(cycle.team);
  const state = cycle.isActive
    ? "active"
    : cycle.isNext
      ? "next"
      : cycle.isPrevious
        ? "previous"
        : cycle.isFuture
          ? "future"
          : cycle.isPast
            ? "past"
            : "unknown";
  return {
    id: String(cycle.id ?? ""),
    number: typeof cycle.number === "number" ? cycle.number : null,
    name: typeof cycle.name === "string" ? cycle.name : "",
    description: typeof cycle.description === "string" ? cycle.description : "",
    progress: typeof cycle.progress === "number" ? cycle.progress : null,
    startsAt: typeof cycle.startsAt === "string" ? cycle.startsAt : null,
    endsAt: typeof cycle.endsAt === "string" ? cycle.endsAt : null,
    state,
    team: team?.name ? String(team.name) : team?.key ? String(team.key) : null,
    teamKey: team?.key ? String(team.key) : null,
    raw: cycle,
  };
}

export async function listCycles(opts?: {
  first?: number;
  team?: AnyRec;
}): Promise<{ nodes: AnyRec[]; totalCount: number; hasNextPage: boolean }> {
  return withLinearErrors(async () => {
    const first = opts?.first ?? 20;
    const scopedTeam =
      opts?.team && typeof opts.team.cycles !== "function" && opts.team.id
        ? await getLinearClient().team(String(opts.team.id))
        : opts?.team;
    const conn =
      scopedTeam && typeof scopedTeam.cycles === "function"
        ? await scopedTeam.cycles({ first })
        : await getLinearClient().cycles({ first });
    const nodes = nodesOf(conn);
    return {
      nodes,
      totalCount: totalOf(conn, nodes.length),
      hasNextPage: Boolean(conn?.pageInfo?.hasNextPage),
    };
  });
}

export async function getCycle(id: string): Promise<AnyRec> {
  return withLinearErrors(async () => {
    const cycle = await getLinearClient().cycle(id);
    if (!cycle?.id) {
      throw new AxiError(`Cycle ${id} not found`, "NOT_FOUND", [
        "Run `linear-sdk-axi cycle list` to see available cycles",
      ]);
    }
    return cycle;
  });
}

/** Resolve a cycle id and reject a cycle owned by a different team. */
export async function resolveCycleId(value: string, teamId?: string): Promise<string> {
  const cycle = await getCycle(value);
  const cycleTeam = await awaitRel(cycle.team);
  if (teamId && cycleTeam?.id && String(cycleTeam.id) !== teamId) {
    throw new AxiError(
      `Cycle ${value} belongs to team ${cycleTeam.key ?? cycleTeam.name ?? cycleTeam.id}, not this issue's team`,
      "VALIDATION_ERROR",
      ["Choose a cycle from `linear-sdk-axi cycle list --team <key>`"],
    );
  }
  return String(cycle.id);
}

export async function listIssueLabels(first = 250): Promise<AnyRec[]> {
  return withLinearErrors(async () => {
    const client = getLinearClient();
    const conn = await client.issueLabels({ first });
    return nodesOf(conn);
  });
}

export async function getIssueLabels(issue: AnyRec): Promise<AnyRec[]> {
  return withLinearErrors(async () => {
    if (typeof issue.labels === "function") {
      return nodesOf(await issue.labels({ first: 100 }));
    }
    if (Array.isArray(issue.labels)) return issue.labels;
    return [];
  });
}

export async function resolveLabelIds(
  values: string[],
  opts?: { teamId?: string },
): Promise<string[]> {
  if (values.length === 0) return [];
  const labels = await listIssueLabels();
  const ids: string[] = [];

  for (const value of values) {
    const wanted = value.toLowerCase();
    const byId = labels.filter((label) => String(label.id) === value);
    const byName = labels.filter(
      (label) =>
        !label.isGroup && String(label.name ?? "").toLowerCase() === wanted,
    );
    let matches = byId.length > 0 ? byId : byName;

    if (byId.length === 0 && opts?.teamId) {
      const teamScoped = matches.filter(
        (label) => String(label.teamId ?? "") === opts.teamId,
      );
      const workspaceScoped = matches.filter((label) => !label.teamId);
      matches = teamScoped.length > 0 ? teamScoped : workspaceScoped;
    }

    if (matches.length === 0) {
      throw new AxiError(`Label "${value}" not found`, "NOT_FOUND", [
        "Pass a label name or id available to this workspace/team",
      ]);
    }
    if (matches.length > 1) {
      const names = matches.map((label) => label.name ?? label.id).join(", ");
      throw new AxiError(`Ambiguous label "${value}". Matches: ${names}`, "VALIDATION_ERROR", [
        "Pass the label id instead",
      ]);
    }
    ids.push(String(matches[0].id));
  }

  return [...new Set(ids)];
}

export async function resolveTeam(
  keyOrId?: string,
): Promise<AnyRec> {
  return withLinearErrors(async () => {
    const client = getLinearClient();
    if (keyOrId && isUuid(keyOrId)) {
      try {
        const team = await client.team(keyOrId);
        if (team && team.id) return team;
      } catch (err) {
        const mapped = mapLinearError(err);
        if (mapped.code !== "NOT_FOUND" && mapped.code !== "UNKNOWN") throw mapped;
      }
    }
    const teams = await listTeams(100);
    if (keyOrId) {
      const wanted = keyOrId.toLowerCase();
      const match = teams.find(
        (t) =>
          String(t.id) === keyOrId ||
          String(t.key ?? "").toLowerCase() === wanted ||
          String(t.name ?? "").toLowerCase() === wanted,
      );
      if (!match) {
        throw new AxiError(`Team "${keyOrId}" not found`, "NOT_FOUND", [
          "Run `linear-sdk-axi team list` to see teams",
        ]);
      }
      return match;
    }
    if (teams.length === 1) return teams[0];
    if (teams.length === 0) {
      throw new AxiError("No Linear teams found", "NOT_FOUND");
    }
    throw new AxiError(
      "Multiple teams found; pass --team <key>",
      "VALIDATION_ERROR",
      [
        "Run `linear-sdk-axi team list`",
        "Retry with --team <key>",
      ],
    );
  });
}

export async function resolveTeamFromContext(
  ctx?: TeamContext,
): Promise<AnyRec> {
  return resolveTeam(ctx?.teamKey);
}

export async function getTeamStates(team: AnyRec): Promise<AnyRec[]> {
  return withLinearErrors(async () => {
    if (typeof team.states === "function") {
      const conn = await team.states();
      return nodesOf(conn);
    }
    if (Array.isArray(team.states)) return team.states;
    return [];
  });
}

export async function resolveStateId(
  team: AnyRec,
  nameOrType: string,
): Promise<string> {
  const states = await getTeamStates(team);
  const wanted = nameOrType.toLowerCase();
  const byName = states.find(
    (s) => String(s.name ?? "").toLowerCase() === wanted,
  );
  if (byName?.id) return String(byName.id);
  const byType = states
    .filter((s) => String(s.type ?? "").toLowerCase() === wanted)
    .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
  if (byType[0]?.id) return String(byType[0].id);
  const available = states
    .map((s) => `${s.name} (${s.type})`)
    .filter(Boolean)
    .join(", ");
  throw new AxiError(
    `Unknown state "${nameOrType}". Available: ${available || "none"}`,
    "VALIDATION_ERROR",
  );
}

export async function completedStateId(team: AnyRec): Promise<string> {
  const states = await getTeamStates(team);
  const completed = states.filter(
    (s) => String(s.type ?? "").toLowerCase() === "completed",
  );
  if (completed.length === 0) {
    throw new AxiError(
      "No completed-type workflow state found for this team",
      "NOT_FOUND",
      ["Run `linear-sdk-axi status --team <key>` to inspect workflow states"],
    );
  }
  const done = completed.find(
    (s) => String(s.name ?? "").toLowerCase() === "done",
  );
  return String((done ?? completed[0]).id);
}

export async function resolveAssigneeId(value: string): Promise<string> {
  return withLinearErrors(async () => {
    if (value.toLowerCase() === "me") {
      const me = await getViewer();
      if (!me.id) {
        throw new AxiError("Could not resolve viewer id", "UNKNOWN");
      }
      return String(me.id);
    }
    const client = getLinearClient();
    if (isUuid(value) && typeof client.user === "function") {
      try {
        const user = await client.user(value);
        if (user?.id) return String(user.id);
      } catch {
        // fall through — treat as id
      }
      return value;
    }
    if (isUuid(value)) return value;
    if (typeof client.users === "function") {
      const byEmail = await client.users({
        filter: { email: { eqIgnoreCase: value } },
        first: 5,
      });
      const emailMatch = nodesOf(byEmail)[0];
      if (emailMatch?.id) return String(emailMatch.id);
      const byName = await client.users({
        filter: { name: { containsIgnoreCase: value } },
        first: 5,
      });
      const nameNodes = nodesOf(byName);
      if (nameNodes.length === 1 && nameNodes[0].id) {
        return String(nameNodes[0].id);
      }
      if (nameNodes.length > 1) {
        const names = nameNodes
          .map((u) => u.name ?? u.email ?? u.id)
          .join(", ");
        throw new AxiError(
          `Ambiguous --assignee "${value}". Matches: ${names}`,
          "VALIDATION_ERROR",
          ["Pass a user id or email"],
        );
      }
    }
    throw new AxiError(
      `Could not resolve --assignee "${value}"`,
      "NOT_FOUND",
      ["Use --assignee me, an email, or a user id"],
    );
  });
}

export async function listProjects(opts: {
  pagination: PaginationRequest;
  teamId?: string;
}): Promise<CollectionResult<AnyRec>> {
  return withLinearErrors(async () => {
    const client = getLinearClient();
    const filter = opts?.teamId
      ? { accessibleTeams: { id: { eq: opts.teamId } } }
      : undefined;
    return paginate(opts.pagination, async ({ first, after }) =>
      client.projects({
        first,
        ...(after ? { after } : {}),
        ...(filter ? { filter } : {}),
      }));
  });
}

export async function getProject(idOrName: string): Promise<AnyRec> {
  return withLinearErrors(async () => {
    const client = getLinearClient();
    if (isUuid(idOrName)) {
      try {
        const project = await client.project(idOrName);
        if (project && project.id) return project;
      } catch (err) {
        const mapped = mapLinearError(err);
        if (mapped.code !== "NOT_FOUND" && mapped.code !== "UNKNOWN") throw mapped;
      }
    }
    const projects = await listProjects({
      pagination: singlePage(100),
    });
    const wanted = idOrName.toLowerCase();
    const match = projects.nodes.find(
      (p) =>
        String(p.id) === idOrName ||
        String(p.name ?? "").toLowerCase() === wanted,
    );
    if (!match) {
      throw new AxiError(`Project "${idOrName}" not found`, "NOT_FOUND", [
        "Run `linear-sdk-axi project list`",
      ]);
    }
    return match;
  });
}

export async function resolveProjectId(idOrName: string): Promise<string> {
  const project = await getProject(idOrName);
  if (!project.id) {
    throw new AxiError(`Project "${idOrName}" not found`, "NOT_FOUND");
  }
  return String(project.id);
}

export async function getProjectStatus(project: AnyRec): Promise<AnyRec | undefined> {
  return withLinearErrors(async () => awaitRel(project.status));
}

export async function listProjectStatuses(first = 50): Promise<AnyRec[]> {
  return withLinearErrors(async () => {
    const conn = await getLinearClient().projectStatuses({ first });
    return nodesOf(conn);
  });
}

export async function resolveProjectStatusId(value: string): Promise<string> {
  const statuses = await listProjectStatuses(100);
  const wanted = value.toLowerCase();
  const matches = statuses.filter(
    (status) =>
      String(status.id ?? "") === value ||
      String(status.name ?? "").toLowerCase() === wanted ||
      String(status.type ?? "").toLowerCase() === wanted,
  );
  if (matches.length === 1 && matches[0].id) return String(matches[0].id);
  if (matches.length > 1) {
    throw new AxiError(
      `Ambiguous project status "${value}". Matches: ${matches.map((status) => status.name ?? status.id).join(", ")}`,
      "VALIDATION_ERROR",
      ["Pass the project status id from `linear-sdk-axi project status list`"],
    );
  }
  throw new AxiError(`Project status "${value}" not found`, "NOT_FOUND", [
    "Run `linear-sdk-axi project status list`",
  ]);
}

export async function createProject(input: AnyRec): Promise<AnyRec> {
  return withLinearErrors(async () => {
    const payload = await getLinearClient().createProject(input);
    if (payload && payload.success === false) {
      throw new AxiError("Failed to create project", "UNKNOWN");
    }
    const project = await awaitRel(payload?.project);
    if (!project) throw new AxiError("Project create returned no project", "UNKNOWN");
    return project;
  });
}

export async function updateProject(id: string, input: AnyRec): Promise<AnyRec> {
  return withLinearErrors(async () => {
    const payload = await getLinearClient().updateProject(id, input);
    if (payload && payload.success === false) {
      throw new AxiError("Failed to update project", "UNKNOWN");
    }
    const project = await awaitRel(payload?.project);
    return project ?? (await getProject(id));
  });
}

export type HydratedProjectUpdate = {
  id: string;
  body: string;
  health: string;
  createdAt: string | null;
  updatedAt: string | null;
  author: string | null;
  url: string | null;
};

function stableDate(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : null;
}

export async function listProjectUpdates(
  project: AnyRec,
  pagination: PaginationRequest,
): Promise<CollectionResult<HydratedProjectUpdate>> {
  return withLinearErrors(async () => {
    if (typeof project.projectUpdates !== "function") {
      return {
        nodes: [],
        totalCount: 0,
        pagination: { endCursor: null, hasNextPage: false, pagesFetched: 1, capped: false },
      };
    }
    const result = await paginate<AnyRec>(pagination, ({ first, after }) =>
      project.projectUpdates({ first, ...(after ? { after } : {}) }));
    const nodes = await Promise.all(result.nodes.map(async (update) => {
      const author = await awaitRel(update.user ?? update.author);
      return {
        id: String(update.id ?? ""),
        body: typeof update.body === "string" ? update.body : "",
        health: String(update.health ?? "unknown"),
        createdAt: stableDate(update.createdAt),
        updatedAt: stableDate(update.updatedAt),
        author: author?.name ?? author?.displayName ?? author?.email ?? null,
        url: typeof update.url === "string" ? update.url : null,
      };
    }));
    return { ...result, nodes };
  });
}

export async function createProjectUpdate(input: {
  projectId: string;
  body?: string;
  health?: string;
}): Promise<AnyRec> {
  return withLinearErrors(async () => {
    const payload = await getLinearClient().createProjectUpdate(input);
    if (payload && payload.success === false) {
      throw new AxiError("Failed to create project update", "UNKNOWN");
    }
    const update = await awaitRel(payload?.projectUpdate);
    if (!update?.id) {
      throw new AxiError("Linear did not return the created project update", "UNKNOWN");
    }
    return update;
  });
}

export async function createIssue(input: AnyRec): Promise<AnyRec> {
  return withLinearErrors(async () => {
    const client = getLinearClient();
    const payload = await client.createIssue(input);
    if (payload && payload.success === false) {
      throw new AxiError("Failed to create issue", "UNKNOWN");
    }
    const issue = await awaitRel(payload?.issue);
    if (!issue) {
      throw new AxiError("Issue create returned no issue", "UNKNOWN");
    }
    return issue;
  });
}

export async function createIssueRelation(input: AnyRec): Promise<AnyRec> {
  return withLinearErrors(async () => {
    const client = getLinearClient();
    const payload = await client.createIssueRelation(input);
    if (payload && payload.success === false) {
      throw new AxiError("Failed to create issue relation", "UNKNOWN");
    }
    const relation = await awaitRel(payload?.issueRelation);
    return relation ?? input;
  });
}

export async function updateIssue(id: string, input: AnyRec): Promise<AnyRec> {
  return withLinearErrors(async () => {
    const client = getLinearClient();
    const payload = await client.updateIssue(id, input);
    if (payload && payload.success === false) {
      throw new AxiError("Failed to update issue", "UNKNOWN");
    }
    const issue = await awaitRel(payload?.issue);
    return issue ?? (await getIssue(id));
  });
}

export async function createComment(input: {
  issueId: string;
  body: string;
}): Promise<AnyRec> {
  return withLinearErrors(async () => {
    const client = getLinearClient();
    const payload = await client.createComment(input);
    if (payload && payload.success === false) {
      throw new AxiError("Failed to create comment", "UNKNOWN");
    }
    const comment = await awaitRel(payload?.comment);
    return comment ?? { body: input.body, issueId: input.issueId };
  });
}

export async function projectIssueCounts(
  project: AnyRec,
): Promise<Record<string, number>> {
  return withLinearErrors(async () => {
    if (typeof project.issues !== "function") return {};
    const conn = await project.issues({ first: 100 });
    const nodes = nodesOf(conn);
    const counts: Record<string, number> = {};
    for (const node of nodes) {
      const state = await awaitRel(node.state);
      const type = String(state?.type ?? "unknown");
      counts[type] = (counts[type] ?? 0) + 1;
    }
    return counts;
  });
}

export function emptyStateCounts(): Record<StateType, number> {
  return {
    triage: 0,
    backlog: 0,
    unstarted: 0,
    started: 0,
    completed: 0,
    canceled: 0,
  };
}

export function countByStateType(
  issues: HydratedIssue[],
): Record<string, number> {
  const counts = emptyStateCounts() as Record<string, number>;
  for (const issue of issues) {
    const type = issue.stateType.toLowerCase();
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}
