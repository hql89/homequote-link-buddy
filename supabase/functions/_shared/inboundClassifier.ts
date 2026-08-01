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

/**
 * Bounce detection.
 *
 * Checked BEFORE every other rule, and that ordering is itself a fix: bounce
 * bodies routinely quote the original message and contain words like "remove"
 * or "stop", so an undeliverable notice could previously be read as the
 * recipient asking to unsubscribe — suppressing a business that never said
 * anything, on the strength of a machine-generated failure notice.
 */
const BOUNCE_SENDER_RE =
  /\b(mailer-daemon|postmaster|mail delivery (system|subsystem)|no-?reply@.*(bounce|mail))/i;

const BOUNCE_SUBJECT_RE =
  /\b(mail delivery failed|undelivered mail|undeliverable|delivery status notification|returned mail|returning message to sender|delivery failure)\b/i;

const BOUNCE_BODY_RE =
  /\b(could not be delivered|delivery to the following recipient failed|permanent (error|failure)|this is an automatically generated (delivery status|message)|the following address(es)? failed)\b/i;

/** Our own domain cannot send — retryable once the block is lifted. */
const SENDER_BLOCKED_RE =
  /\b(outgoing mail suspension|sending (is )?disabled|account (is )?suspended|relay access denied|blocked by policy|not authoriz(s|z)ed to send|exceeded .* sending (limit|quota))\b/i;

/**
 * The recipient's mailbox does not exist — never retryable.
 *
 * The second alternative covers Gmail's phrasing, "The email account that you
 * tried to reach does not exist", where the noun and "does not exist" are
 * separated by a clause. Bounded to one sentence so it cannot reach across
 * unrelated text.
 */
const RECIPIENT_INVALID_RE = new RegExp(
  [
    /\b(user unknown|no such user|unknown user)\b/.source,
    /\bmailbox (unavailable|not found|does not exist)\b/.source,
    /\brecipient address rejected\b/.source,
    /\b(no mailbox here|invalid recipient)\b/.source,
    /\b(email )?(account|address|mailbox|user)\b[^.!?]{0,60}?\b(does not exist|doesn't exist|not found)\b/.source,
  ].join("|"),
  "i",
);

export type BounceKind = "sender_blocked" | "recipient_invalid" | "unknown";

/**
 * Whether an inbound message is a delivery-failure notice.
 *
 * Any one of sender/subject/body matching is enough. Bounce formats vary
 * wildly between providers, and the cost of missing one is high: an
 * undetected bounce leaves a business permanently marked as contacted.
 */
export function isBounce(from: string, subject: string, bodyText: string): boolean {
  return (
    BOUNCE_SENDER_RE.test(from ?? "") ||
    BOUNCE_SUBJECT_RE.test(subject ?? "") ||
    BOUNCE_BODY_RE.test(bodyText ?? "")
  );
}

/**
 * Why the delivery failed, which decides whether to retry.
 *
 * Sender-side is checked first: when our own domain is blocked, the bounce
 * may also quote recipient-shaped text from the original message, and
 * misreading "our sending is broken" as "their address is dead" would
 * permanently discard a perfectly good contact.
 */
export function classifyBounce(bodyText: string): BounceKind {
  const body = bodyText ?? "";
  if (SENDER_BLOCKED_RE.test(body)) return "sender_blocked";
  if (RECIPIENT_INVALID_RE.test(body)) return "recipient_invalid";
  return "unknown";
}

/**
 * The address that actually failed, which is quoted inside the bounce rather
 * than being the bounce's own sender. Returns the first plausible address
 * that is not one of ours.
 */
export function extractBouncedRecipient(bodyText: string, ourDomain: string): string | null {
  const body = bodyText ?? "";
  const matches = body.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g);
  if (!matches) return null;

  const domain = (ourDomain ?? "").toLowerCase();
  for (const raw of matches) {
    const address = raw.toLowerCase();
    // Skip our own addresses and the daemon's — the failed recipient is a
    // third party, and every bounce mentions both of the others.
    if (domain && address.endsWith(`@${domain}`)) continue;
    if (/^(mailer-daemon|postmaster|no-?reply)@/.test(address)) continue;
    return address;
  }
  return null;
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
