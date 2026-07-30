/**
 * Pure logic for Phase 2 email enrichment (implementation_plan.md, "Discovery
 * source: Perplexity Sonar"). Free of Deno APIs and remote imports so the
 * unit tests import it directly — same discipline as inboundClassifier.ts.
 *
 * The hard rule this module exists to enforce: Perplexity finds URLs, it
 * never supplies facts. Every function here either extracts a URL from a
 * model response (discarding any prose) or extracts data from a page WE
 * fetched ourselves — nothing here ever trusts a model's claim about a
 * business's email, phone, or identity.
 */

import { toE164 } from "./directory.ts";

/**
 * Pulls the first http(s) URL out of a Perplexity response and discards
 * everything else — including a plausible-sounding domain the model might
 * assert without a URL, which is exactly the kind of unverified claim this
 * module refuses to trust. Returns null rather than guessing.
 */
export function extractUrlFromModelText(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s")\]}<>]+/i);
  if (!match) return null;
  // Trim common trailing punctuation a model's prose leaves attached.
  return match[0].replace(/[.,;:!?]+$/, "");
}

/**
 * Emails on a fetched page — mailto: links first (an explicit publish-for-
 * contact signal), then a plain-text regex sweep. Obvious asset/tracking
 * false positives (image filenames, sourcemaps) are filtered out.
 */
export function extractEmailsFromHtml(html: string): string[] {
  const found = new Set<string>();

  const mailtoRe = /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
  for (const m of html.matchAll(mailtoRe)) found.add(m[1].toLowerCase());

  const plainRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  for (const m of html.matchAll(plainRe)) {
    const email = m[0].toLowerCase();
    if (/\.(png|jpe?g|gif|svg|webp|css|js|map)$/i.test(email)) continue;
    found.add(email);
  }

  return [...found];
}

/**
 * US phone numbers found anywhere on a fetched page, normalised to E.164 via
 * the same toE164 used for CSLB data — so a page match and a CSLB record are
 * always compared in the same shape.
 */
export function extractPhonesFromHtml(html: string): string[] {
  const found = new Set<string>();
  const phoneRe = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
  for (const m of html.matchAll(phoneRe)) {
    const e164 = toE164(m[0]);
    if (e164) found.add(e164);
  }
  return [...found];
}

/** Whether the CSLB phone on file appears anywhere among a page's extracted phones. */
export function phoneMatchesPage(cslbPhone: string | null, pagePhones: string[]): boolean {
  const normalised = toE164(cslbPhone);
  if (!normalised) return false;
  return pagePhones.includes(normalised);
}

/**
 * Minimal robots.txt check: true if the given user-agent (falling back to
 * the wildcard group) disallows the given path. Deliberately not a full
 * parser — it only needs to catch the real-world case that matters here,
 * blanket disallow, not adjudicate every allow/disallow precedence rule.
 */
export function isDisallowedByRobots(robotsTxt: string, path: string, userAgent: string): boolean {
  const lines = robotsTxt.split("\n").map((l) => l.trim());
  const groups: { agents: string[]; disallows: string[] }[] = [];
  let current: { agents: string[]; disallows: string[] } | null = null;

  for (const line of lines) {
    const [rawKey, ...rest] = line.split(":");
    if (!rawKey || rest.length === 0) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();

    if (key === "user-agent") {
      if (!current || current.disallows.length > 0) {
        current = { agents: [], disallows: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (key === "disallow" && current) {
      if (value) current.disallows.push(value);
    }
  }

  const ua = userAgent.toLowerCase();
  const specific = groups.find((g) => g.agents.some((a) => a !== "*" && ua.includes(a)));
  const wildcard = groups.find((g) => g.agents.includes("*"));
  const group = specific ?? wildcard;
  if (!group) return false;

  return group.disallows.some((rule) => path.startsWith(rule));
}

export type EmailConfidence = "verified" | "needs_review";

/** The one place confidence is decided — a phone match is the only path to 'verified'. */
export function resolveConfidence(phoneMatched: boolean): EmailConfidence {
  return phoneMatched ? "verified" : "needs_review";
}
