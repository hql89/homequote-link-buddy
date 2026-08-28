/**
 * "Can this domain receive mail at all?" — checked before first contact.
 *
 * Scope, stated plainly because it is easy to oversell: this catches an
 * address whose DOMAIN cannot accept mail (dead domain, lapsed registration,
 * a website with no mail exchanger). It does NOT catch a live domain with a
 * non-existent mailbox, which is what the one real bounce on this project was
 * (contact@thynkremodeling.com, recipient_invalid). Proving a mailbox exists
 * needs an SMTP probe against the recipient's server, which is itself
 * reputation-damaging behaviour and is deliberately not done here.
 *
 * So this is a cheap filter on one real class of bad address. The actual
 * protection against a bad campaign is the bounce-rate breaker in
 * emailSafety.ts.
 *
 * DNS-over-HTTPS rather than Deno.resolveDns: resolveDns is not dependable on
 * Supabase's edge runtime, and a safety check that throws on an unsupported
 * API is worse than no check at all. A DoH query is an ordinary fetch, which
 * this codepath already does, so it runs wherever the function runs and is
 * mockable without a network in tests.
 */

/** Cloudflare's resolver. Sends only the domain name — no address, no content. */
const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";
const DOH_TIMEOUT_MS = 5_000;

/** DNS RCODEs we distinguish. Anything else is treated as inconclusive. */
const RCODE_NOERROR = 0;
const RCODE_NXDOMAIN = 3;

/** DNS record type numbers, as they appear in the JSON API's `type` field. */
const TYPE_A = 1;
const TYPE_AAAA = 28;
const TYPE_MX = 15;

export interface MailDomainCheck {
  /** Whether mail can be delivered to this domain. */
  acceptsMail: boolean;
  /**
   * Whether DNS actually answered. False means we could not find out —
   * timeout, network failure, malformed response, or an unexpected RCODE.
   *
   * This distinction carries the whole safety of the feature. Marking a
   * business undeliverable stops its outreach AND its quote-request
   * notifications, so a false positive silences a real business's leads. A
   * caller may only act on a result where `conclusive` is true.
   */
  conclusive: boolean;
  reason: string;
}

interface DohAnswer {
  type: number;
  data: string;
}

interface DohResponse {
  Status: number;
  Answer?: DohAnswer[];
}

/** The domain part of an address, lowercased. Null when there isn't one. */
export function domainOf(email: string | null | undefined): string | null {
  const trimmed = (email ?? "").trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;

  const domain = trimmed.slice(at + 1);
  // Must look like a hostname with a TLD. Anything else would make the DNS
  // query meaningless, and "the query was meaningless" must not be reported
  // as "this domain is dead".
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
    return null;
  }
  return domain;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * A timeout signal that does not depend on AbortSignal.timeout existing.
 *
 * Deno has it, so production is fine — but under vitest/jsdom it is undefined,
 * and calling it threw inside query()'s catch, turning EVERY lookup
 * inconclusive. That failed safe (nothing gets marked undeliverable on an
 * inconclusive result) but it also meant the check silently did nothing while
 * appearing to work, which is exactly the class of bug this module's tests
 * exist to catch. The AbortController fallback keeps a real timeout in any
 * runtime rather than quietly dropping it.
 */
function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return { signal: AbortSignal.timeout(ms), cancel: () => {} };
  }
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(id) };
}

/** One DoH query. Returns null when the answer could not be obtained or parsed. */
async function query(
  domain: string,
  type: "MX" | "A" | "AAAA",
  fetchFn: FetchLike,
): Promise<DohResponse | null> {
  const timeout = withTimeout(DOH_TIMEOUT_MS);
  try {
    const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(domain)}&type=${type}`;
    const res = await fetchFn(url, {
      headers: { accept: "application/dns-json" },
      signal: timeout.signal,
    });
    if (!res.ok) return null;

    const body = await res.json() as DohResponse;
    if (typeof body?.Status !== "number") return null;
    return body;
  } catch {
    return null;
  } finally {
    timeout.cancel();
  }
}

function recordsOfType(response: DohResponse, type: number): DohAnswer[] {
  return (response.Answer ?? []).filter((a) => a?.type === type);
}

/**
 * A single MX whose target is "." is RFC 7505's null MX: the domain is
 * explicitly declaring that it accepts no mail. That is a definite answer, and
 * the opposite of the "has an MX record, therefore fine" reading.
 */
function isNullMx(records: DohAnswer[]): boolean {
  if (records.length !== 1) return false;
  const target = (records[0].data ?? "").trim().split(/\s+/).pop();
  return target === ".";
}

export async function checkMailDomain(
  domain: string,
  fetchFn: FetchLike = fetch,
): Promise<MailDomainCheck> {
  const mx = await query(domain, "MX", fetchFn);

  if (mx === null) {
    return { acceptsMail: false, conclusive: false, reason: "MX lookup failed or timed out." };
  }

  if (mx.Status === RCODE_NXDOMAIN) {
    return { acceptsMail: false, conclusive: true, reason: `${domain} does not exist (NXDOMAIN).` };
  }

  if (mx.Status !== RCODE_NOERROR) {
    return {
      acceptsMail: false,
      conclusive: false,
      reason: `MX lookup returned an unexpected DNS status (${mx.Status}).`,
    };
  }

  const mxRecords = recordsOfType(mx, TYPE_MX);

  if (isNullMx(mxRecords)) {
    return {
      acceptsMail: false,
      conclusive: true,
      reason: `${domain} publishes a null MX record — it accepts no mail by declaration.`,
    };
  }

  if (mxRecords.length > 0) {
    return { acceptsMail: true, conclusive: true, reason: `${domain} has ${mxRecords.length} MX record(s).` };
  }

  // No MX is not the end of it: RFC 5321 §5.1 falls back to the address
  // record, so a domain with only an A record still accepts mail. Treating
  // "no MX" as fatal would wrongly condemn small business domains that never
  // configured one.
  for (const [type, code] of [["A", TYPE_A], ["AAAA", TYPE_AAAA]] as const) {
    const res = await query(domain, type, fetchFn);
    if (res === null) {
      return {
        acceptsMail: false,
        conclusive: false,
        reason: `${domain} has no MX; the ${type} fallback lookup failed.`,
      };
    }
    if (res.Status === RCODE_NXDOMAIN) {
      return { acceptsMail: false, conclusive: true, reason: `${domain} does not exist (NXDOMAIN).` };
    }
    if (res.Status !== RCODE_NOERROR) {
      return {
        acceptsMail: false,
        conclusive: false,
        reason: `${type} fallback returned an unexpected DNS status (${res.Status}).`,
      };
    }
    if (recordsOfType(res, code).length > 0) {
      return {
        acceptsMail: true,
        conclusive: true,
        reason: `${domain} has no MX but resolves via ${type} (implicit MX).`,
      };
    }
  }

  return {
    acceptsMail: false,
    conclusive: true,
    reason: `${domain} has no MX, A or AAAA record — nothing to deliver mail to.`,
  };
}
