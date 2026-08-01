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
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import {
  corsHeaders,
  json,
  loadOutreachTemplates,
  logRun,
  renderTemplate,
} from "../_shared/directory.ts";
import { loadSmtpConfig, sendOutreachEmail } from "../_shared/mailer.ts";

const JOB_NAME = "send-outreach-drip";
const DRIP_DELAY_DAYS = 3;
const BATCH_LIMIT = 50;

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
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const siteUrl = (Deno.env.get("PUBLIC_SITE_URL") || "https://homequotelink.com").replace(/\/+$/, "");

  const summary = { email1_sent: 0, email2_sent: 0, failed: 0 };
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
    };
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

    const { config } = await loadSmtpConfig(supabase);
    const templates = await loadOutreachTemplates(supabase);
    const senderName = config?.fromName || "The Directory Team";

    const selectCols =
      "id, business_name, slug, city, city_slug, owner_name, phone, email, claim_token, outreach_email_1_sent_at, outreach_email_2_sent_at";

    // ── Email 1: never sent ────────────────────────────────────────────────
    const { data: pendingFirst, error: firstErr } = await supabase
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
      .limit(BATCH_LIMIT);

    if (firstErr) throw new Error(`Query (email 1) failed: ${firstErr.message}`);

    for (const row of (pendingFirst ?? []) as BusinessRow[]) {
      if (!row.email) continue;
      const vars = {
        business_name: row.business_name,
        city: row.city,
        owner_name: row.owner_name || "there",
        phone: row.phone || "the number on your listing",
        sender_name: senderName,
      };
      const tpl = templates.outreach_verify;
      const result = await sendOutreachEmail(
        config,
        {
          to: row.email,
          subject: renderTemplate(tpl.subject, vars),
          text: renderTemplate(tpl.body, vars),
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
        await supabase
          .from("businesses")
          .update({ outreach_email_1_sent_at: new Date().toISOString() })
          .eq("id", row.id);
        summary.email1_sent++;
      } else {
        summary.failed++;
        errors.push(`${row.id} (email 1): ${result.error}`);
      }
    }

    // ── Email 2: Email 1 sent >= DRIP_DELAY_DAYS ago, not yet claimed ──────
    const cutoff = new Date(Date.now() - DRIP_DELAY_DAYS * 86_400_000).toISOString();

    const { data: pendingSecond, error: secondErr } = await supabase
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
      .limit(BATCH_LIMIT);

    if (secondErr) throw new Error(`Query (email 2) failed: ${secondErr.message}`);

    for (const row of (pendingSecond ?? []) as BusinessRow[]) {
      if (!row.email) continue;
      const claimUrl =
        `${siteUrl}/directory/${row.city_slug}/${row.slug}/claim?token=${row.claim_token}`;

      const vars = {
        business_name: row.business_name,
        city: row.city,
        owner_name: row.owner_name || "there",
        phone: row.phone || "",
        claim_url: claimUrl,
        sender_name: senderName,
      };
      const tpl = templates.outreach_preview;
      const result = await sendOutreachEmail(
        config,
        {
          to: row.email,
          subject: renderTemplate(tpl.subject, vars),
          text: renderTemplate(tpl.body, vars),
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
        await supabase
          .from("businesses")
          .update({ outreach_email_2_sent_at: new Date().toISOString() })
          .eq("id", row.id);
        summary.email2_sent++;
      } else {
        summary.failed++;
        errors.push(`${row.id} (email 2): ${result.error}`);
      }
    }

    const status = summary.failed > 0 ? "partial" : "success";
    await logRun(
      supabase,
      JOB_NAME,
      status,
      Date.now() - startedAt,
      errors.length ? errors.slice(0, 5).join(" | ") : null,
      summary,
    );

    return json({ success: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${JOB_NAME}]`, message);
    await logRun(supabase, JOB_NAME, "failure", Date.now() - startedAt, message, summary);
    return json({ success: false, error: message, ...summary }, 500);
  }
});
