import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { PageMeta } from "@/components/PageMeta";
import { Header } from "@/components/public/Header";
import { Footer } from "@/components/public/Footer";
import { TrustBadges } from "@/components/public/TrustBadges";
import { JsonLd } from "@/components/public/JsonLd";
import { HowItWorks } from "@/components/public/HowItWorks";
import { LeadCaptureForm } from "@/components/forms/LeadCaptureForm";
import { FadeIn } from "@/components/public/FadeIn";
import { DirectoryBusinessCard } from "@/components/directory/DirectoryBusinessCard";
import {
  SFV_DIRECTORY_CITIES,
  SITE_NAME,
  SITE_PHONE,
  SITE_PHONE_E164,
  SITE_REGION,
} from "@/lib/constants";
import { useActiveVerticals } from "@/hooks/useVerticals";
import type { Vertical } from "@/hooks/useVerticals";
import {
  directoryDb,
  type DirectoryCity,
  type PublicBusinessListing,
} from "@/integrations/supabase/directory";
import { Button } from "@/components/ui/button";
import {
  Droplets, Wind, TreePine, Zap, MapPin, Wrench, Phone, ChevronRight,
  Search, Loader2, type LucideIcon,
} from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = { Droplets, Wind, TreePine, Zap, Wrench };

function getIcon(iconName: string | null): LucideIcon {
  return (iconName && ICON_MAP[iconName]) || Wrench;
}

/** The `verticals` table slugs with hyphens; lead rows key on underscores. */
function verticalKey(slug: string): string {
  return slug.replace(/-/g, "_");
}

/** Service options are stored as JSONB and can arrive as an array or a string. */
function parseServiceTypes(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

const FEATURED_LIMIT = 6;

const Index = () => {
  const { data: verticals, isLoading: verticalsLoading } = useActiveVerticals();

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [featured, setFeatured] = useState<PublicBusinessListing[]>([]);
  const [cities, setCities] = useState<DirectoryCity[]>([]);

  // Default to the first active category once they load, so the form is never
  // rendered without a category selected.
  useEffect(() => {
    if (!selectedSlug && verticals?.length) setSelectedSlug(verticals[0].slug);
  }, [verticals, selectedSlug]);

  // Featured businesses + cities that actually have listings. Both are
  // best-effort: the page is still useful if either is empty or errors.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [listingsRes, citiesRes] = await Promise.all([
        directoryDb
          .from("public_business_listings")
          .select("*")
          .order("tier_rank", { ascending: true })
          .order("business_name", { ascending: true })
          .limit(FEATURED_LIMIT),
        directoryDb.from("public_directory_cities").select("*").order("city", { ascending: true }),
      ]);

      if (cancelled) return;

      if (listingsRes.error) console.error("Featured listings failed:", listingsRes.error.message);
      else setFeatured((listingsRes.data ?? []) as PublicBusinessListing[]);

      if (citiesRes.error) console.error("Directory cities failed:", citiesRes.error.message);
      else setCities((citiesRes.data ?? []) as DirectoryCity[]);
    })();

    return () => { cancelled = true; };
  }, []);

  const selected: Vertical | undefined = useMemo(
    () => verticals?.find((v) => v.slug === selectedSlug),
    [verticals, selectedSlug],
  );

  const selectedServiceTypes = useMemo(
    () => parseServiceTypes(selected?.service_types),
    [selected],
  );

  function chooseCategory(slug: string) {
    setSelectedSlug(slug);
    document.getElementById("match-form")?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <>
      <PageMeta
        title={`${SITE_NAME} — ${SITE_REGION} Home Service Directory`}
        description={`Browse independent home service businesses across the ${SITE_REGION}. Call them directly, or tell us what you need and we'll match you with a local specialist.`}
        canonicalPath="/"
      />
      <JsonLd />
      <Header />
      <TrustBadges />

      <main id="main-content">
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden bg-primary py-20 md:py-28">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_hsl(25_95%_53%/0.15),_transparent_60%)]" />
          <div className="container relative z-10 text-center">
            <FadeIn>
              <h1 className="mx-auto max-w-3xl text-4xl font-black leading-tight text-primary-foreground md:text-5xl lg:text-6xl">
                Find a Trusted Home Service Pro in the {SITE_REGION}
              </h1>
            </FadeIn>
            <FadeIn delay={0.15}>
              <p className="mx-auto mt-5 max-w-2xl text-lg text-primary-foreground/80">
                A local directory of independent Valley businesses. Browse by city and call them
                directly — or tell us what you need and we'll match you with a specialist.
              </p>
            </FadeIn>
            <FadeIn delay={0.3}>
              <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
                <Button asChild size="lg" className="h-14 w-full px-8 text-lg sm:w-auto">
                  <Link to="/directory">
                    <Search className="mr-2 h-5 w-5" aria-hidden="true" />
                    Browse the Directory
                  </Link>
                </Button>
                <a
                  href="#match-form"
                  className="inline-flex h-14 w-full items-center justify-center rounded-md border-2 border-primary-foreground/30 px-8 text-lg font-medium text-primary-foreground transition-colors hover:bg-primary-foreground/10 sm:w-auto"
                >
                  Get Matched Free
                </a>
              </div>
            </FadeIn>
            <FadeIn delay={0.4}>
              <p className="mt-6 text-sm text-primary-foreground/70">
                Or call the Valley matching line:{" "}
                <a href={`tel:${SITE_PHONE_E164}`} className="font-semibold underline underline-offset-4">
                  {SITE_PHONE}
                </a>
              </p>
            </FadeIn>
          </div>
        </section>

        {/* ── Categories (from active verticals) ───────────────────────── */}
        <section className="py-16">
          <div className="container">
            <FadeIn>
              <h2 className="mb-4 text-center text-3xl font-bold text-foreground">
                Browse by Service
              </h2>
              <p className="mx-auto mb-10 max-w-lg text-center text-muted-foreground">
                Pick what you need and we'll match you with a {SITE_REGION} specialist.
              </p>
            </FadeIn>

            {verticalsLoading ? (
              <div className="flex justify-center py-8" role="status" aria-live="polite">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">Loading services…</span>
              </div>
            ) : verticals?.length ? (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {verticals.map((v, i) => {
                  const Icon = getIcon(v.icon_name);
                  const isActive = v.slug === selectedSlug;
                  return (
                    <FadeIn key={v.id} delay={i * 0.05}>
                      <button
                        type="button"
                        onClick={() => chooseCategory(v.slug)}
                        aria-pressed={isActive}
                        className={`group flex h-full w-full flex-col items-center rounded-xl border-2 bg-card p-8 text-center transition-all hover:shadow-lg ${
                          isActive ? "border-accent shadow-md" : "border-border hover:border-accent"
                        }`}
                      >
                        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-accent/10 text-accent transition-colors group-hover:bg-accent group-hover:text-accent-foreground">
                          <Icon className="h-8 w-8" aria-hidden="true" />
                        </div>
                        <h3 className="mb-2 font-sans text-xl font-bold text-card-foreground">
                          {v.label}
                        </h3>
                        <span className="mt-auto flex items-center gap-1 text-sm font-semibold text-accent">
                          Get matched <ChevronRight className="h-4 w-4" aria-hidden="true" />
                        </span>
                      </button>
                    </FadeIn>
                  );
                })}
              </div>
            ) : (
              <p className="text-center text-muted-foreground">
                Service categories are being set up. Call{" "}
                <a href={`tel:${SITE_PHONE_E164}`} className="font-semibold underline">{SITE_PHONE}</a>{" "}
                and we'll point you to the right local pro.
              </p>
            )}
          </div>
        </section>

        {/* ── Featured businesses ──────────────────────────────────────── */}
        {featured.length > 0 && (
          <section className="bg-muted py-16">
            <div className="container">
              <FadeIn>
                <h2 className="mb-4 text-center text-3xl font-bold text-foreground">
                  Featured Valley Businesses
                </h2>
                <p className="mx-auto mb-10 max-w-lg text-center text-muted-foreground">
                  Every listing shows the business's own number — calls go straight to them.
                </p>
              </FadeIn>
              <ul className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2">
                {featured.map((b) => (
                  <DirectoryBusinessCard key={b.id} business={b} />
                ))}
              </ul>
              <div className="mt-8 text-center">
                <Button asChild variant="outline">
                  <Link to="/directory">See the full directory</Link>
                </Button>
              </div>
            </div>
          </section>
        )}

        {/* ── Community matching form ──────────────────────────────────── */}
        <section id="match-form" className="bg-muted py-16">
          <div className="container">
            <div className="mx-auto max-w-xl">
              <div className="rounded-xl border-2 border-border bg-card p-6 shadow-lg md:p-8">
                <div className="mb-6 space-y-2 text-center">
                  <h2 className="text-2xl font-bold text-card-foreground">
                    Need work done in the Valley?
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Tell us your project details and we'll match you with a local{" "}
                    {SITE_REGION} specialist. Free, no obligation.
                  </p>
                </div>

                {selected && (
                  <p className="mb-5 rounded-lg bg-muted/60 px-3 py-2 text-center text-sm text-muted-foreground">
                    Matching for <span className="font-semibold text-foreground">{selected.label}</span>
                    {verticals && verticals.length > 1 && " — pick another category above to change this."}
                  </p>
                )}

                {verticalsLoading ? (
                  <div className="flex justify-center py-8" role="status" aria-live="polite">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
                    <span className="sr-only">Loading form…</span>
                  </div>
                ) : (
                  <LeadCaptureForm
                    key={selectedSlug ?? "default"}
                    vertical={selectedSlug ? verticalKey(selectedSlug) : undefined}
                    serviceTypes={selectedServiceTypes}
                    categoryLabel={selected?.label}
                  />
                )}
              </div>
            </div>
          </div>
        </section>

        <HowItWorks />

        {/* ── Cities ───────────────────────────────────────────────────── */}
        <section className="py-16">
          <div className="container">
            <FadeIn>
              <h2 className="mb-10 text-center text-3xl font-bold text-foreground">
                Serving the Entire {SITE_REGION}
              </h2>
            </FadeIn>

            {cities.length > 0 ? (
              // Only link cities that actually have listings — a link to an
              // empty city page is a worse experience than plain text.
              <ul className="mx-auto grid max-w-3xl grid-cols-2 gap-4 md:grid-cols-3">
                {cities.map((c) => (
                  <li key={c.city_slug}>
                    <Link
                      to={`/directory/${c.city_slug}`}
                      className="flex items-center justify-between rounded-lg border bg-card p-4 transition hover:border-accent hover:shadow-sm"
                    >
                      <span className="flex items-center gap-2 font-medium text-card-foreground">
                        <MapPin className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
                        {c.city}
                      </span>
                      <span className="text-sm text-muted-foreground">{c.listing_count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mx-auto grid max-w-3xl grid-cols-2 gap-4 md:grid-cols-3">
                {SFV_DIRECTORY_CITIES.map((city) => (
                  <div key={city} className="flex items-center gap-2 rounded-lg border bg-card p-4">
                    <MapPin className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
                    <span className="font-medium text-card-foreground">{city}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ── Final CTA ────────────────────────────────────────────────── */}
        <section className="bg-muted py-16">
          <div className="container space-y-4 text-center">
            <FadeIn>
              <h2 className="text-3xl font-bold text-foreground">Own a Valley business?</h2>
              <p className="mx-auto max-w-md text-muted-foreground">
                Listings are free. Homeowners reach you on your own phone number — we never
                sell or resell your leads.
              </p>
              <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Button asChild variant="outline">
                  <Link to="/directory">See the directory</Link>
                </Button>
                <a
                  href={`tel:${SITE_PHONE_E164}`}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-accent hover:underline"
                >
                  <Phone className="h-4 w-4" aria-hidden="true" />
                  {SITE_PHONE}
                </a>
              </div>
            </FadeIn>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
};

export default Index;
