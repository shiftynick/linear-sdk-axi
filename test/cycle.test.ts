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

describe("cycles", () => {
  it("lists cycles with action-ready ids and supports team scope", async () => {
    const otherTeam = { ...defaultTeam, id: "team-2", key: "DES", name: "Design" };
    const { client } = createMockLinear({
      teams: [defaultTeam, otherTeam],
      cycles: [
        {
          id: "cycle-eng-1",
          number: 42,
          name: "Reliability",
          progress: 0.45,
          isActive: true,
          team: defaultTeam,
        },
        {
          id: "cycle-des-1",
          number: 3,
          name: "Polish",
          progress: 1,
          isPast: true,
          team: otherTeam,
        },
      ],
    });
    setLinearClientForTests(client);

    const all = await run(["cycle", "list"]);
    expect(all.exit).toBe(0);
    expect(all.out).toContain("cycle-eng-1");
    expect(all.out).toContain("ENG-42 Reliability");
    expect(all.out).toContain("active");
    expect(all.out).toContain("45%");

    const scoped = await run(["cycle", "list", "--team", "ENG"]);
    expect(scoped.exit).toBe(0);
    expect(scoped.out).toContain("cycle-eng-1");
    expect(scoped.out).not.toContain("cycle-des-1");
  });

  it("views cycle details without a write path and truncates by default", async () => {
    const description = "x".repeat(600);
    const { client } = createMockLinear({
      cycles: [
        {
          id: "cycle-eng-1",
          number: 42,
          name: "Reliability",
          progress: 0.45,
          isActive: true,
          startsAt: "2026-08-10T00:00:00.000Z",
          endsAt: "2026-08-24T00:00:00.000Z",
          description,
          team: defaultTeam,
        },
      ],
    });
    setLinearClientForTests(client);

    const short = await run(["cycle", "view", "cycle-eng-1"]);
    expect(short.exit).toBe(0);
    expect(short.out).toContain("2026-08-10");
    expect(short.out).toContain("description");
    expect(short.out).toContain("--full");
    expect(short.out).not.toContain(description);

    const full = await run(["cycle", "view", "cycle-eng-1", "--full"]);
    expect(full.exit).toBe(0);
    expect(full.out).toContain(description);
  });

  it("rejects unrecognized cycle flags", async () => {
    const { client } = createMockLinear();
    setLinearClientForTests(client);
    const { out, exit } = await run(["cycle", "list", "--write"]);
    expect(exit).toBe(2);
    expect(out).toContain("VALIDATION_ERROR");
    expect(out).toContain("--write");
  });
});
