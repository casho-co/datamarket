export function parsePagination(searchParams: URLSearchParams): {
  limit: number;
  offset: number;
} {
  const limit = Math.min(
    Math.max(parseInt(searchParams.get("limit") || "50", 10), 1),
    100
  );
  const offset = Math.min(
    Math.max(parseInt(searchParams.get("offset") || "0", 10), 0),
    10000
  );
  return { limit, offset };
}
