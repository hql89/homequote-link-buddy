/**
 * ingest-business
 *
 * Accepts a business's public info, creates the directory row (which makes the
 * listing page live immediately), and kicks off the outreach drip by sending
 * Email 1 straight away. Email 2 is sent later by `send-outreach-drip`.
 *
 * Auth: requires the caller to present the service role key or an admin JWT.
 * This endpoint writes public content and sends cold email, so it is never
 * open to anon callers.
 */
import { serviceRoleKey as readServiceRoleKey } from "../_shared/supabaseKeys.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import {
  corsHeaders,
  json,
  logRun,
  pickOutreachVariant,
  recordOutreachSend,
  renderTemplate,
  slugify,
} from "../_shared/directory.ts";
import { loadSmtpConfig, sendOutreachEmail } from "../_shared/mailer.ts";

const JOB_NAME = "ingest-business";

interface IngestPayload {
  business_name?: string;
  city?: string;
  owner_name?: string;
  phone?: string;
  email?: string;
  website_url?: string;
  services?: unknown;
  scraped_context?: string;
  /** When false, the row is created but no outreach email is sent. */
  send_outreach?: boolean;
}

function normaliseServices(input: unknown): string[] {
  if (Array.isArray(input)) {
    // Drop null/undefined before String(), which would otherwise yield "null".
    return input
      .filter((s) => s !== null && s !== undefined)
      .map((s) => String(s).trim())
      .filter(Boolean)
      .slice(0, 40);
  }
  if (typeof input === "string" && input.trim()) {
    return input.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 40);
  }
  return [];
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  const startedAt = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = readServiceRoleKey();
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    // ── Authorisation ──────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ success: false, error: "Missing Authorization header." }, 401);

    if (token !== serviceRoleKey) {
      const { data: userData, error: userErr } = await supabase.auth.getUser(token);
      if (userErr || !userData?.user) {
        return json({ success: false, error: "Invalid credentials." }, 401);
      }
      // admin_users keys on user_id (see is_admin()), not id.
      const { data: adminRow } = await supabase
        .from("admin_users")
        .select("user_id")
        .eq("user_id", userData.user.id)
        .maybeSingle();
      if (!adminRow) return json({ success: false, error: "Admin privileges required." }, 403);
    }

    // ── Validation ─────────────────────────────────────────────────────────
    const payload = (await req.json().catch(() => null)) as IngestPayload | null;
    if (!payload) return json({ success: false, error: "Invalid JSON body." }, 400);

    const businessName = (payload.business_name ?? "").trim();
    const city = (payload.city ?? "").trim();
    if (!businessName) return json({ success: false, error: "business_name is required." }, 400);
    if (!city) return json({ success: false, error: "city is required." }, 400);

    const email = (payload.email ?? "").trim().toLowerCase();
    if (email && !isValidEmail(email)) {
      return json({ success: false, error: "email is not a valid address." }, 400);
    }

    const slug = slugify(businessName);
    const citySlug = slugify(city);
    if (!slug || !citySlug) {
      return json(
        { success: false, error: "business_name and city must contain alphanumeric characters." },
        400,
      );
    }

    // ── Insert ─────────────────────────────────────────────────────────────
    const { data: business, error: insertError } = await supabase
      .from("businesses")
      .insert({
        business_name: businessName,
        slug,
        city,
        city_slug: citySlug,
        owner_name: (payload.owner_name ?? "").trim() || null,
        phone: (payload.phone ?? "").trim() || null,
        email: email || null,
        website_url: (payload.website_url ?? "").trim() || null,
        services: normaliseServices(payload.services),
        scraped_context: (payload.scraped_context ?? "").trim() || null,
      })
      .select("*")
      .single();

    if (insertError) {
      // 23505 = unique_violation on (city_slug, slug)
      if (insertError.code === "23505") {
        return json(
          { success: false, error: `A listing for "${businessName}" already exists in ${city}.` },
          409,
        );
      }
      throw new Error(`Insert failed: ${insertError.message}`);
    }

    const listingPath = `/directory/${citySlug}/${slug}`;

    // ── Email 1 (verification, no links) ───────────────────────────────────
    let emailResult: { sent: boolean; method: string; error?: string } = {
      sent: false,
      method: "skipped",
    };

    const shouldSend = payload.send_outreach !== false && Boolean(email);

    if (shouldSend) {
      const { config } = await loadSmtpConfig(supabase);
      // Same variant pool the drip sends from, so copy edited in
      // Admin → Outreach applies here too. Deliberately NOT capped by
      // daily_limit: this path is one admin adding one business by hand, not
      // an automated batch. It IS recorded to outreach_sends below, so it
      // counts against the same day's allowance and shows up in A/B results
      // rather than being invisible to both.
      const variant = await pickOutreachVariant(supabase, "outreach_verify");

      if (!variant) {
        emailResult = {
          sent: false,
          method: "skipped",
          error: "No active Email 1 template variant — nothing was sent. Check Admin → Outreach.",
        };
      } else {
        const vars: Record<string, string> = {
          business_name: businessName,
          city,
          owner_name: business.owner_name || "there",
          phone: business.phone || "the number on your listing",
          sender_name: config?.fromName || "The Directory Team",
        };

        const result = await sendOutreachEmail(
          config,
          {
            to: email,
            subject: renderTemplate(variant.subject, vars),
            text: renderTemplate(variant.body, vars),
          },
          {
            supabase,
            jobName: JOB_NAME,
            emailType: "outreach_verify",
            recipientKind: "business",
            relatedBusinessId: business.id,
          },
        );

        if (result.success) {
          await recordOutreachSend(supabase, {
            businessId: business.id,
            emailType: "outreach_verify",
            variantKey: variant.variantKey,
          });
          await supabase
            .from("businesses")
            .update({ outreach_email_1_sent_at: new Date().toISOString() })
            .eq("id", business.id);
        }

        emailResult = { sent: result.success, method: result.method, error: result.error };
      }
    }

    await logRun(supabase, JOB_NAME, emailResult.error ? "partial" : "success", Date.now() - startedAt, emailResult.error ?? null, {
      business_id: business.id,
      slug,
      city_slug: citySlug,
      email_sent: emailResult.sent,
      email_method: emailResult.method,
    });

    return json({
      success: true,
      business: {
        id: business.id,
        business_name: business.business_name,
        slug,
        city_slug: citySlug,
        listing_path: listingPath,
      },
      outreach: emailResult,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${JOB_NAME}]`, message);
    await logRun(supabase, JOB_NAME, "failure", Date.now() - startedAt, message, {});
    return json({ success: false, error: message }, 500);
  }
});
