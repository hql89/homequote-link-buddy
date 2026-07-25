import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { Header } from "@/components/public/Header";
import { Footer } from "@/components/public/Footer";
import { PageMeta } from "@/components/PageMeta";
import { BreadcrumbJsonLd } from "@/components/public/JsonLd";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, MapPin } from "lucide-react";
import { SITE_URL, pageTitle } from "@/lib/constants";
import { directoryDb, type PublicBusinessListing } from "@/integrations/supabase/directory";
import { DirectoryBusinessCard } from "@/components/directory/DirectoryBusinessCard";

type LoadState = "loading" | "ready" | "error";

// Paginated rather than unbounded — a city could hold thousands of ingested
// businesses and this view is public/crawlable.
const PAGE_SIZE = 25;

export default function DirectoryCity() {
  const { city } = useParams<{ city: string }>();
  const [businesses, setBusinesses] = useState<PublicBusinessListing[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadPage = useCallback(
    async (offset: number) => {
      if (!city) return;
      if (offset === 0) setState("loading");
      else setLoadingMore(true);

      const { data, error } = await directoryDb
        .from("public_business_listings")
        .select("*")
        .eq("city_slug", city)
        // Featured listings sit above free ones — the paid tier's core perk.
        .order("tier_rank", { ascending: true })
        .order("business_name", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      setLoadingMore(false);

      if (error) {
        console.error("Failed to load city listings:", error.message);
        if (offset === 0) setState("error");
        return;
      }

      const rows = (data ?? []) as PublicBusinessListing[];
      setBusinesses((prev) => (offset === 0 ? rows : [...prev, ...rows]));
      setHasMore(rows.length === PAGE_SIZE);
      setState("ready");
    },
    [city],
  );

  useEffect(() => {
    loadPage(0);
  }, [loadPage]);

  // The slug is the only city identifier available until a row loads; fall back
  // to a de-slugified version so the heading isn't empty on an empty city.
  const cityLabel =
    businesses[0]?.city ??
    (city ?? "").split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

  if (state === "loading") {
    return (
      <>
        <Header variant="portal" />
        <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-live="polite">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Loading listings…</span>
        </div>
        <Footer />
      </>
    );
  }

  if (state === "error") {
    return (
      <>
        <PageMeta title="Something went wrong" description="We couldn't load these listings." noIndex />
        <Header variant="portal" />
        <div className="container mx-auto max-w-xl py-20 text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-destructive" aria-hidden="true" />
          <h1 className="mt-4 text-2xl font-bold">We couldn't load these listings</h1>
          <p className="mt-2 text-muted-foreground">Something went wrong on our end.</p>
          <Button className="mt-6" onClick={() => loadPage(0)}>Retry</Button>
        </div>
        <Footer />
      </>
    );
  }

  return (
    <>
      <PageMeta
        title={pageTitle(`${cityLabel} Home Service Pros`)}
        description={`Browse local home service businesses in ${cityLabel}. Call directly — no middleman.`}
        canonicalPath={`/directory/${city}`}
      />
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: SITE_URL },
          { name: "Directory", url: `${SITE_URL}/directory` },
          { name: cityLabel, url: `${SITE_URL}/directory/${city}` },
        ]}
      />
      <Header variant="portal" />

      <main className="container mx-auto max-w-4xl px-4 py-12">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="h-4 w-4" aria-hidden="true" />
          <Link to="/directory" className="hover:underline underline-offset-4">Directory</Link>
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          Home service pros in {cityLabel}
        </h1>

        {businesses.length === 0 ? (
          <div className="mt-10 rounded-lg border border-dashed border-border p-10 text-center">
            <h2 className="text-lg font-semibold">No listings here yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              We haven't added any businesses in {cityLabel} yet. Check back soon.
            </p>
            <Button asChild variant="outline" className="mt-6">
              <Link to="/directory">Browse other cities</Link>
            </Button>
          </div>
        ) : (
          <>
            <p className="mt-2 text-muted-foreground">
              {businesses.length}
              {hasMore ? "+" : ""} {businesses.length === 1 ? "business" : "businesses"} listed
            </p>

            <ul className="mt-8 grid gap-4">
              {businesses.map((business) => (
                <DirectoryBusinessCard key={business.id} business={business} />
              ))}
            </ul>

            {hasMore && (
              <div className="mt-8 text-center">
                <Button variant="outline" onClick={() => loadPage(businesses.length)} disabled={loadingMore}>
                  {loadingMore ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                      Loading…
                    </>
                  ) : (
                    "Show more"
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </main>

      <Footer />
    </>
  );
}
