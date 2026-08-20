/**
 * Pure logic for the "is this actually the same business?" assessment shown
 * on the enrichment review queue.
 *
 * WHY THIS EXISTS, and what it is careful not to become:
 *
 * enrich-business-email only promotes a row to 'verified' when the CSLB phone
 * number is found on the fetched page. Everything else lands in the review
 * queue for a human. But on 2026-08-19 a human worked that queue by hand and
 * found the phone was close to useless as the deciding signal: of 8 rows, 3
 * were real businesses whose phone simply differed (toll-free vanity numbers,
 * a second line) and 5 were entirely different companies — a Utah builder, a
 * UK electrician, a Florida developer, a florist holding a landscaping
 * licence, and a retail LED shop. What actually decided each one was whether
 * the NAME, LOCATION, LICENCE TRADE and SERVICES all described the same
 * business. That reasoning is what this automates.
 *
 * The hard rule inherited from enrich-business-email stands: the model never
 * supplies facts. It is handed text this project already fetched itself, and
 * its answer is stored ONLY as advisory prose in email_review_* columns that
 * nothing reads except a human's eyes. It can never write an email address,
 * a phone number, or email_confidence, and it can never move a row out of the
 * review queue. A wrong assessment costs a person three seconds of reading;
 * that is the whole blast radius, and it is why an advisory verdict is
 * acceptable here where a stored fact would not be.
 *
 * Split from the edge function for the usual reason (see canary.ts,
 * emailSafety.ts): the function imports Deno-only modules and cannot be
 * loaded under vitest. Nothing here imports anything.
 */

/** How the model's answer is classified. Deliberately not a boolean. */
export type ReviewVerdict = "likely_match" | "likely_mismatch" | "unclear";

export interface AssessmentFacts {
  businessName: string;
  city: string;
  /** CSLB's phone, E.164. Context only — a mismatch is explicitly NOT decisive. */
  cslbPhone: string | null;
  /** e.g. "electrical", "landscaping" — the licensed trade. */
  trade: string | null;
  sourceUrl: string;
}

export interface Assessment {
  verdict: ReviewVerdict;
  /** One or two sentences of reasoning, shown verbatim to the admin. */
  notes: string;
}

/**
 * Head and tail of the page's visible text.
 *
 * Both ends matter and the middle usually does not: the business name and
 * services sit in the nav and hero, while the address, licence number and
 * phone are almost always in the footer. Truncating from the front alone
 * would throw away the half that most often decides identity — the florist
 * and the Utah builder were both caught on footer content.
 */
export function extractReadableText(html: string, maxChars = 6000): string {
  const text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length <= maxChars) return text;

  const half = Math.floor(maxChars / 2);
  return `${text.slice(0, half)}\n…\n${text.slice(-half)}`;
}

/**
 * Builds the judging prompt.
 *
 * Two instructions carry the weight. First, that a differing phone number is
 * NOT evidence of a mismatch — left out, the model simply re-derives the
 * check the code already did and re-reports the mismatch that put the row in
 * the queue, which is worse than useless because it reads as confirmation.
 * Second, that it must answer only from the supplied text: this text was
 * fetched from the source URL by this project, and an answer drawn from the
 * model's own recall of a similarly-named business is exactly the failure
 * this queue exists to catch.
 */
export function buildAssessmentPrompt(facts: AssessmentFacts, pageText: string): string {
  return [
    `A California contractor directory holds this licence record:`,
    `- Business name: ${facts.businessName}`,
    `- City: ${facts.city}`,
    `- Licensed trade: ${facts.trade ?? "unknown"}`,
    `- Phone on file: ${facts.cslbPhone ?? "unknown"}`,
    ``,
    `Below is the visible text of ${facts.sourceUrl}, which was found by searching for that business.`,
    `Decide whether this website belongs to that same business.`,
    ``,
    `Weigh: does the business name match; is the location consistent with ${facts.city}, California;`,
    `do the services offered fit a "${facts.trade ?? "contractor"}" licence?`,
    ``,
    `IMPORTANT: a phone number on the site that differs from the phone on file is NOT evidence of a`,
    `mismatch — businesses commonly list toll-free, tracking, or secondary numbers. Do not treat a`,
    `differing or absent phone number as a reason to say mismatch.`,
    ``,
    `Judge ONLY from the text below. Do not use outside knowledge about any similarly-named business.`,
    `If the text is too sparse to tell, say unclear.`,
    ``,
    `Reply in exactly this format and nothing else:`,
    `VERDICT: likely_match OR likely_mismatch OR unclear`,
    `REASON: one or two sentences citing what in the text decided it`,
    ``,
    `--- PAGE TEXT ---`,
    pageText,
  ].join("\n");
}

/**
 * Parses the model's reply.
 *
 * Returns null on anything it cannot read confidently. Storing a half-parsed
 * or defaulted verdict would put words in the model's mouth on a screen whose
 * entire purpose is helping someone decide — an absent assessment is honest,
 * a fabricated one is not.
 */
export function parseAssessment(modelText: string): Assessment | null {
  if (!modelText) return null;

  const verdictMatch = modelText.match(/VERDICT:\s*(likely_match|likely_mismatch|unclear)/i);
  if (!verdictMatch) return null;

  const reasonMatch = modelText.match(/REASON:\s*([\s\S]+)/i);
  const notes = (reasonMatch?.[1] ?? "")
    .replace(/\s+/g, " ")
    .trim()
    // Long enough for real reasoning, short enough that the review card stays
    // scannable — the point is to speed a decision up, not to be read closely.
    .slice(0, 500);

  if (!notes) return null;

  return { verdict: verdictMatch[1].toLowerCase() as ReviewVerdict, notes };
}
