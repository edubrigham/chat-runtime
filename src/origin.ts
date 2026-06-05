/**
 * Browser-widget origin-allowlist + CORS helpers for the PUBLIC `/chat` path.
 *
 * `isOriginAllowed` is PORTED VERBATIM from the web app's
 * `src/lib/widget/origin-allowlist.ts` (exact match + `*.` wildcard prefix). The chat-runtime
 * is a standalone workspace and cannot import from `src/lib`, so the logic is copied here.
 * Keep the two in sync if either changes.
 */

/** Build CORS headers that reflect the request `origin` back to the caller. */
export function corsHeadersForOrigin(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
}

/**
 * Check whether `origin` matches at least one entry in the allow-list.
 * Supports exact match and wildcard prefix (e.g. `*.example.com`).
 */
export function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  let originUrl: URL
  try {
    originUrl = new URL(origin)
  } catch {
    return false
  }
  const normalizedOrigin = originUrl.origin.toLowerCase()

  const normalizeConfiguredOrigin = (value: string): string => {
    const trimmed = value.trim()
    if (!trimmed) return ''
    try {
      return new URL(trimmed).origin.toLowerCase()
    } catch {
      return trimmed.replace(/\/+$/, '').toLowerCase()
    }
  }

  for (const pattern of allowedOrigins) {
    const normalizedPattern = normalizeConfiguredOrigin(pattern)
    if (!normalizedPattern) continue
    if (normalizedPattern === normalizedOrigin) return true

    // Wildcard prefix: *.example.com  ->  matches sub.example.com
    if (normalizedPattern.startsWith('*.')) {
      const suffix = normalizedPattern.slice(1) // .example.com
      const hostname = originUrl.hostname.toLowerCase()
      if (hostname.endsWith(suffix) && hostname !== suffix.slice(1)) {
        return true
      }
    }
  }
  return false
}
