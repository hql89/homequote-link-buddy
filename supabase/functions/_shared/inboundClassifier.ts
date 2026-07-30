/**
 * Deterministic classification of replies to our own outreach templates.
 *
 * Deliberately NOT an LLM. Mivos.ai's inbound-email bridge (the pattern this
 * module's caller mirrors) uses one, because it turns *arbitrary* mail into
 * structured lead data. Our problem is narrower: classifying replies to an
 * email we wrote, which literally instructs "reply YES" and "reply STOP".
 * The categories are known in advance, so a regex is more predictable, is
 * unit-testable, costs nothing, needs no key, and can't silently
 * mis-classify an unsubscribe — the one failure mode that actually matters
 * here. This is the same standing rule that keeps Perplexity to URLs only
 * and killed ai-company-lookup: a model never supplies facts when a
 * deterministic check will do.
 *
 * Free of Deno APIs and remote imports so the unit tests import it directly.
 */

export type ReplyClassification = "unsubscribe" | "confirm" | "website" | "unclassified";

export interface ClassifiedReply {
  classification: ReplyClassification;
  extractedUrl: string | null;
  isPriority: boolean;
}

/** `Name <addr>` or a bare address. Lower-cased for case-insensitive matching against businesses.email. */
export function extractEmail(from: string): string {
  const angleMatch = from.match(/<([^>]+)>/);
  if (angleMatch) return angleMatch[1].trim().toLowerCase();

  const bareMatch = from.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (bareMatch) return bareMatch[0].trim().toLowerCase();

  return from.trim().toLowerCase();
}

/** The display name portion of a `Name <addr>` header. Falls back to a generic label. */
export function extractName(from: string): string {
  const match = from.match(/^([^<]+)</);
  if (match) {
    const name = match[1].trim().replace(/^"|"$/g, "");
    if (name) return name;
  }
  return "Unknown sender";
}

const UNSUBSCRIBE_RE = /\b(stop|unsubscribe|remove me|opt[\s-]?out|take me off)\b/i;
const CONFIRM_RE = /\byes\b/i;
const URL_RE = /https?:\/\/[^\s<>")\]]+|(?:www\.)[a-z0-9-]+\.[a-z]{2,}[^\s<>")\]]*/i;
const PRIORITY_RE = /\?|(\binterested\b)|(\bcall me\b)|(\bprice\b)|(\bcost\b)/i;

/**
 * Classifies one reply body. Unsubscribe is checked first and wins over
 * every other signal — a message containing both "yes" and "stop" is an
 * unsubscribe. The asymmetry is deliberate: wrongly suppressing someone
 * costs one lost listing; wrongly continuing to email someone who asked to
 * stop is the failure that actually matters.
 *
 * `isPriority` is a sort hint for the human review queue, never an action —
 * nothing here replies, publishes, or applies anything automatically.
 */
export function classifyReply(bodyText: string): ClassifiedReply {
  const body = bodyText ?? "";
  const isPriority = PRIORITY_RE.test(body);

  if (UNSUBSCRIBE_RE.test(body)) {
    return { classification: "unsubscribe", extractedUrl: null, isPriority };
  }

  // Only the first ~100 chars: "yes" appearing deep in a long reply ("...
  // let me know if that works, yes?") is not a confirmation, it's incidental.
  if (CONFIRM_RE.test(body.slice(0, 100))) {
    return { classification: "confirm", extractedUrl: null, isPriority };
  }

  const urlMatch = body.match(URL_RE);
  if (urlMatch) {
    // "www.example.com, thanks!" — the regex's own exclusion set can't tell
    // trailing sentence punctuation from a URL that legitimately ends in one,
    // so strip common trailing marks separately rather than widen the
    // exclusion set and risk cutting a URL short instead.
    const trimmed = urlMatch[0].replace(/[.,;:!?]+$/, "");
    const url = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
    return { classification: "website", extractedUrl: url, isPriority };
  }

  return { classification: "unclassified", extractedUrl: null, isPriority };
}
