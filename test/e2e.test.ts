import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const binary = fileURLToPath(new URL("../dist/bin/linear-axi.js", import.meta.url));

function runBinary(args: string[]) {
  const { LINEAR_API_KEY: _ignored, ...env } = process.env;
  return spawnSync(process.execPath, [binary, ...args], {
    cwd: root,
    env,
    encoding: "utf8",
  });
}

describe("compiled CLI", () => {
  it("prints its version without a Linear API key", () => {
    const result = runBinary(["--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("0.1.0");
    expect(result.stderr).toBe("");
  });

  it("returns a structured auth error without leaking a key", () => {
    const result = runBinary([]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("AUTH_REQUIRED");
    expect(result.stdout).toContain("LINEAR_API_KEY");
    expect(result.stdout).not.toMatch(/lin_api/i);
    expect(result.stderr).toBe("");
  });

  it("uses the same safe auth behavior for doctor", () => {
    const result = runBinary(["doctor"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("AUTH_REQUIRED");
    expect(result.stdout).not.toMatch(/lin_api/i);
    expect(result.stderr).toBe("");
  });
});
