import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLinearClientForTests } from "../src/client.js";
import { main } from "../src/cli.js";
import { createMockLinear, defaultTeam } from "./mock.js";

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

describe("project writes", () => {
  it("plans project creation without writing", async () => {
    const { client, spies } = createMockLinear();
    setLinearClientForTests(client);

    const { out, exit } = await run([
      "project",
      "create",
      "--name",
      "Launch CLI",
      "--team",
      "ENG",
      "--priority",
      "2",
      "--start-date",
      "2026-09-01",
      "--target-date",
      "2026-10-01",
      "--dry-run",
    ]);

    expect(exit).toBe(0);
    expect(spies.createProject.calls).toHaveLength(0);
    expect(out).toContain("createProject");
    expect(out).toContain("teamIds");
    expect(out).toContain(defaultTeam.id);
    expect(out).toContain("targetDate: 2026-10-01");
  });

  it("creates a project scoped to the requested team", async () => {
    const statuses = [
      { id: "status-planned", name: "Planned", type: "planned" },
      { id: "status-started", name: "In Progress", type: "started" },
    ];
    const { client, spies, issues } = createMockLinear({ projectStatuses: statuses });
    setLinearClientForTests(client);

    const { out, exit } = await run([
      "project",
      "create",
      "--name",
      "Launch CLI",
      "--team",
      "ENG",
      "--description",
      "Ship the direct SDK client",
      "--status",
      "In Progress",
      "--priority",
      "1",
    ]);

    expect(exit).toBe(0);
    expect(spies.createProject.calls[0][0]).toMatchObject({
      name: "Launch CLI",
      teamIds: [defaultTeam.id],
      statusId: "status-started",
      priority: 1,
    });
    expect(issues).toEqual([]);
    expect(out).toContain("action: created");
  });

  it("updates dates safely and recognizes no-ops", async () => {
    const statuses = [
      { id: "status-planned", name: "Planned", type: "planned" },
      { id: "status-started", name: "In Progress", type: "started" },
    ];
    const project = {
      id: "project-1",
      name: "Launch CLI",
      description: "Initial scope",
      priority: 2,
      startDate: "2026-09-01",
      targetDate: "2026-10-01",
      teamIds: [defaultTeam.id],
      statusId: "status-started",
      projectStatus: statuses[1],
    };
    const { client, spies, issues } = createMockLinear({
      projects: [project],
      projectStatuses: statuses,
    });
    setLinearClientForTests(client);

    const changed = await run([
      "project",
      "update",
      "project-1",
      "--target-date",
      "none",
      "--description",
      "Refined scope",
      "--status",
      "Planned",
    ]);
    expect(changed.exit).toBe(0);
    expect(spies.updateProject.calls[0][1]).toMatchObject({
      targetDate: null,
      description: "Refined scope",
      statusId: "status-planned",
    });
    expect(issues).toEqual([]);

    const noOp = await run(["project", "update", "project-1", "--priority", "2"]);
    expect(noOp.exit).toBe(0);
    expect(noOp.out).toMatch(/no-op|desired state/i);
    expect(spies.updateProject.calls).toHaveLength(1);
  });

  it("rejects invalid dates before writing", async () => {
    const { client, spies } = createMockLinear();
    setLinearClientForTests(client);
    const { out, exit } = await run([
      "project",
      "create",
      "--name",
      "Bad date",
      "--team",
      "ENG",
      "--target-date",
      "2026-02-30",
    ]);
    expect(exit).toBe(2);
    expect(out).toContain("valid calendar date");
    expect(spies.createProject.calls).toHaveLength(0);
  });

  it("lists project statuses before a status write", async () => {
    const { client } = createMockLinear({
      projectStatuses: [
        { id: "status-planned", name: "Planned", type: "planned" },
        { id: "status-started", name: "In Progress", type: "started" },
      ],
    });
    setLinearClientForTests(client);
    const { out, exit } = await run(["project", "status", "list"]);
    expect(exit).toBe(0);
    expect(out).toContain("projectStatuses");
    expect(out).toContain("status-started");
    expect(out).toContain("In Progress");
  });
});
