import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle2, AlertCircle, ShieldCheck } from "lucide-react";
import { extractEdgeError } from "@/lib/edgeFunctionError";

interface DirectoryQuoteFormProps {
  businessId: string;
  businessName: string;
}

type Status = "idle" | "submitting" | "success" | "error";

export function DirectoryQuoteForm({ businessId, businessName }: DirectoryQuoteFormProps) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const digits = phone.replace(/\D/g, "");
  const canSubmit = fullName.trim().length >= 2 && (digits.length === 10 || digits.length === 11);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || status === "submitting") return;

    setStatus("submitting");
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("submit-directory-lead", {
        body: {
          business_id: businessId,
          full_name: fullName,
          phone,
          email,
          message,
          source: "quote_form",
        },
      });

      if (fnError || !data?.success) {
        throw new Error(await extractEdgeError(fnError, data, "Could not send your request."));
      }

      setStatus("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your request.");
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" aria-hidden="true" />
        <h3 className="mt-3 text-lg font-semibold">Request sent</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {businessName} has been notified and will reach out shortly.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-card p-6" noValidate>
      <h3 className="text-lg font-semibold">Request a Free Quote</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Send your details straight to {businessName}.
      </p>
      <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
        Goes only to {businessName}. We never sell or share your information.
      </p>

      <div className="mt-4 space-y-4">
        <div>
          <Label htmlFor="dq-name">Name</Label>
          <Input
            id="dq-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Your name"
            autoComplete="name"
            required
          />
        </div>

        <div>
          <Label htmlFor="dq-phone">Phone</Label>
          <Input
            id="dq-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(818) 555-0123"
            autoComplete="tel"
            required
          />
        </div>

        <div>
          <Label htmlFor="dq-email">Email (optional)</Label>
          <Input
            id="dq-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </div>

        <div>
          <Label htmlFor="dq-message">What do you need?</Label>
          <Textarea
            id="dq-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Briefly describe the job…"
            rows={3}
          />
        </div>
      </div>

      {error && (
        <p className="mt-4 flex items-start gap-2 text-sm text-destructive" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      <Button type="submit" className="mt-5 w-full" size="lg" disabled={!canSubmit || status === "submitting"}>
        {status === "submitting" ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            Sending…
          </>
        ) : (
          "Request a Free Quote"
        )}
      </Button>
    </form>
  );
}
