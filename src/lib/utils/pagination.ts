export function parsePagination(searchParams: URLSearchParams): {
  limit: number;
  offset: number;
} {
  const rawLimit = parseInt(searchParams.get("limit") || "50", 10);
  const rawOffset = parseInt(searchParams.get("offset") || "0", 10);
  const limit = Math.min(Math.max(Number.isNaN(rawLimit) ? 50 : rawLimit, 1), 100);
  const offset = Math.min(Math.max(Number.isNaN(rawOffset) ? 0 : rawOffset, 0), 10000);
  return { limit, offset };
}
