import { useState } from "react";
import { Link } from "react-router-dom";
import { PageMeta } from "@/components/PageMeta";
import { Header } from "@/components/public/Header";
import { Footer } from "@/components/public/Footer";
import { TrustBadges } from "@/components/public/TrustBadges";
import { JsonLd } from "@/components/public/JsonLd";
import { CTAButton } from "@/components/public/CTAButton";
import { HowItWorks } from "@/components/public/HowItWorks";
import { StickyMobileCTA } from "@/components/public/StickyMobileCTA";
import { LeadCaptureForm } from "@/components/forms/LeadCaptureForm";
import { FadeIn } from "@/components/public/FadeIn";
import { SFV_CITIES, VERTICALS } from "@/lib/constants";
import type { VerticalKey } from "@/lib/constants";
import { useActiveVerticals } from "@/hooks/useVerticals";
import {
  Droplets, Wind, TreePine, Zap, MapPin, ArrowRight, Wrench, type LucideIcon,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ICON_MAP: Record<string, LucideIcon> = {
  Droplets, Wind, TreePine, Zap, Wrench,
};

function getIcon(iconName: string | null): LucideIcon {
  if (iconName && ICON_MAP[iconName]) return ICON_MAP[iconName];
  return Wrench;
}

const Index = () => {
  const { data: verticals } = useActiveVerticals();
  const [selectedVertical, setSelectedVertical] = useState<VerticalKey>("tree_service");

  const scrollToForm = () => {
    const formSection = document.getElementById("quote-form");
    if (formSection) {
      formSection.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <>
      <PageMeta
        title="Sherman Oaks Home Pros — Expert Tree Service & Removal"
        description="Trusted local arborists in Sherman Oaks, CA. Emergency tree removal, precision trimming, and hillside fire mitigation. Fast, free quotes."
        canonicalPath="/"
      />
      <JsonLd />
      <Header />
      <TrustBadges />

      <main id="main-content">
        {/* Hero */}
        <section className="relative overflow-hidden bg-primary py-20 md:py-28">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_hsl(25_95%_53%/0.15),_transparent_60%)]" />
          <div className="container relative z-10 text-center">
            <FadeIn>
              <h1 className="mx-auto max-w-3xl text-4xl font-black leading-tight text-primary-foreground md:text-5xl lg:text-6xl">
                Expert Tree Service & Removal in Sherman Oaks, CA
              </h1>
            </FadeIn>
            <FadeIn delay={0.15}>
              <p className="mx-auto mt-5 max-w-xl text-lg text-primary-foreground/80">
                Trusted Local Arborists for the San Fernando Valley. Tell us what you need or call for emergency removal.
              </p>
            </FadeIn>
            <FadeIn delay={0.3}>
              <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
                <a 
                  href="tel:+13108613314" 
                  className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 h-14 px-8 text-lg bg-green-500 text-white hover:bg-green-600 shadow-lg w-full sm:w-auto"
                >
                  Call Now (310) 861-3314
                </a>
                <CTAButton onClick={scrollToForm}>Get a Free Quote</CTAButton>
              </div>
            </FadeIn>
          </div>
        </section>

        {/* Inline Lead Form Section */}
        <section id="quote-form" className="py-16 bg-muted">
          <div className="container">
            <div className="mx-auto max-w-xl">
              <div className="rounded-xl border-2 border-border bg-card p-6 md:p-8 shadow-lg">
                <div className="mb-6 text-center space-y-2">
                  <h2 className="text-2xl font-bold text-card-foreground">
                    Get Your Free Quote
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Select a service and tell us what you need — we'll connect you with a local pro.
                  </p>
                </div>

                {/* Vertical Selector */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-card-foreground mb-2">
                    What type of service do you need?
                  </label>
                  <Select
                    value={selectedVertical}
                    onValueChange={(value) => setSelectedVertical(value as VerticalKey)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select a service" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(VERTICALS).map(([key, vertical]) => (
                        <SelectItem key={key} value={key}>
                          {vertical.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <LeadCaptureForm vertical={selectedVertical} />
              </div>
            </div>
          </div>
        </section>

        {/* Service Verticals Grid */}
        <section className="py-16">
          <div className="container">
            <FadeIn>
              <h2 className="text-3xl font-bold text-center mb-4 text-foreground">Our Core Tree Care Services</h2>
              <p className="text-center text-muted-foreground mb-10 max-w-lg mx-auto">
                Specialized arborist services for Sherman Oaks and the San Fernando Valley.
              </p>
            </FadeIn>
            <div className="grid gap-6 sm:grid-cols-3">
              <FadeIn delay={0.1}>
                <Link
                  to="/services/emergency-tree-removal"
                  className="group flex flex-col items-center rounded-xl border-2 border-border bg-card p-8 text-center transition-all hover:border-accent hover:shadow-lg"
                >
                  <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-600 transition-colors group-hover:bg-red-600 group-hover:text-white">
                    <Zap className="h-8 w-8" aria-hidden="true" />
                  </div>
                  <h3 className="mb-2 text-xl font-bold text-card-foreground font-sans">Emergency Tree Removal</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    24/7 storm damage and hazardous fallen limb removal.
                  </p>
                  <span className="mt-auto flex items-center gap-1 text-sm font-semibold text-accent group-hover:underline">
                    View Details <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </span>
                </Link>
              </FadeIn>
              <FadeIn delay={0.2}>
                <Link
                  to="/services/brush-clearing"
                  className="group flex flex-col items-center rounded-xl border-2 border-border bg-card p-8 text-center transition-all hover:border-accent hover:shadow-lg"
                >
                  <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-accent/10 text-accent transition-colors group-hover:bg-accent group-hover:text-accent-foreground">
                    <TreePine className="h-8 w-8" aria-hidden="true" />
                  </div>
                  <h3 className="mb-2 text-xl font-bold text-card-foreground font-sans">Hillside Brush Clearing</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    LAFD brush clearance and fire mitigation.
                  </p>
                  <span className="mt-auto flex items-center gap-1 text-sm font-semibold text-accent group-hover:underline">
                    View Details <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </span>
                </Link>
              </FadeIn>
              <FadeIn delay={0.3}>
                <Link
                  to="/services/palm-tree-trimming"
                  className="group flex flex-col items-center rounded-xl border-2 border-border bg-card p-8 text-center transition-all hover:border-accent hover:shadow-lg"
                >
                  <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-accent/10 text-accent transition-colors group-hover:bg-accent group-hover:text-accent-foreground">
                    <Wind className="h-8 w-8" aria-hidden="true" />
                  </div>
                  <h3 className="mb-2 text-xl font-bold text-card-foreground font-sans">Palm Tree Trimming</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Aesthetic maintenance and dead frond removal.
                  </p>
                  <span className="mt-auto flex items-center gap-1 text-sm font-semibold text-accent group-hover:underline">
                    View Details <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </span>
                </Link>
              </FadeIn>
            </div>
          </div>
        </section>

        <HowItWorks />

        {/* Service Areas */}
        <section className="py-16">
          <div className="container">
            <FadeIn>
              <h2 className="text-3xl font-bold text-center mb-10 text-foreground">We Serve the Entire San Fernando Valley</h2>
            </FadeIn>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
              {SFV_CITIES.map((city, i) => (
                <FadeIn key={city} delay={i * 0.05}>
                  <div className="flex items-center gap-2 rounded-lg border bg-card p-4">
                    <MapPin className="h-5 w-5 text-accent flex-shrink-0" aria-hidden="true" />
                    <span className="font-medium text-card-foreground">{city}</span>
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="py-16 bg-muted">
          <div className="container text-center space-y-4">
            <FadeIn>
              <h2 className="text-3xl font-bold text-foreground">Ready to Get Started?</h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                Whether it's an overgrown oak or a hazardous palm tree, we'll connect you with the right pro.
              </p>
              <CTAButton onClick={scrollToForm}>Get Your Free Quote Now</CTAButton>
            </FadeIn>
          </div>
        </section>
      </main>

      <StickyMobileCTA onClick={scrollToForm} />
      <Footer />
    </>
  );
};

export default Index;
