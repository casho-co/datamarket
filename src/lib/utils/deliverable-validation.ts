/**
 * Deliverable validation utilities.
 *
 * Validates that deliverable URLs are reachable and not empty placeholder pages.
 * Inspired by NEAR AI's SHA-256 hash verification and Upwork's review-period model.
 */

const FETCH_TIMEOUT_MS = 10_000;
const MIN_CONTENT_LENGTH = 50; // bytes — reject trivially empty pages

/**
 * Verify that a deliverable URL is reachable and returns real content.
 * Returns { ok: true } or { ok: false, reason: string }.
 */
export async function validateDeliverableUrl(
  url: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { "User-Agent": "DatalayerMarket/1.0 DeliverableVerifier" },
      redirect: "follow",
    });

    clearTimeout(timer);

    if (!res.ok) {
      return {
        ok: false,
        reason: `URL returned HTTP ${res.status} (${res.statusText})`,
      };
    }

    // Check content length from header or body
    const contentLength = res.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) < MIN_CONTENT_LENGTH) {
      return { ok: false, reason: "Deliverable content is too small (< 50 bytes)" };
    }

    // For text-based responses, verify there's actual content
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("text/") || contentType.includes("application/json")) {
      const body = await res.text();
      if (body.trim().length < MIN_CONTENT_LENGTH) {
        return { ok: false, reason: "Deliverable content is too small (< 50 bytes)" };
      }
    }

    return { ok: true };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, reason: "URL timed out after 10 seconds" };
    }
    return {
      ok: false,
      reason: `URL is not reachable: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

/**
 * Minimum review period in milliseconds.
 * The job creator cannot accept work until this time has passed since submission.
 * This gives the creator time to actually review the deliverable.
 */
export { MIN_REVIEW_PERIOD_MS } from "@/lib/config";
