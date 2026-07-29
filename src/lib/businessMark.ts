/**
 * Deterministic visual identity for a listing that has no photo — which today
 * is all 536 CSLB-ingested businesses. Not a photograph and not pretending to
 * be one: a trade icon on a colour derived from the business name.
 *
 * Pure and framework-free so it is trivial to test directly, and the same
 * business always renders identically wherever it is used — the card, the
 * detail hero, the admin review table.
 */

/**
 * A small curated set rather than free-form `hsl(hash % 360, ...)`. Hashing
 * straight into HSL produces unpredictable contrast — some hues read fine at
 * a glance but fail against the white icon on top. Each entry here is chosen
 * to hold contrast, so the mark is legible no matter which of the ~8 it lands
 * on.
 *
 * One colour per entry, not a light/dark pair: dark mode is configured in
 * Tailwind (`darkMode: ["class"]`) but nothing in the app ever adds the
 * `.dark` class — there is no ThemeProvider mounted and no toggle. Building a
 * theme split for a mode that cannot currently be reached would be
 * speculative; add it back if dark mode is actually wired up.
 */
export const MARK_PALETTE: readonly string[] = [
  "#2563eb", // blue
  "#0d9488", // teal
  "#7c3aed", // violet
  "#c2410c", // burnt orange
  "#0f766e", // deep teal
  "#be123c", // rose
  "#4d7c0f", // olive
  "#6d28d9", // indigo
];

/** FNV-1a: fast, deterministic, tiny — no need for a crypto hash here. */
function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Same business name always resolves to the same palette entry. */
export function markPaletteIndex(businessName: string): number {
  const key = businessName.trim().toLowerCase();
  if (!key) return 0;
  return hashString(key) % MARK_PALETTE.length;
}

export function markColor(businessName: string): string {
  return MARK_PALETTE[markPaletteIndex(businessName)];
}

/**
 * Initials fallback, used only when a business has no resolvable vertical
 * icon. Two letters, from the first two words — for a single-word name, the
 * first two characters. Never returns empty for non-empty input.
 */
export function markInitials(businessName: string): string {
  const words = businessName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
