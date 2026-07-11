/**
 * Normalize raw user input into a canonical 7-digit postal code string.
 *
 * Handles the realities of Japanese form input:
 *  - full-width digits:      １５００００２ → 1500002
 *  - postal mark:            〒150-0002   → 1500002
 *  - every hyphen variant:   - − – — ー ‐ ｰ 〜 ~
 *  - stray whitespace (incl. full-width space)
 *
 * Returns the 7-digit code, or null if the input does not contain
 * exactly 7 digits after cleaning.
 */
export function normalizePostalCode(raw: string): string | null {
  if (!raw) return null

  const digits = raw
    // full-width digits → half-width
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    // strip everything that is not an ASCII digit (kills 〒, hyphens, spaces)
    .replace(/[^0-9]/g, '')

  return digits.length === 7 ? digits : null
}

/** True when the input already resolves to a valid-looking 7-digit code. */
export function isCompletePostalCode(raw: string): boolean {
  return normalizePostalCode(raw) !== null
}

/** Format a 7-digit code as "150-0002" for display. */
export function formatPostalCode(code: string): string {
  const normalized = normalizePostalCode(code)
  if (!normalized) return code
  return `${normalized.slice(0, 3)}-${normalized.slice(3)}`
}
