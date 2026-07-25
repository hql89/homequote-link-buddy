import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { Header } from "@/components/public/Header";
import { Footer } from "@/components/public/Footer";
import { PageMeta } from "@/components/PageMeta";
import { BreadcrumbJsonLd } from "@/components/public/JsonLd";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Phone, Globe, MapPin, Wrench, Loader2, AlertCircle, BadgeCheck, ShieldCheck, Star } from "lucide-react";
import { SITE_URL, pageTitle } from "@/lib/constants";
import {
  directoryDb,
  formatPhoneDisplay,
  isFeatured,
  parseServices,
  toTelHref,
  type PublicBusinessListing,
} from "@/integrations/supabase/directory";
import { DirectoryQuoteForm } from "@/components/directory/DirectoryQuoteForm";

type LoadState = "loading" | "ready" | "notfound" | "error";

export default function DirectoryListing() {
  const { city, slug } = useParams<{ city: string; slug: string }>();
  const [business, setBusiness] = useState<PublicBusinessListing | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  const loadListing = useCallback(async () => {
    if (!city || !slug) {
      setState("notfound");
      return;
    }
    setState("loading");

    const { data, error } = await directoryDb
      .from("public_business_listings")
      .select("*")
      .eq("city_slug", city)
      .eq("slug", slug)
      .maybeSingle();

    if (error) {
      console.error("Failed to load listing:", error.message);
      setState("error");
      return;
    }
    if (!data) {
      setState("notfound");
      return;
    }

    setBusiness(data as PublicBusinessListing);
    setState("ready");
  }, [city, slug]);

  useEffect(() => {
    loadListing();
  }, [loadListing]);

  const services = useMemo(() => parseServices(business?.services), [business?.services]);

  const breadcrumbs = useMemo(
    () => [
      { name: "Home", url: SITE_URL },
      { name: "Directory", url: `${SITE_URL}/directory` },
      ...(business
        ? [
            { name: business.city, url: `${SITE_URL}/directory/${business.city_slug}` },
            {
              name: business.business_name,
              url: `${SITE_URL}/directory/${business.city_slug}/${business.slug}`,
            },
          ]
        : []),
    ],
    [business],
  );

  // ── Loading ──────────────────────────────────────────────────────────────
  if (state === "loading") {
    return (
      <>
        <Header variant="listing" />
        <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-live="polite">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Loading listing…</span>
        </div>
        <Footer />
      </>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (state === "error") {
    return (
      <>
        <PageMeta title="Something went wrong" description="We couldn't load this listing." noIndex />
        <Header variant="listing" />
        <div className="container mx-auto max-w-xl py-20 text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-destructive" aria-hidden="true" />
          <h1 className="mt-4 text-2xl font-bold">We couldn't load this listing</h1>
          <p className="mt-2 text-muted-foreground">
            Something went wrong on our end. Please try again.
          </p>
          <Button className="mt-6" onClick={loadListing}>Retry</Button>
        </div>
        <Footer />
      </>
    );
  }

  // ── Not found ────────────────────────────────────────────────────────────
  if (state === "notfound" || !business) {
    return (
      <>
        <PageMeta title="Listing not found" description="This directory listing does not exist." noIndex />
        <Header variant="listing" />
        <div className="container mx-auto max-w-xl py-20 text-center">
          <h1 className="text-2xl font-bold">Listing not found</h1>
          <p className="mt-2 text-muted-foreground">
            This business isn't in our directory, or the link has changed.
          </p>
          <Button asChild className="mt-6"><Link to="/">Back to home</Link></Button>
        </div>
        <Footer />
      </>
    );
  }

  const hasPhone = Boolean(business.phone);
  const cta = business.is_claimed ? "Call or request a free quote." : "Call for a free quote.";
  const metaDescription = services.length
    ? `${business.business_name} in ${business.city}. ${services.slice(0, 4).join(", ")}. ${cta}`
    : `${business.business_name} in ${business.city}. ${cta}`;

  return (
    <>
      <PageMeta
        title={pageTitle(`${business.business_name} — ${business.city} Home Services`)}
        description={metaDescription}
        canonicalPath={`/directory/${business.city_slug}/${business.slug}`}
        ogType="profile"
      />
      <BreadcrumbJsonLd items={breadcrumbs} />
      <Header variant="listing" />

      <main>
        {/* ── Above the fold: dual-intent CRO ───────────────────────────── */}
        <section className="border-b border-border bg-muted/30">
          <div className="container mx-auto max-w-5xl px-4 py-10">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="gap-1">
                <MapPin className="h-3 w-3" aria-hidden="true" />
                {business.city}
              </Badge>
              {/* "Verified owner" is free and means only that the owner
                  confirmed the listing is theirs. "Featured" is the paid tier.
                  They are deliberately separate signals — selling the verified
                  badge would make a trust marker purchasable. */}
              {business.is_claimed && (
                <Badge className="gap-1 bg-green-600 hover:bg-green-600">
                  <BadgeCheck className="h-3 w-3" aria-hidden="true" />
                  Verified owner
                </Badge>
              )}
              {isFeatured(business) && (
                <Badge className="gap-1 bg-amber-500 text-amber-950 hover:bg-amber-500">
                  <Star className="h-3 w-3 fill-current" aria-hidden="true" />
                  Featured
                </Badge>
              )}
            </div>

            <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              {business.business_name}
            </h1>

            <div className={`mt-6 grid gap-4 ${business.is_claimed ? "sm:grid-cols-2" : ""}`}>
              {hasPhone ? (
                <a
                  href={toTelHref(business.phone as string)}
                  className="flex items-center justify-center gap-3 rounded-lg bg-accent px-6 py-5 text-lg font-bold text-accent-foreground shadow-sm transition hover:bg-accent/90"
                >
                  <Phone className="h-6 w-6" aria-hidden="true" />
                  Call {formatPhoneDisplay(business.phone as string)}
                </a>
              ) : (
                <div className="flex items-center justify-center rounded-lg border border-dashed border-border px-6 py-5 text-center text-sm text-muted-foreground">
                  No phone number on file yet
                </div>
              )}

              {/* Quote capture only appears once the owner has claimed the
                  listing — see submit-directory-lead's server-side gate.
                  Showing this on an unclaimed page would route a homeowner's
                  contact details to us with no confirmation the business
                  wants that, which reads as us intercepting their leads. */}
              {business.is_claimed && (
                <a
                  href="#request-quote"
                  className="flex items-center justify-center gap-3 rounded-lg border-2 border-accent px-6 py-5 text-lg font-bold text-accent transition hover:bg-accent/10"
                >
                  Request a Free Quote
                </a>
              )}
            </div>

            {hasPhone && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
                Calls go directly to {business.business_name} — no tracking number, no middleman.
              </p>
            )}
          </div>
        </section>

        {/* ── Branded content grid ──────────────────────────────────────── */}
        <section className="container mx-auto max-w-5xl px-4 py-12">
          <div className={`grid gap-10 ${business.is_claimed ? "lg:grid-cols-[1fr_380px]" : ""}`}>
            <div>
              <h2 className="text-2xl font-bold">About {business.business_name}</h2>
              {business.scraped_context ? (
                <p className="mt-3 whitespace-pre-line leading-relaxed text-muted-foreground">
                  {business.scraped_context}
                </p>
              ) : (
                <p className="mt-3 text-muted-foreground">
                  {business.business_name} serves homeowners in {business.city}.{" "}
                  {business.is_claimed
                    ? "Call directly or request a free quote below."
                    : "Call directly to get in touch."}
                </p>
              )}

              <h2 className="mt-10 text-2xl font-bold">Services</h2>
              {services.length > 0 ? (
                <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                  {services.map((service) => (
                    <li
                      key={service}
                      className="flex items-center gap-3 rounded-lg border border-border bg-card p-4"
                    >
                      <Wrench className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
                      <h3 className="text-base font-semibold">{service}</h3>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-muted-foreground">
                  Service list coming soon — call for details.
                </p>
              )}

              <Card className="mt-10">
                <CardContent className="flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1 text-sm">
                    <p className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      <span>{business.city}</span>
                    </p>
                    {hasPhone && (
                      <p className="flex items-center gap-2">
                        <Phone className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        <a className="hover:underline" href={toTelHref(business.phone as string)}>
                          {formatPhoneDisplay(business.phone as string)}
                        </a>
                      </p>
                    )}
                    {business.website_url && (
                      <p className="flex items-center gap-2">
                        <Globe className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        <a
                          className="hover:underline"
                          href={business.website_url}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                        >
                          Visit website
                        </a>
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {business.is_claimed && (
              <aside id="request-quote" className="lg:sticky lg:top-24 lg:self-start">
                <DirectoryQuoteForm
                  businessId={business.id}
                  businessName={business.business_name}
                  showPreferredTime={isFeatured(business)}
                />
              </aside>
            )}
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
