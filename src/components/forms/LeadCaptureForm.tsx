import { useRef, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { trackFormStep } from "@/services/analyticsService";
import { cityFromZip } from "@/lib/zipCityMap";
import type { VerticalKey } from "@/lib/constants";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2, ArrowRight, ArrowLeft } from "lucide-react";

import { leadFormSchema, LeadFormValues, FORM_STEPS } from "./leadFormSchema";
import { useLeadFormSubmit } from "./useLeadFormSubmit";
import { ServiceStep } from "./steps/ServiceStep";
import { LocationStep } from "./steps/LocationStep";
import { ContactStep } from "./steps/ContactStep";

interface LeadCaptureFormProps {
  vertical?: VerticalKey | string;
  /**
   * Service options for the chosen category. Passed through when the category
   * comes from the `verticals` table so the options match what was picked.
   */
  serviceTypes?: readonly string[];
  /** Display label for the chosen category, used in the consent copy. */
  categoryLabel?: string;
}

export function LeadCaptureForm({
  vertical = "tree_service",
  serviceTypes,
  categoryLabel,
}: LeadCaptureFormProps) {
  const stepContainerRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);

  const form = useForm<LeadFormValues>({
    resolver: zodResolver(leadFormSchema),
    defaultValues: {
      full_name: "",
      phone: "",
      email: "",
      zip_code: "",
      city: "",
      service_type: "",
      urgency: "",
      description: "",
      preferred_contact_method: "call",
      consent_to_contact: undefined as unknown as true,
    },
  });

  const {
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
  } = useLeadFormSubmit(vertical);

  // Focus management on step change
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    requestAnimationFrame(() => {
      stepContainerRef.current?.focus();
    });
  }, [step]);

  // Progressive save
  const watchedPhone = form.watch("phone");
  const watchedEmail = form.watch("email");
  useEffect(() => {
    savePartialLead(watchedPhone, watchedEmail, form.getValues);
  }, [watchedPhone, watchedEmail, savePartialLead, form]);

  // Auto-suggest city from ZIP
  const watchedZip = form.watch("zip_code");
  useEffect(() => {
    if (watchedZip && watchedZip.length >= 5) {
      const suggested = cityFromZip(watchedZip);
      if (suggested) form.setValue("city", suggested);
    }
  }, [watchedZip, form]);

  async function handleNext() {
    const fields = FORM_STEPS[step].fields;
    const valid = await form.trigger([...fields] as (keyof LeadFormValues)[]);
    if (valid) {
      trackFormStep(`form_step_${step + 1}_complete`, { step: FORM_STEPS[step].label });
      setStep((s) => Math.min(s + 1, FORM_STEPS.length - 1));
    }
  }

  const progressValue = ((step + 1) / FORM_STEPS.length) * 100;
  const stepLabel = `Step ${step + 1} of ${FORM_STEPS.length}: ${FORM_STEPS[step].label}`;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" aria-label="Lead capture form">
        {/* Honeypot */}
        <div className="absolute opacity-0 -z-10 h-0 overflow-hidden" aria-hidden="true">
          <label htmlFor="website_url">Website</label>
          <input
            type="text"
            id="website_url"
            name="website_url"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </div>

        {/* Progress */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs font-medium text-muted-foreground">
            {FORM_STEPS.map((s, i) => (
              <span key={s.label} className={i <= step ? "text-accent font-semibold" : ""}>
                {s.label}
              </span>
            ))}
          </div>
          <Progress value={progressValue} className="h-2" aria-label={stepLabel} />
        </div>

        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {stepLabel}
        </div>

        {/* Steps */}
        {step === 0 && (
          <ServiceStep
            form={form}
            vertical={vertical}
            serviceTypes={serviceTypes}
            stepRef={stepContainerRef}
          />
        )}
        {step === 1 && <LocationStep form={form} stepRef={stepContainerRef} />}
        {step === 2 && (
          <ContactStep
            form={form}
            vertical={vertical}
            categoryLabel={categoryLabel}
            stepRef={stepContainerRef}
          />
        )}

        {/* Math challenge */}
        {mathChallenge && step === FORM_STEPS.length - 1 && (
          <div className="rounded-md border border-border bg-muted p-4 space-y-2">
            <label htmlFor="math-challenge" className="block text-sm font-medium text-foreground">
              Quick verification: What is <span className="font-bold">{mathChallenge.question}</span>?
            </label>
            <Input
              id="math-challenge"
              type="text"
              inputMode="numeric"
              placeholder="Your answer"
              value={mathAnswer}
              onChange={(e) => { setMathAnswer(e.target.value); setMathError(""); }}
              className="max-w-[120px]"
            />
            {mathError && <p className="text-sm text-destructive">{mathError}</p>}
          </div>
        )}

        {/* Navigation */}
        <div className="flex gap-3">
          {step > 0 && (
            <Button type="button" variant="outline" onClick={() => setStep((s) => Math.max(s - 1, 0))} className="flex-1">
              <ArrowLeft className="h-4 w-4 mr-1" aria-hidden="true" /> Back
            </Button>
          )}

          {step < FORM_STEPS.length - 1 ? (
            <Button
              type="button"
              onClick={handleNext}
              className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90 font-semibold"
            >
              Next <ArrowRight className="h-4 w-4 ml-1" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="lg"
              className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90 font-semibold text-base"
              disabled={insertLead.isPending || inlineSuccess}
            >
              {insertLead.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Submitting…</>
              ) : (
                "Get My Free Quote"
              )}
            </Button>
          )}
        </div>

        {inlineSuccess && (
          <div role="status" aria-live="polite" className="rounded-md border border-border bg-muted px-4 py-3 text-sm text-foreground">
            Thanks — your quote request was received. We'll reach out shortly.
          </div>
        )}
      </form>
    </Form>
  );
}
