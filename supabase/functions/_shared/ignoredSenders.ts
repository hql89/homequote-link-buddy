/**
 * Sender-level noise filter for the reply inbox.
 *
 * /admin/replies is meant to hold contractors answering our outreach. The
 * outreach mailbox also receives ordinary operational mail — login codes,
 * deploy notices, vendor marketing — and each of those was occupying the
 * human review queue. An admin marks such a sender ignored (see
 * public.ignored_senders and admin_add_ignored_sender); this module decides
 * whether an incoming message matches one of those rules.
 *
 * The matching here MUST agree with public.sender_matches_pattern in
 * 20260823230000_ignored_senders.sql. That function does the retroactive
 * sweep over messages already received; this one handles messages arriving
 * from now on. If the two ever disagree, the same sender is filed two
 * different ways depending on when it arrived.
 *
 * Free of Deno APIs and remote imports so the unit tests import it directly —
 * same convention, and for the same reason, as inboundClassifier.ts.
 */

export type IgnoreMatchType = "address" | "domain";

export interface IgnoredSenderRule {
  match_type: IgnoreMatchType;
  pattern: string;
}

/**
 * Whether one rule covers one address.
 *
 * A domain rule covers the domain itself and every subdomain of it:
 * `vercel.com` matches both `system@vercel.com` and `ship@info.vercel.com`.
 * The `@`/`.` anchoring is what keeps it from matching a lookalike —
 * `vercel.com` must never match `someone@notvercel.com`.
 *
 * An empty or single-label pattern matches nothing. The RPC already rejects
 * those on the way in, but a bare `endsWith("@" + "")` would match every
 * address on earth, so this refuses rather than trusting the caller — a
 * malformed row reaching here should quieten nothing, not everything.
 */
export function ruleMatches(fromEmail: string, rule: IgnoredSenderRule): boolean {
  const email = (fromEmail ?? "").trim().toLowerCase();
  const pattern = (rule?.pattern ?? "").trim().toLowerCase();
  if (!email || !pattern) return false;

  if (rule.match_type === "address") {
    return email === pattern;
  }

  if (rule.match_type === "domain") {
    // Must be a real multi-label domain: "com" would match almost everything.
    if (!pattern.includes(".")) return false;
    return email.endsWith(`@${pattern}`) || email.endsWith(`.${pattern}`);
  }

  return false;
}

/**
 * The first rule covering this address, or null.
 *
 * Returns the rule rather than a boolean so the caller can log *which* rule
 * quietened a message — otherwise an admin looking at an ignored message has
 * no way to tell why it was ignored or which entry to remove.
 */
export function findIgnoreRule(
  fromEmail: string,
  rules: IgnoredSenderRule[],
): IgnoredSenderRule | null {
  for (const rule of rules ?? []) {
    if (ruleMatches(fromEmail, rule)) return rule;
  }
  return null;
}
