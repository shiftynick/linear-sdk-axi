import { AxiError } from "./errors.js";

export const LINEAR_LIMITS = {
  projectDescription: 255,
} as const;

export function assertMaxLength(
  value: string | undefined,
  maximum: number,
  label: string,
): void {
  if (value === undefined || value.length <= maximum) return;
  throw new AxiError(
    `${label} must be ${maximum} characters or fewer (received ${value.length})`,
    "VALIDATION_ERROR",
  );
}
