import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const binary = fileURLToPath(new URL("../dist/bin/linear-axi.js", import.meta.url));
const liveEnabled =
  process.env.LINEAR_AXI_LIVE_TEST === "1" && Boolean(process.env.LINEAR_API_KEY);

function runBinary(args: string[]) {
  return spawnSync(process.execPath, [binary, ...args], {
    cwd: root,
    env: process.env,
    encoding: "utf8",
  });
}

const describeLive = liveEnabled ? describe : describe.skip;

describeLive("live Linear read-only integration", () => {
  it("returns the authenticated viewer", () => {
    const result = runBinary(["me"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("me:");
    expect(result.stdout).toContain("assignedIssueCount");
    expect(result.stderr).toBe("");
  });

  it("lists teams without mutating Linear", () => {
    const result = runBinary(["team", "list", "--limit", "5"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/teams:|0 teams/);
    expect(result.stderr).toBe("");
  });
});
