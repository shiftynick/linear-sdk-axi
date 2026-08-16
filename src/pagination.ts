import { AxiError } from "./errors.js";
import { hasFlag, optionalFlagArg, parseLimit } from "./args.js";

export type PaginationRequest = {
  pageSize: number;
  after?: string;
  all: boolean;
  maxItems: number;
};

export type PageInfo = {
  endCursor: string | null;
  hasNextPage: boolean;
};

export type PaginationInfo = PageInfo & {
  pagesFetched: number;
  capped: boolean;
};

export type CollectionResult<T> = {
  nodes: T[];
  totalCount: number;
  pagination: PaginationInfo;
};

type Connection<T> = {
  nodes?: T[];
  totalCount?: number;
  pageInfo?: Partial<PageInfo>;
};

export const PAGINATION_FLAGS = ["--limit", "--after", "--all", "--max-items"];

export function singlePage(pageSize: number, after?: string): PaginationRequest {
  return { pageSize, ...(after ? { after } : {}), all: false, maxItems: pageSize };
}

export function parsePagination(
  args: string[],
  defaultPageSize: number,
): PaginationRequest {
  const pageSize = parseLimit(optionalFlagArg(args, "--limit"), defaultPageSize);
  const after = optionalFlagArg(args, "--after");
  const all = hasFlag(args, "--all");
  const maxRaw = optionalFlagArg(args, "--max-items");

  if (all && maxRaw === undefined) {
    throw new AxiError("--all requires --max-items <n>", "VALIDATION_ERROR", [
      "Set an explicit upper bound, for example `--all --max-items 200`",
    ]);
  }
  if (!all && maxRaw !== undefined) {
    throw new AxiError("--max-items requires --all", "VALIDATION_ERROR");
  }

  const maxItems = all ? parseLimit(maxRaw, pageSize) : pageSize;
  return { pageSize: Math.min(pageSize, maxItems), after, all, maxItems };
}

export async function paginate<T>(
  request: PaginationRequest,
  fetchPage: (input: { first: number; after?: string }) => Promise<Connection<T>>,
): Promise<CollectionResult<T>> {
  const nodes: T[] = [];
  const seenCursors = new Set<string>();
  let after = request.after;
  let endCursor: string | null = null;
  let hasNextPage = false;
  let totalCount = 0;
  let pagesFetched = 0;

  do {
    const remaining = request.maxItems - nodes.length;
    const connection = await fetchPage({
      first: Math.min(request.pageSize, remaining),
      ...(after ? { after } : {}),
    });
    pagesFetched++;
    const pageNodes = Array.isArray(connection.nodes) ? connection.nodes : [];
    nodes.push(...pageNodes.slice(0, remaining));
    if (pagesFetched === 1) {
      totalCount = typeof connection.totalCount === "number"
        ? connection.totalCount
        : pageNodes.length;
    }
    endCursor = typeof connection.pageInfo?.endCursor === "string"
      ? connection.pageInfo.endCursor
      : null;
    hasNextPage = Boolean(connection.pageInfo?.hasNextPage);

    if (!request.all || !hasNextPage || nodes.length >= request.maxItems) break;
    if (!endCursor || seenCursors.has(endCursor)) {
      throw new AxiError(
        "Linear returned an unusable pagination cursor",
        "UNKNOWN",
      );
    }
    seenCursors.add(endCursor);
    after = endCursor;
  } while (nodes.length < request.maxItems);

  return {
    nodes,
    totalCount,
    pagination: {
      endCursor,
      hasNextPage,
      pagesFetched,
      capped: hasNextPage && nodes.length >= request.maxItems,
    },
  };
}
