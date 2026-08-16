import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { installSessionStartHooks } = vi.hoisted(() => ({
  installSessionStartHooks: vi.fn(),
}));

vi.mock("axi-sdk-js", async () => {
  const actual = await vi.importActual("axi-sdk-js");
  return {
    ...actual,
    installSessionStartHooks,
  };
});
import { setLinearClientForTests } from "../src/client.js";
import { main } from "../src/cli.js";
import { VERSION } from "../src/version.js";
import {
  createMockLinear,
  defaultTeam,
  defaultViewer,
  makeIssue,
  stateByType,
} from "./mock.js";

let originalApiKey: string | undefined;
let originalAuthFile: string | undefined;

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
  originalApiKey = process.env.LINEAR_API_KEY;
  originalAuthFile = process.env.LINEAR_SDK_AXI_AUTH_FILE;
  delete process.env.LINEAR_API_KEY;
  process.env.LINEAR_SDK_AXI_AUTH_FILE = join(
    tmpdir(),
    `linear-sdk-axi-cli-test-${process.pid}-${Date.now()}.json`,
  );
});

afterEach(() => {
  setLinearClientForTests(undefined);
  process.exitCode = undefined;
  if (originalApiKey === undefined) delete process.env.LINEAR_API_KEY;
  else process.env.LINEAR_API_KEY = originalApiKey;
  if (originalAuthFile === undefined) delete process.env.LINEAR_SDK_AXI_AUTH_FILE;
  else process.env.LINEAR_SDK_AXI_AUTH_FILE = originalAuthFile;
});

describe("version fast path", () => {
  it.each(["--version", "-v", "-V"])(
    "%s prints VERSION without needing a key",
    async (flag) => {
      const saved = process.env.LINEAR_API_KEY;
      delete process.env.LINEAR_API_KEY;
      try {
        const { out, exit } = await run([flag]);
        expect(out.trim()).toBe(VERSION);
        expect(out).toContain(VERSION);
        expect(exit).toBe(0);
      } finally {
        if (saved !== undefined) process.env.LINEAR_API_KEY = saved;
      }
    },
  );
});

describe("auth", () => {
  it("missing LINEAR_API_KEY returns AUTH_REQUIRED structured error, exit 1", async () => {
    const saved = process.env.LINEAR_API_KEY;
    delete process.env.LINEAR_API_KEY;
    setLinearClientForTests(undefined);
    try {
      const { out, exit } = await run([]);
      expect(exit).toBe(1);
      expect(out).toContain("AUTH_REQUIRED");
      expect(out).toContain("LINEAR_API_KEY");
      expect(out).toContain("Linear Settings");
      expect(out).not.toMatch(/lin_api/i);
    } finally {
      if (saved !== undefined) process.env.LINEAR_API_KEY = saved;
    }
  });
});

describe("help and unknown input", () => {
  it("top-level --help shows commands", async () => {
    const { out, exit } = await run(["--help"]);
    expect(exit).toBe(0);
    expect(out).toContain("issue");
    expect(out).toContain("project");
    expect(out).toContain("team");
    expect(out).toContain("me");
    expect(out).toContain("status");
    expect(out).toContain("auth");
    expect(out).toContain("setup");
  });

  it("issue --help is concise and mentions list/view/create/update/comment/close", async () => {
    const { out, exit } = await run(["issue", "--help"]);
    expect(exit).toBe(0);
    expect(out).toContain("list");
    expect(out).toContain("view");
    expect(out).toContain("create");
    expect(out).toContain("update");
    expect(out).toContain("comment");
    expect(out).toContain("close");
  });

  it("unknown command fails loud", async () => {
    const { out, exit } = await run(["nope"]);
    expect(exit).toBe(2);
    expect(out).toContain("VALIDATION_ERROR");
    expect(out).toMatch(/unknown command/i);
  });

  it("unknown flag fails loud", async () => {
    const { client } = createMockLinear();
    setLinearClientForTests(client);
    const { out, exit } = await run(["issue", "list", "--bogus"]);
    expect(exit).toBe(2);
    expect(out).toContain("VALIDATION_ERROR");
    expect(out).toContain("--bogus");
    expect(out).toMatch(/valid flags/i);
  });

  it("setup hooks with unknown action errors", async () => {
    const { out, exit } = await run(["setup", "widgets"]);
    expect(exit).toBe(2);
    expect(out).toContain("VALIDATION_ERROR");
    expect(out).toMatch(/unknown setup action/i);
  });
});

describe("OAuth auth commands", () => {
  it("reports unconfigured auth without requiring a Linear connection", async () => {
    const { out, exit } = await run(["auth", "status"]);
    expect(exit).toBe(0);
    expect(out).toContain("method: none");
    expect(out).toContain("oauthConfigured: no");
    expect(out).not.toMatch(/accessToken|refreshToken/i);
  });

  it("requires an OAuth client id before starting login", async () => {
    const { out, exit } = await run(["auth", "login"]);
    expect(exit).toBe(2);
    expect(out).toContain("OAuth client id is required");
    expect(out).toContain("LINEAR_SDK_AXI_OAUTH_CLIENT_ID");
  });
});

describe("dashboard", () => {
  it("includes viewer, identifiers/titles, and counts", async () => {
    const { client } = createMockLinear({
      issues: [
        makeIssue({
          id: "i1",
          identifier: "ENG-123",
          title: "Fix auth bug",
          state: stateByType("started"),
        }),
        makeIssue({
          id: "i2",
          identifier: "ENG-124",
          title: "Add pagination",
          state: stateByType("unstarted"),
        }),
      ],
    });
    setLinearClientForTests(client);
    const { out, exit } = await run([]);
    expect(exit).toBe(0);
    expect(out).toContain("bin:");
    expect(out).toContain("Agent-ergonomic Linear CLI wrapping @linear/sdk");
    expect(out).toContain("Alice");
    expect(out).toContain("alice@example.com");
    expect(out).toContain("ENG-123");
    expect(out).toContain("Fix auth bug");
    expect(out).toContain("ENG-124");
    expect(out).toMatch(/count:/);
    expect(out).toContain("started");
  });

  it("empty assigned issues is explicit 0", async () => {
    const { client } = createMockLinear({ issues: [] });
    setLinearClientForTests(client);
    const { out, exit } = await run([]);
    expect(exit).toBe(0);
    expect(out).toContain("0 assigned issues");
    expect(out).not.toMatch(/issues\[0\]/);
  });
});

describe("me", () => {
  it("shows viewer and assigned issue count", async () => {
    const { client } = createMockLinear({
      issues: [
        makeIssue({ id: "i1", identifier: "ENG-1", title: "A" }),
        makeIssue({ id: "i2", identifier: "ENG-2", title: "B" }),
      ],
    });
    setLinearClientForTests(client);
    const { out, exit } = await run(["me"]);
    expect(exit).toBe(0);
    expect(out).toContain(defaultViewer.id);
    expect(out).toContain("Alice");
    expect(out).toContain("alice@example.com");
    expect(out).toMatch(/assignedIssueCount: 2/);
  });
});

describe("status", () => {
  it("lists workflow states from the mock team", async () => {
    const { client } = createMockLinear();
    setLinearClientForTests(client);
    const { out, exit } = await run(["status"]);
    expect(exit).toBe(0);
    expect(out).toContain("Done");
    expect(out).toContain("completed");
    expect(out).toContain("In Progress");
    expect(out).toContain("started");
    expect(out).toContain(defaultTeam.key);
  });
});

describe("team and project empty states", () => {
  it("team list empty state", async () => {
    const { client } = createMockLinear({ teams: [] });
    setLinearClientForTests(client);
    const { out, exit } = await run(["team", "list"]);
    expect(exit).toBe(0);
    expect(out).toContain("0 teams");
  });

  it("project list empty state", async () => {
    const { client } = createMockLinear({ projects: [] });
    setLinearClientForTests(client);
    const { out, exit } = await run(["project", "list"]);
    expect(exit).toBe(0);
    expect(out).toContain("0 projects");
  });

  it("team list non-empty includes key and name", async () => {
    const { client } = createMockLinear();
    setLinearClientForTests(client);
    const { out, exit } = await run(["team", "list"]);
    expect(exit).toBe(0);
    expect(out).toContain("ENG");
    expect(out).toContain("Engineering");
  });
});

describe("setup hooks", () => {
  it("installs hooks via axi-sdk-js", async () => {
    installSessionStartHooks.mockReset();
    const { out, exit } = await run(["setup", "hooks"]);
    expect(exit).toBe(0);
    expect(installSessionStartHooks).toHaveBeenCalledWith({
      marker: "linear-sdk-axi",
      binaryNames: ["linear-sdk-axi"],
    });
    expect(out).toContain("installed");
  });
});
