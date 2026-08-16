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

describe("label list", () => {
  it("shows workspace labels and team-scoped labels for a requested team", async () => {
    const otherTeam = { ...defaultTeam, id: "team-2", key: "DES", name: "Design" };
    const { client } = createMockLinear({
      teams: [defaultTeam, otherTeam],
      labels: [
        { id: "label-platform", name: "Platform" },
        { id: "label-bug", name: "Bug", teamId: defaultTeam.id },
        { id: "label-design", name: "Design", teamId: otherTeam.id },
      ],
    });
    setLinearClientForTests(client);

    const { out, exit } = await run(["label", "list", "--team", "ENG"]);
    expect(exit).toBe(0);
    expect(out).toContain("label-platform");
    expect(out).toContain("label-bug");
    expect(out).not.toContain("label-design");
    expect(out).toContain("--label <name|id>");
  });
});
