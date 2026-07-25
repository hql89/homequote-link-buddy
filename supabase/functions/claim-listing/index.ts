/**
 * claim-listing
 *
 * Two actions, both authenticated by the `claim_token` bearer credential that
 * was emailed to the business owner:
 *
 *   • lookup — resolves a token to the listing so the claim page can render.
 *              Returns only non-sensitive fields (never the token itself).
 *              Once claimed, also returns the leads that came through the
 *              listing — proof the free listing is generating real leads,
 *              not just a claim we're asking them to trust.
 *   • claim  — verifies the owner's email/phone against the stored record,
 *              and marks the listing claimed.
 *
 * Runs with the service role key because the businesses and directory_leads
 * tables are closed to anon/authenticated by RLS (see the
 * directory_demo_engine migration). Possession of a business's claim_token is
 * already the credential that authorises claiming it, so it's also treated as
 * the credential that authorises viewing that business's own leads — no
 * additional login system for business owners exists yet.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { corsHeaders, json, logRun, toE164 } from "../_shared/directory.ts";

const JOB_NAME = "claim-listing";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LEADS_RETURNED = 50;

interface ClaimPayload {
  action?: "lookup" | "claim";
  token?: string;
  email?: string;
  phone?: string;
}

function normaliseEmail(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

async function fetchLeadsForBusiness(supabase: SupabaseClient, businessId: string) {
  const { data, error } = await supabase
    .from("directory_leads")
    .select("id, full_name, phone, email, message, preferred_time, source, created_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(MAX_LEADS_RETURNED);

  if (error) {
    console.error(`[${JOB_NAME}] failed to load leads for ${businessId}:`, error.message);
    return [];
  }
  return data ?? [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  const startedAt = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const payload = (await req.json().catch(() => null)) as ClaimPayload | null;
    if (!payload) return json({ success: false, error: "Invalid JSON body." }, 400);

    const token = (payload.token ?? "").trim();
    // Validate shape before querying so malformed tokens can't probe the table.
    if (!UUID_RE.test(token)) {
      return json({ success: false, error: "This claim link is invalid or has expired." }, 400);
    }

    const { data: business, error } = await supabase
      .from("businesses")
      .select(
        "id, business_name, slug, city, city_slug, owner_name, phone, email, services, is_claimed",
      )
      .eq("claim_token", token)
      .maybeSingle();

    if (error) throw new Error(`Lookup failed: ${error.message}`);
    if (!business) {
      return json({ success: false, error: "This claim link is invalid or has expired." }, 404);
    }

    const action = payload.action ?? "lookup";

    // ── lookup ─────────────────────────────────────────────────────────────
    if (action === "lookup") {
      const leads = business.is_claimed ? await fetchLeadsForBusiness(supabase, business.id) : [];

      return json({
        success: true,
        business: {
          id: business.id,
          business_name: business.business_name,
          slug: business.slug,
          city: business.city,
          city_slug: business.city_slug,
          owner_name: business.owner_name,
          services: business.services,
          is_claimed: business.is_claimed,
          // Masked so the page can prompt "confirm the number ending in 3314"
          // without disclosing the full record to a link-holder.
          phone_last4: business.phone ? String(business.phone).replace(/\D/g, "").slice(-4) : null,
          email_masked: business.email
            ? String(business.email).replace(/^(.)(.*)(@.*)$/, (_m, a, b, c) => `${a}${"*".repeat(Math.max(b.length, 1))}${c}`)
            : null,
        },
        leads,
      });
    }

    // ── claim ──────────────────────────────────────────────────────────────
    if (action !== "claim") {
      return json({ success: false, error: `Unknown action: ${action}` }, 400);
    }

    // Verify the claimant actually knows the business's contact details.
    const submittedEmail = normaliseEmail(payload.email);
    const storedEmail = normaliseEmail(business.email);
    if (!submittedEmail) return json({ success: false, error: "Email is required." }, 400);
    if (storedEmail && submittedEmail !== storedEmail) {
      return json(
        { success: false, error: "That email does not match the one on file for this listing." },
        403,
      );
    }

    const submittedPhone = toE164(payload.phone);
    const storedPhone = toE164(business.phone);
    if (!submittedPhone) {
      return json(
        { success: false, error: "Enter a valid US phone number (10 digits)." },
        400,
      );
    }
    if (storedPhone && submittedPhone !== storedPhone) {
      return json(
        { success: false, error: "That phone number does not match the one on file for this listing." },
        403,
      );
    }

    const { error: updateError } = await supabase
      .from("businesses")
      .update({
        is_claimed: true,
        claimed_at: business.is_claimed ? undefined : new Date().toISOString(),
        phone: submittedPhone,
        email: submittedEmail,
        outreach_paused: true, // stop the cold drip once they engage
      })
      .eq("id", business.id);

    if (updateError) throw new Error(`Claim update failed: ${updateError.message}`);

    await logRun(supabase, JOB_NAME, "success", Date.now() - startedAt, null, {
      business_id: business.id,
      action: "claim",
    });

    const leads = await fetchLeadsForBusiness(supabase, business.id);

    return json({
      success: true,
      business: {
        id: business.id,
        business_name: business.business_name,
        city_slug: business.city_slug,
        slug: business.slug,
        is_claimed: true,
      },
      leads,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${JOB_NAME}]`, message);
    await logRun(supabase, JOB_NAME, "failure", Date.now() - startedAt, message, {});
    return json({ success: false, error: message }, 500);
  }
});
