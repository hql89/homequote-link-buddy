/**
 * Turning a CSLB licence record into a name fit for a public listing page.
 *
 * Deliberately free of Deno APIs and remote imports so the unit tests can
 * import it directly — this logic decides what a homeowner reads, and it is
 * not something to verify by eyeballing production rows.
 *
 * Two problems in the source data:
 *
 *  1. A licence held by an individual under their own name is stored surname
 *     first: "GREKOV GEORGIY". Published verbatim it reads as a database
 *     record rather than a business.
 *  2. Everything is upper case, which across a whole directory reads as
 *     shouting.
 */

/** Tokens that stay upper case; anything else gets ordinary title casing. */
const ALWAYS_UPPER = new Set([
  "HVAC", "AC", "LLC", "LLP", "USA", "US", "CA", "TV", "AV", "LED", "PVC",
  "ADU", "HOA", "GC", "II", "III", "IV", "NW", "NE", "SW", "SE", "BBQ", "RV",
]);

/** Capitalises one whitespace-delimited token, handling the usual name quirks. */
function capitaliseToken(token: string): string {
  if (!token) return token;

  const upper = token.toUpperCase();
  if (ALWAYS_UPPER.has(upper)) return upper;

  // A token carrying digits is usually a model or unit designation ("A1",
  // "24/7"); lower-casing it would be wrong, so leave the shape alone.
  if (/\d/.test(token)) {
    return token.length <= 3 ? upper : upper.charAt(0) + token.slice(1).toLowerCase();
  }

  const lower = token.toLowerCase();

  // "MCDONALD" -> "McDonald". Guarded on length so "MC" alone is untouched.
  if (/^mc[a-z]{2,}$/.test(lower)) {
    return "Mc" + lower.charAt(2).toUpperCase() + lower.slice(3);
  }
  // "O'BRIEN" -> "O'Brien", while "JOHN'S" -> "John's" falls through below.
  if (/^[od]'[a-z]{2,}$/.test(lower)) {
    return lower.charAt(0).toUpperCase() + "'" + lower.charAt(2).toUpperCase() + lower.slice(3);
  }

  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Title-cases a CSLB name. Splits on whitespace, hyphens and slashes so
 * "AIR-CON" and "HEATING/COOLING" capitalise on both sides, and preserves the
 * original separators.
 */
export function titleCaseName(raw: string): string {
  if (!raw) return "";
  return raw
    .trim()
    .split(/(\s+)/)
    .map((chunk) =>
      /^\s+$/.test(chunk)
        ? " "
        : chunk.split(/([-/])/).map((p) => (p === "-" || p === "/" ? p : capitaliseToken(p))).join(""),
    )
    .join("")
    .trim();
}

/**
 * True when `business_name` is really an individual's name written surname
 * first.
 *
 * CSLB populates `FullBusinessName` for two unrelated reasons, so the business
 * type has to be checked as well:
 *   - Sole Owner   -> the same person, natural order ("GEORGIY GREKOV")
 *   - Corporation  -> the long legal form ("LUX AIR ENGINEERING INC DBA LUX
 *                     AIR HVAC"), which must NOT replace the trading name
 */
export function isPersonalName(raw: Record<string, unknown> | null | undefined): boolean {
  if (!raw) return false;
  const type = String(raw.BusinessType ?? "").trim().toLowerCase();
  const full = String(raw.FullBusinessName ?? "").trim();
  return type === "sole owner" && full.length > 0;
}

/**
 * The name to publish. Falls back to the stored name whenever the record does
 * not clearly indicate otherwise — a listing showing the licence's own name is
 * always defensible, whereas substituting the wrong field is not.
 */
export function displayBusinessName(
  businessName: string,
  raw: Record<string, unknown> | null | undefined,
): string {
  const stored = (businessName ?? "").trim();
  if (isPersonalName(raw)) {
    const full = String(raw!.FullBusinessName ?? "").trim();
    if (full) return titleCaseName(full);
  }
  return titleCaseName(stored);
}
