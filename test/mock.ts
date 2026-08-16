import type { LinearLike } from "../src/client.js";

export type MockState = {
  id: string;
  name: string;
  type: string;
  position: number;
};

export type MockTeam = {
  id: string;
  key: string;
  name: string;
  issueCount?: number;
  states: MockState[];
};

export type MockUser = {
  id: string;
  name: string;
  email: string;
  displayName?: string;
  organization?: MockOrganization;
};

export type MockOrganization = {
  id: string;
  name: string;
  urlKey: string;
};

export type MockComment = {
  id: string;
  body: string;
  parentId?: string;
  user?: MockUser;
  createdAt?: string;
  resolvedAt?: string;
};

export type MockProject = {
  id: string;
  name: string;
  state?: string;
  progress?: number;
  description?: string;
  url?: string;
  issueCount?: number;
  teamIds?: string[];
  priority?: number;
  startDate?: string | null;
  targetDate?: string | null;
  statusId?: string;
  projectStatus?: MockProjectStatus | null;
};

export type MockProjectStatus = {
  id: string;
  name: string;
  type: string;
};

export type MockLabel = {
  id: string;
  name: string;
  teamId?: string;
  isGroup?: boolean;
};

export type MockRelation = {
  id: string;
  issueId: string;
  relatedIssueId: string;
  type: string;
};

export type MockCycle = {
  id: string;
  name: string;
  number?: number;
  progress?: number;
  startsAt?: string;
  endsAt?: string;
  description?: string;
  isActive?: boolean;
  isFuture?: boolean;
  isPast?: boolean;
  isNext?: boolean;
  isPrevious?: boolean;
  team: MockTeam;
};

export type MockIssue = {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  url?: string;
  commentCount?: number;
  state: MockState;
  team: MockTeam;
  assignee?: MockUser | null;
  project?: MockProject | null;
  cycleId?: string | null;
  priority?: number;
  estimate?: number | null;
  dueDate?: string | null;
  parentId?: string;
  labels?: MockLabel[];
  relations?: MockRelation[];
  comments?: MockComment[];
};

export type MockOptions = {
  viewer?: MockUser;
  issues?: MockIssue[];
  teams?: MockTeam[];
  projects?: MockProject[];
  projectStatuses?: MockProjectStatus[];
  labels?: MockLabel[];
  cycles?: MockCycle[];
  users?: MockUser[];
};

const DEFAULT_STATES: MockState[] = [
  { id: "state-triage", name: "Triage", type: "triage", position: 0 },
  { id: "state-backlog", name: "Backlog", type: "backlog", position: 1 },
  { id: "state-todo", name: "Todo", type: "unstarted", position: 2 },
  { id: "state-progress", name: "In Progress", type: "started", position: 3 },
  { id: "state-done", name: "Done", type: "completed", position: 4 },
  { id: "state-canceled", name: "Canceled", type: "canceled", position: 5 },
];

export const defaultViewer: MockUser = {
  id: "user-1",
  name: "Alice",
  email: "alice@example.com",
  displayName: "Alice",
};

export const defaultTeam: MockTeam = {
  id: "team-1",
  key: "ENG",
  name: "Engineering",
  issueCount: 2,
  states: DEFAULT_STATES,
};

export function stateByType(type: string, team: MockTeam = defaultTeam): MockState {
  const found = team.states.find((s) => s.type === type);
  if (!found) throw new Error(`no state type ${type}`);
  return found;
}

export function makeIssue(
  partial: Partial<MockIssue> & Pick<MockIssue, "id" | "identifier" | "title">,
): MockIssue {
  return {
    state: stateByType("started"),
    team: defaultTeam,
    assignee: defaultViewer,
    description: "",
    url: `https://linear.app/issue/${partial.identifier}`,
    commentCount: 0,
    labels: [],
    comments: [],
    ...partial,
  };
}

function wrapTeam(team: MockTeam) {
  return {
    ...team,
    states: async () => ({
      nodes: team.states,
      totalCount: team.states.length,
    }),
  };
}

function wrapIssue(
  issue: MockIssue,
  issues: MockIssue[] = [],
  relations: MockRelation[] = [],
) {
  const parent = issue.parentId
    ? issues.find((candidate) => candidate.id === issue.parentId) ?? null
    : null;
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? "",
    url: issue.url,
    commentCount: issue.commentCount ?? issue.comments?.length ?? 0,
    labelIds: issue.labels?.map((label) => label.id) ?? [],
    parentId: issue.parentId,
    cycleId: issue.cycleId,
    priority: issue.priority ?? 0,
    estimate: issue.estimate ?? null,
    dueDate: issue.dueDate ?? null,
    state: Promise.resolve(issue.state),
    team: Promise.resolve(wrapTeam(issue.team)),
    assignee: Promise.resolve(issue.assignee ?? null),
    project: Promise.resolve(issue.project ?? null),
    parent: Promise.resolve(parent ? wrapIssue(parent, issues, relations) : null),
    children: async () => connection(
      issues
        .filter((candidate) => candidate.parentId === issue.id)
        .map((child) => wrapIssue(child, issues, relations)),
    ),
    comments: async () => ({
      nodes: (issue.comments ?? []).map((c) => ({
        ...c,
        user: Promise.resolve(c.user ?? null),
      })),
      totalCount: issue.comments?.length ?? 0,
    }),
    labels: async () => connection(issue.labels ?? []),
    relations: async () => connection(
      relations
        .filter((relation) => relation.issueId === issue.id)
        .map((relation) => wrapRelation(relation, issues, relations)),
    ),
    inverseRelations: async () => connection(
      relations
        .filter((relation) => relation.relatedIssueId === issue.id)
        .map((relation) => wrapRelation(relation, issues, relations)),
    ),
  };
}

function wrapRelation(
  relation: MockRelation,
  issues: MockIssue[],
  relations: MockRelation[],
) {
  const source = issues.find((issue) => issue.id === relation.issueId);
  const related = issues.find((issue) => issue.id === relation.relatedIssueId);
  return {
    ...relation,
    issue: Promise.resolve(source ? wrapIssue(source, issues, relations) : null),
    relatedIssue: Promise.resolve(related ? wrapIssue(related, issues, relations) : null),
  };
}

function wrapProject(
  project: MockProject,
  issues: MockIssue[],
  relations: MockRelation[] = [],
) {
  const related = issues.filter((i) => i.project?.id === project.id);
  return {
    ...project,
    status: Promise.resolve(project.projectStatus ?? null),
    issues: async () => ({
      nodes: related.map((issue) => wrapIssue(issue, issues, relations)),
      totalCount: related.length,
    }),
  };
}

function wrapCycle(cycle: MockCycle) {
  return {
    ...cycle,
    team: Promise.resolve(wrapTeam(cycle.team)),
  };
}

function connection<T>(nodes: T[], totalCount?: number) {
  return {
    nodes,
    totalCount: totalCount ?? nodes.length,
    pageInfo: { hasNextPage: false, endCursor: null },
  };
}

export type MockSpies = {
  createProject: ReturnType<typeof createSpy>;
  updateProject: ReturnType<typeof createSpy>;
  createIssue: ReturnType<typeof createSpy>;
  updateIssue: ReturnType<typeof createSpy>;
  createIssueRelation: ReturnType<typeof createSpy>;
  createComment: ReturnType<typeof createSpy>;
};

function createSpy() {
  const calls: unknown[][] = [];
  const fn = async (...args: unknown[]) => {
    calls.push(args);
    return fn.impl(...args);
  };
  fn.calls = calls;
  fn.impl = async (..._args: unknown[]) => ({ success: true });
  fn.mockImplementation = (impl: (...args: unknown[]) => Promise<unknown>) => {
    fn.impl = impl;
  };
  return fn;
}

export function createMockLinear(options: MockOptions = {}): {
  client: LinearLike;
  spies: MockSpies;
  issues: MockIssue[];
  relations: MockRelation[];
} {
  const viewer = options.viewer ?? defaultViewer;
  const teams = options.teams ?? [defaultTeam];
  const issues = [...(options.issues ?? [])];
  const projects = options.projects ?? [];
  const projectStatuses = options.projectStatuses ?? [
    { id: "project-status-planned", name: "Planned", type: "planned" },
    { id: "project-status-started", name: "In Progress", type: "started" },
    { id: "project-status-completed", name: "Completed", type: "completed" },
  ];
  const labels = options.labels ?? [];
  const relations = [...(options.relations ?? [])];
  const cycles = options.cycles ?? [];
  const users = options.users ?? [viewer];

  const spies: MockSpies = {
    createProject: createSpy(),
    updateProject: createSpy(),
    createIssue: createSpy(),
    updateIssue: createSpy(),
    createIssueRelation: createSpy(),
    createComment: createSpy(),
  };

  spies.createProject.mockImplementation(async (input: unknown) => {
    const rec = input as Record<string, unknown>;
    const created: MockProject = {
      id: `project-${projects.length + 1}`,
      name: String(rec.name ?? ""),
      state: "planned",
      description: typeof rec.description === "string" ? rec.description : "",
      priority: typeof rec.priority === "number" ? rec.priority : 0,
      startDate: typeof rec.startDate === "string" ? rec.startDate : null,
      targetDate: typeof rec.targetDate === "string" ? rec.targetDate : null,
      teamIds: Array.isArray(rec.teamIds) ? rec.teamIds.map(String) : [],
      statusId: typeof rec.statusId === "string" ? rec.statusId : projectStatuses[0]?.id,
      projectStatus: projectStatuses.find((status) => status.id === rec.statusId) ?? projectStatuses[0] ?? null,
      url: `https://linear.app/project/project-${projects.length + 1}`,
    };
    projects.push(created);
    return { success: true, project: wrapProject(created, issues, relations) };
  });

  spies.updateProject.mockImplementation(async (id: unknown, input: unknown) => {
    const rec = input as Record<string, unknown>;
    const found = projects.find((project) => project.id === id || project.name === id);
    if (!found) return { success: false };
    if (typeof rec.name === "string") found.name = rec.name;
    if (typeof rec.description === "string") found.description = rec.description;
    if (typeof rec.priority === "number") found.priority = rec.priority;
    if (typeof rec.statusId === "string") {
      found.statusId = rec.statusId;
      found.projectStatus = projectStatuses.find((status) => status.id === rec.statusId) ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(rec, "startDate")) {
      found.startDate = typeof rec.startDate === "string" ? rec.startDate : null;
    }
    if (Object.prototype.hasOwnProperty.call(rec, "targetDate")) {
      found.targetDate = typeof rec.targetDate === "string" ? rec.targetDate : null;
    }
    return { success: true, project: wrapProject(found, issues, relations) };
  });

  spies.createIssue.mockImplementation(async (input: unknown) => {
    const rec = input as Record<string, unknown>;
    const team =
      teams.find((t) => t.id === rec.teamId) ?? teams[0] ?? defaultTeam;
    const state =
      team.states.find((s) => s.id === rec.stateId) ?? stateByType("unstarted", team);
    const assignee =
      users.find((u) => u.id === rec.assigneeId) ??
      (rec.assigneeId ? { id: String(rec.assigneeId), name: "User", email: "" } : viewer);
    const issueLabels = Array.isArray(rec.labelIds)
      ? labels.filter((label) => rec.labelIds.includes(label.id))
      : [];
    const created = makeIssue({
      id: `issue-${issues.length + 1}`,
      identifier: `${team.key}-${100 + issues.length}`,
      title: String(rec.title ?? ""),
      description: typeof rec.description === "string" ? rec.description : "",
      state,
      team,
      assignee,
      labels: issueLabels,
      parentId: typeof rec.parentId === "string" ? rec.parentId : undefined,
      cycleId: typeof rec.cycleId === "string" ? rec.cycleId : undefined,
      priority: typeof rec.priority === "number" ? rec.priority : 0,
      estimate: typeof rec.estimate === "number" ? rec.estimate : null,
      dueDate: typeof rec.dueDate === "string" ? rec.dueDate : null,
    });
    issues.push(created);
    return { success: true, issue: wrapIssue(created, issues, relations) };
  });

  spies.updateIssue.mockImplementation(async (id: unknown, input: unknown) => {
    const rec = input as Record<string, unknown>;
    const found = issues.find((i) => i.id === id || i.identifier === id);
    if (!found) return { success: false };
    if (typeof rec.title === "string") found.title = rec.title;
    if (typeof rec.description === "string") found.description = rec.description;
    if (typeof rec.stateId === "string") {
      const st = found.team.states.find((s) => s.id === rec.stateId);
      if (st) found.state = st;
    }
    if (typeof rec.assigneeId === "string") {
      found.assignee = users.find((u) => u.id === rec.assigneeId) ?? found.assignee;
    }
    if (Object.prototype.hasOwnProperty.call(rec, "cycleId")) {
      found.cycleId = typeof rec.cycleId === "string" ? rec.cycleId : null;
    }
    if (typeof rec.priority === "number") found.priority = rec.priority;
    if (Object.prototype.hasOwnProperty.call(rec, "estimate")) {
      found.estimate = typeof rec.estimate === "number" ? rec.estimate : null;
    }
    if (Object.prototype.hasOwnProperty.call(rec, "dueDate")) {
      found.dueDate = typeof rec.dueDate === "string" ? rec.dueDate : null;
    }
    if (Object.prototype.hasOwnProperty.call(rec, "parentId")) {
      found.parentId = typeof rec.parentId === "string" ? rec.parentId : undefined;
    }
    if (Array.isArray(rec.labelIds)) {
      found.labels = labels.filter((label) => rec.labelIds.includes(label.id));
    }
    if (Array.isArray(rec.addedLabelIds)) {
      const existing = found.labels ?? [];
      const additions = labels.filter(
        (label) => rec.addedLabelIds.includes(label.id) && !existing.some((item) => item.id === label.id),
      );
      found.labels = [...existing, ...additions];
    }
    if (Array.isArray(rec.removedLabelIds)) {
      found.labels = (found.labels ?? []).filter(
        (label) => !rec.removedLabelIds.includes(label.id),
      );
    }
    return { success: true, issue: wrapIssue(found, issues, relations) };
  });

  spies.createIssueRelation.mockImplementation(async (input: unknown) => {
    const rec = input as Record<string, unknown>;
    const issueId = String(rec.issueId ?? "");
    const relatedIssueId = String(rec.relatedIssueId ?? "");
    if (!issues.some((issue) => issue.id === issueId) || !issues.some((issue) => issue.id === relatedIssueId)) {
      return { success: false };
    }
    const relation: MockRelation = {
      id: `relation-${relations.length + 1}`,
      issueId,
      relatedIssueId,
      type: String(rec.type ?? "related"),
    };
    relations.push(relation);
    return {
      success: true,
      issueRelation: wrapRelation(relation, issues, relations),
    };
  });

  spies.createComment.mockImplementation(async (input: unknown) => {
    const rec = input as Record<string, unknown>;
    const found = issues.find((i) => i.id === rec.issueId);
    const comment: MockComment = {
      id: `comment-${Date.now()}`,
      body: String(rec.body ?? ""),
      parentId: typeof rec.parentId === "string" ? rec.parentId : undefined,
      user: viewer,
    };
    if (found) {
      found.comments = [...(found.comments ?? []), comment];
      found.commentCount = found.comments.length;
    }
    return { success: true, comment };
  });

  const client: LinearLike = {
    viewer: Promise.resolve({
      ...viewer,
      assignedIssues: async (opts?: { first?: number; filter?: Record<string, unknown> }) => {
        let assigned = issues.filter((i) => i.assignee?.id === viewer.id);
        assigned = applyIssueFilter(assigned, opts?.filter, relations);
        const first = opts?.first ?? 30;
        return connection(assigned.slice(0, first).map((issue) => wrapIssue(issue, issues, relations)), assigned.length);
      },
    }),
    issues: async (opts?: { first?: number; filter?: Record<string, unknown> }) => {
      let filtered = applyIssueFilter(issues, opts?.filter, relations);
      const first = opts?.first ?? 30;
      return connection(filtered.slice(0, first).map((issue) => wrapIssue(issue, issues, relations)), filtered.length);
    },
    searchIssues: async (
      term: string,
      opts?: { first?: number; teamId?: string; includeComments?: boolean },
    ) => {
      const query = term.toLowerCase();
      let matched = issues.filter((issue) => {
        const content = [
          issue.identifier,
          issue.title,
          issue.description ?? "",
          ...(opts?.includeComments ? (issue.comments ?? []).map((comment) => comment.body) : []),
        ]
          .join("\n")
          .toLowerCase();
        return content.includes(query);
      });
      if (opts?.teamId) matched = matched.filter((issue) => issue.team.id === opts.teamId);
      const first = opts?.first ?? 20;
      return connection(matched.slice(0, first).map((issue) => wrapIssue(issue, issues, relations)), matched.length);
    },
    issue: async (id: string) => {
      const found = issues.find((i) => i.id === id || i.identifier === id);
      if (!found) {
        const err = new Error(`Issue not found: ${id}`) as Error & { status: number };
        err.status = 404;
        throw err;
      }
      return wrapIssue(found, issues, relations);
    },
    teams: async () => connection(teams.map(wrapTeam)),
    issueLabels: async (opts?: { first?: number }) => {
      const first = opts?.first ?? 250;
      return connection(labels.slice(0, first), labels.length);
    },
    team: async (id: string) => {
      const found = teams.find((t) => t.id === id || t.key === id);
      if (!found) {
        const err = new Error(`Team not found: ${id}`) as Error & { status: number };
        err.status = 404;
        throw err;
      }
      return {
        ...wrapTeam(found),
        cycles: async (opts?: { first?: number }) => {
          const first = opts?.first ?? 20;
          const matching = cycles.filter((cycle) => cycle.team.id === found.id);
          return connection(matching.slice(0, first).map(wrapCycle), matching.length);
        },
      };
    },
    cycles: async (opts?: { first?: number }) => {
      const first = opts?.first ?? 20;
      return connection(cycles.slice(0, first).map(wrapCycle), cycles.length);
    },
    cycle: async (id: string) => {
      const found = cycles.find((cycle) => cycle.id === id);
      if (!found) {
        const err = new Error(`Cycle not found: ${id}`) as Error & { status: number };
        err.status = 404;
        throw err;
      }
      return wrapCycle(found);
    },
    projects: async (opts?: { first?: number; filter?: Record<string, unknown> }) => {
      const first = opts?.first ?? 30;
      const teamId = (
        opts?.filter as { accessibleTeams?: { id?: { eq?: string } } } | undefined
      )?.accessibleTeams?.id?.eq;
      const matching = teamId
        ? projects.filter((project) => project.teamIds?.includes(teamId))
        : projects;
      return connection(
        matching.slice(0, first).map((p) => wrapProject(p, issues, relations)),
        matching.length,
      );
    },
    project: async (id: string) => {
      const found = projects.find((p) => p.id === id || p.name === id);
      if (!found) {
        const err = new Error(`Project not found: ${id}`) as Error & { status: number };
        err.status = 404;
        throw err;
      }
      return wrapProject(found, issues, relations);
    },
    projectStatuses: async (opts?: { first?: number }) => {
      const first = opts?.first ?? 50;
      return connection(projectStatuses.slice(0, first), projectStatuses.length);
    },
    createProject: spies.createProject as LinearLike["createProject"],
    updateProject: spies.updateProject as LinearLike["updateProject"],
    createIssue: spies.createIssue as LinearLike["createIssue"],
    updateIssue: spies.updateIssue as LinearLike["updateIssue"],
    createIssueRelation: spies.createIssueRelation as LinearLike["createIssueRelation"],
    createComment: spies.createComment as LinearLike["createComment"],
    users: async (opts?: { first?: number; filter?: Record<string, unknown> }) => {
      let filtered = users;
      const emailEq =
        (opts?.filter as { email?: { eqIgnoreCase?: string } } | undefined)?.email
          ?.eqIgnoreCase;
      if (emailEq) {
        filtered = users.filter(
          (u) => u.email.toLowerCase() === emailEq.toLowerCase(),
        );
      }
      const nameContains =
        (opts?.filter as { name?: { containsIgnoreCase?: string } } | undefined)?.name
          ?.containsIgnoreCase;
      if (nameContains) {
        filtered = users.filter((u) =>
          u.name.toLowerCase().includes(nameContains.toLowerCase()),
        );
      }
      return connection(filtered);
    },
    user: async (id: string) => users.find((u) => u.id === id) ?? null,
  };

  return { client, spies, issues, relations };
}

function applyIssueFilter(
  issues: MockIssue[],
  filter?: Record<string, unknown>,
  relations: MockRelation[] = [],
): MockIssue[] {
  if (!filter) return issues;
  return issues.filter((issue) => {
    const assignee = filter.assignee as { id?: { eq?: string } } | undefined;
    if (assignee?.id?.eq && issue.assignee?.id !== assignee.id.eq) return false;
    const team = filter.team as { id?: { eq?: string }; key?: { eq?: string } } | undefined;
    if (team?.id?.eq && issue.team.id !== team.id.eq) return false;
    if (team?.key?.eq && issue.team.key !== team.key.eq) return false;
    const identifier = filter.identifier as { eq?: string } | undefined;
    if (identifier?.eq && issue.identifier !== identifier.eq) return false;
    const state = filter.state as
      | { type?: { eq?: string; nin?: string[] }; name?: { eqIgnoreCase?: string } }
      | undefined;
    if (state?.type?.eq && issue.state.type !== state.type.eq) return false;
    if (state?.type?.nin && state.type.nin.includes(issue.state.type)) return false;
    if (
      state?.name?.eqIgnoreCase &&
      issue.state.name.toLowerCase() !== state.name.eqIgnoreCase.toLowerCase()
    ) {
      return false;
    }
    const hasBlockedByRelations = filter.hasBlockedByRelations as
      | { eq?: boolean; neq?: boolean }
      | undefined;
    if (hasBlockedByRelations) {
      const isBlocked = relations.some(
        (relation) =>
          relation.type === "blocks" && relation.relatedIssueId === issue.id,
      );
      if (hasBlockedByRelations.eq !== undefined && isBlocked !== hasBlockedByRelations.eq) {
        return false;
      }
      if (hasBlockedByRelations.neq !== undefined && isBlocked === hasBlockedByRelations.neq) {
        return false;
      }
    }
    return true;
  });
}
