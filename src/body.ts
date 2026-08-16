import { readFileSync } from "node:fs";
import { AxiError } from "./errors.js";

interface BodyFlagMatch {
  flag: string;
  value: string | undefined;
}

interface TakeBodyOptions {
  required?: boolean;
  inlineFlags?: string[];
  fileFlags?: string[];
  valueBoundaryFlags?: string[];
  label?: string;
  suggestions?: string[];
}

export interface TruncateBodyOptions {
  fullHint?: string;
}

function defaultSuggestions(label: string): string[] {
  return [
    `Use --body "..." for inline ${label}, or --body-file for markdown from a file`,
  ];
}

function isMissingValue(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

function isValueBoundary(arg: string | undefined, flags: string[]): boolean {
  if (arg === undefined) return false;
  if (arg.startsWith("--")) return true;
  return flags.some((flag) => arg === flag || arg.startsWith(`${flag}=`));
}

function takeFlagMatches(
  args: string[],
  flags: string[],
  valueBoundaryFlags: string[],
): BodyFlagMatch[] {
  const matches: BodyFlagMatch[] = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];

    for (const flag of flags) {
      const equalsPrefix = `${flag}=`;
      if (arg === flag) {
        const next = args[index + 1];
        const value =
          next !== undefined && !isValueBoundary(next, valueBoundaryFlags)
            ? next
            : undefined;
        const consumeCount = value === undefined ? 1 : 2;
        args.splice(index, consumeCount);
        index--;
        matches.push({ flag, value });
        break;
      }

      if (arg.startsWith(equalsPrefix)) {
        args.splice(index, 1);
        index--;
        matches.push({ flag, value: arg.slice(equalsPrefix.length) });
        break;
      }
    }
  }

  return matches;
}

function readBodyFile(flag: string, path: string, suggestions: string[]): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as NodeJS.ErrnoException).code)
        : "UNKNOWN";
    if (code === "ENOENT") {
      throw new AxiError(
        `${flag} path not found: ${path}`,
        "VALIDATION_ERROR",
        suggestions,
      );
    }
    if (code === "EISDIR") {
      throw new AxiError(
        `${flag} must point to a readable UTF-8 file, not a directory: ${path}`,
        "VALIDATION_ERROR",
        suggestions,
      );
    }
    throw new AxiError(
      `Could not read ${flag} path: ${path} (${code})`,
      "VALIDATION_ERROR",
      suggestions,
    );
  }
}

export function takeBody(
  args: string[],
  options: TakeBodyOptions & { required: true },
): string;
export function takeBody(
  args: string[],
  options?: TakeBodyOptions,
): string | undefined;
export function takeBody(
  args: string[],
  options: TakeBodyOptions = {},
): string | undefined {
  const inlineFlags = options.inlineFlags ?? ["--body", "--description"];
  const fileFlags = options.fileFlags ?? ["--body-file"];
  const valueBoundaryFlags = [
    ...new Set([
      ...inlineFlags,
      ...fileFlags,
      ...(options.valueBoundaryFlags ?? []),
    ]),
  ];
  const label = options.label ?? "body";
  const suggestions = options.suggestions ?? defaultSuggestions(label);
  const inlineMatches = takeFlagMatches(args, inlineFlags, valueBoundaryFlags);
  const fileMatches = takeFlagMatches(args, fileFlags, valueBoundaryFlags);
  const matches = [...inlineMatches, ...fileMatches];

  if (matches.length === 0) {
    if (options.required) {
      throw new AxiError(
        `${inlineFlags[0]} or ${fileFlags[0]} is required`,
        "VALIDATION_ERROR",
        suggestions,
      );
    }
    return undefined;
  }

  if (matches.length > 1) {
    throw new AxiError(
      `Use only one ${label} source: ${matches.map((m) => m.flag).join(", ")} were provided`,
      "VALIDATION_ERROR",
      suggestions,
    );
  }

  const match = matches[0];
  const value = match.value;
  if (isMissingValue(value)) {
    const noun = fileFlags.includes(match.flag) ? "path" : "text";
    throw new AxiError(
      `${match.flag} requires ${noun}`,
      "VALIDATION_ERROR",
      suggestions,
    );
  }
  const resolvedValue = value ?? "";

  if (fileFlags.includes(match.flag)) {
    return readBodyFile(match.flag, resolvedValue, suggestions);
  }

  return resolvedValue;
}

/**
 * Truncate a body field for display.
 * Never omits the field entirely — includes a preview plus a size hint.
 * Suggest --full only when truncated.
 */
export function truncateBody(
  body: unknown,
  maxLen = 500,
  options: TruncateBodyOptions = {},
): string {
  if (typeof body !== "string" || !body) return "";
  if (body.length <= maxLen) return body;
  const fullHint = options.fullHint ?? "use --full to see complete body";
  return (
    body.slice(0, maxLen) +
    "\n... (truncated, " +
    body.length +
    " chars total - " +
    fullHint +
    ")"
  );
}

export function wasTruncated(body: unknown, maxLen = 500): boolean {
  return typeof body === "string" && body.length > maxLen;
}
