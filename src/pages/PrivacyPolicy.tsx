import { PageMeta } from "@/components/PageMeta";
import { Header } from "@/components/public/Header";
import { Footer } from "@/components/public/Footer";

export default function PrivacyPolicy() {
  return (
    <>
      <PageMeta title="Privacy Policy | Valley Home Pros" description="HomeQuoteLink privacy policy — how we collect, use, and protect your information." />
      <Header />
      <main className="container py-16 max-w-3xl">
        <h1 className="text-3xl font-bold mb-8 font-sans">Privacy Policy</h1>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3 font-sans">Information We Collect</h2>
          <p className="text-muted-foreground leading-relaxed">
            When you submit a request through Valley Home Pros, we collect the following information: your full name, phone number, email address (optional), city, ZIP code, service type, urgency level, preferred contact method, and the description of the work you need done.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3 font-sans">How We Use Your Information</h2>
          <p className="text-muted-foreground leading-relaxed">
            We use the information you provide to connect you with a local home service business in the San Fernando Valley. Your contact details and request are shared with that business so they can follow up with you about your project.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3 font-sans">Third-Party Sharing</h2>
          <p className="text-muted-foreground leading-relaxed">
            We share your submitted information only with the business matched to your request. We do not sell your personal data to third parties, advertisers, or data brokers, and we do not resell requests to multiple businesses.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3 font-sans">Contact Us</h2>
          <p className="text-muted-foreground leading-relaxed">
            If you have questions about this privacy policy or wish to request deletion of your data, please contact us at{" "}
            <a href="mailto:privacy@homequotelink.com" className="underline text-primary">privacy@homequotelink.com</a>.
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}
