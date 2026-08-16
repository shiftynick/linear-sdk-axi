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

async function run(argv: string[]) {
  process.exitCode = undefined;
  const output = capture();
  await main({ argv, stdout: output.stdout });
  return {
    value: JSON.parse(output.text()) as Record<string, unknown>,
    raw: output.text(),
    exit: process.exitCode ?? 0,
  };
}

beforeEach(() => {
  process.exitCode = undefined;
});

afterEach(() => {
  setLinearClientForTests(undefined);
  process.exitCode = undefined;
});

describe("JSON output contract", () => {
  it("emits one stable envelope for successful command data", async () => {
    const { client } = createMockLinear({
      issues: [makeIssue({ id: "i1", identifier: "ENG-1", title: "Stable output" })],
    });
    setLinearClientForTests(client);

    const { value, raw, exit } = await run([
      "issue", "list", "--team", "ENG", "--output", "json",
    ]);

    expect(exit).toBe(0);
    expect(value).toMatchObject({
      schemaVersion: 1,
      ok: true,
      command: "issue list",
    });
    const data = value.data as Record<string, unknown>;
    expect(data.issues).toEqual([
      { identifier: "ENG-1", title: "Stable output", state: "In Progress", team: "ENG" },
    ]);
    expect(data.pagination).toMatchObject({ hasNextPage: false, pagesFetched: 1 });
    expect(raw.trim().startsWith("{")).toBe(true);
    expect(raw.trim().endsWith("}")).toBe(true);
    expect(raw).not.toContain("issues[1]");
  });

  it("normalizes empty collections to arrays", async () => {
    const { client } = createMockLinear({ issues: [] });
    setLinearClientForTests(client);

    const { value, exit } = await run([
      "issue", "list", "--team", "ENG", "--output=json",
    ]);

    expect(exit).toBe(0);
    expect((value.data as Record<string, unknown>).issues).toEqual([]);
  });

  it("emits structured errors without mixed stdout", async () => {
    const { client } = createMockLinear();
    setLinearClientForTests(client);

    const { value, raw, exit } = await run([
      "issue", "list", "--bogus", "--output", "json",
    ]);

    expect(exit).toBe(2);
    expect(value).toMatchObject({
      schemaVersion: 1,
      ok: false,
      command: "issue list",
      error: { code: "VALIDATION_ERROR" },
    });
    expect(JSON.parse(raw)).toEqual(value);
  });

  it("wraps help as a single JSON value", async () => {
    const { value, exit } = await run(["issue", "--help", "--output", "json"]);

    expect(exit).toBe(0);
    expect(value).toMatchObject({
      schemaVersion: 1,
      ok: true,
      command: "issue",
      data: null,
    });
    expect((value.help as string[])[0]).toContain("usage: linear-sdk-axi issue");
  });
});
