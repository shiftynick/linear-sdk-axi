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
    stdout: { write: (chunk: string) => (chunks.push(chunk), true) },
    text: () => chunks.join(""),
  };
}

async function run(argv: string[]): Promise<{ out: string; exit: number }> {
  process.exitCode = undefined;
  const output = capture();
  await main({ argv, stdout: output.stdout });
  return { out: output.text(), exit: process.exitCode ?? 0 };
}

beforeEach(() => {
  process.exitCode = undefined;
});

afterEach(() => {
  setLinearClientForTests(undefined);
  process.exitCode = undefined;
});

describe("project-scoped issue reads", () => {
  it("composes a project name with team, state, assignee, and pagination", async () => {
    const project = { id: "project-1", name: "Launch" };
    const other = { id: "project-2", name: "Other" };
    const issues = [
      makeIssue({ id: "i1", identifier: "ENG-1", title: "First", project }),
      makeIssue({ id: "i2", identifier: "ENG-2", title: "Second", project }),
      makeIssue({ id: "i3", identifier: "ENG-3", title: "Done", project, state: stateByType("completed") }),
      makeIssue({ id: "i4", identifier: "ENG-4", title: "Other", project: other }),
    ];
    const { client } = createMockLinear({ projects: [project, other], issues });
    setLinearClientForTests(client);

    const { out, exit } = await run([
      "issue", "list", "--project", "Launch", "--team", "ENG",
      "--state", "started", "--assignee", defaultViewer.email,
      "--limit", "1", "--all", "--max-items", "2",
    ]);

    expect(exit).toBe(0);
    expect(out).toContain("ENG-1");
    expect(out).toContain("ENG-2");
    expect(out).not.toContain("ENG-3");
    expect(out).not.toContain("ENG-4");
    expect(out).toContain("pagesFetched: 2");
  });

  it("adds a paginated issue summary to project view", async () => {
    const project = { id: "project-1", name: "Launch", teamIds: [defaultTeam.id] };
    const issues = Array.from({ length: 3 }, (_, index) => makeIssue({
      id: `i${index + 1}`,
      identifier: `ENG-${index + 1}`,
      title: `Issue ${index + 1}`,
      project,
      state: index === 2 ? stateByType("completed") : stateByType("started"),
    }));
    const { client } = createMockLinear({ projects: [project], issues });
    setLinearClientForTests(client);

    const { out, exit } = await run([
      "project", "view", "Launch", "--issues", "--limit", "1", "--all", "--max-items", "2",
    ]);

    expect(exit).toBe(0);
    expect(out).toContain("issueCounts");
    expect(out).toContain("started: 2");
    expect(out).toContain("completed: 1");
    expect(out).toContain("ENG-1");
    expect(out).toContain("ENG-2");
    expect(out).not.toContain("ENG-3");
    expect(out).toContain("count: 2 of 3 total");
    expect(out).toContain("capped: true");
  });

  it("returns an explicit empty summary and scopes pagination flags to --issues", async () => {
    const project = { id: "project-1", name: "Empty" };
    const { client } = createMockLinear({ projects: [project], issues: [] });
    setLinearClientForTests(client);

    const empty = await run(["project", "view", "Empty", "--issues"]);
    expect(empty.exit).toBe(0);
    expect(empty.out).toContain("0 project issues");
    expect(empty.out).toContain("hasNextPage: false");

    const invalid = await run(["project", "view", "Empty", "--limit", "5"]);
    expect(invalid.exit).toBe(2);
    expect(invalid.out).toContain("require --issues");
  });
});
