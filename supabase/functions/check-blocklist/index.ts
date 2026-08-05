import { serviceRoleKey as readServiceRoleKey } from "../_shared/supabaseKeys.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, phone } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      readServiceRoleKey()
    );

    let blocked = false;
    let blockType: string | null = null;

    if (email) {
      const normalized = email.toLowerCase().trim();
      const { data } = await supabase
        .from("blocked_emails")
        .select("id")
        .eq("email_normalized", normalized)
        .maybeSingle();
      if (data) {
        blocked = true;
        blockType = "blocked_email";
      }
    }

    if (!blocked && phone) {
      const normalized = phone.replace(/\D/g, "").slice(-10);
      if (normalized.length === 10) {
        const { data } = await supabase
          .from("blocked_phones")
          .select("id")
          .eq("phone_normalized", normalized)
          .maybeSingle();
        if (data) {
          blocked = true;
          blockType = "blocked_phone";
        }
      }
    }

    // Log the blocked attempt
    if (blocked && blockType) {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
      await supabase.from("spam_events").insert({
        event_type: blockType,
        email: email || null,
        phone: phone || null,
        ip_address: ip,
      }).then(() => {});
    }

    return new Response(JSON.stringify({ blocked }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
