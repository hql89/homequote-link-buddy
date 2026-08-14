/**
 * Authoring-time helpers for the outreach copy editor.
 *
 * These live in `src/` rather than beside the send logic in
 * `supabase/functions/_shared/` because they are purely an editor concern —
 * nothing here runs at send time, and a warning surfaced during a cron run
 * would be read by nobody. The edge functions and the app can't share a
 * module in either direction (Deno vs. the Vite build, and the app's
 * tsconfig only includes `src`), so the split follows where the code is
 * actually used.
 */

/** Merge fields the send job supplies, per stage. */
export const OUTREACH_MERGE_FIELDS: Record<string, string[]> = {
  outreach_verify: ["business_name", "city", "owner_name", "phone", "sender_name"],
  outreach_preview: ["business_name", "city", "owner_name", "phone", "claim_url", "sender_name"],
};

/**
 * Whether a body looks like it contains a link.
 *
 * Advisory only — it must never block a save. Email 1's design is that it
 * carries no links at all, which is what keeps a cold, unsolicited message
 * out of spam folders, so an accidental link there is worth flagging. But
 * deliberately A/B testing that assumption is exactly the kind of thing the
 * variant editor exists to allow, so this informs rather than refuses.
 */
export function looksLikeItContainsLink(body: string): boolean {
  return /\bhttps?:\/\/|\bwww\.|\{\{\s*claim_url\s*\}\}/i.test(body);
}

/**
 * Substitutes {{merge_field}} placeholders, mirroring `renderTemplate` in the
 * edge functions' shared directory module.
 *
 * Intentionally a separate implementation from the one that actually sends:
 * this one exists to show an admin what a message will look like, and an
 * unknown field renders as a visible marker rather than silently collapsing
 * to an empty string. A preview that hides a typo'd merge field would defeat
 * the purpose of previewing.
 */
export function renderPreview(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) =>
    key in vars ? vars[key] : `[unknown: ${key}]`,
  );
}
