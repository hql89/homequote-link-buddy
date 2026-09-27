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
 * Website builder/template placeholder domains. Found in production on the
 * first real run of this module: a live site verified by phone match still
 * had "contact@mysite.com" sitting in its unedited template footer, which
 * would have been stored as a real contact and put straight into outreach —
 * a guaranteed bounce that damages sender reputation, not just a wasted send.
 * A phone match proves the *page* belongs to the right business; it says
 * nothing about whether the *email* on that page was ever actually set up.
 */
const PLACEHOLDER_EMAIL_DOMAINS = new Set([
  "example.com", "example.org", "example.net",
  "mysite.com", "yoursite.com", "yourdomain.com", "domain.com",
  "yourcompany.com", "email.com", "test.com", "sentry.io",
  "wixpress.com", "godaddy.com", "squarespace.com",
]);

/**
 * Emails on a fetched page — mailto: links first (an explicit publish-for-
 * contact signal), then a plain-text regex sweep. Obvious asset/tracking
 * false positives (image filenames, sourcemaps) and known template
 * placeholder domains are filtered out.
 */
export function extractEmailsFromHtml(html: string): string[] {
  const found = new Set<string>();

  function isUsable(email: string): boolean {
    if (/\.(png|jpe?g|gif|svg|webp|css|js|map)$/i.test(email)) return false;
    const domain = email.split("@")[1];
    if (domain && PLACEHOLDER_EMAIL_DOMAINS.has(domain)) return false;
    return true;
  }

  const mailtoRe = /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
  for (const m of html.matchAll(mailtoRe)) {
    const email = m[1].toLowerCase();
    if (isUsable(email)) found.add(email);
  }

  const plainRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  for (const m of html.matchAll(plainRe)) {
    const email = m[0].toLowerCase();
    if (isUsable(email)) found.add(email);
  }

  return [...found];
}

/**
 * US phone numbers found anywhere on a fetched page, normalised to E.164 via
 * the same toE164 used for CSLB data — so a page match and a CSLB record are
 * always compared in the same shape.
 */
/**
 * Whether an E.164 US number could actually be dialled.
 *
 * Without this, any ten digits on a page became a "phone". Three real
 * examples pulled from contractor sites on 2026-09-26: +1 529 411 7647,
 * +1 942 938 4556, +1 532 272 9582. None are dialable — 529/942/532 are not
 * area codes in service, and 411 can never be an exchange.
 *
 * The cost was not a false match (junk never equals the CSLB number) but a
 * misleading one: `email_source_phone` showed a reviewer an invented number
 * beside the real licence number, making an honest business look like the
 * wrong one.
 *
 * Structural NANP rules alone are not enough, and that is worth stating
 * plainly: 942 and 532 both satisfy them. They are rejected only because
 * they are not area codes that exist. So the check needs the assigned list
 * below as well as the structural rules.
 *
 * The list is a snapshot and new area codes are assigned a few times a year.
 * It fails in the safe direction: an unlisted code makes a number
 * "implausible", which sends the business to human review — it can never
 * cause a wrong verification. Update it when a genuine number is queried.
 *
 * Does NOT reject the 555-01xx fiction range: no contractor site carries
 * one, so it buys nothing real, and it would reject the safe example
 * numbers used throughout this project's own tests.
 */
const ASSIGNED_AREA_CODES = new Set([
  // Toll-free and premium
  "800", "833", "844", "855", "866", "877", "888", "900",
  // California
  "209", "213", "279", "310", "323", "341", "350", "408", "415", "424", "442",
  "510", "530", "559", "562", "619", "626", "628", "650", "657", "661", "669",
  "707", "714", "747", "760", "805", "818", "820", "831", "840", "858", "909",
  "916", "925", "949", "951",
  // Rest of the US
  "201", "202", "203", "205", "206", "207", "208", "210", "212", "214", "215",
  "216", "217", "218", "219", "220", "223", "224", "225", "228", "229", "231",
  "234", "239", "240", "248", "251", "252", "253", "254", "256", "260", "262",
  "267", "269", "270", "272", "276", "281", "283", "301", "302", "303", "304",
  "305", "307", "308", "309", "312", "313", "314", "315", "316", "317", "318",
  "319", "320", "321", "325", "326", "330", "331", "332", "334", "336", "337",
  "339", "346", "351", "352", "360", "361", "364", "380", "385", "386", "401",
  "402", "404", "405", "406", "407", "409", "410", "412", "413", "414", "417",
  "419", "423", "425", "430", "432", "434", "435", "440", "443", "445", "447",
  "458", "463", "464", "469", "470", "475", "478", "479", "480", "484", "501",
  "502", "503", "504", "505", "507", "508", "509", "512", "513", "515", "516",
  "517", "518", "520", "534", "539", "540", "541", "551", "559", "561", "563",
  "564", "567", "570", "571", "573", "574", "575", "580", "585", "586", "601",
  "602", "603", "605", "606", "607", "608", "609", "610", "612", "614", "615",
  "616", "617", "618", "620", "623", "624", "630", "631", "636", "640", "641",
  "646", "651", "660", "662", "667", "678", "680", "681", "682", "689", "701",
  "702", "703", "704", "706", "708", "712", "713", "715", "716", "717", "718",
  "719", "720", "724", "725", "726", "727", "731", "732", "734", "737", "740",
  "743", "754", "757", "762", "763", "765", "769", "770", "772", "773", "774",
  "775", "779", "781", "785", "786", "801", "802", "803", "804", "806", "808",
  "810", "812", "813", "814", "815", "816", "817", "828", "830", "832", "838",
  "843", "845", "847", "848", "850", "854", "856", "857", "859", "860", "862",
  "863", "864", "865", "870", "872", "878", "901", "903", "904", "906", "907",
  "908", "910", "912", "913", "914", "915", "917", "918", "919", "920", "930",
  "931", "934", "936", "937", "938", "940", "941", "947", "952", "954", "956",
  "959", "970", "971", "972", "973", "975", "978", "979", "980", "984", "985",
  "986", "989",
  // Canada — an owner's mobile from across the border is unremarkable
  "204", "226", "236", "249", "250", "289", "306", "343", "365", "367", "368",
  "403", "416", "418", "428", "431", "437", "438", "450", "506", "514", "519",
  "548", "579", "581", "584", "587", "604", "613", "639", "647", "672", "705",
  "709", "742", "753", "778", "780", "782", "807", "819", "825", "867", "873",
  "902", "905",
]);

export function isPlausibleUsPhone(e164: string): boolean {
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  if (!m) return false;
  const [, area, exchange, line] = m;

  if (!ASSIGNED_AREA_CODES.has(area)) return false;
  if (!/^[2-9]/.test(exchange) || /^\d11$/.test(exchange)) return false;
  if (/^(\d)\1{9}$/.test(area + exchange + line)) return false;

  return true;
}

export function extractPhonesFromHtml(html: string): string[] {
  const found = new Set<string>();
  // Boundaries on both sides: without them a longer digit run (an order id,
  // a timestamp) donates its first ten digits and becomes a phone number.
  const phoneRe = /(?<![\d-])(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?![\d-])/g;
  for (const m of html.matchAll(phoneRe)) {
    const e164 = toE164(m[0]);
    if (e164 && isPlausibleUsPhone(e164)) found.add(e164);
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
 * A "<city>, CA <zip>" location snippet found on a fetched page — not a full
 * street-address parser, just enough for a human reviewer to spot a business
 * whose site clearly lists an address outside the service area. Same posture
 * as the rest of this module: extract and surface, never auto-decide, since
 * there's no single authoritative in-area zip list to compare against without
 * duplicating one (see the memory note on the verticals two-sources bug).
 */
export function extractAddressFromHtml(html: string): string | null {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ");
  const match = text.match(/[A-Za-z][A-Za-z\s]{1,40},\s*CA\s+\d{5}(?:-\d{4})?/);
  if (!match) return null;
  return match[0].replace(/\s+/g, " ").replace(/\s+,/g, ",").trim();
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

/** Case/punctuation-insensitive city comparison. */
function normaliseCity(value: string): string {
  return value.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Places that are not the service area but are not a red flag either.
 *
 * Every city this directory covers is a neighbourhood of the City of Los
 * Angeles, so a site whose address reads "Los Angeles, CA" is entirely
 * consistent with a Tarzana business — the first run of the new rule flagged
 * exactly that as "outside the service area", which is wrong and would have
 * mis-flagged a large share of the 452 still queued. The rest are San
 * Fernando Valley and immediately adjacent communities: near enough that a
 * contractor being based there says nothing suspicious, far enough that it
 * is not proof they serve our cities either.
 */
const NEARBY_PLACES = new Set([
  "los angeles", "van nuys", "north hollywood", "woodland hills", "reseda",
  "canoga park", "northridge", "west hills", "winnetka", "lake balboa",
  "panorama city", "north hills", "valley glen", "sun valley", "shadow hills",
  "granada hills", "mission hills", "chatsworth", "arleta", "pacoima",
  "sylmar", "tujunga", "sunland", "burbank", "glendale", "calabasas",
  "hidden hills", "universal city",
]);

export interface PageLocation {
  /** An address-shaped snippet, for a reviewer to read. Null when none found. */
  snippet: string | null;
  /**
   * The city from an address-shaped match — where the business says it IS.
   * Much stronger evidence than a name appearing somewhere on the page.
   */
  addressCity: string | null;
  /** Whether that address city is one the directory covers. */
  addressInArea: boolean;
  /**
   * The address is not in a covered city, but is somewhere that raises no
   * suspicion — greater Los Angeles or the Valley. Neither proof nor a flag.
   */
  addressNearby: boolean;
  /** Service-area cities named anywhere, address or not. Marketing-grade evidence. */
  mentioned: string[];
}

/**
 * Where a page says the business is.
 *
 * Replaces a lone `<City>, CA <zip>` regex that required both the zip and
 * the two-letter form — it found a location on only 8 of 27 enriched
 * businesses. Leading the decision with a signal missing two thirds of the
 * time would just push everything into the review queue.
 *
 * The two kinds of evidence are kept apart on purpose, and the distinction
 * is the whole point. An ADDRESS says where the business is. A city NAMED on
 * the page says only that they will travel there — nearly every contractor
 * site lists a long service-area footer, so treating a mention as proof of
 * location would verify a Fresno company that happens to list Sherman Oaks,
 * which is precisely the case worth catching.
 */
export function findPageLocation(html: string, serviceArea: string[]): PageLocation {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ");
  const area = serviceArea.map(normaliseCity).filter(Boolean);

  const addressRe = /([A-Za-z][A-Za-z.'\s]{1,40}?),\s*(?:CA|California)\b(?:\s+(\d{5})(?:-\d{4})?)?/g;

  let snippet: string | null = null;
  let addressCity: string | null = null;
  let addressInArea = false;
  let addressNearby = false;

  for (const match of text.matchAll(addressRe)) {
    const words = match[1].trim().split(" ");
    const tail = normaliseCity(words.slice(-3).join(" "));

    // Longest name first, so "north hollywood" is not read as "hollywood"
    // and "los angeles" is preferred over a shorter accidental suffix.
    const known = [...area, ...NEARBY_PLACES].sort((a, b) => b.length - a.length);
    const hit = known.find((c) => tail.endsWith(c));
    const city = hit ?? normaliseCity(words.slice(-2).join(" "));
    const inArea = hit !== undefined && area.includes(hit);
    const nearby = hit !== undefined && !inArea;

    // An in-area address wins outright; a page may print a corporate address
    // and a local branch, and the branch is the relevant fact.
    if (inArea && !addressInArea) {
      addressCity = city;
      addressInArea = true;
      addressNearby = false;
      snippet = `${city}, CA`;
    } else if (!addressInArea && addressCity === null) {
      addressCity = city;
      addressNearby = nearby;
      // Rebuilt rather than using the raw match, which trails back into the
      // preceding sentence ("Andrew Chang Sherman Oaks, CA").
      snippet = `${city}, CA`;
    }
  }

  const normalisedText = normaliseCity(text);
  const mentioned = area.filter((c) => normalisedText.includes(c));

  return { snippet, addressCity, addressInArea, addressNearby, mentioned };
}

/**
 * The registrable-ish domain of a URL or email, for comparing a page against
 * the addresses printed on it. Strips `www.` and keeps the last two labels,
 * so `mail.capitolplumbing.com` and `capitolplumbing.com` compare equal.
 *
 * Deliberately not a Public Suffix List implementation: the failure it has to
 * catch is an entirely different registrable domain (`micahrich.com` on
 * `capitolplumbing.com`), not a `.co.uk` edge case. Over-matching on a
 * multi-part TLD would at worst let a same-suffix address through, which is
 * the behaviour that already exists today.
 */
export function registrableDomain(urlOrEmail: string): string | null {
  const raw = urlOrEmail.trim().toLowerCase();
  if (!raw) return null;

  const host = raw.includes("@")
    ? raw.split("@")[1]
    : raw.replace(/^[a-z]+:\/\//, "").split("/")[0].split(":")[0];

  if (!host || !host.includes(".")) return null;

  const labels = host.replace(/^www\./, "").split(".").filter(Boolean);
  if (labels.length < 2) return null;
  return labels.slice(-2).join(".");
}

export interface EmailSelection {
  /** The address to store, or null when the page yielded none. */
  email: string | null;
  /** Whether it is published on the same domain as the page it came from. */
  onDomain: boolean;
}

/**
 * Chooses which of a page's emails actually belongs to the business.
 *
 * Previously the caller took `emails[0]` — first in document order, which is
 * mailto: links first and then a plain-text sweep. That picked up whoever
 * happened to appear earliest, and in production it picked a web developer's
 * personal address out of a "site by" footer credit
 * (`micah@micahrich.com` stored for Capitol Plumbing & Rooter Inc, then sent
 * cold outreach on 2026-08-21 and 2026-08-25).
 *
 * The existing PLACEHOLDER_EMAIL_DOMAINS filter does not help here: the
 * developer's domain is a real, deliverable mailbox. It is simply not this
 * business's. Cold-mailing it tells an uninvolved third party we have built
 * them a listing — a reputation and CAN-SPAM problem that scales with volume.
 *
 * So: prefer an address on the same registrable domain as the page. Document
 * order still breaks ties among on-domain addresses, which preserves the
 * mailto-before-plain-sweep preference for the normal case.
 */
export function selectBusinessEmail(emails: string[], sourceUrl: string): EmailSelection {
  if (emails.length === 0) return { email: null, onDomain: false };

  const siteDomain = registrableDomain(sourceUrl);
  if (siteDomain) {
    const onDomain = emails.find((e) => registrableDomain(e) === siteDomain);
    if (onDomain) return { email: onDomain, onDomain: true };
  }

  // Nothing on-domain: keep the address so a human reviewer can see what was
  // actually found, but flag it as unrelated so confidence can refuse it.
  return { email: emails[0], onDomain: false };
}

export type EmailConfidence = "verified" | "needs_review";

export interface ConfidenceEvidence {
  phoneMatched: boolean;
  location: PageLocation;
  /** The city on the licence record. */
  expectedCity: string;
  /**
   * Whether the address found is published on the same registrable domain as
   * the page it came from — see {@link selectBusinessEmail}.
   *
   * Separate from every other signal here on purpose. The rest of this
   * function answers "is this the right PAGE"; this answers "is this address
   * even the page's". A page can be unmistakably the right business and still
   * carry a web developer's address in its footer credit.
   *
   * Optional so existing callers that only reason about the page keep
   * compiling; absent is treated as on-domain, i.e. no downgrade.
   */
  emailOnDomain?: boolean;
}

export interface ConfidenceDecision {
  confidence: EmailConfidence;
  /** One sentence for the review queue, so it says why rather than implying it. */
  reason: string;
}

/**
 * The one place confidence is decided.
 *
 * Was: a phone match, and nothing else, could reach `verified`. That made the
 * weakest available signal the sole gate. Contractors routinely publish
 * tracking numbers, answering services and mobiles never filed with CSLB, so
 * a mismatch says very little — while the page placing the business in
 * another county says a great deal.
 *
 * Location therefore leads and an out-of-area address outranks a phone match.
 * A phone match remains a valid route when no location can be found, because
 * a genuine match is real corroboration; it is simply no longer the only door.
 *
 * Note what this deliberately does NOT do: `email_confidence` also permits
 * 'rejected', and an out-of-area address does not take it. That is a strong
 * reason for a person to look, not grounds to discard a business unattended.
 */
export function resolveConfidence(evidence: ConfidenceEvidence): ConfidenceDecision {
  const { phoneMatched, location, expectedCity, emailOnDomain } = evidence;
  const expected = normaliseCity(expectedCity ?? "");

  // An off-domain address can never be `verified`, however well the page
  // itself checks out.
  //
  // This is deliberately a gate in front of the page reasoning below rather
  // than another signal mixed into it, because it answers a different
  // question. Everything after this decides whether the PAGE is this
  // business — address in the service area, phone matching the licence. None
  // of that says the address printed on the page is the business's own. The
  // case this exists for passed every one of those checks: the right
  // company's real website, in the right city, with a web developer's
  // personal address in the "site by" footer credit, which then received
  // cold outreach twice.
  //
  // Strictly more conservative — it can only move a row from verified to
  // needs_review, never the reverse — so nothing that was skipped before is
  // sent now. The address is still stored by the caller so a human sees what
  // was actually found; it just doesn't go straight into outreach.
  if (emailOnDomain === false) {
    return {
      confidence: "needs_review",
      reason:
        "The address found is not on the same domain as the site it came from, so it may " +
        "belong to someone else — a web designer or a listing service — rather than to this " +
        "business.",
    };
  }

  // An address outside the area dominates everything, including a phone
  // match and any number of in-area mentions. Nearly every contractor site
  // lists cities it will travel to; only one says where it is.
  if (location.addressCity && !location.addressInArea && !location.addressNearby) {
    return {
      confidence: "needs_review",
      reason:
        `The site's address is in ${location.addressCity}, outside the service area. ` +
        `It may still travel here, but this could also be a different business with a ` +
        `similar name.`,
    };
  }

  if (location.addressInArea) {
    return location.addressCity === expected
      ? { confidence: "verified", reason: `The site's address is in ${expectedCity}, matching the licence.` }
      : {
          confidence: "verified",
          reason:
            `The site's address is in ${location.addressCity}, which the directory covers, ` +
            `though the licence says ${expectedCity}. Both are in the area.`,
        };
  }

  if (phoneMatched) {
    return {
      confidence: "verified",
      reason: "No address on the site, but the phone number matches the licence exactly.",
    };
  }

  if (location.mentioned.length > 0) {
    return {
      confidence: "needs_review",
      reason:
        `The site names ${location.mentioned[0]}, but only as somewhere it works — there is no ` +
        `address and no matching phone number, so nothing says the business is based here.`,
    };
  }

  return {
    confidence: "needs_review",
    reason:
      "The site gave no address we could read and no matching phone number, so nothing ties " +
      "it to this licence yet.",
  };
}

/** Outcome counts from one enrichment run, as written to job_run_logs.metadata. */
export interface EnrichmentSummary {
  considered: number;
  failed: number;
}

export interface EnrichmentRunOutcome {
  status: "success" | "partial" | "failure";
  errorMessage: string | null;
}

/**
 * Decides how an enrichment run should be recorded.
 *
 * Pure and separated from the function for the same reason pickVariant and
 * remainingDailyBudget are: the rule deciding whether a run counts as broken
 * should be directly testable.
 *
 * `failed` is the catch-all for a row that threw. It is deliberately distinct
 * from no_url / no_email / fetch_failed, which are ordinary findings about a
 * business — plenty of small contractors have no website — and must never
 * make a run look broken.
 *
 * Every row throwing means the run achieved nothing, and recording that as a
 * success is exactly how an expired Perplexity key looked like a quiet day
 * for a month: 20 of 20 rows failing on a 401 was logged `status: success`,
 * rendered as "0 verified", and never tripped the repeated-failure alarm.
 */
export function summariseEnrichmentRun(
  summary: EnrichmentSummary,
  errors: string[],
): EnrichmentRunOutcome {
  const considered = Number.isFinite(summary.considered) ? Math.max(0, summary.considered) : 0;
  const failed = Number.isFinite(summary.failed) ? Math.max(0, summary.failed) : 0;

  if (failed === 0) return { status: "success", errorMessage: null };

  // Deduplicated: twenty rows failing for one reason should read as one
  // reason, not twenty copies of the same sentence.
  const distinct = [...new Set(errors)];
  const errorMessage =
    `${failed} of ${considered} lookups failed. ` +
    `${distinct.length === 1 ? "Reason" : "Reasons"}: ` +
    `${distinct.length > 0 ? distinct.slice(0, 3).join(" | ") : "(not recorded)"}`;

  return {
    status: considered > 0 && failed >= considered ? "failure" : "partial",
    errorMessage,
  };
}
