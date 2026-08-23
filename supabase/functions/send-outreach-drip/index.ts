/**
 * send-outreach-drip
 *
 * Scheduled worker (intended to run daily via pg_cron, like the existing
 * send-nurture-emails job). Handles two cases:
 *
 *   • Email 1 (verification) — for rows that were ingested without outreach,
 *     or where the first send failed.
 *   • Email 2 (preview + claim link) — sent DRIP_DELAY_DAYS after Email 1.
 *
 * Every send goes through the SMTP → Resend failover mailer.
 */
import { serviceRoleKey as readServiceRoleKey } from "../_shared/supabaseKeys.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import {
  corsHeaders,
  formatPhoneDisplay,
  json,
  logRun,
  pickOutreachVariant,
  recordOutreachSend,
  renderTemplate,
} from "../_shared/directory.ts";
import { remainingDailyBudget, startOfUtcDay } from "../_shared/outreachVariants.ts";
import { loadSmtpConfig, sendOutreachEmail } from "../_shared/mailer.ts";
import { buildUnsubscribeHeaders } from "../_shared/emailSafety.ts";

const JOB_NAME = "send-outreach-drip";
const DRIP_DELAY_DAYS = 3;

/**
 * Page size for each candidate query — an upper bound on how much this reads
 * at once, NOT the send limit. The real limit is the admin's daily_limit,
 * counted across every run of the calendar day (see remainingDailyBudget).
 *
 * Until 2026-08-14 this constant WAS the limit, applied per invocation: two
 * runs in one day sent 100 emails, and no admin-visible number existed to
 * change that.
 */
const BATCH_PAGE_SIZE = 50;

/** Used only if outreach_config has no daily_limit — matches the migration's seed. */
const DEFAULT_DAILY_LIMIT = 10;

/**
 * How long a human's confirmation that mail actually arrives stays good for.
 *
 * SMTP acceptance is not delivery — on 2026-08-01 the server accepted every
 * message and discarded it, while this job would have stamped each business
 * as contacted and never retried it. Nothing available to this function can
 * detect that: the bounce arrives later, as a separate inbound email, and the
 * n8n bridge that would ingest it is not always running.
 *
 * So delivery is asserted by a person (Admin -> Settings -> Email, after a
 * test email actually lands) and that assertion expires, because a domain can
 * be suspended at any time without warning — as this one was, between a
 * working test on 26 July and a discarded one on 1 August.
 */
const DELIVERY_PROOF_MAX_AGE_DAYS = 14;

/**
 * Halt if bounces dominate recent sends. Belt to the gate's braces: it needs
 * bounce ingestion to be running, but when it is, it catches a domain that
 * breaks mid-campaign without waiting for the proof to expire.
 */
const BOUNCE_CIRCUIT_WINDOW_DAYS = 7;
const BOUNCE_CIRCUIT_MIN_SAMPLE = 10;
const BOUNCE_CIRCUIT_THRESHOLD = 0.5;

interface BusinessRow {
  id: string;
  business_name: string;
  slug: string;
  city: string;
  city_slug: string;
  owner_name: string | null;
  phone: string | null;
  email: string | null;
  claim_token: string;
  outreach_email_1_sent_at: string | null;
  outreach_email_2_sent_at: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = readServiceRoleKey();
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const siteUrl = (Deno.env.get("PUBLIC_SITE_URL") || "https://homequotelink.com").replace(/\/+$/, "");

  // stamp_write_failed: the send succeeded but recording that fact did not.
  // Distinct from `failed` (send itself failed) because these businesses WERE
  // emailed — the risk is a duplicate send next run, not a missed one — and
  // that difference matters when reading the log after the fact.
  const summary = {
    email1_sent: 0,
    email2_sent: 0,
    failed: 0,
    stamp_write_failed: 0,
    /** Sends that went out but couldn't be logged to outreach_sends. */
    send_log_write_failed: 0,
  };
  const errors: string[] = [];

  try {
    // ── Gate 1: has anyone confirmed mail actually arrives? ────────────────
    const { data: outreachCfgRow } = await supabase
      .from("admin_settings")
      .select("setting_value")
      .eq("setting_key", "outreach_config")
      .maybeSingle();

    const outreachCfg = (outreachCfgRow?.setting_value ?? {}) as {
      delivery_verified_at?: string;
      daily_limit?: number;
      /**
       * Optional testing copy. Empty/absent = off, which is why turning this
       * feature off is a config edit rather than a redeploy. Validated at the
       * send boundary by resolveBccCopy, not here.
       */
      bcc_email?: string;
    };
    const bccCopy = outreachCfg.bcc_email?.trim() || undefined;
    const verifiedAt = outreachCfg.delivery_verified_at
      ? Date.parse(outreachCfg.delivery_verified_at)
      : NaN;
    const proofAgeMs = Date.now() - verifiedAt;
    const maxAgeMs = DELIVERY_PROOF_MAX_AGE_DAYS * 86_400_000;

    if (Number.isNaN(verifiedAt) || proofAgeMs > maxAgeMs) {
      const reason = Number.isNaN(verifiedAt)
        ? "delivery has never been confirmed"
        : `delivery was last confirmed ${Math.floor(proofAgeMs / 86_400_000)} days ago`;

      // Not an error: refusing to send is the correct outcome, and saying so
      // plainly is what stops this being mistaken for a quiet no-op.
      await logRun(supabase, JOB_NAME, "success", Date.now() - startedAt, null, {
        halted: "delivery_unverified",
        reason,
        ...summary,
      });
      return json({
        success: true,
        halted: "delivery_unverified",
        reason:
          `${reason}. Send a test email from Admin → Settings → Email, confirm it arrived, ` +
          `then outreach will resume. SMTP accepting a message does not prove it was delivered.`,
        ...summary,
      });
    }

    // ── Gate 2: are recent sends mostly bouncing? ──────────────────────────
    const windowStart = new Date(
      Date.now() - BOUNCE_CIRCUIT_WINDOW_DAYS * 86_400_000,
    ).toISOString();

    const { count: recentSends } = await supabase
      .from("email_send_log")
      .select("id", { count: "exact", head: true })
      .eq("job_name", JOB_NAME)
      .gte("sent_at", windowStart);

    const { count: recentBounces } = await supabase
      .from("email_send_log")
      .select("id", { count: "exact", head: true })
      .eq("job_name", JOB_NAME)
      .eq("status", "bounced")
      .gte("sent_at", windowStart);

    const sends = recentSends ?? 0;
    const bounces = recentBounces ?? 0;

    if (sends >= BOUNCE_CIRCUIT_MIN_SAMPLE && bounces / sends >= BOUNCE_CIRCUIT_THRESHOLD) {
      await logRun(supabase, JOB_NAME, "partial", Date.now() - startedAt, null, {
        halted: "bounce_rate",
        recent_sends: sends,
        recent_bounces: bounces,
        ...summary,
      });
      return json({
        success: true,
        halted: "bounce_rate",
        reason:
          `${bounces} of the last ${sends} outreach emails bounced. Sending is stopped until ` +
          `the cause is fixed — continuing would damage the domain's sending reputation.`,
        ...summary,
      });
    }

    // ── Gate 3: has today's send allowance already been used? ──────────────
    // Counted from outreach_sends, which records one row per delivered
    // outreach email, so the cap holds across every run of the calendar day
    // — repeated cron firings, manual "Run now" clicks, or both. The old
    // BATCH_LIMIT was per invocation and could not do this.
    const dayStart = startOfUtcDay();

    const { count: sentTodayCount, error: sentTodayErr } = await supabase
      .from("outreach_sends")
      .select("id", { count: "exact", head: true })
      .gte("sent_at", dayStart);

    // Unreadable count means the budget is unknown. Sending on an unknown
    // budget is how a "limit 10" turns into an unbounded send, so this stops
    // rather than assuming zero.
    if (sentTodayErr) {
      throw new Error(`Could not read today's send count: ${sentTodayErr.message}`);
    }

    const dailyLimit = Number.isFinite(outreachCfg.daily_limit)
      ? Number(outreachCfg.daily_limit)
      : DEFAULT_DAILY_LIMIT;
    const sentToday = sentTodayCount ?? 0;
    let budget = remainingDailyBudget(dailyLimit, sentToday);

    if (budget <= 0) {
      await logRun(supabase, JOB_NAME, "success", Date.now() - startedAt, null, {
        halted: "daily_limit_reached",
        daily_limit: dailyLimit,
        sent_today: sentToday,
        ...summary,
      });
      return json({
        success: true,
        halted: "daily_limit_reached",
        reason:
          `${sentToday} of today's limit of ${dailyLimit} outreach emails have already been sent. ` +
          `Sending resumes tomorrow, or sooner if you raise the limit in Admin → Outreach.`,
        daily_limit: dailyLimit,
        sent_today: sentToday,
        ...summary,
      });
    }

    const { config } = await loadSmtpConfig(supabase);
    const senderName = config?.fromName || "The Directory Team";

    const selectCols =
      "id, business_name, slug, city, city_slug, owner_name, phone, email, claim_token, outreach_email_1_sent_at, outreach_email_2_sent_at";

    // ── Email 1: never sent ────────────────────────────────────────────────
    // Null when the admin has deactivated every variant for this stage.
    // Sending the old hardcoded copy in that case would be a silent
    // substitution of content nobody approved, so the stage is skipped and
    // the reason recorded.
    const verifyVariant = await pickOutreachVariant(supabase, "outreach_verify");
    if (!verifyVariant) {
      errors.push("Email 1 skipped: no active template variant.");
    }

    const { data: pendingFirst, error: firstErr } = verifyVariant
      ? await supabase
      .from("businesses")
      .select(selectCols)
      .eq("outreach_paused", false)
      // Someone who replied STOP must never receive another message. The
      // unsubscribe was being recorded and then ignored here, which is the
      // one failure in this whole system that is not merely embarrassing.
      .is("outreach_suppressed_at", null)
      // Only addresses the scan could actually corroborate. "verified" means
      // the contractor's licensed phone number was found on the same website
      // the address came from; "needs_review" means we found an address but
      // could not tie it to this business at all. Emailing those risks cold-
      // mailing a stranger and telling them we have built them a listing.
      // /admin/enrichment is where a human promotes needs_review -> verified.
      .eq("email_confidence", "verified")
      .is("outreach_email_1_sent_at", null)
      .not("email", "is", null)
      // A recipient-side bounce proved this address is dead. Retrying a
      // non-existent mailbox is what damages sender reputation.
      .is("email_undeliverable_at", null)
      .order("created_at", { ascending: true })
      // Never read more than today's remaining allowance — the cap is
      // enforced here, at the query, not by breaking out of the loop later.
      .limit(Math.min(BATCH_PAGE_SIZE, budget))
      : { data: [], error: null };

    if (firstErr) throw new Error(`Query (email 1) failed: ${firstErr.message}`);

    for (const row of (pendingFirst ?? []) as BusinessRow[]) {
      if (!row.email || !verifyVariant) continue;
      if (budget <= 0) break;
      // Routed through the homequotelink.com domain (vercel.json rewrites
      // /unsubscribe to the edge function) rather than the raw supabase.co
      // URL, so the link doesn't look like a mismatched/phishy domain next
      // to a "Home Quote Link" branded email. The rewrite is a transparent
      // proxy, so it still works for RFC 8058's List-Unsubscribe-Post
      // one-click POST fired by the recipient's mail provider (not a
      // browser) — there is no page to land on. The same URL also works for
      // a human clicking it in the body, since the function itself renders
      // a confirmation page on GET.
      const unsubscribeUrl = `${siteUrl}/unsubscribe?token=${row.claim_token}`;
      const vars = {
        business_name: row.business_name,
        city: row.city,
        owner_name: row.owner_name || "there",
        phone: row.phone ? formatPhoneDisplay(row.phone) : "the number on your listing",
        sender_name: senderName,
        unsubscribe_url: unsubscribeUrl,
      };
      const result = await sendOutreachEmail(
        config,
        {
          to: row.email,
          subject: renderTemplate(verifyVariant.subject, vars),
          text: renderTemplate(verifyVariant.body, vars),
          bcc: bccCopy,
          headers: buildUnsubscribeHeaders(unsubscribeUrl, config?.fromEmail),
        },
        {
          supabase,
          jobName: JOB_NAME,
          emailType: "outreach_verify",
          recipientKind: "business",
          relatedBusinessId: row.id,
        },
      );

      if (result.success) {
        summary.email1_sent++;
        budget--;
        // Consumes today's allowance and attributes the send to its variant.
        // Logged even if it fails, because an unrecorded send is one the cap
        // can't see — it would let the next run exceed the limit.
        const sendLogErr = await recordOutreachSend(supabase, {
          businessId: row.id,
          emailType: "outreach_verify",
          variantKey: verifyVariant.variantKey,
        });
        if (sendLogErr) {
          summary.send_log_write_failed++;
          errors.push(
            `${row.id} (email 1): sent successfully but the send log write failed — ` +
              `today's count is now understated: ${sendLogErr}`,
          );
        }
        // Unchecked before: if this write silently failed, the business
        // stayed eligible (outreach_email_1_sent_at still null) and would be
        // emailed again on the next run. The message already went out — a
        // failure here can only cause a DUPLICATE send, never a missed one —
        // so it is logged loudly rather than swallowed.
        const { error: stampErr } = await supabase
          .from("businesses")
          .update({ outreach_email_1_sent_at: new Date().toISOString() })
          .eq("id", row.id);
        if (stampErr) {
          summary.stamp_write_failed++;
          errors.push(
            `${row.id} (email 1): sent successfully but outreach_email_1_sent_at ` +
              `failed to write — will be re-sent next run: ${stampErr.message}`,
          );
        }
      } else {
        summary.failed++;
        errors.push(`${row.id} (email 1): ${result.error}`);
      }
    }

    // ── Email 2: Email 1 sent >= DRIP_DELAY_DAYS ago, not yet claimed ──────
    // The budget is shared between both stages, not per-stage: "limit 10"
    // means ten outreach emails today in total. If Email 1 consumed it all,
    // this query is skipped outright rather than fetched and discarded.
    const cutoff = new Date(Date.now() - DRIP_DELAY_DAYS * 86_400_000).toISOString();

    const previewVariant = budget > 0
      ? await pickOutreachVariant(supabase, "outreach_preview")
      : null;
    if (budget > 0 && !previewVariant) {
      errors.push("Email 2 skipped: no active template variant.");
    }

    const { data: pendingSecond, error: secondErr } = previewVariant
      ? await supabase
      .from("businesses")
      .select(selectCols)
      .eq("outreach_paused", false)
      .is("outreach_suppressed_at", null)
      .eq("email_confidence", "verified")
      .eq("is_claimed", false)
      .is("email_undeliverable_at", null)
      .not("outreach_email_1_sent_at", "is", null)
      .lte("outreach_email_1_sent_at", cutoff)
      .is("outreach_email_2_sent_at", null)
      .not("email", "is", null)
      .order("outreach_email_1_sent_at", { ascending: true })
      .limit(Math.min(BATCH_PAGE_SIZE, budget))
      : { data: [], error: null };

    if (secondErr) throw new Error(`Query (email 2) failed: ${secondErr.message}`);

    for (const row of (pendingSecond ?? []) as BusinessRow[]) {
      if (!row.email || !previewVariant) continue;
      if (budget <= 0) break;
      const claimUrl =
        `${siteUrl}/directory/${row.city_slug}/${row.slug}/claim?token=${row.claim_token}`;
      const unsubscribeUrl = `${siteUrl}/unsubscribe?token=${row.claim_token}`;

      const vars = {
        business_name: row.business_name,
        city: row.city,
        owner_name: row.owner_name || "there",
        phone: row.phone ? formatPhoneDisplay(row.phone) : "",
        claim_url: claimUrl,
        sender_name: senderName,
        unsubscribe_url: unsubscribeUrl,
      };
      const result = await sendOutreachEmail(
        config,
        {
          to: row.email,
          subject: renderTemplate(previewVariant.subject, vars),
          text: renderTemplate(previewVariant.body, vars),
          bcc: bccCopy,
          headers: buildUnsubscribeHeaders(unsubscribeUrl, config?.fromEmail),
        },
        {
          supabase,
          jobName: JOB_NAME,
          emailType: "outreach_preview",
          recipientKind: "business",
          relatedBusinessId: row.id,
        },
      );

      if (result.success) {
        summary.email2_sent++;
        budget--;
        const sendLogErr = await recordOutreachSend(supabase, {
          businessId: row.id,
          emailType: "outreach_preview",
          variantKey: previewVariant.variantKey,
        });
        if (sendLogErr) {
          summary.send_log_write_failed++;
          errors.push(
            `${row.id} (email 2): sent successfully but the send log write failed — ` +
              `today's count is now understated: ${sendLogErr}`,
          );
        }
        const { error: stampErr } = await supabase
          .from("businesses")
          .update({ outreach_email_2_sent_at: new Date().toISOString() })
          .eq("id", row.id);
        if (stampErr) {
          summary.stamp_write_failed++;
          errors.push(
            `${row.id} (email 2): sent successfully but outreach_email_2_sent_at ` +
              `failed to write — will be re-sent next run: ${stampErr.message}`,
          );
        }
      } else {
        summary.failed++;
        errors.push(`${row.id} (email 2): ${result.error}`);
      }
    }

    // A stamp-write failure is worse than an ordinary send failure — it risks
    // a duplicate send, not just a missed one — so it must surface the run as
    // partial exactly like an outright failure would. A send-log write
    // failure is the same class of problem for the cap: it understates
    // today's count, which risks exceeding the limit on the next run.
    const status =
      summary.failed > 0 || summary.stamp_write_failed > 0 || summary.send_log_write_failed > 0
        ? "partial"
        : "success";
    const runMeta = {
      ...summary,
      daily_limit: dailyLimit,
      sent_today_before_run: sentToday,
      budget_remaining: budget,
      variant_verify: verifyVariant?.variantKey ?? null,
      variant_preview: previewVariant?.variantKey ?? null,
      // Recorded so "why did I get a copy of that?" — and, more importantly,
      // "is this still on?" — are answerable from the run history alone.
      bcc_copy_to: bccCopy ?? null,
    };
    await logRun(
      supabase,
      JOB_NAME,
      status,
      Date.now() - startedAt,
      errors.length ? errors.slice(0, 5).join(" | ") : null,
      runMeta,
    );

    return json({ success: true, ...runMeta });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${JOB_NAME}]`, message);
    await logRun(supabase, JOB_NAME, "failure", Date.now() - startedAt, message, summary);
    return json({ success: false, error: message, ...summary }, 500);
  }
});
