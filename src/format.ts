/**
 * Shared formatting helpers for consistent count phrasing.
 *
 * Standard phrases:
 * count: N — simple count
 * count: N of T total — when a total of at least N is known
 * count: N (showing first N) — when truncated by limit
 */

export interface CountLineOptions {
  /** Number of items returned / displayed. */
  count: number;
  /** The request limit; when count === limit, results may be truncated. */
  limit?: number;
  /** True total count from an API (e.g. GraphQL totalCount). */
  totalCount?: number;
  /** Display limit that further truncates results for output. */
  displayLimit?: number;
}

export function formatCountLine(opts: CountLineOptions): string {
  const { count, limit, totalCount, displayLimit } = opts;

  if (totalCount !== undefined && totalCount !== null && totalCount >= count) {
    return `count: ${count} of ${totalCount} total`;
  }

  if (displayLimit !== undefined && count > displayLimit) {
    return `count: ${count} (showing first ${displayLimit})`;
  }

  if (limit !== undefined && count === limit && count > 0) {
    return `count: ${count} (showing first ${count})`;
  }

  return `count: ${count}`;
}
