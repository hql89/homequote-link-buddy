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
import { SCV_CITIES, VERTICALS } from "@/lib/constants";
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
  const [selectedVertical, setSelectedVertical] = useState<VerticalKey>("plumbing");

  const scrollToForm = () => {
    const formSection = document.getElementById("quote-form");
    if (formSection) {
      formSection.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <>
      <PageMeta
        title="HomeQuoteLink — Free Home Service Quotes in Santa Clarita"
        description="Get free quotes from trusted local home service pros in Santa Clarita Valley. Plumbing, HVAC, electrical, landscaping — fast, free, no obligation."
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
                Santa Clarita Home Service Directory
              </h1>
            </FadeIn>
            <FadeIn delay={0.15}>
              <p className="mx-auto mt-5 max-w-xl text-lg text-primary-foreground/80">
                Tell us what you need. We'll connect you with a trusted local professional — free, fast, and no obligation.
              </p>
            </FadeIn>
            <FadeIn delay={0.3}>
              <div className="mt-8">
                <CTAButton onClick={scrollToForm}>Get Your Free Quote</CTAButton>
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
              <h2 className="text-3xl font-bold text-center mb-4 text-foreground">What Do You Need Help With?</h2>
              <p className="text-center text-muted-foreground mb-10 max-w-lg mx-auto">
                Choose a service below to get matched with a local pro who specializes in exactly what you need.
              </p>
            </FadeIn>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {verticals?.map((v, i) => {
                const Icon = getIcon(v.icon_name);
                const href = v.slug === "plumbing" ? "/" : `/services/${v.slug}`;
                return (
                  <FadeIn key={v.id} delay={i * 0.1}>
                    <Link
                      to={href}
                      className="group flex flex-col items-center rounded-xl border-2 border-border bg-card p-8 text-center transition-all hover:border-accent hover:shadow-lg"
                    >
                      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-accent/10 text-accent transition-colors group-hover:bg-accent group-hover:text-accent-foreground">
                        <Icon className="h-8 w-8" aria-hidden="true" />
                      </div>
                      <h3 className="mb-2 text-xl font-bold text-card-foreground font-sans">{v.label}</h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        {v.service_types.slice(0, 3).join(" · ")} & more
                      </p>
                      <span className="mt-auto flex items-center gap-1 text-sm font-semibold text-accent group-hover:underline">
                        Get a Quote <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </span>
                    </Link>
                  </FadeIn>
                );
              })}
            </div>
          </div>
        </section>

        <HowItWorks />

        {/* Service Areas */}
        <section className="py-16">
          <div className="container">
            <FadeIn>
              <h2 className="text-3xl font-bold text-center mb-10 text-foreground">We Serve the Entire SCV</h2>
            </FadeIn>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
              {SCV_CITIES.map((city, i) => (
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
                Whether it's a leaky faucet, a broken AC, or a backyard makeover — we'll connect you with the right pro.
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
