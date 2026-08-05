import { serviceRoleKey as readServiceRoleKey } from "../_shared/supabaseKeys.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const JOB_NAME = "send-nurture-emails-hourly";
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;

async function withRetries<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_ATTEMPTS) break;
      const delay = BASE_BACKOFF_MS * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200);
      console.warn(`[send-nurture-emails] ${label} attempt ${attempt} failed, retrying in ${delay}ms`, err);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

async function logRun(
  supabase: ReturnType<typeof createClient>,
  status: "success" | "failure" | "partial",
  attempts: number,
  durationMs: number,
  errorMessage: string | null,
  metadata: Record<string, unknown>,
) {
  try {
    await supabase.from("job_run_logs").insert({
      job_name: JOB_NAME,
      status,
      attempts,
      duration_ms: durationMs,
      error_message: errorMessage,
      metadata,
    });
  } catch (logErr) {
    console.error("[send-nurture-emails] failed to write job_run_logs:", logErr);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startedAt = Date.now();
  let outerAttempts = 0;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = readServiceRoleKey();
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    // Get all scheduled emails that are due
    const pendingEmails = await withRetries("fetch pending nurture emails", async () => {
      outerAttempts++;
      const { data, error } = await supabase
        .from("lead_nurture_emails")
        .select("*")
        .eq("status", "scheduled")
        .lte("scheduled_at", new Date().toISOString())
        .limit(50);
      if (error) throw error;
      return data;
    });

    if (!pendingEmails || pendingEmails.length === 0) {
      await logRun(supabase, "success", outerAttempts, Date.now() - startedAt, null, { processed: 0, pending: 0 });
      return new Response(
        JSON.stringify({ processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let processed = 0;
    const failures: { id: string; error: string }[] = [];

    for (const nurture of pendingEmails) {
      try {
        // Fetch lead
        const { data: lead } = await supabase
          .from("leads")
          .select("*")
          .eq("id", nurture.lead_id)
          .single();

        if (!lead || !lead.email || lead.status === "spam") {
          // Cancel if no email or spam
          await supabase
            .from("lead_nurture_emails")
            .update({ status: "cancelled" })
            .eq("id", nurture.id);
          continue;
        }

        // Fetch buyer name
        let buyerName = lead.vertical === "plumbing" ? "your plumber" : "your service provider";
        if (lead.assigned_buyer_id) {
          const { data: buyer } = await supabase
            .from("buyers")
            .select("business_name")
            .eq("id", lead.assigned_buyer_id)
            .single();
          if (buyer) buyerName = buyer.business_name;
        }

        // Get feedback token
        const { data: feedback } = await supabase
          .from("lead_feedback")
          .select("token")
          .eq("lead_id", lead.id)
          .maybeSingle();

        const feedbackUrl = feedback?.token
          ? `https://homequotelink.com/feedback?token=${feedback.token}`
          : null;

        const leadName = lead.full_name || "there";
        let subject = "";
        let html = "";

        if (nurture.email_type === "follow_up") {
          subject = `Did ${buyerName} reach out about your ${lead.service_type || "plumbing"} request?`;
          html = buildFollowUpHtml(leadName, buyerName, lead.service_type || "plumbing");
        } else if (nurture.email_type === "feedback_request") {
          subject = `How did it go with ${buyerName}?`;
          html = buildFeedbackRequestHtml(leadName, buyerName, feedbackUrl);
        } else {
          continue;
        }

        // Send via notify-admin-email
        const notifyUrl = `${supabaseUrl}/functions/v1/notify-admin-email`;
        const res = await fetch(notifyUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            notificationType: "lead_nurture",
            nurtureData: { toEmail: lead.email, subject, html },
          }),
        });

        if (res.ok) {
          await supabase
            .from("lead_nurture_emails")
            .update({ status: "sent", sent_at: new Date().toISOString() })
            .eq("id", nurture.id);

          await supabase.from("lead_events").insert({
            lead_id: lead.id,
            event_type: `nurture_${nurture.email_type}_sent`,
            event_detail: `${nurture.email_type} email sent to ${lead.email}`,
          });

          processed++;
        } else {
          const text = await res.text();
          console.error(`Failed to send nurture email ${nurture.id}:`, text);
          failures.push({ id: nurture.id, error: `HTTP ${res.status}: ${text.slice(0, 200)}` });
        }
      } catch (innerErr) {
        console.error(`Error processing nurture email ${nurture.id}:`, innerErr);
        failures.push({
          id: nurture.id,
          error: innerErr instanceof Error ? innerErr.message : String(innerErr),
        });
      }
    }

    const status = failures.length === 0
      ? "success"
      : processed === 0
        ? "failure"
        : "partial";
    await logRun(
      supabase,
      status,
      outerAttempts,
      Date.now() - startedAt,
      failures.length > 0 ? `${failures.length} of ${pendingEmails.length} failed` : null,
      { processed, pending: pendingEmails.length, failures: failures.slice(0, 10) },
    );

    return new Response(
      JSON.stringify({ processed, failures: failures.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("send-nurture-emails error:", message);
    await logRun(supabase, "failure", outerAttempts || 1, Date.now() - startedAt, message, {});
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function htmlWrapper(title: string, innerHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
<tr><td style="background:#2563eb;padding:20px 28px;border-radius:12px 12px 0 0;">
<span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">HomeQuoteLink</span>
</td></tr>
<tr><td style="background:#ffffff;padding:28px;border-radius:0 0 12px 12px;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
${innerHtml}
</td></tr>
</table>
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;margin-top:16px;">
<tr><td style="text-align:center;color:#999;font-size:12px;padding:8px;">
© ${new Date().getFullYear()} HomeQuoteLink
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function buildFollowUpHtml(name: string, buyerName: string, serviceType: string): string {
  const inner = `
<h1 style="margin:0 0 12px;font-size:20px;font-weight:700;">Quick Check-In</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#333;">
  Hi ${name}, just checking in — did <strong>${buyerName}</strong> reach out about your <strong>${serviceType}</strong> request?
</p>
<p style="margin:0 0 16px;font-size:14px;color:#666;">
  If you haven't heard from them yet, don't worry. Sometimes schedules get busy. If you'd like us to follow up on your behalf, just reply to this email and we'll make sure you get connected.
</p>
<p style="margin:0;font-size:13px;color:#999;">
  We want to make sure you get the help you need!
</p>`;
  return htmlWrapper("Quick Check-In", inner);
}

function buildFeedbackRequestHtml(name: string, buyerName: string, feedbackUrl: string | null): string {
  const ctaButton = feedbackUrl
    ? `<table cellpadding="0" cellspacing="0" style="margin:20px 0 8px;">
<tr><td style="background:#2563eb;border-radius:8px;">
<a href="${feedbackUrl}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">Share Your Feedback →</a>
</td></tr></table>`
    : "";

  const inner = `
<h1 style="margin:0 0 12px;font-size:20px;font-weight:700;">How Did It Go?</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#333;">
  Hi ${name}, we'd love to hear about your experience with <strong>${buyerName}</strong>.
</p>
<p style="margin:0 0 16px;font-size:14px;color:#666;">
  Your feedback helps us connect homeowners with the best service professionals in the area. It only takes a minute!
</p>
<ul style="margin:0 0 16px;padding-left:20px;font-size:14px;color:#333;line-height:1.8;">
  <li>Did you end up hiring them?</li>
  <li>How was the communication?</li>
  <li>Would you recommend them?</li>
</ul>
${ctaButton}
<p style="margin:8px 0 0;font-size:13px;color:#999;">
  Your response is confidential and helps us improve our service.
</p>`;
  return htmlWrapper("How Did It Go?", inner);
}
