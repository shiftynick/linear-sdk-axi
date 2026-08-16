import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLinearClientForTests } from "../src/client.js";
import { main } from "../src/cli.js";
import { createMockLinear, defaultTeam, defaultViewer } from "./mock.js";

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

describe("doctor", () => {
  it("verifies read-only access and reports the viewer, workspace, and teams", async () => {
    const { client } = createMockLinear({
      viewer: {
        ...defaultViewer,
        organization: {
          id: "workspace-1",
          name: "Acme Workspace",
          urlKey: "acme",
        },
      },
      teams: [
        defaultTeam,
        {
          id: "team-2",
          key: "PROD",
          name: "Product",
          states: defaultTeam.states,
        },
      ],
    });
    setLinearClientForTests(client);

    const { out, exit } = await run(["doctor"]);

    expect(exit).toBe(0);
    expect(out).toContain("status: ok");
    expect(out).toContain("authentication: verified");
    expect(out).toContain("Alice");
    expect(out).toContain("Acme Workspace");
    expect(out).toContain("workspaceUrlKey: acme");
    expect(out).toContain("accessibleTeamCount: 2");
    expect(out).toContain("ENG");
    expect(out).toContain("PROD");
  });

  it("rejects unsupported flags as a structured usage error", async () => {
    const { out, exit } = await run(["doctor", "--write"]);
    expect(exit).toBe(2);
    expect(out).toContain("VALIDATION_ERROR");
    expect(out).toContain("--write");
  });
});
