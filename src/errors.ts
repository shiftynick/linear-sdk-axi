import { AxiError, exitCodeForError } from "axi-sdk-js";

export type ErrorCode =
  | "AUTH_REQUIRED"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "UNKNOWN";

export { AxiError, exitCodeForError };

const AUTH_HELP = [
  "Set LINEAR_API_KEY from Linear Settings -> API (https://linear.app/settings/api)",
  "Or run `linear-sdk-axi auth login --client-id <client-id>` after registering an OAuth app",
  "Never paste credentials into chat",
];

export function authRequiredError(): AxiError {
  return new AxiError(
    "No Linear credentials found. Set LINEAR_API_KEY or run `linear-sdk-axi auth login --client-id <client-id>`. Never paste credentials into chat.",
    "AUTH_REQUIRED",
    AUTH_HELP,
  );
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? "";
}

function sanitizeMessage(text: string): string {
  return firstLine(text).replace(/LinearClient/gi, "Linear API");
}

function statusOf(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const rec = err as Record<string, unknown>;
  for (const key of ["status", "statusCode", "httpStatus"]) {
    const val = rec[key];
    if (typeof val === "number") return val;
  }
  const errors = rec.errors;
  if (Array.isArray(errors) && errors[0] && typeof errors[0] === "object") {
    const first = errors[0] as Record<string, unknown>;
    const ext = first.extensions;
    if (ext && typeof ext === "object") {
      const st = (ext as Record<string, unknown>).status;
      if (typeof st === "number") return st;
    }
    if (typeof first.status === "number") return first.status;
  }
  const type = typeof rec.type === "string" ? rec.type : "";
  if (/auth/i.test(type)) return 401;
  if (/forbid/i.test(type)) return 403;
  if (/not.?found/i.test(type)) return 404;
  if (/rate/i.test(type)) return 429;
  return undefined;
}

export function mapLinearError(err: unknown): AxiError {
  if (err instanceof AxiError) return err;
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "Linear API request failed";
  const message = sanitizeMessage(raw);
  const status = statusOf(err);

  if (
    status === 401 ||
    /unauthor/i.test(message) ||
    /authentication/i.test(message) ||
    /invalid api key/i.test(message)
  ) {
    return new AxiError(
      "Linear authentication failed. Check LINEAR_API_KEY or run `linear-sdk-axi auth login` again.",
      "AUTH_REQUIRED",
      AUTH_HELP,
    );
  }
  if (status === 403 || /forbidden/i.test(message) || /permission/i.test(message)) {
    return new AxiError(
      "Insufficient permissions for this Linear action",
      "FORBIDDEN",
      ["Confirm the key's workspace access at Linear Settings → API"],
    );
  }
  if (status === 404 || /not found/i.test(message)) {
    return new AxiError(message || "Linear resource not found", "NOT_FOUND");
  }
  if (status === 429 || /rate limit/i.test(message)) {
    return new AxiError(
      "Linear API rate limit exceeded — wait and retry",
      "RATE_LIMITED",
      ["Wait briefly, then retry the same command"],
    );
  }
  return new AxiError(message || "Linear API request failed", "UNKNOWN");
}

export async function withLinearErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw mapLinearError(err);
  }
}
