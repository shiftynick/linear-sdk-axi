import { describe, expect, it } from "vitest";
import { truncateBody, wasTruncated } from "../src/body.js";
import { formatCountLine } from "../src/format.js";
import { renderError, renderHelp } from "../src/toon.js";

describe("truncateBody", () => {
  it("returns short text unchanged", () => {
    expect(truncateBody("hello", 500)).toBe("hello");
    expect(wasTruncated("hello", 500)).toBe(false);
  });

  it("returns empty for non-strings", () => {
    expect(truncateBody(null)).toBe("");
    expect(truncateBody(undefined)).toBe("");
    expect(truncateBody(12)).toBe("");
  });

  it("truncates long text with a size hint", () => {
    const body = "x".repeat(8432);
    const result = truncateBody(body, 500);
    expect(result.startsWith("x".repeat(500))).toBe(true);
    expect(result).toContain("... (truncated, 8432 chars total");
    expect(result).toContain("use --full");
    expect(wasTruncated(body, 500)).toBe(true);
  });
});

describe("formatCountLine", () => {
  it("formats a simple count", () => {
    expect(formatCountLine({ count: 3 })).toBe("count: 3");
  });

  it("formats count of total", () => {
    expect(formatCountLine({ count: 20, totalCount: 47 })).toBe(
      "count: 20 of 47 total",
    );
  });

  it("formats showing-first when hitting the limit", () => {
    expect(formatCountLine({ count: 30, limit: 30 })).toBe(
      "count: 30 (showing first 30)",
    );
  });
});

describe("renderHelp", () => {
  it("renders a numbered help block", () => {
    const out = renderHelp(["line1", "line2"]);
    expect(out).toBe("help[2]:\n  line1\n  line2");
  });

  it("returns empty string for no lines", () => {
    expect(renderHelp([])).toBe("");
  });
});

describe("renderError", () => {
  it("includes error and code", () => {
    const out = renderError("boom", "VALIDATION_ERROR", ["try again"]);
    expect(out).toContain("boom");
    expect(out).toContain("VALIDATION_ERROR");
    expect(out).toContain("try again");
  });
});
