import { useState, useEffect, useCallback } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { ClaimBusiness } from "@/integrations/supabase/directory";
import { Header } from "@/components/public/Header";
import { Footer } from "@/components/public/Footer";
import { PageMeta } from "@/components/PageMeta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { extractEdgeError } from "@/lib/edgeFunctionError";

type LoadState = "loading" | "ready" | "invalid" | "error";
type ClaimState = "idle" | "submitting" | "claimed";

export default function ClaimListing() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [business, setBusiness] = useState<ClaimBusiness | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [claimState, setClaimState] = useState<ClaimState>("idle");
  const [claimError, setClaimError] = useState<string | null>(null);

  const lookup = useCallback(async () => {
    if (!token) {
      setLoadState("invalid");
      setLoadError("This claim link is missing its token.");
      return;
    }
    setLoadState("loading");

    try {
      const { data, error } = await supabase.functions.invoke("claim-listing", {
        body: { action: "lookup", token },
      });

      if (error || !data?.success) {
        setLoadState("invalid");
        setLoadError(
          await extractEdgeError(error, data, "This claim link is invalid or has expired."),
        );
        return;
      }

      const biz = data.business as ClaimBusiness;
      setBusiness(biz);
      if (biz.is_claimed) setClaimState("claimed");
      setLoadState("ready");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load this listing.");
      setLoadState("error");
    }
  }, [token]);

  useEffect(() => {
    lookup();
  }, [lookup]);

  const digits = phone.replace(/\D/g, "");
  const phoneValid = digits.length === 10 || (digits.length === 11 && digits.startsWith("1"));
  const canClaim = email.trim().length > 3 && phoneValid && claimState !== "submitting";

  async function handleClaim(e: React.FormEvent) {
    e.preventDefault();
    if (!canClaim) return;

    setClaimState("submitting");
    setClaimError(null);

    try {
      const { data, error } = await supabase.functions.invoke("claim-listing", {
        body: { action: "claim", token, email, phone },
      });

      if (error || !data?.success) {
        throw new Error(await extractEdgeError(error, data, "Could not claim this listing."));
      }

      setClaimState("claimed");
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : "Could not claim this listing.");
      setClaimState("idle");
    }
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loadState === "loading") {
    return (
      <>
        <PageMeta title="Claim your listing" description="Claim your free directory listing." noIndex />
        <Header />
        <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-live="polite">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Loading…</span>
        </div>
        <Footer />
      </>
    );
  }

  // ── Invalid token / error ────────────────────────────────────────────────
  if (loadState !== "ready" || !business) {
    return (
      <>
        <PageMeta title="Claim link unavailable" description="This claim link could not be used." noIndex />
        <Header />
        <div className="container mx-auto max-w-xl py-20 text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-destructive" aria-hidden="true" />
          <h1 className="mt-4 text-2xl font-bold">
            {loadState === "invalid" ? "This claim link isn't valid" : "Something went wrong"}
          </h1>
          <p className="mt-2 text-muted-foreground">{loadError}</p>
          <div className="mt-6 flex justify-center gap-3">
            {loadState === "error" && <Button onClick={lookup}>Retry</Button>}
            <Button asChild variant="outline"><Link to="/">Back to home</Link></Button>
          </div>
        </div>
        <Footer />
      </>
    );
  }

  const listingPath = `/directory/${business.city_slug}/${business.slug}`;

  return (
    <>
      <PageMeta
        title={`Claim ${business.business_name} — Free Listing`}
        description={`Claim the free ${business.city} directory listing for ${business.business_name}.`}
        noIndex
      />
      <Header />

      <main className="container mx-auto max-w-2xl px-4 py-12">
        <p className="text-sm text-muted-foreground">{business.city}</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">{business.business_name}</h1>
        <p className="mt-2 text-muted-foreground">
          Claim your free listing to keep your details up to date.{" "}
          <Link to={listingPath} className="underline underline-offset-4">
            View your live listing
          </Link>
        </p>

        {claimState !== "claimed" ? (
          <Card className="mt-8">
            <CardHeader>
              <CardTitle>Verify your details</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleClaim} noValidate>
                <p className="mb-4 text-sm text-muted-foreground">
                  Confirm the contact details we have on file so we know this listing is yours.
                </p>

                <div className="space-y-4">
                  <div>
                    <Label htmlFor="claim-email">Business email</Label>
                    <Input
                      id="claim-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={business.email_masked ?? "you@business.com"}
                      autoComplete="email"
                      required
                    />
                    {business.email_masked && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Must match the address we have on file ({business.email_masked}).
                      </p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="claim-phone">Business phone</Label>
                    <Input
                      id="claim-phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="(818) 555-0123"
                      autoComplete="tel"
                      required
                    />
                    {business.phone_last4 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Must match the number on file ending in {business.phone_last4}.
                      </p>
                    )}
                  </div>
                </div>

                {claimError && (
                  <p className="mt-4 flex items-start gap-2 text-sm text-destructive" role="alert">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    {claimError}
                  </p>
                )}

                <Button type="submit" size="lg" className="mt-6 w-full" disabled={!canClaim}>
                  {claimState === "submitting" ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                      Verifying…
                    </>
                  ) : (
                    "Claim my listing"
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Card className="mt-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" aria-hidden="true" />
                Listing claimed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Thanks — {business.business_name} is now verified. Your listing shows a
                verified badge, and quote requests come straight to you.
              </p>
              <Button asChild className="mt-6">
                <Link to={listingPath}>View my listing</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </main>

      <Footer />
    </>
  );
}
