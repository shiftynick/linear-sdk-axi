import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLinearClientForTests } from "../src/client.js";
import { main } from "../src/cli.js";
import {
  createMockLinear,
  defaultTeam,
  defaultViewer,
  makeIssue,
  stateByType,
} from "./mock.js";

function capture() {
  const chunks: string[] = [];
  return {
    stdout: {
      write: (chunk: string) => {
        chunks.push(chunk);
        return true;
      },
    },
    text: () => chunks.join(""),
  };
}

async function run(argv: string[]): Promise<{ out: string; exit: number }> {
  process.exitCode = undefined;
  const cap = capture();
  await main({ argv, stdout: cap.stdout });
  return { out: cap.text(), exit: process.exitCode ?? 0 };
}

beforeEach(() => {
  process.exitCode = undefined;
});

afterEach(() => {
  setLinearClientForTests(undefined);
  process.exitCode = undefined;
});

describe("issue list", () => {
  it("non-empty list includes count line and 3-4 default fields", async () => {
    const { client } = createMockLinear({
      issues: [
        makeIssue({
          id: "i1",
          identifier: "ENG-10",
          title: "Ship CLI",
          state: stateByType("started"),
        }),
        makeIssue({
          id: "i2",
          identifier: "ENG-11",
          title: "Write docs",
          state: stateByType("completed"),
        }),
      ],
    });
    setLinearClientForTests(client);
    const { out, exit } = await run(["issue", "list"]);
    expect(exit).toBe(0);
    expect(out).toMatch(/count:/);
    expect(out).toContain("ENG-10");
    expect(out).toContain("Ship CLI");
    expect(out).toContain("In Progress");
    expect(out).toContain("ENG");
    // default is uncompleted assigned — completed issue excluded
    expect(out).not.toContain("ENG-11");
  });

  it("empty list is explicit 0", async () => {
    const { client } = createMockLinear({ issues: [] });
    setLinearClientForTests(client);
    const { out, exit } = await run(["issue", "list"]);
    expect(exit).toBe(0);
    expect(out).toMatch(/0 assigned uncompleted issues|0 matching issues|0 issues/);
    expect(out).not.toMatch(/issues\[0\]/);
  });

  it("rejects empty --limit, --fields, and --team values before calling Linear", async () => {
    const { client } = createMockLinear();
    setLinearClientForTests(client);

    for (const argv of [
      ["issue", "list", "--limit"],
      ["issue", "list", "--fields="],
      ["issue", "list", "--team"],
    ]) {
      const { out, exit } = await run(argv);
      expect(exit).toBe(2);
      expect(out).toContain("VALIDATION_ERROR");
    }
  });

  it("filters the default assigned, open list to unblocked issues", async () => {
    const blocker = makeIssue({
      id: "i1",
      identifier: "ENG-20",
      title: "Resolve API contract",
    });
    const blocked = makeIssue({
      id: "i2",
      identifier: "ENG-21",
      title: "Ship dependent client",
    });
    const { client } = createMockLinear({
      issues: [blocker, blocked],
      relations: [
        { id: "r1", issueId: blocker.id, relatedIssueId: blocked.id, type: "blocks" },
      ],
    });
    setLinearClientForTests(client);

    const { out, exit } = await run(["issue", "list", "--unblocked"]);
    expect(exit).toBe(0);
    expect(out).toContain("ENG-20");
    expect(out).not.toContain("ENG-21");
  });
});

describe("issue search", () => {
  it("finds matching issue content and honors a team scope", async () => {
    const productTeam = {
      ...defaultTeam,
      id: "team-2",
      key: "PROD",
      name: "Product",
    };
    const { client } = createMockLinear({
      teams: [defaultTeam, productTeam],
      issues: [
        makeIssue({
          id: "i1",
          identifier: "ENG-12",
          title: "Fix OAuth timeout",
          description: "Token exchange exceeds the configured timeout.",
        }),
        makeIssue({
          id: "i2",
          identifier: "PROD-12",
          title: "Fix OAuth timeout in signup",
          team: productTeam,
        }),
      ],
    });
    setLinearClientForTests(client);

    const all = await run(["issue", "search", "OAuth timeout"]);
    expect(all.exit).toBe(0);
    expect(all.out).toContain("ENG-12");
    expect(all.out).toContain("PROD-12");

    const scoped = await run([
      "issue",
      "search",
      "OAuth timeout",
      "--team",
      "ENG",
    ]);
    expect(scoped.exit).toBe(0);
    expect(scoped.out).toContain("ENG-12");
    expect(scoped.out).not.toContain("PROD-12");
  });

  it("includes comment text only when requested", async () => {
    const { client } = createMockLinear({
      issues: [
        makeIssue({
          id: "i1",
          identifier: "ENG-13",
          title: "Investigate notifications",
          comments: [{ id: "c1", body: "The retry queue is stuck" }],
        }),
      ],
    });
    setLinearClientForTests(client);

    const withoutComments = await run(["issue", "search", "retry queue"]);
    expect(withoutComments.exit).toBe(0);
    expect(withoutComments.out).toContain("0 matching issues");

    const withComments = await run([
      "issue",
      "search",
      "retry queue",
      "--comments",
    ]);
    expect(withComments.exit).toBe(0);
    expect(withComments.out).toContain("ENG-13");
  });
});

describe("issue view", () => {
  it("truncates a long description and --full does not", async () => {
    const long = "Lorem ipsum " + "x".repeat(900);
    const { client } = createMockLinear({
      issues: [
        makeIssue({
          id: "i1",
          identifier: "ENG-42",
          title: "Long body",
          description: long,
          commentCount: 3,
        }),
      ],
    });
    setLinearClientForTests(client);

    const truncated = await run(["issue", "view", "ENG-42"]);
    expect(truncated.exit).toBe(0);
    expect(truncated.out).toContain("truncated");
    expect(truncated.out).toContain(`${long.length} chars total`);
    expect(truncated.out).toContain("--full");
    expect(truncated.out).toContain("ENG-42");
    expect(truncated.out).toContain("commentCount");

    const full = await run(["issue", "view", "ENG-42", "--full"]);
    expect(full.exit).toBe(0);
    expect(full.out).not.toContain("truncated");
    expect(full.out).toContain(long.slice(-20));
  });

  it("uses the fetched comment count when --comments is present", async () => {
    const { client } = createMockLinear({
      issues: [makeIssue({
        id: "i-comments",
        identifier: "ENG-43",
        title: "Comment metadata",
        commentCount: 0,
        comments: [
          { id: "c1", body: "First" },
          { id: "c2", body: "Second" },
        ],
      })],
    });
    setLinearClientForTests(client);

    const { out, exit } = await run(["issue", "view", "ENG-43", "--comments"]);

    expect(exit).toBe(0);
    expect(out).toContain("commentCount: 2");
    expect(out).toContain("First");
    expect(out).toContain("Second");
  });
});

describe("issue create", () => {
  it("requires --title", async () => {
    const { client, spies } = createMockLinear();
    setLinearClientForTests(client);
    const { out, exit } = await run(["issue", "create", "--team", "ENG"]);
    expect(exit).toBe(2);
    expect(out).toContain("VALIDATION_ERROR");
    expect(out).toContain("--title");
    expect(spies.createIssue.calls.length).toBe(0);
  });

  it("--dry-run does not call createIssue", async () => {
    const { client, spies } = createMockLinear();
    setLinearClientForTests(client);
    const { out, exit } = await run([
      "issue",
      "create",
      "--title",
      "New issue",
      "--team",
      "ENG",
      "--dry-run",
    ]);
    expect(exit).toBe(0);
    expect(spies.createIssue.calls.length).toBe(0);
    expect(out).toContain("dryRun");
    expect(out).toContain("createIssue");
    expect(out).toContain("New issue");
  });

  it("resolves repeated labels and includes them in the created issue", async () => {
    const labels = [
      { id: "label-bug", name: "Bug", teamId: defaultTeam.id },
      { id: "label-platform", name: "Platform" },
    ];
    const { client, spies, issues } = createMockLinear({ labels });
    setLinearClientForTests(client);

    const { out, exit } = await run([
      "issue",
      "create",
      "--title",
      "Label me",
      "--team",
      "ENG",
      "--label",
      "bug",
      "--label=Platform",
    ]);

    expect(exit).toBe(0);
    expect(spies.createIssue.calls).toHaveLength(1);
    expect(spies.createIssue.calls[0][0]).toMatchObject({
      labelIds: ["label-bug", "label-platform"],
    });
    expect(issues[0].labels?.map((label) => label.name)).toEqual([
      "Bug",
      "Platform",
    ]);
    expect(out).toMatch(/labels:.*Bug.*Platform/);
  });

  it("resolves an assignee by email before creating", async () => {
    const bob = { id: "user-2", name: "Bob Smith", email: "bob@example.com" };
    const { client, spies } = createMockLinear({ users: [defaultViewer, bob] });
    setLinearClientForTests(client);

    const { exit } = await run([
      "issue",
      "create",
      "--title",
      "Assign by email",
      "--team",
      "ENG",
      "--assignee",
      "bob@example.com",
    ]);

    expect(exit).toBe(0);
    expect(spies.createIssue.calls[0][0]).toMatchObject({ assigneeId: bob.id });
  });

  it("plans cycle, priority, estimate, and due date with strict values", async () => {
    const cycle = {
      id: "cycle-eng-1",
      name: "Reliability",
      team: defaultTeam,
    };
    const { client, spies } = createMockLinear({ cycles: [cycle] });
    setLinearClientForTests(client);

    const { out, exit } = await run([
      "issue",
      "create",
      "--title",
      "Scheduled issue",
      "--team",
      "ENG",
      "--cycle",
      cycle.id,
      "--priority",
      "2",
      "--estimate",
      "3",
      "--due-date",
      "2026-09-01",
      "--dry-run",
    ]);

    expect(exit).toBe(0);
    expect(spies.createIssue.calls).toHaveLength(0);
    expect(out).toContain("cycleId: cycle-eng-1");
    expect(out).toContain("priority: 2");
    expect(out).toContain("estimate: 3");
    expect(out).toContain("dueDate: 2026-09-01");
  });

  it("rejects an invalid due date and priority before writing", async () => {
    const { client, spies } = createMockLinear();
    setLinearClientForTests(client);

    const invalidPriority = await run([
      "issue",
      "create",
      "--title",
      "Bad priority",
      "--team",
      "ENG",
      "--priority",
      "5",
    ]);
    const invalidDate = await run([
      "issue",
      "create",
      "--title",
      "Bad date",
      "--team",
      "ENG",
      "--due-date",
      "2026-02-30",
    ]);

    expect(invalidPriority.exit).toBe(2);
    expect(invalidPriority.out).toContain("--priority");
    expect(invalidDate.exit).toBe(2);
    expect(invalidDate.out).toContain("valid calendar date");
    expect(spies.createIssue.calls).toHaveLength(0);
  });
});

describe("issue close", () => {
  it("already-completed is a no-op exit 0", async () => {
    const { client, spies } = createMockLinear({
      issues: [
        makeIssue({
          id: "i1",
          identifier: "ENG-9",
          title: "Done already",
          state: stateByType("completed"),
        }),
      ],
    });
    setLinearClientForTests(client);
    const { out, exit } = await run(["issue", "close", "ENG-9"]);
    expect(exit).toBe(0);
    expect(out).toMatch(/no-op|already completed/i);
    expect(spies.updateIssue.calls.length).toBe(0);
  });
});

describe("issue update", () => {
  it("idempotent no-op when already in desired state", async () => {
    const { client, spies } = createMockLinear({
      issues: [
        makeIssue({
          id: "i1",
          identifier: "ENG-5",
          title: "Keep me",
        }),
      ],
    });
    setLinearClientForTests(client);
    const { out, exit } = await run([
      "issue",
      "update",
      "ENG-5",
      "--title",
      "Keep me",
    ]);
    expect(exit).toBe(0);
    expect(out).toMatch(/no-op|desired state/i);
    expect(spies.updateIssue.calls.length).toBe(0);
  });

  it("updates and clears scheduling fields idempotently", async () => {
    const issue = makeIssue({
      id: "i-scheduled",
      identifier: "ENG-88",
      title: "Scheduled",
      cycleId: "cycle-eng-1",
      priority: 2,
      estimate: 5,
      dueDate: "2026-09-01",
    });
    const { client, spies, issues } = createMockLinear({ issues: [issue] });
    setLinearClientForTests(client);

    const cleared = await run([
      "issue",
      "update",
      "ENG-88",
      "--cycle",
      "none",
      "--estimate",
      "none",
      "--due-date",
      "none",
    ]);
    expect(cleared.exit).toBe(0);
    expect(spies.updateIssue.calls[0][1]).toMatchObject({
      cycleId: null,
      estimate: null,
      dueDate: null,
    });
    expect(issues[0]).toMatchObject({ cycleId: null, estimate: null, dueDate: null });

    const noOp = await run(["issue", "update", "ENG-88", "--priority", "2"]);
    expect(noOp.exit).toBe(0);
    expect(noOp.out).toMatch(/no-op|desired state/i);
    expect(spies.updateIssue.calls).toHaveLength(1);
  });
});

describe("issue hierarchy", () => {
  it("shows a parent, lists sub-issues on demand, and plans parent assignment", async () => {
    const parent = makeIssue({
      id: "parent-1",
      identifier: "ENG-60",
      title: "Parent work item",
    });
    const child = makeIssue({
      id: "child-1",
      identifier: "ENG-61",
      title: "Implementation slice",
      parentId: parent.id,
    });
    const { client, spies } = createMockLinear({ issues: [parent, child] });
    setLinearClientForTests(client);

    const childView = await run(["issue", "view", "ENG-61"]);
    expect(childView.exit).toBe(0);
    expect(childView.out).toContain("ENG-60 Parent work item");

    const parentView = await run(["issue", "view", "ENG-60", "--sub-issues"]);
    expect(parentView.exit).toBe(0);
    expect(parentView.out).toContain("subIssues");
    expect(parentView.out).toContain("ENG-61");

    const planned = await run([
      "issue",
      "create",
      "--title",
      "Another slice",
      "--team",
      "ENG",
      "--parent",
      "ENG-60",
      "--dry-run",
    ]);
    expect(planned.exit).toBe(0);
    expect(planned.out).toContain("parentId: parent-1");
    expect(spies.createIssue.calls).toHaveLength(0);
  });

  it("can detach a sub-issue idempotently with --parent none", async () => {
    const parent = makeIssue({
      id: "parent-1",
      identifier: "ENG-60",
      title: "Parent work item",
    });
    const child = makeIssue({
      id: "child-1",
      identifier: "ENG-61",
      title: "Implementation slice",
      parentId: parent.id,
    });
    const { client, spies, issues } = createMockLinear({ issues: [parent, child] });
    setLinearClientForTests(client);

    const { exit } = await run(["issue", "update", "ENG-61", "--parent", "none"]);
    expect(exit).toBe(0);
    expect(spies.updateIssue.calls[0][1]).toMatchObject({ parentId: null });
    expect(issues.find((issue) => issue.id === child.id)?.parentId).toBeUndefined();
  });
});

describe("issue relations", () => {
  it("plans, creates, lists, and idempotently preserves a blocks relation", async () => {
    const source = makeIssue({
      id: "source-1",
      identifier: "ENG-70",
      title: "Publish API contract",
    });
    const target = makeIssue({
      id: "target-1",
      identifier: "ENG-71",
      title: "Build client",
    });
    const { client, spies, relations } = createMockLinear({
      issues: [source, target],
    });
    setLinearClientForTests(client);

    const planned = await run([
      "issue",
      "relation",
      "add",
      "ENG-70",
      "--blocks",
      "ENG-71",
      "--dry-run",
    ]);
    expect(planned.exit).toBe(0);
    expect(planned.out).toContain("createIssueRelation");
    expect(spies.createIssueRelation.calls).toHaveLength(0);

    const created = await run([
      "issue",
      "relation",
      "add",
      "ENG-70",
      "--blocks",
      "ENG-71",
    ]);
    expect(created.exit).toBe(0);
    expect(spies.createIssueRelation.calls).toHaveLength(1);
    expect(relations[0]).toMatchObject({
      issueId: source.id,
      relatedIssueId: target.id,
      type: "blocks",
    });

    const listed = await run(["issue", "relation", "list", "ENG-71"]);
    expect(listed.exit).toBe(0);
    expect(listed.out).toContain("relation-1");
    expect(listed.out).toContain("blocked-by");
    expect(listed.out).toContain("ENG-70 Publish API contract");

    const noOp = await run([
      "issue",
      "relation",
      "add",
      "ENG-70",
      "--blocks",
      "ENG-71",
    ]);
    expect(noOp.exit).toBe(0);
    expect(noOp.out).toContain("no-op");
    expect(spies.createIssueRelation.calls).toHaveLength(1);
  });

  it("plans and removes a semantic edge, then treats a repeat as a no-op", async () => {
    const source = makeIssue({ id: "source-1", identifier: "ENG-70", title: "Source" });
    const target = makeIssue({ id: "target-1", identifier: "ENG-71", title: "Target" });
    const relation = { id: "rel-1", issueId: source.id, relatedIssueId: target.id, type: "blocks" };
    const { client, spies, relations } = createMockLinear({
      issues: [source, target],
      relations: [relation],
    });
    setLinearClientForTests(client);

    const planned = await run([
      "issue", "relation", "remove", "ENG-70", "--blocks", "ENG-71", "--dry-run",
    ]);
    expect(planned.exit).toBe(0);
    expect(planned.out).toContain("deleteIssueRelation");
    expect(planned.out).toContain("id: rel-1");
    expect(spies.deleteIssueRelation.calls).toHaveLength(0);

    const removed = await run([
      "issue", "relation", "remove", "ENG-70", "--blocks", "ENG-71",
    ]);
    expect(removed.exit).toBe(0);
    expect(removed.out).toContain("action: removed");
    expect(spies.deleteIssueRelation.calls[0][0]).toBe("rel-1");
    expect(relations).toHaveLength(0);

    const noOp = await run([
      "issue", "relation", "remove", "ENG-70", "--blocks", "ENG-71",
    ]);
    expect(noOp.exit).toBe(0);
    expect(noOp.out).toContain("already absent (no-op)");
    expect(spies.deleteIssueRelation.calls).toHaveLength(1);
  });

  it("removes by relation id and rejects a missing id", async () => {
    const source = makeIssue({ id: "source-1", identifier: "ENG-70", title: "Source" });
    const target = makeIssue({ id: "target-1", identifier: "ENG-71", title: "Target" });
    const { client, spies } = createMockLinear({
      issues: [source, target],
      relations: [{ id: "rel-1", issueId: source.id, relatedIssueId: target.id, type: "related" }],
    });
    setLinearClientForTests(client);

    const removed = await run([
      "issue", "relation", "remove", "ENG-70", "--id", "rel-1",
    ]);
    expect(removed.exit).toBe(0);
    expect(spies.deleteIssueRelation.calls[0][0]).toBe("rel-1");

    const missing = await run([
      "issue", "relation", "remove", "ENG-70", "--id", "rel-missing",
    ]);
    expect(missing.exit).toBe(1);
    expect(missing.out).toContain("NOT_FOUND");
  });

  it("rejects an ambiguous semantic relation and requires its id", async () => {
    const source = makeIssue({ id: "source-1", identifier: "ENG-70", title: "Source" });
    const target = makeIssue({ id: "target-1", identifier: "ENG-71", title: "Target" });
    const { client, spies } = createMockLinear({
      issues: [source, target],
      relations: [
        { id: "rel-1", issueId: source.id, relatedIssueId: target.id, type: "related" },
        { id: "rel-2", issueId: target.id, relatedIssueId: source.id, type: "related" },
      ],
    });
    setLinearClientForTests(client);

    const { out, exit } = await run([
      "issue", "relation", "remove", "ENG-70", "--related", "ENG-71",
    ]);

    expect(exit).toBe(2);
    expect(out).toContain("More than one related relation matches");
    expect(out).toContain("--id <relation-id>");
    expect(spies.deleteIssueRelation.calls).toHaveLength(0);
  });
});

describe("issue comment", () => {
  it("--dry-run does not call createComment", async () => {
    const { client, spies } = createMockLinear({
      issues: [
        makeIssue({
          id: "i1",
          identifier: "ENG-7",
          title: "Comment target",
        }),
      ],
    });
    setLinearClientForTests(client);
    const { out, exit } = await run([
      "issue",
      "comment",
      "ENG-7",
      "--body",
      "Looks good",
      "--dry-run",
    ]);
    expect(exit).toBe(0);
    expect(spies.createComment.calls.length).toBe(0);
    expect(out).toContain("dryRun");
    expect(out).toContain("Looks good");
  });

  it("does not treat a following flag as a comment body", async () => {
    const { client, spies } = createMockLinear({
      issues: [
        makeIssue({
          id: "i1",
          identifier: "ENG-7",
          title: "Comment target",
        }),
      ],
    });
    setLinearClientForTests(client);
    const { out, exit } = await run([
      "issue",
      "comment",
      "ENG-7",
      "--body",
      "--dry-run",
    ]);
    expect(exit).toBe(2);
    expect(out).toContain("--body requires text");
    expect(spies.createComment.calls).toHaveLength(0);
  });

  it("lists comments with their thread parent and creates a reply", async () => {
    const { client, spies, issues } = createMockLinear({
      issues: [
        makeIssue({
          id: "i1",
          identifier: "ENG-8",
          title: "Threaded discussion",
          comments: [
            { id: "c1", body: "Root comment", user: defaultViewer },
            { id: "c2", body: "Existing reply", parentId: "c1", user: defaultViewer },
          ],
        }),
      ],
    });
    setLinearClientForTests(client);

    const listed = await run(["issue", "comment", "list", "ENG-8"]);
    expect(listed.exit).toBe(0);
    expect(listed.out).toContain("Root comment");
    expect(listed.out).toContain("Existing reply");
    expect(listed.out).toContain("c2,c1,Alice");

    const replied = await run([
      "issue",
      "comment",
      "ENG-8",
      "--reply-to",
      "c1",
      "--body",
      "New reply",
    ]);
    expect(replied.exit).toBe(0);
    expect(spies.createComment.calls[0][0]).toMatchObject({
      issueId: "i1",
      parentId: "c1",
      body: "New reply",
    });
    expect(issues[0].comments?.at(-1)).toMatchObject({
      body: "New reply",
      parentId: "c1",
    });
    expect(replied.out).toContain("replyTo: c1");
  });

  it("rejects a reply target outside the issue before writing", async () => {
    const { client, spies } = createMockLinear({
      issues: [
        makeIssue({
          id: "i1",
          identifier: "ENG-8",
          title: "Threaded discussion",
          comments: [{ id: "c1", body: "Root comment" }],
        }),
      ],
    });
    setLinearClientForTests(client);

    const { out, exit } = await run([
      "issue",
      "comment",
      "ENG-8",
      "--reply-to",
      "other-comment",
      "--body",
      "Unsafe reply",
    ]);
    expect(exit).toBe(1);
    expect(out).toContain("NOT_FOUND");
    expect(spies.createComment.calls).toHaveLength(0);
  });
});

describe("issue create write path (mocked)", () => {
  it("createIssue is called without --dry-run", async () => {
    const { client, spies } = createMockLinear();
    setLinearClientForTests(client);
    const { out, exit } = await run([
      "issue",
      "create",
      "--title",
      "Real create",
      "--team",
      "ENG",
    ]);
    expect(exit).toBe(0);
    expect(spies.createIssue.calls.length).toBe(1);
    expect(out).toContain("Real create");
    expect(out).toContain("ENG-");
  });
});

describe("issue write paths (mocked)", () => {
  it("updates a changed title and reports the updated issue", async () => {
    const { client, spies, issues } = createMockLinear({
      issues: [
        makeIssue({ id: "i1", identifier: "ENG-50", title: "Before" }),
      ],
    });
    setLinearClientForTests(client);
    const { out, exit } = await run([
      "issue",
      "update",
      "ENG-50",
      "--title",
      "After",
    ]);
    expect(exit).toBe(0);
    expect(spies.updateIssue.calls).toHaveLength(1);
    expect(issues[0].title).toBe("After");
    expect(out).toContain("After");
  });

  it("closes an incomplete issue through the completed workflow state", async () => {
    const { client, spies, issues } = createMockLinear({
      issues: [
        makeIssue({ id: "i1", identifier: "ENG-51", title: "Still open" }),
      ],
    });
    setLinearClientForTests(client);
    const { out, exit } = await run(["issue", "close", "ENG-51"]);
    expect(exit).toBe(0);
    expect(spies.updateIssue.calls).toHaveLength(1);
    expect(issues[0].state.type).toBe("completed");
    expect(out).toContain("completed");
  });

  it("adds and removes labels without replacing unrelated labels", async () => {
    const labels = [
      { id: "label-bug", name: "Bug", teamId: defaultTeam.id },
      { id: "label-ui", name: "UI", teamId: defaultTeam.id },
      { id: "label-platform", name: "Platform" },
    ];
    const { client, spies, issues } = createMockLinear({
      labels,
      issues: [
        makeIssue({
          id: "i1",
          identifier: "ENG-52",
          title: "Tagged work",
          labels: [labels[0], labels[1]],
        }),
      ],
    });
    setLinearClientForTests(client);

    const { out, exit } = await run([
      "issue",
      "update",
      "ENG-52",
      "--add-label",
      "Platform",
      "--remove-label",
      "Bug",
    ]);

    expect(exit).toBe(0);
    expect(spies.updateIssue.calls).toHaveLength(1);
    expect(spies.updateIssue.calls[0][1]).toMatchObject({
      addedLabelIds: ["label-platform"],
      removedLabelIds: ["label-bug"],
    });
    expect(issues[0].labels?.map((label) => label.name)).toEqual(["UI", "Platform"]);
    expect(out).toMatch(/labels:.*UI.*Platform/);
  });

  it("rejects an unknown label before writing", async () => {
    const label = { id: "label-bug", name: "Bug", teamId: defaultTeam.id };
    const { client, spies } = createMockLinear({
      labels: [label],
      issues: [
        makeIssue({
          id: "i1",
          identifier: "ENG-53",
          title: "Already tagged",
          labels: [label],
        }),
      ],
    });
    setLinearClientForTests(client);

    const { out, exit } = await run([
      "issue",
      "update",
      "ENG-53",
      "--add-label",
      "Bug",
      "--remove-label",
      "missing-label",
    ]);

    expect(exit).toBe(1);
    expect(out).toContain("NOT_FOUND");
    expect(spies.updateIssue.calls).toHaveLength(0);
  });

  it("treats an already-present label as an idempotent no-op", async () => {
    const label = { id: "label-bug", name: "Bug", teamId: defaultTeam.id };
    const { client, spies } = createMockLinear({
      labels: [label],
      issues: [
        makeIssue({
          id: "i1",
          identifier: "ENG-54",
          title: "Already tagged",
          labels: [label],
        }),
      ],
    });
    setLinearClientForTests(client);

    const { out, exit } = await run([
      "issue",
      "update",
      "ENG-54",
      "--add-label",
      "Bug",
    ]);

    expect(exit).toBe(0);
    expect(out).toContain("no-op");
    expect(spies.updateIssue.calls).toHaveLength(0);
  });
});

void defaultViewer;
