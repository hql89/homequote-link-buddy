import { serviceRoleKey as readServiceRoleKey, publishableKey as readPublishableKey } from "../_shared/supabaseKeys.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const FOLLOW_UP_DELAY_HOURS = 48;
const FEEDBACK_DELAY_HOURS = 120;

function generateToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  for (const byte of arr) result += chars[byte % chars.length];
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = readPublishableKey();
    const serviceRoleKey = readServiceRoleKey();

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { leadId, siteUrl } = await req.json();
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Fetch lead + buyer
    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .single();
    if (leadErr || !lead) {
      return new Response(
        JSON.stringify({ error: "Lead not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!lead.email) {
      return new Response(
        JSON.stringify({ error: "Lead has no email address — cannot send nurture emails" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!lead.assigned_buyer_id) {
      return new Response(
        JSON.stringify({ error: "No buyer assigned" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: buyer } = await supabase
      .from("buyers")
      .select("business_name, contact_name")
      .eq("id", lead.assigned_buyer_id)
      .single();

    const buyerName = buyer?.business_name || (lead.vertical === "plumbing" ? "our partner plumber" : "our partner service provider");
    const leadName = lead.full_name || "there";
    const feedbackToken = generateToken();
    const baseUrl = siteUrl || "https://homequotelink.com";

    // 1. Create feedback record with token
    await supabase.from("lead_feedback").insert({
      lead_id: leadId,
      token: feedbackToken,
    });

    const now = new Date();
    const followUpAt = new Date(now.getTime() + FOLLOW_UP_DELAY_HOURS * 3600_000);
    const feedbackAt = new Date(now.getTime() + FEEDBACK_DELAY_HOURS * 3600_000);

    // 2. Send the confirmation BEFORE recording it.
    //
    // This used to run the other way round: the confirmation row was inserted
    // with status 'sent' and a sent_at timestamp, then the send was fired with
    // `await fetch(...)` and its response discarded. So a notify-admin-email
    // failure — SMTP down, the volume circuit breaker tripped, a self-address
    // refusal, any 500 — left the homeowner with no email while the database
    // said it had been sent, lead_events said "Confirmation sent", and the
    // caller got success: true. Nothing anywhere recorded the failure.
    //
    // send-nurture-emails, which sends the follow-up and feedback mails of
    // this same sequence through this same endpoint, already gets this right:
    // it checks res.ok and only then writes status 'sent'. This is that
    // pattern, applied to the first email in the sequence.
    const confirmationHtml = buildConfirmationHtml(leadName, buyerName, lead.service_type || "plumbing");

    const notifyUrl = `${supabaseUrl}/functions/v1/notify-admin-email`;
    let confirmationSent = false;
    let confirmationError: string | null = null;
    try {
      const res = await fetch(notifyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          notificationType: "lead_nurture",
          nurtureData: {
            toEmail: lead.email,
            subject: `We've shared your request with ${buyerName}`,
            html: confirmationHtml,
          },
        }),
      });
      confirmationSent = res.ok;
      if (!res.ok) {
        confirmationError = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
      }
    } catch (sendErr) {
      confirmationError = sendErr instanceof Error ? sendErr.message : String(sendErr);
    }
    if (confirmationError) {
      console.error(`send-lead-confirmation: confirmation to ${lead.email} failed:`, confirmationError);
    }

    // 3. Record the sequence, with the confirmation's real outcome.
    //
    // The follow-up and feedback rows are scheduled either way: they are
    // future sends that send-nurture-emails will attempt on its own, and a
    // failed confirmation is no reason to cancel them.
    //
    // On failure the confirmation row is left at the column default,
    // 'scheduled', rather than marked 'failed'. That is deliberate and is
    // what makes the failure self-healing: send-nurture-emails selects
    // `status = 'scheduled' AND scheduled_at <= now()`, so a confirmation
    // left scheduled with scheduled_at of now is picked up and retried on
    // its next run. A terminal 'failed' would be recorded honestly and then
    // never sent — the homeowner still gets nothing. This is also exactly
    // how send-nurture-emails treats its own failures: it leaves the row
    // scheduled rather than closing it out.
    await supabase.from("lead_nurture_emails").insert([
      {
        lead_id: leadId,
        email_type: "confirmation",
        scheduled_at: now.toISOString(),
        ...(confirmationSent ? { status: "sent", sent_at: new Date().toISOString() } : {}),
      },
      { lead_id: leadId, email_type: "follow_up", scheduled_at: followUpAt.toISOString() },
      { lead_id: leadId, email_type: "feedback_request", scheduled_at: feedbackAt.toISOString() },
    ]);

    // 4. Log event — saying which of the two things actually happened.
    await supabase.from("lead_events").insert({
      lead_id: leadId,
      event_type: "nurture_started",
      event_detail: confirmationSent
        ? `Confirmation sent, follow-up scheduled for ${followUpAt.toISOString()}, feedback for ${feedbackAt.toISOString()}`
        : `Confirmation FAILED (${confirmationError}); follow-up still scheduled for ${followUpAt.toISOString()}, feedback for ${feedbackAt.toISOString()}`,
      created_by_user_id: userData.user.id,
    });

    // The nurture sequence is scheduled either way, so this is not a 500 —
    // but `success` must not claim the confirmation went out when it didn't.
    return new Response(
      JSON.stringify({
        success: confirmationSent,
        feedbackToken,
        ...(confirmationError ? { confirmationError } : {}),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("send-lead-confirmation error:", message);
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

function buildConfirmationHtml(name: string, buyerName: string, serviceType: string): string {
  const inner = `
<h1 style="margin:0 0 12px;font-size:20px;font-weight:700;">Your Request Has Been Sent!</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#333;">
  Hi ${name}, we've shared your <strong>${serviceType}</strong> request with <strong>${buyerName}</strong>. They should reach out to you shortly.
</p>
<p style="margin:0 0 16px;font-size:14px;color:#666;">
  Here's what happens next:
</p>
<ul style="margin:0 0 16px;padding-left:20px;font-size:14px;color:#333;line-height:1.8;">
  <li><strong>${buyerName}</strong> will contact you to discuss your project</li>
  <li>They'll provide a quote based on your needs</li>
  <li>You're under no obligation — it's a free quote</li>
</ul>
<p style="margin:0;font-size:13px;color:#999;">
  If you don't hear from them within 24 hours, feel free to reach out to us and we'll follow up on your behalf.
</p>`;
  return htmlWrapper("Your Request Has Been Sent", inner);
}
