import { AxiError } from "./errors.js";

function flagEqualsPrefix(flag: string): string {
  return `${flag}=`;
}

/** Get a flag's value from --flag value or --flag=value without modifying args. */
export function getFlag(args: string[], name: string): string | undefined {
  const equalsPrefix = flagEqualsPrefix(name);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === name) {
      if (i + 1 >= args.length) return "";
      return args[i + 1];
    }
    if (arg.startsWith(equalsPrefix)) {
      return arg.slice(equalsPrefix.length);
    }
  }
  return undefined;
}

/** Get a flag's value from --flag value or --flag=value and remove it from args. */
export function takeFlag(args: string[], flag: string): string | undefined {
  const equalsPrefix = flagEqualsPrefix(flag);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === flag) {
      const val = args[i + 1];
      args.splice(i, 2);
      return val;
    }
    if (arg.startsWith(equalsPrefix)) {
      const val = arg.slice(equalsPrefix.length);
      args.splice(i, 1);
      return val;
    }
  }
  return undefined;
}

/** Check if a boolean flag is present. */
export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

/** Check if a boolean flag is present and remove it from args. */
export function takeBoolFlag(args: string[], flag: string): boolean {
  const idx = args.indexOf(flag);
  if (idx === -1) return false;
  args.splice(idx, 1);
  return true;
}

function requireFlagValue(value: string, flag: string): string {
  if (value.trim() === "")
    throw new AxiError(`${flag} requires a value`, "VALIDATION_ERROR");
  return value;
}

/** Get the first positional arg (non-flag) starting from startIndex. */
export function getPositional(
  args: string[],
  startIndex: number,
): string | undefined {
  for (let i = startIndex; i < args.length; i++) {
    if (!args[i].startsWith("-")) return args[i];
  }
  return undefined;
}

export function requirePositional(
  args: string[],
  startIndex: number,
  label: string,
): string {
  const value = getPositional(args, startIndex);
  if (!value) {
    throw new AxiError(`Missing ${label}`, "VALIDATION_ERROR", [
      `Pass ${label} as a positional argument`,
    ]);
  }
  return value;
}

export function parseLimit(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n <= 0) {
    throw new AxiError(`Invalid --limit: ${raw}`, "VALIDATION_ERROR");
  }
  return n;
}

function flagName(arg: string): string {
  const eq = arg.indexOf("=");
  return eq === -1 ? arg : arg.slice(0, eq);
}

/**
 * Fail loud on unrecognized flags. Never silently drop them.
 * `--help` is always allowed. Lists valid flags inline.
 */
export function assertNoUnknownFlags(
  args: string[],
  validFlags: string[],
  commandLabel: string,
): void {
  const known = new Set(validFlags);
  for (const arg of args) {
    if (arg === "--") break;
    if (!arg.startsWith("-") || arg === "-") continue;
    const name = flagName(arg);
    if (name === "--help") continue;
    if (!known.has(name)) {
      throw new AxiError(
        `unknown flag ${name} for \`${commandLabel}\`. valid flags: ${validFlags.join(", ")} (--help always allowed)`,
        "VALIDATION_ERROR",
        [`Run \`linear-axi ${commandLabel} --help\``],
      );
    }
  }
}

export function requireFlagArg(args: string[], flag: string): string {
  if (!hasFlag(args, flag) && !args.some((a) => a.startsWith(`${flag}=`))) {
    throw new AxiError(`${flag} is required`, "VALIDATION_ERROR");
  }
  const value = getFlag(args, flag);
  if (value === undefined || value.trim() === "" || value.startsWith("--")) {
    throw new AxiError(`${flag} requires a value`, "VALIDATION_ERROR");
  }
  return value;
}

export function optionalFlagArg(
  args: string[],
  flag: string,
): string | undefined {
  if (!hasFlag(args, flag) && !args.some((a) => a.startsWith(`${flag}=`))) {
    return undefined;
  }
  const value = getFlag(args, flag);
  if (value === undefined || value.trim() === "" || value.startsWith("--")) {
    throw new AxiError(`${flag} requires a value`, "VALIDATION_ERROR");
  }
  return value;
}

/** Read a repeatable value flag such as --label one --label two. */
export function repeatableFlagArgs(args: string[], flag: string): string[] {
  const values: string[] = [];
  const equalsPrefix = `${flag}=`;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    let value: string | undefined;
    if (arg === flag) {
      value = args[index + 1];
      index++;
    } else if (arg.startsWith(equalsPrefix)) {
      value = arg.slice(equalsPrefix.length);
    } else {
      continue;
    }

    if (value === undefined || value.trim() === "" || value.startsWith("--")) {
      throw new AxiError(`${flag} requires a value`, "VALIDATION_ERROR");
    }
    values.push(value);
  }

  return values;
}
