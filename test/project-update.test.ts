import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLinearClientForTests } from "../src/client.js";
import { main } from "../src/cli.js";
import { createMockLinear, defaultViewer } from "./mock.js";

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

describe("project updates", () => {
  it("lists updates with pagination, health, author, and body", async () => {
    const project = {
      id: "project-1",
      name: "Launch",
      updates: [
        { id: "u1", body: "First", health: "onTrack", createdAt: "2026-08-15T00:00:00.000Z", user: defaultViewer },
        { id: "u2", body: "Second", health: "atRisk", createdAt: "2026-08-16T00:00:00.000Z", user: defaultViewer },
      ],
    };
    const { client } = createMockLinear({ projects: [project] });
    setLinearClientForTests(client);

    const { out, exit } = await run([
      "project", "updates", "list", "Launch", "--limit", "1", "--all", "--max-items", "2",
    ]);

    expect(exit).toBe(0);
    expect(out).toContain("projectUpdates");
    expect(out).toContain("onTrack");
    expect(out).toContain("atRisk");
    expect(out).toContain(defaultViewer.name);
    expect(out).toContain("pagesFetched: 2");
  });

  it("plans a body-file and health update without writing", async () => {
    const folder = await mkdtemp(join(tmpdir(), "linear-axi-project-update-"));
    const bodyPath = join(folder, "update.md");
    await writeFile(bodyPath, "## Milestone\n\nAll launch checks pass.\n", "utf8");
    try {
      const project = { id: "project-1", name: "Launch" };
      const { client, spies } = createMockLinear({ projects: [project] });
      setLinearClientForTests(client);

      const { out, exit } = await run([
        "project", "updates", "create", "Launch",
        "--body-file", bodyPath, "--health", "on-track", "--dry-run",
      ]);

      expect(exit).toBe(0);
      expect(out).toContain("createProjectUpdate");
      expect(out).toContain("All launch checks pass");
      expect(out).toContain("health: onTrack");
      expect(spies.createProjectUpdate.calls).toHaveLength(0);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("creates and returns a health-only update", async () => {
    const project = { id: "project-1", name: "Launch" };
    const { client, spies } = createMockLinear({ projects: [project] });
    setLinearClientForTests(client);

    const { out, exit } = await run([
      "project", "updates", "create", "Launch", "--health", "at-risk",
    ]);

    expect(exit).toBe(0);
    expect(spies.createProjectUpdate.calls[0][0]).toEqual({
      projectId: "project-1",
      health: "atRisk",
    });
    expect(out).toContain("action: created");
    expect(out).toContain("health: atRisk");
  });

  it("rejects empty and invalid updates before writing", async () => {
    const project = { id: "project-1", name: "Launch" };
    const { client, spies } = createMockLinear({ projects: [project] });
    setLinearClientForTests(client);

    const empty = await run(["project", "updates", "create", "Launch"]);
    expect(empty.exit).toBe(2);
    expect(empty.out).toContain("requires --body");

    const invalid = await run([
      "project", "updates", "create", "Launch", "--health", "unknown",
    ]);
    expect(invalid.exit).toBe(2);
    expect(invalid.out).toContain("on-track, at-risk, or off-track");
    expect(spies.createProjectUpdate.calls).toHaveLength(0);
  });

  it("surfaces a failed SDK mutation", async () => {
    const project = { id: "project-1", name: "Launch" };
    const { client, spies } = createMockLinear({ projects: [project] });
    spies.createProjectUpdate.mockImplementation(async () => ({ success: false }));
    setLinearClientForTests(client);

    const { out, exit } = await run([
      "project", "updates", "create", "Launch", "--body", "Status",
    ]);

    expect(exit).toBe(1);
    expect(out).toContain("Failed to create project update");
  });
});
