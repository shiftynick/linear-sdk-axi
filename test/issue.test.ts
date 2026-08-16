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
