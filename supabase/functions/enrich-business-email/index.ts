/**
 * enrich-business-email
 *
 * Phase 2 of implementation_plan.md's email enrichment design: discover a
 * candidate website via Perplexity, fetch it ourselves, verify identity by
 * matching the CSLB phone number on the page, and extract an email — never
 * from the model, only from a page we actually fetched.
 *
 * The hard rule: Perplexity finds URLs, it never supplies facts. Sonar's
 * response is parsed for a URL and everything else is discarded — if it
 * asserts an email or phone number in prose, that assertion is never stored.
 *
 * Only a phone match makes a row 'verified' (drip-eligible). Everything else
 * lands 'needs_review' for an admin to confirm, or nothing at all if no email
 * was found — same moderation posture as business photos and inbound replies.
 *
 * Auth: any privileged caller (admin JWT or service role) — see isPrivilegedCaller.
 */
import { serviceRoleKey as readServiceRoleKey } from "../_shared/supabaseKeys.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import {
  corsHeaders,
  json,
  logRun,
  isPrivilegedCaller,
  loadPerplexityConfig,
  loadEnrichmentConfig,
} from "../_shared/directory.ts";
import {
  extractUrlFromModelText,
  extractEmailsFromHtml,
  extractPhonesFromHtml,
  extractAddressFromHtml,
  phoneMatchesPage,
  isDisallowedByRobots,
  resolveConfidence,
} from "../_shared/emailEnrichment.ts";
import {
  buildAssessmentPrompt,
  extractReadableText,
  parseAssessment,
  type Assessment,
} from "../_shared/enrichmentAssessment.ts";

const JOB_NAME = "enrich-business-email";
const MAX_DAILY_LIMIT = 100;
const USER_AGENT = "ValleyHomeProsBot/1.0 (+https://homequotelink.com)";
const FETCH_TIMEOUT_MS = 8_000;
/** Generous vs. the page fetch — this is a model call, and it is optional. */
const ASSESSMENT_TIMEOUT_MS = 20_000;
/** Pause between fetching each business's own site — the "hard rate limit"
 *  the root plan calls for on the crawl step, distinct from the daily cap. */
const BETWEEN_FETCHES_MS = 500;

interface CandidateRow {
  id: string;
  business_name: string;
  city: string;
  phone: string | null;
  /** The one class chosen for display. Context for the identity assessment. */
  vertical_slug: string | null;
  /** Full CSLB class list — what trade-fit is actually judged against, since
   *  221 of 536 businesses hold more than the one class vertical_slug shows. */
  classification: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Sonar is asked for a URL only — see the module header for why the response text itself is never trusted. */
async function discoverUrl(apiKey: string, businessName: string, city: string): Promise<string | null> {
  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "sonar",
      messages: [
        {
          role: "user",
          content:
            `What is the official website URL for "${businessName}", a licensed contractor in ` +
            `${city}, California? Reply with only the URL, nothing else. If you cannot find one, say "none".`,
        },
      ],
    }),
  });

  if (!res.ok) throw new Error(`Perplexity API returned ${res.status}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  return extractUrlFromModelText(content);
}

/**
 * Asks the model whether the fetched page is really this business.
 *
 * Only ever called for rows headed to the review queue — a phone match has
 * already settled the verified ones, and spending a call to second-guess it
 * would be both wasteful and an invitation to override a deterministic check
 * with a probabilistic one.
 *
 * Returns null on any failure, and the caller stores nothing in that case.
 * This is a nicety on a screen a human is going to read anyway: it must never
 * cost a row its enrichment. Note the model is handed page text THIS FUNCTION
 * fetched, and its output is confined to advisory columns — it cannot reach
 * email, phone, or email_confidence.
 */
async function assessIdentity(
  apiKey: string,
  facts: Parameters<typeof buildAssessmentPrompt>[0],
  html: string,
): Promise<Assessment | null> {
  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          { role: "user", content: buildAssessmentPrompt(facts, extractReadableText(html)) },
        ],
      }),
      signal: AbortSignal.timeout(ASSESSMENT_TIMEOUT_MS),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return parseAssessment(data?.choices?.[0]?.message?.content ?? "");
  } catch {
    return null;
  }
}

async function tryFetchDomain(candidateUrl: string): Promise<string | null> {
  const parsed = new URL(candidateUrl);

  try {
    const robotsRes = await fetchWithTimeout(`${parsed.origin}/robots.txt`, FETCH_TIMEOUT_MS);
    if (robotsRes.ok) {
      const robotsTxt = await robotsRes.text();
      if (isDisallowedByRobots(robotsTxt, parsed.pathname || "/", USER_AGENT)) return null;
    }
  } catch {
    // No robots.txt, or it timed out — proceed. Absence is not a disallow.
  }

  // Network-level failures are an ORDINARY outcome here, not an error: the
  // URL came from a model's guess, so a domain that does not resolve, refuses
  // the connection, or times out is routine. Left unguarded this throws, and
  // enrichOne's catch classifies the row `failed` — which, unlike
  // `fetch_failed`, never stamps enriched_at. The candidate query takes the
  // oldest un-enriched rows every run, so those same rows come back forever
  // and the batch can never advance past them. That is exactly what happened:
  // two rows (a dead domain and a timeout) consumed the entire daily limit on
  // 2026-08-20's runs, twice, while 476 untouched businesses waited behind
  // them. Returning null routes them to `fetch_failed`, which stamps and
  // moves on.
  try {
    const pageRes = await fetchWithTimeout(candidateUrl, FETCH_TIMEOUT_MS);
    if (!pageRes.ok) return null;
    return await pageRes.text();
  } catch {
    return null;
  }
}

/** One business, start to finish. Never throws — a bad row must not stall the batch. */
async function enrichOne(
  supabase: SupabaseClient,
  apiKey: string,
  row: CandidateRow,
): Promise<"verified" | "needs_review" | "no_url" | "no_email" | "fetch_failed" | "failed"> {
  try {
    const candidateUrl = await discoverUrl(apiKey, row.business_name, row.city);
    if (!candidateUrl) {
      await supabase.from("businesses").update({ enriched_at: new Date().toISOString() }).eq("id", row.id);
      return "no_url";
    }

    const html = await tryFetchDomain(candidateUrl);
    if (!html) {
      await supabase
        .from("businesses")
        .update({ enriched_at: new Date().toISOString(), email_source_url: candidateUrl })
        .eq("id", row.id);
      return "fetch_failed";
    }

    const emails = extractEmailsFromHtml(html);
    if (emails.length === 0) {
      await supabase
        .from("businesses")
        .update({ enriched_at: new Date().toISOString(), email_source_url: candidateUrl })
        .eq("id", row.id);
      return "no_email";
    }

    const phones = extractPhonesFromHtml(html);
    const matched = phoneMatchesPage(row.phone, phones);
    const confidence = resolveConfidence(matched);
    const address = extractAddressFromHtml(html);

    // Only for rows a human will have to judge. A phone match has already
    // settled the verified ones deterministically; asking a model to weigh in
    // there would spend a call to invite second-guessing a stronger signal.
    const assessment =
      confidence === "needs_review"
        ? await assessIdentity(
            apiKey,
            {
              businessName: row.business_name,
              city: row.city,
              cslbPhone: row.phone,
              trade: row.vertical_slug,
              classification: row.classification,
              sourceUrl: candidateUrl,
            },
            html,
          )
        : null;

    await supabase
      .from("businesses")
      .update({
        email: emails[0],
        email_source_url: candidateUrl,
        email_source_phone: phones[0] ?? null,
        email_source_address: address,
        email_confidence: confidence,
        // Written together with the evidence they describe, and null for a
        // verified row so a stale verdict from an earlier pass can never
        // outlive the finding it was about.
        email_review_verdict: assessment?.verdict ?? null,
        email_review_notes: assessment?.notes ?? null,
        email_review_assessed_at: assessment ? new Date().toISOString() : null,
        enriched_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    return confidence;
  } catch (err) {
    console.error(`[${JOB_NAME}] row ${row.id} failed:`, err instanceof Error ? err.message : err);
    return "failed";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  if (!(await isPrivilegedCaller(req))) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }

  const startedAt = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    readServiceRoleKey(),
  );

  const summary = { considered: 0, verified: 0, needs_review: 0, no_url: 0, no_email: 0, fetch_failed: 0, failed: 0 };

  try {
    const enrichmentConfig = await loadEnrichmentConfig(supabase);
    if (!enrichmentConfig.enabled) {
      await logRun(supabase, JOB_NAME, "success", Date.now() - startedAt, null, { ...summary, skipped: "disabled" });
      return json({ success: true, ...summary, skipped: "Enrichment is disabled." });
    }

    const { config: perplexity, error: perplexityError } = await loadPerplexityConfig(supabase);
    if (!perplexity?.api_key || !perplexity.enabled) {
      const message = perplexityError ?? "Perplexity is not enabled. Go to Admin → Settings.";
      await logRun(supabase, JOB_NAME, "failure", Date.now() - startedAt, message, summary);
      return json({ success: false, error: message }, 400);
    }

    const limit = Math.min(enrichmentConfig.daily_limit, MAX_DAILY_LIMIT);

    const { data: candidates, error: queryError } = await supabase
      .from("businesses")
      .select("id, business_name, city, phone, vertical_slug, classification")
      .is("enriched_at", null)
      .eq("is_published", true)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (queryError) throw new Error(`Candidate query failed: ${queryError.message}`);

    const rows = (candidates ?? []) as CandidateRow[];
    summary.considered = rows.length;

    for (let i = 0; i < rows.length; i++) {
      const outcome = await enrichOne(supabase, perplexity.api_key, rows[i]);
      summary[outcome]++;
      if (i < rows.length - 1) await sleep(BETWEEN_FETCHES_MS);
    }

    await logRun(supabase, JOB_NAME, "success", Date.now() - startedAt, null, summary);
    return json({ success: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${JOB_NAME}]`, message);
    await logRun(supabase, JOB_NAME, "failure", Date.now() - startedAt, message, summary);
    return json({ success: false, error: message, ...summary }, 500);
  }
});
