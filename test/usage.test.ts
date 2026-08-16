import { beforeEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";

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

describe("usage map", () => {
  it("lists every command topic without requiring a Linear API key", async () => {
    const { out, exit } = await run(["usage"]);
    expect(exit).toBe(0);
    expect(out).toContain("tier: overview");
    for (const topic of ["issue", "label", "project", "team", "account", "auth", "setup"]) {
      expect(out).toContain(topic);
      expect(out).toContain(`linear-sdk-axi usage ${topic}`);
    }
  });

  it("returns exact issue command forms in the second tier", async () => {
    const { out, exit } = await run(["usage", "issue"]);
    expect(exit).toBe(0);
    expect(out).toContain("tier: issue");
    expect(out).toContain("linear-sdk-axi issue list");
    expect(out).toContain("linear-sdk-axi issue create");
    expect(out).toContain("linear-sdk-axi issue close");
    expect(out).toContain("--dry-run");
  });

  it("includes safe project write forms in the project tier", async () => {
    const { out, exit } = await run(["usage", "project"]);
    expect(exit).toBe(0);
    expect(out).toContain("linear-sdk-axi project status list");
    expect(out).toContain("linear-sdk-axi project create");
    expect(out).toContain("linear-sdk-axi project update");
    expect(out).toContain("--dry-run");
  });

  it("rejects an unknown or extra topic with a structured usage error", async () => {
    for (const argv of [
      ["usage", "unknown"],
      ["usage", "issue", "extra"],
    ]) {
      const { out, exit } = await run(argv);
      expect(exit).toBe(2);
      expect(out).toContain("VALIDATION_ERROR");
    }
  });
});
