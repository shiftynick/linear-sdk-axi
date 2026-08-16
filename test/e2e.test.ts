import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const binary = fileURLToPath(new URL("../dist/bin/linear-sdk-axi.js", import.meta.url));
const packageVersion = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
).version as string;

function runBinary(args: string[]) {
  const {
    LINEAR_API_KEY: _ignored,
    LINEAR_SDK_AXI_AUTH_FILE: _ignoredAuthFile,
    ...env
  } = process.env;
  return spawnSync(process.execPath, [binary, ...args], {
    cwd: root,
    env: {
      ...env,
      LINEAR_SDK_AXI_AUTH_FILE: join(root, ".linear-sdk-axi-oauth-e2e-missing.json"),
    },
    encoding: "utf8",
  });
}

describe("compiled CLI", () => {
  it("prints its version without a Linear API key", () => {
    const result = runBinary(["--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(packageVersion);
    expect(result.stderr).toBe("");
  });

  it("prints the usage map without a Linear API key", () => {
    const result = runBinary(["usage", "issue"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("tier: issue");
    expect(result.stdout).toContain("linear-sdk-axi issue create");
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

  it("emits one JSON value for success, help, version, and auth errors", () => {
    for (const args of [
      ["usage", "issue", "--output", "json"],
      ["issue", "--help", "--output", "json"],
      ["--version", "--output", "json"],
      ["doctor", "--output", "json"],
    ]) {
      const result = runBinary(args);
      const value = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(value.schemaVersion).toBe(1);
      expect(typeof value.ok).toBe("boolean");
      expect(result.stderr).toBe("");
    }
  });
});
