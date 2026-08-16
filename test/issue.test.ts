import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLinearClientForTests } from "../src/client.js";
import { main } from "../src/cli.js";
import {
  createMockLinear,
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

void defaultViewer;
