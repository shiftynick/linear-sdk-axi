import { AxiError, mapLinearError, withLinearErrors } from "./errors.js";
import { getLinearClient, isUuid, type TeamContext } from "./client.js";

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
  first?: number;
  filter?: AnyRec;
}): Promise<{ nodes: AnyRec[]; totalCount: number; hasNextPage: boolean }> {
  return withLinearErrors(async () => {
    const client = getLinearClient();
    const conn = await client.issues({
      first: opts.first ?? 30,
      ...(opts.filter ? { filter: opts.filter } : {}),
    });
    const nodes = nodesOf(conn);
    return {
      nodes,
      totalCount: totalOf(conn, nodes.length),
      hasNextPage: Boolean(conn?.pageInfo?.hasNextPage),
    };
  });
}

export async function searchIssues(
  term: string,
  opts?: { first?: number; teamId?: string; includeComments?: boolean },
): Promise<{ nodes: AnyRec[]; totalCount: number; hasNextPage: boolean }> {
  return withLinearErrors(async () => {
    const client = getLinearClient();
    const result = await client.searchIssues(term, {
      first: opts?.first ?? 20,
      ...(opts?.teamId ? { teamId: opts.teamId } : {}),
      ...(opts?.includeComments ? { includeComments: true } : {}),
    });
    const nodes = nodesOf(result);
    return {
      nodes,
      totalCount: totalOf(result, nodes.length),
      hasNextPage: Boolean(result?.pageInfo?.hasNextPage),
    };
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
        "Run `linear-axi issue list` to see assigned issues",
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
  first = 50,
): Promise<HydratedIssueRelation[]> {
  return withLinearErrors(async () => {
    const [outgoing, incoming] = await Promise.all([
      typeof issue.relations === "function"
        ? issue.relations({ first })
        : undefined,
      typeof issue.inverseRelations === "function"
        ? issue.inverseRelations({ first })
        : undefined,
    ]);
    const [direct, inverse] = await Promise.all([
      hydrateIssueRelations(outgoing, "outgoing"),
      hydrateIssueRelations(incoming, "incoming"),
    ]);
    return [...direct, ...inverse];
  });
}

export async function getIssueComments(
  issue: AnyRec,
  first = 50,
): Promise<AnyRec[]> {
  return withLinearErrors(async () => {
    if (typeof issue.comments !== "function") {
      if (Array.isArray(issue.comments)) return issue.comments;
      return [];
    }
    const conn = await issue.comments({ first });
    const nodes = nodesOf(conn);
    const hydrated: AnyRec[] = [];
    for (const node of nodes) {
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
    return hydrated;
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
        "Run `linear-axi cycle list` to see available cycles",
      ]);
    }
    return cycle;
  });
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
          "Run `linear-axi team list` to see teams",
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
        "Run `linear-axi team list`",
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
      ["Run `linear-axi status --team <key>` to inspect workflow states"],
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

export async function listProjects(opts?: {
  first?: number;
  teamId?: string;
}): Promise<AnyRec[]> {
  return withLinearErrors(async () => {
    const client = getLinearClient();
    const filter = opts?.teamId
      ? { accessibleTeams: { id: { eq: opts.teamId } } }
      : undefined;
    const conn = await client.projects({
      first: opts?.first ?? 30,
      ...(filter ? { filter } : {}),
    });
    return nodesOf(conn);
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
    const projects = await listProjects({ first: 100 });
    const wanted = idOrName.toLowerCase();
    const match = projects.find(
      (p) =>
        String(p.id) === idOrName ||
        String(p.name ?? "").toLowerCase() === wanted,
    );
    if (!match) {
      throw new AxiError(`Project "${idOrName}" not found`, "NOT_FOUND", [
        "Run `linear-axi project list`",
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
