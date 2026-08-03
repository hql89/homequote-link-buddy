import { serviceRoleKey as readServiceRoleKey } from "../_shared/supabaseKeys.ts";
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
    const { token, hired_plumber, rating, review_text } = await req.json();

    if (!token) {
      return new Response(
        JSON.stringify({ error: "Token is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      readServiceRoleKey()
    );

    // Find feedback record by token
    const { data: feedback, error: findErr } = await supabase
      .from("lead_feedback")
      .select("*")
      .eq("token", token)
      .maybeSingle();

    if (findErr || !feedback) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired feedback link" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (feedback.submitted_at) {
      return new Response(
        JSON.stringify({ error: "Feedback has already been submitted" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update feedback
    const { error: updateErr } = await supabase
      .from("lead_feedback")
      .update({
        hired_plumber: hired_plumber ?? null,
        rating: rating ?? null,
        review_text: review_text ?? null,
        submitted_at: new Date().toISOString(),
      })
      .eq("id", feedback.id);

    if (updateErr) throw updateErr;

    // Log event
    await supabase.from("lead_events").insert({
      lead_id: feedback.lead_id,
      event_type: "feedback_received",
      event_detail: `Rating: ${rating ?? "n/a"}, Hired: ${hired_plumber ?? "n/a"}`,
    });

    // Send notification
    const notifyUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/notify-admin-email`;
    await fetch(notifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${readServiceRoleKey()}`,
      },
      body: JSON.stringify({
        notificationType: "feedback_submitted",
        feedbackData: {
          rating: rating ?? "n/a",
          hired_plumber: hired_plumber ?? "n/a",
          review_text: review_text ?? "",
          lead_id: feedback.lead_id,
        },
      }),
    });

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("submit-feedback error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
