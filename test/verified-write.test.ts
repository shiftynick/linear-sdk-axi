import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLinearClientForTests } from "../src/client.js";
import { main } from "../src/cli.js";
import { AxiError } from "../src/errors.js";
import { verifyWrite } from "../src/verification.js";
import { createMockLinear, makeIssue, stateByType } from "./mock.js";

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

function expectVerified(result: { out: string; exit: number }) {
  expect(result.exit).toBe(0);
  expect(result.out).toContain("verification:");
  expect(result.out).toContain("matched: true");
  expect(result.out).toContain("intended:");
  expect(result.out).toContain("observed:");
}

beforeEach(() => {
  process.exitCode = undefined;
});

afterEach(() => {
  setLinearClientForTests(undefined);
  process.exitCode = undefined;
});

describe("verified writes", () => {
  it("rejects combining verification with dry-run", async () => {
    const { client } = createMockLinear();
    setLinearClientForTests(client);

    const issue = await run([
      "issue", "create", "--title", "Impossible mode", "--team", "ENG",
      "--dry-run", "--verify",
    ]);
    const project = await run([
      "project", "create", "--name", "Impossible mode", "--team", "ENG",
      "--dry-run", "--verify",
    ]);

    for (const result of [issue, project]) {
      expect(result.exit).toBe(2);
      expect(result.out).toContain("--verify cannot be combined with --dry-run");
    }
  });

  it("verifies issue create, update, no-op update, and close from fresh reads", async () => {
    const { client } = createMockLinear();
    setLinearClientForTests(client);

    const created = await run([
      "issue", "create", "--title", "Verified issue", "--team", "ENG",
      "--priority", "2", "--verify",
    ]);
    expectVerified(created);

    const updated = await run([
      "issue", "update", "ENG-100", "--title", "Verified update", "--verify",
    ]);
    expectVerified(updated);
    expect(updated.out).toContain("title: Verified update");

    const noop = await run([
      "issue", "update", "ENG-100", "--title", "Verified update", "--verify",
    ]);
    expectVerified(noop);
    expect(noop.out).toContain("already in desired state");

    const closed = await run(["issue", "close", "ENG-100", "--verify"]);
    expectVerified(closed);
    expect(closed.out).toContain("stateId:");
  });

  it("verifies relation creation and removal semantically", async () => {
    const source = makeIssue({ id: "source", identifier: "ENG-10", title: "Source" });
    const target = makeIssue({ id: "target", identifier: "ENG-11", title: "Target" });
    const { client } = createMockLinear({ issues: [source, target] });
    setLinearClientForTests(client);

    const added = await run([
      "issue", "relation", "add", "ENG-10", "--blocks", "ENG-11", "--verify",
    ]);
    expectVerified(added);
    expect(added.out).toContain("present: true");

    const removed = await run([
      "issue", "relation", "remove", "ENG-10", "--blocks", "ENG-11", "--verify",
    ]);
    expectVerified(removed);
    expect(removed.out).toContain("present: false");
  });

  it("verifies comments and replies by their returned ids", async () => {
    const issue = makeIssue({ id: "issue-1", identifier: "ENG-20", title: "Comments" });
    const { client } = createMockLinear({ issues: [issue] });
    setLinearClientForTests(client);

    const comment = await run([
      "issue", "comment", "ENG-20", "--body", "Verified comment", "--verify",
    ]);
    expectVerified(comment);
    expect(comment.out).toContain("body: Verified comment");
  });

  it("verifies project create, update, and milestone update", async () => {
    const { client } = createMockLinear();
    setLinearClientForTests(client);

    const created = await run([
      "project", "create", "--name", "Verified project", "--team", "ENG",
      "--priority", "2", "--verify",
    ]);
    expectVerified(created);
    expect(created.out).toContain("teamIds");

    const updated = await run([
      "project", "update", "Verified project", "--name", "Verified launch",
      "--target-date", "2026-10-01", "--verify",
    ]);
    expectVerified(updated);
    expect(updated.out).toContain("targetDate: 2026-10-01");

    const milestone = await run([
      "project", "updates", "create", "Verified launch",
      "--body", "All checks passed", "--health", "on-track", "--verify",
    ]);
    expectVerified(milestone);
    expect(milestone.out).toContain("health: onTrack");
  });

  it("fails closed when the fresh issue state does not match", async () => {
    const issue = makeIssue({
      id: "issue-1",
      identifier: "ENG-30",
      title: "Original",
      state: stateByType("started"),
    });
    const { client, spies } = createMockLinear({ issues: [issue] });
    spies.updateIssue.mockImplementation(async () => ({ success: true }));
    setLinearClientForTests(client);

    const result = await run([
      "issue", "update", "ENG-30", "--title", "Not persisted", "--verify",
    ]);

    expect(result.exit).toBe(1);
    expect(result.out).toContain("Write verification did not match intended state");
    expect(result.out).toContain("intended:");
    expect(result.out).toContain("observed:");
  });

  it("fails closed with intended-state evidence when the fresh read throws", async () => {
    let caught: AxiError | undefined;
    try {
      await verifyWrite({ title: "Persisted" }, async () => {
        throw new Error("fresh read unavailable");
      });
    } catch (error) {
      caught = error as AxiError;
    }

    expect(caught).toBeInstanceOf(AxiError);
    expect(caught?.message).toContain("Write applied but verification read failed");
    expect(caught?.message).toContain("fresh read unavailable");
    expect(caught?.code).toBe("UNKNOWN");
    expect(caught?.suggestions).toContain('intended: {"title":"Persisted"}');
  });

  it("preserves the default write output when verification is not requested", async () => {
    const issue = makeIssue({ id: "issue-1", identifier: "ENG-40", title: "Default" });
    const { client } = createMockLinear({ issues: [issue] });
    setLinearClientForTests(client);

    const result = await run([
      "issue", "update", "ENG-40", "--title", "Normal write",
    ]);

    expect(result.exit).toBe(0);
    expect(result.out).not.toContain("verification:");
  });

  it("includes verification in the versioned JSON envelope", async () => {
    const issue = makeIssue({ id: "issue-1", identifier: "ENG-50", title: "JSON" });
    const { client } = createMockLinear({ issues: [issue] });
    setLinearClientForTests(client);

    const result = await run([
      "issue", "update", "ENG-50", "--title", "JSON verified",
      "--verify", "--output", "json",
    ]);

    expect(result.exit).toBe(0);
    const envelope = JSON.parse(result.out) as {
      schemaVersion: number;
      data: { verification?: { matched?: boolean } };
    };
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.data.verification?.matched).toBe(true);
  });
});
