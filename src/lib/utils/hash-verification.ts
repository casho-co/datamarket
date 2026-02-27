import { createHash } from "crypto";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024; // 50MB max for hash verification

/**
 * Verify that the content at a URL matches the provided SHA-256 hash.
 * Downloads the content and computes the hash to compare.
 */
export async function verifySha256(
  url: string,
  expectedHash: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    // Normalize hash (strip optional sha256: prefix)
    const normalizedExpected = expectedHash
      .replace(/^sha256:/, "")
      .toLowerCase();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { "User-Agent": "DatalayerMarket/1.0 HashVerifier" },
      redirect: "follow",
    });

    clearTimeout(timer);

    if (!res.ok) {
      return {
        ok: false,
        reason: `URL returned HTTP ${res.status} — cannot verify hash`,
      };
    }

    // Check content-length before downloading
    const contentLength = res.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_DOWNLOAD_BYTES) {
      return {
        ok: false,
        reason: `Content too large for hash verification (${contentLength} bytes, max ${MAX_DOWNLOAD_BYTES})`,
      };
    }

    const buffer = await res.arrayBuffer();

    if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
      return {
        ok: false,
        reason: `Content too large for hash verification (${buffer.byteLength} bytes)`,
      };
    }

    const hash = createHash("sha256")
      .update(Buffer.from(buffer))
      .digest("hex")
      .toLowerCase();

    if (hash !== normalizedExpected) {
      return {
        ok: false,
        reason: `Hash mismatch: expected ${normalizedExpected.slice(0, 16)}..., got ${hash.slice(0, 16)}...`,
      };
    }

    return { ok: true };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, reason: "Hash verification timed out after 15 seconds" };
    }
    return {
      ok: false,
      reason: `Hash verification failed: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

/**
 * Compute SHA-256 hash of inline text content.
 */
export function hashInlineContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
