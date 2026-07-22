import { useEffect, useMemo } from "react";
import { PageMeta } from "@/components/PageMeta";
import { Header } from "@/components/public/Header";
import { Footer } from "@/components/public/Footer";
import { TrustBadges } from "@/components/public/TrustBadges";
import { BreadcrumbJsonLd } from "@/components/public/JsonLd";
import { BreadcrumbNav } from "@/components/public/BreadcrumbNav";
import { CTAButton } from "@/components/public/CTAButton";
import { ServiceCard } from "@/components/public/ServiceCard";
import { LeadCaptureForm } from "@/components/forms/LeadCaptureForm";
import { FAQSection } from "@/components/public/FAQSection";
import { StickyMobileCTA } from "@/components/public/StickyMobileCTA";
import { SFV_CITIES } from "@/lib/constants";
import { SITE_URL } from "@/lib/constants";
import type { VerticalKey } from "@/lib/constants";
import { VERTICAL_CONTENT } from "@/lib/verticalContent";
import { MapPin, ClipboardList, PhoneCall, ThumbsUp } from "lucide-react";

const stepIcons = [ClipboardList, PhoneCall, ThumbsUp];

interface ServiceLandingProps {
  vertical: VerticalKey;
  /** If true, show the inline lead capture form instead of just a CTA button */
  showInlineForm?: boolean;
}

export function ServiceLanding({ vertical, showInlineForm = false }: ServiceLandingProps) {
  const content = VERTICAL_CONTENT[vertical];
  

  const breadcrumbs = useMemo(() => [
    { name: "Home", url: SITE_URL },
    { name: "Services", url: `${SITE_URL}/services` },
    { name: content.metaTitle.split("—")[0]?.trim() || content.jsonLdServiceType },
  ], [content]);

  const scrollToForm = () => {
    const formSection = document.getElementById("service-quote-form");
    if (formSection) {
      formSection.scrollIntoView({ behavior: "smooth" });
    }
  };

  // JSON-LD
  useEffect(() => {
    const id = `jsonld-${vertical}`;
    const existing = document.querySelector(`script[data-jsonld="${id}"]`);
    if (existing) return;

    const schema = {
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      name: "HomeQuoteLink",
      description: content.metaDescription,
      url: `https://homequotelink.com/services/${vertical}`,
      areaServed: SFV_CITIES.filter((c) => c !== "Other / Outside SFV").map((name) => ({
        "@type": "City",
        name,
      })),
      address: {
        "@type": "PostalAddress",
        addressLocality: "Santa Clarita",
        addressRegion: "CA",
        addressCountry: "US",
      },
      priceRange: "Free quotes",
      serviceType: content.jsonLdServiceType,
    };

    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.setAttribute("data-jsonld", id);
    script.textContent = JSON.stringify(schema);
    document.head.appendChild(script);

    return () => {
      script.remove();
    };
  }, [vertical, content.jsonLdServiceType, content.metaDescription]);

  return (
    <>
      <PageMeta title={content.metaTitle} description={content.metaDescription} canonicalPath={`/services/${vertical}`} />
      <BreadcrumbJsonLd items={breadcrumbs} />
      <Header />
      <TrustBadges />

      <main id="main-content">
        {/* Hero */}
        <section className="relative overflow-hidden bg-primary py-20 md:py-28">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_hsl(25_95%_53%/0.15),_transparent_60%)]" />
          <div className="container relative z-10 text-center">
            <div className="mb-6 flex justify-center">
              <BreadcrumbNav
                variant="light"
                items={[
                  { label: "Services", to: "/" },
                  { label: content.metaTitle.split("—")[0]?.trim() || content.jsonLdServiceType },
                ]}
              />
            </div>
            <h1 className="mx-auto max-w-3xl text-4xl font-black leading-tight text-primary-foreground md:text-5xl lg:text-6xl">
              {content.heroTitle}
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-lg text-primary-foreground/80">
              {content.heroDescription}
            </p>
            <div className="mt-8">
              <CTAButton onClick={scrollToForm}>Get Your Free Quote</CTAButton>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="py-16 bg-secondary">
          <div className="container">
            <h2 className="text-3xl font-bold text-center mb-12 text-foreground">How It Works</h2>
            <div className="grid gap-8 md:grid-cols-3">
              {content.howItWorks.map((step, i) => {
                const Icon = stepIcons[i];
                return (
                  <div key={i} className="text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Icon className="h-7 w-7" aria-hidden="true" />
                    </div>
                    <h3 className="mb-2 text-xl font-bold text-foreground font-sans">{step.title}</h3>
                    <p className="text-muted-foreground">{step.description}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Service Areas */}
        <section className="py-16">
          <div className="container">
            <h2 className="text-3xl font-bold text-center mb-10 text-foreground">We Serve the Entire SFV</h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
              {SFV_CITIES.map((city) => (
                <div key={city} className="flex items-center gap-2 rounded-lg border bg-card p-4">
                  <MapPin className="h-5 w-5 text-accent flex-shrink-0" aria-hidden="true" />
                  <span className="font-medium text-card-foreground">{city}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Services */}
        <section className="py-16 bg-muted">
          <div className="container">
            <h2 className="text-3xl font-bold text-center mb-10 text-foreground">{content.servicesHeading}</h2>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {content.services.map((svc) => (
                <ServiceCard key={svc.title} {...svc} />
              ))}
            </div>
            <div className="mt-10 text-center">
              <CTAButton onClick={scrollToForm}>Request a Quote Now</CTAButton>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        {content.faqs && content.faqs.length > 0 && (
          <FAQSection faqs={content.faqs} vertical={vertical} />
        )}

        {/* Inline Form (optional) */}
        {showInlineForm && (
          <section id="service-quote-form" className="py-16 bg-muted">
            <div className="container flex justify-center">
              <div className="w-full max-w-[600px] rounded-lg border bg-card p-8">
                <div className="mb-6 text-center space-y-2">
                  <h2 className="text-2xl font-bold text-card-foreground font-serif">
                    Get Your Free {content.jsonLdServiceType} Quote
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Fill out this quick form and we'll connect you with a local pro.
                  </p>
                </div>
                <LeadCaptureForm vertical={vertical} />
              </div>
            </div>
          </section>
        )}
      </main>

      <StickyMobileCTA onClick={scrollToForm} />
      <Footer />
    </>
  );
}
