import { useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useInsertLead } from "@/hooks/useLeads";
import { useTrackingParams } from "@/hooks/useTrackingParams";
import { scoreLead } from "@/services/leadScoringService";
import { checkDuplicate } from "@/services/duplicateDetectionService";
import { trackFormStep, trackConversion } from "@/services/analyticsService";
import { toast } from "@/hooks/use-toast";
import {
  LeadFormValues,
  normalizePhone,
  normalizeEmail,
  EMAIL_REGEX,
  MIN_FILL_TIME_MS,
  RATE_LIMIT_MS,
  SUSPICION_THRESHOLD,
  generateMathChallenge,
} from "./leadFormSchema";

async function isBlocked(email?: string, phone?: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.functions.invoke("check-blocklist", {
      body: { email, phone },
    });
    if (error) return false;
    return data?.blocked === true;
  } catch {
    return false;
  }
}

export function useLeadFormSubmit(vertical: string | undefined) {
  const navigate = useNavigate();
  const tracking = useTrackingParams();
  const insertLead = useInsertLead();
  const partialLeadId = useRef<string | null>(null);
  const savingPartial = useRef(false);
  const formLoadedAt = useRef(Date.now());
  const lastSubmitAt = useRef(0);
  const suspicionCount = useRef(0);

  const [inlineSuccess, setInlineSuccess] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [mathChallenge, setMathChallenge] = useState<{ question: string; answer: number } | null>(null);
  const [mathAnswer, setMathAnswer] = useState("");
  const [mathError, setMathError] = useState("");

  const savePartialLead = useCallback(async (watchedPhone: string, watchedEmail: string, getValues: () => LeadFormValues) => {
    if (partialLeadId.current || savingPartial.current) return;

    const phoneDigits = watchedPhone?.replace(/\D/g, "") || "";
    const hasValidPhone = phoneDigits.length >= 10;
    const hasValidEmail = EMAIL_REGEX.test(watchedEmail || "");

    if (!hasValidPhone || !hasValidEmail) return;

    savingPartial.current = true;

    const blocked = await isBlocked(watchedEmail, watchedPhone);
    if (blocked) {
      savingPartial.current = false;
      return;
    }

    const values = getValues();
    const generatedId = crypto.randomUUID();
    const partialData = {
      id: generatedId,
      phone: watchedPhone,
      phone_normalized: normalizePhone(watchedPhone),
      email: watchedEmail,
      email_normalized: normalizeEmail(watchedEmail) || null,
      full_name: values.full_name || null,
      zip_code: values.zip_code || null,
      city: values.city || null,
      service_type: values.service_type || null,
      urgency: values.urgency || null,
      description: values.description || null,
      preferred_contact_method: values.preferred_contact_method || "call",
      consent_to_contact: false,
      status: "partial",
      // Only written when actually resolved — the column has its own
      // server-side default, which is more honest than the frontend
      // guessing a placeholder vertical.
      ...(vertical ? { vertical } : {}),
      utm_source: tracking.utm_source,
      utm_medium: tracking.utm_medium,
      utm_campaign: tracking.utm_campaign,
      gclid: tracking.gclid,
      landing_page: tracking.landing_page,
      referrer: tracking.referrer,
    };

    const { error } = await supabase.from("leads").insert(partialData);
    if (!error) {
      partialLeadId.current = generatedId;
    } else {
      console.error("Partial save failed:", error);
    }
    savingPartial.current = false;
  }, [tracking, vertical]);

  async function onSubmit(values: LeadFormValues) {
    setInlineSuccess(false);
    setMathError("");

    // 1. Honeypot
    if (honeypot) {
      suspicionCount.current += 2;
      setInlineSuccess(true);
      return;
    }

    // 2. Timing
    if (Date.now() - formLoadedAt.current < MIN_FILL_TIME_MS) {
      suspicionCount.current += 2;
      setInlineSuccess(true);
      return;
    }

    // 3. Rate limit
    if (Date.now() - lastSubmitAt.current < RATE_LIMIT_MS) {
      suspicionCount.current += 1;
      if (suspicionCount.current >= SUSPICION_THRESHOLD && !mathChallenge) {
        setMathChallenge(generateMathChallenge());
      }
      toast({
        title: "Please wait",
        description: "You've already submitted a request. Please wait a moment before trying again.",
      });
      return;
    }

    // 4. Math challenge
    if (mathChallenge) {
      const parsed = parseInt(mathAnswer, 10);
      if (isNaN(parsed) || parsed !== mathChallenge.answer) {
        setMathError("Incorrect answer. Please try again.");
        setMathChallenge(generateMathChallenge());
        setMathAnswer("");
        return;
      }
    }

    lastSubmitAt.current = Date.now();

    // Server-side checks in parallel
    const [blockedResult, rateLimitResult] = await Promise.all([
      isBlocked(values.email, values.phone),
      (async () => {
        try {
          const { data, error } = await supabase.functions.invoke("rate-limit-lead", {
            body: { email: values.email, phone: values.phone },
          });
          if (error) return false;
          return data?.rateLimited === true;
        } catch {
          return false;
        }
      })(),
    ]);

    if (blockedResult) {
      toast({ title: "Unable to submit", description: "We're unable to process your request. Please call us directly for assistance.", variant: "destructive" });
      return;
    }
    if (rateLimitResult) {
      toast({ title: "Too many requests", description: "You've submitted multiple requests recently. Please wait a few minutes or call us directly.", variant: "destructive" });
      return;
    }

    const leadData = {
      full_name: values.full_name,
      phone: values.phone,
      email: values.email || null,
      zip_code: values.zip_code,
      city: values.city,
      service_type: values.service_type,
      urgency: values.urgency,
      description: values.description,
      preferred_contact_method: values.preferred_contact_method,
      consent_to_contact: true,
      phone_normalized: normalizePhone(values.phone),
      email_normalized: normalizeEmail(values.email) || null,
      lead_score: scoreLead(values),
      duplicate_flag: checkDuplicate(values).isDuplicate,
      // Only written when actually resolved — see the matching comment on
      // partialData above.
      ...(vertical ? { vertical } : {}),
      utm_source: tracking.utm_source,
      utm_medium: tracking.utm_medium,
      utm_campaign: tracking.utm_campaign,
      gclid: tracking.gclid,
      landing_page: tracking.landing_page,
      referrer: tracking.referrer,
      status: "new",
    };

    try {
      let resultId: string;

      if (partialLeadId.current) {
        const { data, error } = await supabase
          .from("leads")
          .update(leadData)
          .eq("id", partialLeadId.current)
          .select("id")
          .single();
        if (error) throw error;
        resultId = data.id;
      } else {
        const result = await insertLead.mutateAsync(leadData);
        resultId = result.id;
      }

      try {
        await supabase.functions.invoke("notify-admin-email", {
          body: { notificationType: "new_lead", leadData: { ...leadData, id: resultId } },
        });
      } catch (e) {
        console.error("Admin email notification failed:", e);
      }

      supabase.functions.invoke("analyze-lead", { body: { leadId: resultId } }).catch((e) =>
        console.error("AI analysis failed:", e)
      );

      trackFormStep("form_step_3_submit", { step: "Contact" });
      trackConversion("lead_submitted", { leadId: resultId, service: leadData.service_type, city: leadData.city });

      setInlineSuccess(true);
      await new Promise((r) => setTimeout(r, 900));
      navigate("/thank-you");
    } catch (error: unknown) {
      setInlineSuccess(false);
      const errorMessage = error instanceof Error ? error.message : String(error);
      toast({ title: "Something went wrong", description: errorMessage || "Please try again or call us directly.", variant: "destructive" });
    }
  }

  return {
    onSubmit,
    savePartialLead,
    insertLead,
    inlineSuccess,
    honeypot,
    setHoneypot,
    mathChallenge,
    mathAnswer,
    setMathAnswer,
    mathError,
    setMathError,
  };
}
