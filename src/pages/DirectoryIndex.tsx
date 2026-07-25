import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Header } from "@/components/public/Header";
import { Footer } from "@/components/public/Footer";
import { PageMeta } from "@/components/PageMeta";
import { BreadcrumbJsonLd } from "@/components/public/JsonLd";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, MapPin, ChevronRight } from "lucide-react";
import { SITE_URL, pageTitle } from "@/lib/constants";
import { directoryDb, type DirectoryCity } from "@/integrations/supabase/directory";

type LoadState = "loading" | "ready" | "error";

const MAX_CITIES = 200;

export default function DirectoryIndex() {
  const [cities, setCities] = useState<DirectoryCity[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  const load = useCallback(async () => {
    setState("loading");

    const { data, error } = await directoryDb
      .from("public_directory_cities")
      .select("*")
      .order("city", { ascending: true })
      .limit(MAX_CITIES);

    if (error) {
      console.error("Failed to load directory cities:", error.message);
      setState("error");
      return;
    }

    setCities((data ?? []) as DirectoryCity[]);
    setState("ready");
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (state === "loading") {
    return (
      <>
        <Header variant="portal" />
        <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-live="polite">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Loading directory…</span>
        </div>
        <Footer />
      </>
    );
  }

  if (state === "error") {
    return (
      <>
        <PageMeta title="Something went wrong" description="We couldn't load the directory." noIndex />
        <Header variant="portal" />
        <div className="container mx-auto max-w-xl py-20 text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-destructive" aria-hidden="true" />
          <h1 className="mt-4 text-2xl font-bold">We couldn't load the directory</h1>
          <p className="mt-2 text-muted-foreground">Something went wrong on our end.</p>
          <Button className="mt-6" onClick={load}>Retry</Button>
        </div>
        <Footer />
      </>
    );
  }

  return (
    <>
      <PageMeta
        title={pageTitle("Home Service Directory")}
        description="Browse local home service businesses by city. Call directly — no middleman."
        canonicalPath="/directory"
      />
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: SITE_URL },
          { name: "Directory", url: `${SITE_URL}/directory` },
        ]}
      />
      <Header variant="portal" />

      <main className="container mx-auto max-w-4xl px-4 py-12">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Local pros directory</h1>
        <p className="mt-3 text-muted-foreground">
          Browse home service businesses by city. Every listing shows the business's own phone
          number — calls go straight to them.
        </p>

        {cities.length === 0 ? (
          <div className="mt-10 rounded-lg border border-dashed border-border p-10 text-center">
            <h2 className="text-lg font-semibold">No listings yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The directory is still being built. Check back soon.
            </p>
          </div>
        ) : (
          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {cities.map((c) => (
              <li key={c.city_slug}>
                <Link
                  to={`/directory/${c.city_slug}`}
                  className="flex items-center justify-between rounded-lg border border-border bg-card p-4 transition hover:border-accent hover:shadow-sm"
                >
                  <span className="flex items-center gap-2 font-semibold">
                    <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    {c.city}
                  </span>
                  <span className="flex items-center gap-1 text-sm text-muted-foreground">
                    {c.listing_count}
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>

      <Footer />
    </>
  );
}
