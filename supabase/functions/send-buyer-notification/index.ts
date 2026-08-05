import { serviceRoleKey as readServiceRoleKey, publishableKey as readPublishableKey } from "../_shared/supabaseKeys.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

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
    // Validate JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = readPublishableKey();
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { leadId } = await req.json();

    const serviceRoleKey = readServiceRoleKey();
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Fetch lead
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .single();

    if (leadError || !lead) {
      return new Response(
        JSON.stringify({ success: false, error: "Lead not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!lead.assigned_buyer_id) {
      return new Response(
        JSON.stringify({ success: false, error: "No buyer assigned to this lead" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch buyer
    const { data: buyer, error: buyerError } = await supabase
      .from("buyers")
      .select("*")
      .eq("id", lead.assigned_buyer_id)
      .single();

    if (buyerError || !buyer) {
      return new Response(
        JSON.stringify({ success: false, error: "Assigned buyer not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Call notify-admin-email internally
    const notifyUrl = `${supabaseUrl}/functions/v1/notify-admin-email`;
    const res = await fetch(notifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        notificationType: "buyer_notification",
        eventData: {
          buyerEmail: buyer.email,
          buyerContactName: buyer.contact_name,
          full_name: lead.full_name,
          phone: lead.phone,
          email: lead.email,
          city: lead.city,
          service_type: lead.service_type,
          urgency: lead.urgency,
          description: lead.description,
        },
      }),
    });

    const result = await res.json();
    return new Response(
      JSON.stringify(result),
      { status: res.ok ? 200 : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
