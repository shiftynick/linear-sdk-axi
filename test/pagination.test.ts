import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLinearClientForTests } from "../src/client.js";
import { main } from "../src/cli.js";
import { createMockLinear, makeIssue } from "./mock.js";

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

describe("bounded pagination", () => {
  it("traverses issue pages up to the explicit cap", async () => {
    const issues = Array.from({ length: 5 }, (_, index) => makeIssue({
      id: `i${index + 1}`,
      identifier: `ENG-${index + 1}`,
      title: `Issue ${index + 1}`,
    }));
    const { client } = createMockLinear({ issues });
    setLinearClientForTests(client);

    const { out, exit } = await run([
      "issue", "list", "--team", "ENG", "--limit", "2", "--all", "--max-items", "4",
    ]);

    expect(exit).toBe(0);
    expect(out).toContain("ENG-1");
    expect(out).toContain("ENG-4");
    expect(out).not.toContain("ENG-5");
    expect(out).toContain("pagesFetched: 2");
    expect(out).toContain("hasNextPage: true");
    expect(out).toContain("capped: true");
    expect(out).toContain('endCursor: "cursor:4"');
  });

  it("resumes from an exposed cursor", async () => {
    const issues = Array.from({ length: 4 }, (_, index) => makeIssue({
      id: `i${index + 1}`,
      identifier: `ENG-${index + 1}`,
      title: `Issue ${index + 1}`,
    }));
    const { client } = createMockLinear({ issues });
    setLinearClientForTests(client);

    const { out, exit } = await run([
      "issue", "list", "--team", "ENG", "--limit", "2", "--after", "cursor:2",
    ]);

    expect(exit).toBe(0);
    expect(out).not.toContain("ENG-1");
    expect(out).toContain("ENG-3");
    expect(out).toContain("ENG-4");
    expect(out).toContain("hasNextPage: false");
  });

  it("paginates search and project collections", async () => {
    const issues = Array.from({ length: 3 }, (_, index) => makeIssue({
      id: `i${index + 1}`,
      identifier: `ENG-${index + 1}`,
      title: `Shared query ${index + 1}`,
    }));
    const projects = Array.from({ length: 3 }, (_, index) => ({
      id: `p${index + 1}`,
      name: `Project ${index + 1}`,
    }));
    const { client } = createMockLinear({ issues, projects });
    setLinearClientForTests(client);

    const search = await run([
      "issue", "search", "Shared query", "--limit", "1", "--all", "--max-items", "3",
    ]);
    expect(search.exit).toBe(0);
    expect(search.out).toContain("ENG-3");
    expect(search.out).toContain("pagesFetched: 3");

    const project = await run([
      "project", "list", "--limit", "1", "--all", "--max-items", "3",
    ]);
    expect(project.exit).toBe(0);
    expect(project.out).toContain("Project 3");
    expect(project.out).toContain("pagesFetched: 3");
  });

  it("paginates comments and the combined relation collection", async () => {
    const source = makeIssue({
      id: "source",
      identifier: "ENG-1",
      title: "Source",
      comments: Array.from({ length: 3 }, (_, index) => ({
        id: `c${index + 1}`,
        body: `Comment ${index + 1}`,
      })),
    });
    const related = Array.from({ length: 4 }, (_, index) => makeIssue({
      id: `r${index + 1}`,
      identifier: `ENG-${index + 2}`,
      title: `Related ${index + 1}`,
    }));
    const { client } = createMockLinear({
      issues: [source, ...related],
      relations: [
        { id: "rel1", issueId: source.id, relatedIssueId: related[0].id, type: "blocks" },
        { id: "rel2", issueId: source.id, relatedIssueId: related[1].id, type: "blocks" },
        { id: "rel3", issueId: related[2].id, relatedIssueId: source.id, type: "blocks" },
        { id: "rel4", issueId: related[3].id, relatedIssueId: source.id, type: "blocks" },
      ],
    });
    setLinearClientForTests(client);

    const comments = await run([
      "issue", "comment", "list", "ENG-1", "--limit", "1", "--all", "--max-items", "3",
    ]);
    expect(comments.exit).toBe(0);
    expect(comments.out).toContain("Comment 3");
    expect(comments.out).toContain("pagesFetched: 3");

    const relations = await run([
      "issue", "relation", "list", "ENG-1", "--limit", "2", "--all", "--max-items", "3",
    ]);
    expect(relations.exit).toBe(0);
    expect(relations.out).toContain("ENG-4 Related 3");
    expect(relations.out).not.toContain("ENG-5 Related 4");
    expect(relations.out).toContain("capped: true");
  });

  it("keeps empty pages explicit and rejects unbounded all-pages requests", async () => {
    const { client } = createMockLinear({ issues: [] });
    setLinearClientForTests(client);

    const empty = await run(["issue", "list", "--team", "ENG"]);
    expect(empty.exit).toBe(0);
    expect(empty.out).toContain("0 matching issues");
    expect(empty.out).toContain("pagesFetched: 1");
    expect(empty.out).toContain("hasNextPage: false");

    const unbounded = await run(["issue", "list", "--team", "ENG", "--all"]);
    expect(unbounded.exit).toBe(2);
    expect(unbounded.out).toContain("--all requires --max-items");

    const orphanCap = await run(["issue", "list", "--team", "ENG", "--max-items", "5"]);
    expect(orphanCap.exit).toBe(2);
    expect(orphanCap.out).toContain("--max-items requires --all");
  });
});
