import { serviceRoleKey as readServiceRoleKey } from "../_shared/supabaseKeys.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { leadId } = await req.json();
    if (!leadId) throw new Error("leadId is required");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = readServiceRoleKey();
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: lead, error: fetchErr } = await supabase
      .from("leads")
      .select("full_name, phone, email, description, city, zip_code, service_type, urgency")
      .eq("id", leadId)
      .single();

    if (fetchErr || !lead) throw new Error(fetchErr?.message || "Lead not found");

    // Check for blocked email domains server-side
    const BLOCKED_DOMAINS = [
      "example.com", "test.com", "mailinator.com", "guerrillamail.com",
      "tempmail.com", "throwaway.email", "fakeinbox.com", "yopmail.com",
      "sharklasers.com", "grr.la", "guerrillamailblock.com", "pokemail.net",
      "spam4.me", "trashmail.com", "dispostable.com", "maildrop.cc",
      "10minutemail.com", "temp-mail.org", "getnada.com",
    ];
    const emailDomain = lead.email?.split("@")[1]?.toLowerCase();
    const isFakeDomain = emailDomain && BLOCKED_DOMAINS.includes(emailDomain);

    const prompt = `Evaluate this plumbing service lead for authenticity. Consider:
- Name plausibility (gibberish, single character, obviously fake)
- Description quality and relevance to plumbing
- Email domain (disposable/temporary domains score lower)
- Phone format validity
- Geographic consistency (city + ZIP match)
- Overall coherence of the submission

Lead data:
Name: ${lead.full_name || "not provided"}
Phone: ${lead.phone}
Email: ${lead.email || "not provided"}
City: ${lead.city || "not provided"}
ZIP: ${lead.zip_code || "not provided"}
Service: ${lead.service_type || "not provided"}
Urgency: ${lead.urgency || "not provided"}
Description: ${lead.description || "not provided"}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content:
              "You are a lead quality analyst for a plumbing lead generation company. Evaluate leads for authenticity and return a structured score.",
          },
          { role: "user", content: prompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "score_lead",
              description: "Return an authenticity score and reasoning for this lead.",
              parameters: {
                type: "object",
                properties: {
                  score: {
                    type: "integer",
                    description: "Authenticity score from 0 (clearly fake/spam) to 100 (clearly legitimate).",
                  },
                  reason: {
                    type: "string",
                    description:
                      "Brief 1-2 sentence explanation of the score, highlighting key signals.",
                  },
                },
                required: ["score", "reason"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "score_lead" } },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, try again later" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call in AI response");

    const args = JSON.parse(toolCall.function.arguments);
    let score = Math.max(0, Math.min(100, args.score));
    let reason = args.reason || "No reason provided";

    // Override score for fake/disposable email domains
    if (isFakeDomain) {
      score = Math.min(score, 15);
      reason = `Disposable/fake email domain detected (${emailDomain}). ${reason}`;
    }

    const updatePayload: Record<string, unknown> = {
      ai_authenticity_score: score,
      ai_authenticity_reason: reason,
    };
    if (score < 30) {
      updatePayload.spam_flag = true;
      updatePayload.status = "archived";
      updatePayload.review_reason = `Auto-flagged as spam (AI Quality Score: ${score})`;
    }

    const { error: updateErr } = await supabase
      .from("leads")
      .update(updatePayload)
      .eq("id", leadId);

    if (updateErr) throw new Error(updateErr.message);

    return new Response(JSON.stringify({ score, reason }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-lead error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
