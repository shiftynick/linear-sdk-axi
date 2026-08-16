import { encode } from "@toon-format/toon";
import { AxiError } from "./errors.js";

type VerificationState = Record<string, unknown>;

function normalized(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalized).sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalized(child)]),
    );
  }
  return value;
}

export function assertVerificationMode(dryRun: boolean, verify: boolean): void {
  if (dryRun && verify) {
    throw new AxiError("--verify cannot be combined with --dry-run", "VALIDATION_ERROR");
  }
}

export async function verifyWrite(
  intended: VerificationState,
  readObserved: () => Promise<VerificationState>,
): Promise<string> {
  let observed: VerificationState;
  try {
    observed = await readObserved();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AxiError(
      `Write applied but verification read failed: ${detail}`,
      "UNKNOWN",
      [`intended: ${JSON.stringify(intended)}`],
    );
  }
  const expected = normalized(intended);
  const actual = normalized(observed);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new AxiError("Write verification did not match intended state", "UNKNOWN", [
      `intended: ${JSON.stringify(intended)}`,
      `observed: ${JSON.stringify(observed)}`,
    ]);
  }
  return encode({ verification: { matched: true, intended, observed } });
}
