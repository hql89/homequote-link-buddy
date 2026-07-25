import { useEffect } from "react";
import { SITE_URL, SITE_PHONE_E164, SITE_NAME, SITE_REGION } from "@/lib/constants";

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${SITE_URL}/#organization`,
  name: SITE_NAME,
  url: SITE_URL,
  telephone: SITE_PHONE_E164,
  description:
    `A local directory of independent home service businesses across the ${SITE_REGION}. Browse listings and contact businesses directly.`,
  areaServed: {
    "@type": "AdministrativeArea",
    name: SITE_REGION,
    containedInPlace: { "@type": "AdministrativeArea", name: "California" },
  },
  contactPoint: {
    "@type": "ContactPoint",
    telephone: SITE_PHONE_E164,
    contactType: "customer service",
    areaServed: "US",
    availableLanguage: "English",
  },
};

const localBusinessSchema = {
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "@id": `${SITE_URL}/#business`,
  name: SITE_NAME,
  description:
    `A local directory of independent ${SITE_REGION} home service businesses — tree service, plumbing, HVAC, electrical and landscaping.`,
  url: SITE_URL,
  telephone: SITE_PHONE_E164,
  areaServed: [
    { "@type": "City", name: "Sherman Oaks" },
    { "@type": "City", name: "Encino" },
    { "@type": "City", name: "Studio City" },
    { "@type": "City", name: "Tarzana" },
    { "@type": "City", name: "Valley Village" },
    { "@type": "City", name: "Toluca Lake" },
  ],
  address: {
    "@type": "PostalAddress",
    addressLocality: "Sherman Oaks",
    addressRegion: "CA",
    addressCountry: "US",
  },
  priceRange: "Free",
  hasOfferCatalog: {
    "@type": "OfferCatalog",
    name: "Home Services",
    itemListElement: [
      { "@type": "Offer", itemOffered: { "@type": "Service", name: "Tree Service & Removal" } },
      { "@type": "Offer", itemOffered: { "@type": "Service", name: "Plumbing" } },
      { "@type": "Offer", itemOffered: { "@type": "Service", name: "HVAC / Air Conditioning" } },
      { "@type": "Offer", itemOffered: { "@type": "Service", name: "Electrical" } },
      { "@type": "Offer", itemOffered: { "@type": "Service", name: "Landscaping" } },
    ],
  },
};

const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${SITE_URL}/#website`,
  name: SITE_NAME,
  url: SITE_URL,
  description: `Local home service directory for the ${SITE_REGION}.`,
  publisher: { "@id": `${SITE_URL}/#organization` },
  potentialAction: {
    "@type": "SearchAction",
    target: `${SITE_URL}/blog?q={search_term_string}`,
    "query-input": "required name=search_term_string",
  },
};

function injectSchema(id: string, data: object) {
  const existing = document.querySelector(`script[data-jsonld="${id}"]`);
  if (existing) return;

  const script = document.createElement("script");
  script.type = "application/ld+json";
  script.setAttribute("data-jsonld", id);
  script.textContent = JSON.stringify(data);
  document.head.appendChild(script);
}

export function JsonLd() {
  useEffect(() => {
    injectSchema("organization", organizationSchema);
    injectSchema("localbusiness", localBusinessSchema);
    injectSchema("website", websiteSchema);

    return () => {
      document.querySelectorAll('script[data-jsonld="organization"], script[data-jsonld="localbusiness"], script[data-jsonld="website"]')
        .forEach((el) => el.remove());
    };
  }, []);

  return null;
}

/** Inject FAQPage schema from an array of Q&A pairs */
export function FAQJsonLd({ faqs }: { faqs: { q: string; a: string }[] }) {
  useEffect(() => {
    const id = "faqpage";
    const existing = document.querySelector(`script[data-jsonld="${id}"]`);
    if (existing) return;

    const schema = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqs.map((faq) => ({
        "@type": "Question",
        name: faq.q,
        acceptedAnswer: {
          "@type": "Answer",
          text: faq.a,
        },
      })),
    };

    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.setAttribute("data-jsonld", id);
    script.textContent = JSON.stringify(schema);
    document.head.appendChild(script);

    return () => {
      script.remove();
    };
  }, [faqs]);

  return null;
}

/** Inject BreadcrumbList schema */
export function BreadcrumbJsonLd({ items }: { items: { name: string; url?: string }[] }) {
  useEffect(() => {
    const id = "breadcrumblist";
    document.querySelector(`script[data-jsonld="${id}"]`)?.remove();

    const schema = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: items.map((item, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: item.name,
        ...(item.url ? { item: item.url } : {}),
      })),
    };

    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.setAttribute("data-jsonld", id);
    script.textContent = JSON.stringify(schema);
    document.head.appendChild(script);

    return () => {
      script.remove();
    };
  }, [items]);

  return null;
}
