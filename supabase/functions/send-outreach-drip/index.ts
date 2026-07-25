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
      .is("outreach_email_1_sent_at", null)
      .not("email", "is", null)
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
      const result = await sendOutreachEmail(config, {
        to: row.email,
        subject: renderTemplate(tpl.subject, vars),
        text: renderTemplate(tpl.body, vars),
      });

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
      .eq("is_claimed", false)
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
      const result = await sendOutreachEmail(config, {
        to: row.email,
        subject: renderTemplate(tpl.subject, vars),
        text: renderTemplate(tpl.body, vars),
      });

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
