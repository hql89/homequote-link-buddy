import { PageMeta } from "@/components/PageMeta";
import { Header } from "@/components/public/Header";
import { Footer } from "@/components/public/Footer";

/**
 * Every claim on this page is written against what the code actually does, and
 * is meant to be re-checked against it whenever tracking changes:
 *
 * - Google Analytics 4 (G-LKDJ4LMYFR) and the Meta Pixel (1102708245809446)
 *   both load unconditionally from `index.html`.
 * - `trackConversion` sends Meta a `Lead` event carrying the service type and
 *   city on a successful request (`analyticsService.ts`).
 * - The `track-event` edge function stores IP address, referrer and a
 *   localStorage visitor id in `analytics_events`.
 *
 * Updated 2026-11-06: an opt-out now exists at /privacy-choices, and Global
 * Privacy Control IS honoured — see src/lib/trackingChoice.ts and the guard at
 * the top of index.html, which runs before the Google and Meta snippets.
 *
 * Still deliberately NOT claimed: there is no consent banner, so tracking
 * remains on by default for a visitor who has made no choice and sends no GPC
 * signal. Saying otherwise would make this page the untrue part.
 */
export default function PrivacyPolicy() {
  return (
    <>
      <PageMeta title="Privacy Policy | Valley Home Pros" description="HomeQuoteLink privacy policy — how we collect, use, and protect your information." />
      <Header />
      <main className="container py-16 max-w-3xl">
        <h1 className="text-3xl font-bold mb-2 font-sans">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: November 6, 2026</p>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3 font-sans">Information We Collect</h2>
          <p className="text-muted-foreground leading-relaxed">
            When you submit a request through Valley Home Pros, we collect the following information: your full name, phone number, email address (optional), city, ZIP code, service type, urgency level, preferred contact method, and the description of the work you need done.
          </p>
          <p className="text-muted-foreground leading-relaxed mt-4">
            We also collect some information automatically when you browse the site, whether or not you submit a request: the pages you visit, the site or search that referred you, your IP address, your browser and device type, and a randomly generated identifier stored in your browser so repeat visits can be recognised as the same visitor. This identifier is not linked to your name unless you submit a request.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3 font-sans">How We Use Your Information</h2>
          <p className="text-muted-foreground leading-relaxed">
            We use the information you provide to connect you with a local home service business in the San Fernando Valley. Your contact details and request are shared with that business so they can follow up with you about your project.
          </p>
          <p className="text-muted-foreground leading-relaxed mt-4">
            We use the information collected automatically to understand how people find and use the site, and to measure and improve our advertising.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3 font-sans">Analytics and Advertising Tools</h2>
          <p className="text-muted-foreground leading-relaxed">
            This site uses two third-party tools that collect information about your visit directly, on every page:
          </p>
          <ul className="mt-4 space-y-3 text-muted-foreground leading-relaxed list-disc pl-5">
            <li>
              <span className="font-medium text-foreground">Google Analytics</span> — records the pages you view and basic device and location information, so we can see how the site is used.
            </li>
            <li>
              <span className="font-medium text-foreground">Meta Pixel (Facebook and Instagram)</span> — records that you visited the site. If you successfully submit a request, we also tell Meta that a request was submitted, along with the type of service and the city. We do not send Meta your name, phone number, email address, or the description of your project.
            </li>
          </ul>
          <p className="text-muted-foreground leading-relaxed mt-4">
            These tools set their own cookies and may combine what they collect here with information they already hold about you, including to show you advertising elsewhere. You can switch them off for your browser at any time on{" "}
            <a href="/privacy-choices" className="underline text-primary">Your Privacy Choices</a>. We do not show a consent banner, so they are on until you say otherwise, or unless your browser sends a Global Privacy Control signal — which we honour.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3 font-sans">Third-Party Sharing</h2>
          <p className="text-muted-foreground leading-relaxed">
            We share the details of your request only with the business matched to it. We do not resell requests to multiple businesses, and we do not sell your personal information for money to anyone, including data brokers.
          </p>
          <p className="text-muted-foreground leading-relaxed mt-4">
            We do, however, share browsing and conversion information with Google and Meta through the tools described above, for analytics and advertising. California law treats that kind of sharing for advertising purposes as "sharing" or a "sale" even when no money changes hands, so we want to state it plainly rather than rely on the narrower everyday meaning of those words.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3 font-sans">Your Choices and California Privacy Rights</h2>
          <p className="text-muted-foreground leading-relaxed">
            If you are a California resident, you have the right to know what personal information we hold about you, to request its deletion, to correct it, and to opt out of the sharing described above. We will not treat you differently for exercising any of these rights.
          </p>
          <p className="text-muted-foreground leading-relaxed mt-4">
            To opt out of sharing for advertising, use{" "}
            <a href="/privacy-choices" className="underline text-primary">Your Privacy Choices</a>{" "}
            — it takes effect immediately on the browser you are using, and needs nothing from us.
            If your browser sends a Global Privacy Control signal we treat that as an opt-out on
            its own. For anything else — to know what we hold, to have it deleted or corrected, or
            to reach information already shared — email us at{" "}
            <a href="mailto:privacy@homequotelink.com" className="underline text-primary">privacy@homequotelink.com</a>{" "}
            and say what you would like us to do. You do not need an account, and you may have an authorised agent make the request for you. We will confirm we received it and respond within 45 days.
          </p>
          <p className="text-muted-foreground leading-relaxed mt-4">
            You can also limit this kind of tracking yourself, without going through us: block or delete cookies in your browser settings, use your browser's private browsing mode, or adjust your advertising preferences directly with{" "}
            <a href="https://myadcenter.google.com/" target="_blank" rel="noopener noreferrer" className="underline text-primary">Google</a>{" "}
            and{" "}
            <a href="https://accountscenter.facebook.com/ad_preferences" target="_blank" rel="noopener noreferrer" className="underline text-primary">Meta</a>.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3 font-sans">Children's Privacy</h2>
          <p className="text-muted-foreground leading-relaxed">
            This site is intended for adults arranging work on a home. We do not knowingly collect information from children under 13. If you believe a child has submitted information to us, email us and we will delete it.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3 font-sans">Contact Us</h2>
          <p className="text-muted-foreground leading-relaxed">
            If you have questions about this privacy policy, or wish to request deletion of your data, please contact us at{" "}
            <a href="mailto:privacy@homequotelink.com" className="underline text-primary">privacy@homequotelink.com</a>.
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}
