import { decode, type JsonValue } from "@toon-format/toon";
import { AxiError } from "./errors.js";

export type OutputFormat = "toon" | "json";

export function parseOutputArgs(argv: string[]): {
  format: OutputFormat;
  argv: string[];
} {
  let format: OutputFormat = "toon";
  const stripped: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    let value: string | undefined;
    if (arg === "--output") {
      value = argv[index + 1];
      index++;
    } else if (arg.startsWith("--output=")) {
      value = arg.slice("--output=".length);
    } else {
      stripped.push(arg);
      continue;
    }
    if (value !== "toon" && value !== "json") {
      throw new AxiError("--output must be toon or json", "VALIDATION_ERROR");
    }
    format = value;
  }
  return { format, argv: stripped };
}

const EMPTY_LIST_KEYS = new Set([
  "comments",
  "cycles",
  "issues",
  "labels",
  "projectStatuses",
  "projectUpdates",
  "projects",
  "relations",
  "states",
  "subIssues",
  "teams",
  "users",
]);

function normalize(value: JsonValue, key?: string): JsonValue {
  if (typeof value === "string" && key && EMPTY_LIST_KEYS.has(key) && /^0\b/.test(value)) {
    return [];
  }
  if (Array.isArray(value)) return value.map((item) => normalize(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        normalize(child, childKey),
      ]),
    ) as JsonValue;
  }
  return value;
}

function commandName(argv: string[]): string {
  const command = argv[0];
  if (!command || command.startsWith("-")) return "root";
  const action = argv[1];
  return action && !action.startsWith("-") ? `${command} ${action}` : command;
}

function helpArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value !== "") return [value];
  return undefined;
}

function extractRenderedHelp(text: string): { body: string; help?: string[] } {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^help\[\d+\]:$/.test(line));
  if (start === -1) return { body: text };
  let end = start + 1;
  while (end < lines.length && lines[end].startsWith("  ")) end++;
  const body = [...lines.slice(0, start), ...lines.slice(end)].join("\n").trim();
  const help = lines
    .slice(start + 1, end)
    .map((line) => line.slice(2).trimEnd())
    .filter(Boolean);
  return { body, help };
}

export function jsonOutput(raw: string, argv: string[], exitCode: number): string {
  const text = raw.trim();
  const command = commandName(argv);
  const helpMode = argv.includes("--help");
  const versionMode = argv.some((arg) => ["-v", "-V", "--version"].includes(arg));

  if (helpMode) {
    return JSON.stringify({ schemaVersion: 1, ok: true, command, data: null, help: [text] });
  }
  if (versionMode && exitCode === 0) {
    return JSON.stringify({
      schemaVersion: 1,
      ok: true,
      command: "version",
      data: { version: text },
    });
  }

  const extracted = extractRenderedHelp(text);
  let decoded: JsonValue;
  try {
    decoded = normalize(decode(extracted.body, { strict: false }));
  } catch {
    decoded = { text: extracted.body };
  }

  if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) {
    const record = decoded as Record<string, JsonValue>;
    if (typeof record.error === "string") {
      return JSON.stringify({
        schemaVersion: 1,
        ok: false,
        command,
        error: {
          code: typeof record.code === "string" ? record.code : "UNKNOWN",
          message: record.error,
          ...(extracted.help ?? helpArray(record.help)
            ? { help: extracted.help ?? helpArray(record.help) }
            : {}),
        },
      });
    }
    const { help, ...data } = record;
    const renderedHelp = extracted.help ?? helpArray(help);
    return JSON.stringify({
      schemaVersion: 1,
      ok: exitCode === 0,
      command,
      data,
      ...(renderedHelp ? { help: renderedHelp } : {}),
    });
  }

  return JSON.stringify({
    schemaVersion: 1,
    ok: exitCode === 0,
    command,
    data: decoded,
  });
}
