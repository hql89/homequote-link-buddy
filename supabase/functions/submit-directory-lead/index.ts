/**
 * submit-directory-lead
 *
 * Public endpoint behind the "Request a Free Quote" form on a listing page.
 * Stores the lead against the business and emails the business owner. Open to
 * anon callers by design, so it validates input tightly and never echoes
 * stored contact details back.
 */
import { serviceRoleKey as readServiceRoleKey } from "../_shared/supabaseKeys.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { corsHeaders, json, logRun, toE164 } from "../_shared/directory.ts";
import { loadSmtpConfig, sendOutreachEmail } from "../_shared/mailer.ts";

const JOB_NAME = "submit-directory-lead";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mirrors the thresholds used by the existing rate-limit-lead function.
const MAX_PER_PHONE = 3;
const MAX_PER_IP = 10;
const WINDOW_MINUTES = 10;

// `ReturnType<typeof createClient>` resolves to a structurally different type
// than the runtime client under Deno's esm.sh module resolution and fails
// `deno check`; importing SupabaseClient directly (as claim-listing.ts does)
// avoids the mismatch.
type Supabase = SupabaseClient;

/** Blocklist check, reusing the project's blocked_emails / blocked_phones tables. */
async function isBlocked(
  supabase: Supabase,
  email: string,
  phoneE164: string,
): Promise<string | null> {
  if (email) {
    const { data } = await supabase
      .from("blocked_emails")
      .select("id")
      .eq("email_normalized", email)
      .maybeSingle();
    if (data) return "blocked_email";
  }

  const last10 = phoneE164.replace(/\D/g, "").slice(-10);
  if (last10.length === 10) {
    const { data } = await supabase
      .from("blocked_phones")
      .select("id")
      .eq("phone_normalized", last10)
      .maybeSingle();
    if (data) return "blocked_phone";
  }
  return null;
}

/** Sliding-window submission cap, per phone and per IP. */
async function isRateLimited(
  supabase: Supabase,
  phoneE164: string,
  ip: string | null,
): Promise<boolean> {
  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();

  const { count: phoneCount } = await supabase
    .from("directory_leads")
    .select("id", { count: "exact", head: true })
    .eq("phone", phoneE164)
    .gte("created_at", windowStart);
  if ((phoneCount ?? 0) >= MAX_PER_PHONE) return true;

  if (ip) {
    const { count: ipCount } = await supabase
      .from("directory_leads")
      .select("id", { count: "exact", head: true })
      .eq("ip_address", ip)
      .gte("created_at", windowStart);
    if ((ipCount ?? 0) >= MAX_PER_IP) return true;
  }

  return false;
}

async function logSpamEvent(
  supabase: Supabase,
  eventType: string,
  email: string,
  phone: string,
  ip: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.from("spam_events").insert({
      event_type: eventType,
      email: email || null,
      phone: phone || null,
      ip_address: ip,
      metadata,
    });
  } catch (err) {
    console.error(`[${JOB_NAME}] failed to log spam_event:`, err);
  }
}

interface LeadPayload {
  business_id?: string;
  full_name?: string;
  phone?: string;
  email?: string;
  message?: string;
  preferred_time?: string;
  source?: string;
}

function clamp(value: string, max: number): string {
  return value.trim().slice(0, max);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  const startedAt = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    readServiceRoleKey(),
  );

  try {
    const payload = (await req.json().catch(() => null)) as LeadPayload | null;
    if (!payload) return json({ success: false, error: "Invalid request." }, 400);

    const businessId = (payload.business_id ?? "").trim();
    if (!UUID_RE.test(businessId)) {
      return json({ success: false, error: "Invalid business reference." }, 400);
    }

    const fullName = clamp(payload.full_name ?? "", 120);
    if (fullName.length < 2) return json({ success: false, error: "Please enter your name." }, 400);

    const phone = toE164(payload.phone);
    if (!phone) {
      return json({ success: false, error: "Please enter a valid 10-digit phone number." }, 400);
    }

    const email = clamp(payload.email ?? "", 200).toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return json({ success: false, error: "Please enter a valid email address." }, 400);
    }

    const source = payload.source === "chat" ? "chat" : "quote_form";
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      null;

    // ── Abuse guards (server-side: a client check would be bypassable) ────
    const blockType = await isBlocked(supabase, email, phone);
    if (blockType) {
      await logSpamEvent(supabase, blockType, email, phone, ip, { fn: JOB_NAME });
      // Deliberately vague + 200 so a blocked sender learns nothing.
      return json({ success: true, leadId: null });
    }

    if (await isRateLimited(supabase, phone, ip)) {
      await logSpamEvent(supabase, "rate_limited", email, phone, ip, {
        fn: JOB_NAME,
        window_minutes: WINDOW_MINUTES,
        max_per_phone: MAX_PER_PHONE,
        max_per_ip: MAX_PER_IP,
      });
      return json(
        { success: false, error: "You've sent several requests already. Please try again shortly." },
        429,
      );
    }

    const { data: business, error: bizError } = await supabase
      .from("businesses")
      .select("id, business_name, email, phone, city, slug, city_slug, is_published, is_claimed")
      .eq("id", businessId)
      .maybeSingle();

    if (bizError) throw new Error(`Business lookup failed: ${bizError.message}`);
    if (!business || !business.is_published) {
      return json({ success: false, error: "This listing is no longer available." }, 404);
    }

    // Trust boundary, enforced server-side (the frontend already hides the
    // form): we never capture a lead on an unclaimed listing. Nothing about
    // this business's participation has been confirmed by its owner, so
    // routing a homeowner's contact details to them would look — correctly —
    // like this platform is intercepting leads on their behalf without
    // consent. The listing page falls back to click-to-call only until the
    // business claims it.
    if (!business.is_claimed) {
      return json(
        { success: false, error: "This business hasn't set up quote requests yet. Please call them directly." },
        403,
      );
    }

    const { data: lead, error: insertError } = await supabase
      .from("directory_leads")
      .insert({
        business_id: business.id,
        full_name: fullName,
        phone,
        email: email || null,
        message: clamp(payload.message ?? "", 2000) || null,
        preferred_time: clamp(payload.preferred_time ?? "", 200) || null,
        source,
        ip_address: ip,
      })
      .select("id")
      .single();

    if (insertError) throw new Error(`Insert failed: ${insertError.message}`);

    // ── Notify the business ────────────────────────────────────────────────
    let notified = false;
    let notifyError: string | null = null;

    if (business.email) {
      const { config } = await loadSmtpConfig(supabase);
      const lines = [
        `New quote request for ${business.business_name}`,
        "",
        `Name:  ${fullName}`,
        `Phone: ${phone}`,
        email ? `Email: ${email}` : "",
        payload.preferred_time ? `Preferred time: ${clamp(payload.preferred_time, 200)}` : "",
        "",
        payload.message ? `Message:\n${clamp(payload.message, 2000)}` : "",
        "",
        `Source: ${source === "chat" ? "AI chat assistant" : "Website quote form"}`,
      ].filter(Boolean);

      const result = await sendOutreachEmail(
        config,
        {
          to: business.email,
          subject: `New quote request for ${business.business_name}`,
          text: lines.join("\n"),
        },
        {
          supabase,
          jobName: JOB_NAME,
          emailType: "quote_request",
          recipientKind: "business",
          relatedBusinessId: business.id,
          relatedLeadId: lead.id,
        },
      );

      notified = result.success;
      notifyError = result.error ?? null;

      await supabase
        .from("directory_leads")
        .update({
          notified_at: result.success ? new Date().toISOString() : null,
          notify_error: notifyError,
        })
        .eq("id", lead.id);
    } else {
      notifyError = "Business has no email on file.";
    }

    await logRun(
      supabase,
      JOB_NAME,
      notifyError ? "partial" : "success",
      Date.now() - startedAt,
      notifyError,
      { business_id: business.id, lead_id: lead.id, source, notified },
    );

    // The lead is saved either way — never fail the user's submission just
    // because the notification email bounced.
    return json({ success: true, leadId: lead.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${JOB_NAME}]`, message);
    await logRun(supabase, JOB_NAME, "failure", Date.now() - startedAt, message, {});
    return json({ success: false, error: "Could not send your request. Please try again." }, 500);
  }
});
