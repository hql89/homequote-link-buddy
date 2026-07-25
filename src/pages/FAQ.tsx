import { Header } from "@/components/public/Header";
import { Footer } from "@/components/public/Footer";
import { PageMeta } from "@/components/PageMeta";
import { FAQJsonLd } from "@/components/public/JsonLd";
import { SITE_NAME, SITE_REGION, SITE_PHONE, SFV_DIRECTORY_CITIES } from "@/lib/constants";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const CITIES = SFV_DIRECTORY_CITIES.join(", ");

/**
 * Rewritten for the directory model.
 *
 * The previous copy described this site as "a residential plumbing lead
 * generation service" that sells "exclusive leads" to "buyers" in the Santa
 * Clarita Valley — wrong brand, wrong region, wrong vertical, and worst of
 * all, exactly the lead-broker positioning the directory exists to avoid. Any
 * contractor doing diligence before claiming their listing would have landed
 * here and found us describing the thing we promise them we don't do.
 */
const homeownerFAQs = [
  {
    q: `What is ${SITE_NAME}?`,
    a: `${SITE_NAME} is a free local directory of independent home service businesses across the ${SITE_REGION}. You can browse listings and call businesses directly on their own number, or tell us about your project and we'll point you to a local specialist. It's free for homeowners either way.`,
  },
  {
    q: "Does it cost anything to use?",
    a: "No. Browsing the directory and requesting a match are both free, with no obligation to hire anyone.",
  },
  {
    q: "What happens when I call a business in the directory?",
    a: "You reach that business directly. The number on a listing is the business's own number — there's no call routing or middleman in between.",
  },
  {
    q: "What happens when I use the matching form instead?",
    a: "Your project details come to us, and we pass them to a local business that handles that type of work in your area. They contact you directly to discuss the job and quote it.",
  },
  {
    q: "Will I get calls from a bunch of different companies?",
    a: "No. We don't blast your details out to a list of companies competing for the same job.",
  },
  {
    q: "What areas do you cover?",
    a: `We focus on the ${SITE_REGION}: ${CITIES}. If you're just outside that, submit a request anyway and we'll help if we can.`,
  },
  {
    q: "What kinds of work can I find here?",
    a: "Tree service and removal, plumbing, HVAC and air conditioning, electrical, and landscaping. Tree service is our deepest category today and the rest are growing.",
  },
  {
    q: "What information gets shared when I request a match?",
    a: "Your name, phone number, email if you provided one, city, service type, and the description you wrote. Nothing else — and we don't sell your information to anyone.",
  },
];

const businessFAQs = [
  {
    q: "What is this, and what's the catch?",
    a: `${SITE_NAME} is a local directory for ${SITE_REGION} home service businesses. Your listing is free. There's no catch and no commission — we don't take a cut of any job that comes from it.`,
  },
  {
    q: "Do you sell my leads?",
    a: "No. We don't sell, resell, or share the requests that come through your listing. They go to you and nobody else. We're not a lead broker and we don't operate an auction.",
  },
  {
    q: "Whose phone number is on my listing?",
    a: "Yours. Calls from your listing page ring your phone directly — no tracking number and nothing in between. That's deliberate: your listing should send you your own customers, not route them through us.",
  },
  {
    q: "My business is already listed. How did that happen, and how do I control it?",
    a: "We build listings from publicly available business information so the directory is useful from day one. Your listing is yours — claim it to confirm your details are right, update your services, and take control of the page. Claiming is free and takes about a minute.",
  },
  {
    q: "What changes when I claim my listing?",
    a: "Your listing gets a verified badge, quote requests through the page are turned on and delivered straight to you, and you can see every request your listing has generated. Before a listing is claimed we don't collect quote requests on it at all — only the business's phone number is shown.",
  },
  {
    q: "Is there anything paid?",
    a: "There's an optional Featured upgrade that places your listing above the free ones in your city and adds a Featured badge. It's entirely optional — a free listing stays free and fully functional forever, and the leads it generates are yours either way.",
  },
  {
    q: "Do I have to pay to get the requests from my own listing?",
    a: "No. Every request from your claimed listing goes to you for free, whether or not you ever upgrade.",
  },
  {
    q: "How do I get my listing removed?",
    a: `Call us at ${SITE_PHONE} or use the feedback form and we'll take it down. No argument, no retention pitch.`,
  },
];

const allFAQs = [...homeownerFAQs, ...businessFAQs];

export default function FAQ() {
  return (
    <>
      <PageMeta
        title={`FAQ — ${SITE_NAME} | ${SITE_REGION} Home Service Directory`}
        description={`Common questions about the ${SITE_NAME} directory, for ${SITE_REGION} homeowners and for business owners with a listing.`}
        canonicalPath="/faq"
      />
      <FAQJsonLd faqs={allFAQs} />
      <Header />
      <main id="main-content" className="container max-w-3xl py-12 space-y-12">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold font-serif text-primary">
            Frequently Asked Questions
          </h1>
          <p className="text-muted-foreground">
            Everything you need to know about {SITE_NAME}.
          </p>
        </div>

        <section aria-labelledby="homeowner-faq-heading">
          <h2 id="homeowner-faq-heading" className="text-xl font-semibold font-serif text-primary mb-4">
            For Homeowners
          </h2>
          <Accordion type="single" collapsible className="w-full">
            {homeownerFAQs.map((faq, i) => (
              <AccordionItem key={i} value={`homeowner-${i}`}>
                <AccordionTrigger>{faq.q}</AccordionTrigger>
                <AccordionContent>{faq.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>

        <section aria-labelledby="business-faq-heading">
          <h2 id="business-faq-heading" className="text-xl font-semibold font-serif text-primary mb-4">
            For Business Owners
          </h2>
          <Accordion type="single" collapsible className="w-full">
            {businessFAQs.map((faq, i) => (
              <AccordionItem key={i} value={`business-${i}`}>
                <AccordionTrigger>{faq.q}</AccordionTrigger>
                <AccordionContent>{faq.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>
      </main>
      <Footer />
    </>
  );
}
