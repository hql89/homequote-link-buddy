import { PageMeta } from "@/components/PageMeta";
import { Header } from "@/components/public/Header";
import { Footer } from "@/components/public/Footer";

export default function TermsOfService() {
  return (
    <>
      <PageMeta title="Terms of Service | Valley Home Pros" description="Valley Home Pros terms of service — rules and conditions for using our home service directory." />
      <Header />
      <main className="container py-16 max-w-3xl">
        <h1 className="text-3xl font-bold mb-8 font-sans">Terms of Service</h1>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3 font-sans">Service Description</h2>
          <p className="text-muted-foreground leading-relaxed">
            Valley Home Pros is a directory of independent home service businesses in the San Fernando Valley. We also offer an optional matching service for homeowners who would rather describe their project than pick a business themselves. We are not a contractor and do not perform any home service work ourselves.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3 font-sans">No Guarantees</h2>
          <p className="text-muted-foreground leading-relaxed">
            We do not guarantee the availability, response times, pricing, licensing, or quality of work of any business listed in the directory or matched to a request. Any agreement or contract is solely between you and that business.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3 font-sans">User Responsibilities</h2>
          <p className="text-muted-foreground leading-relaxed">
            By submitting a request, you confirm that the information you provide is accurate and that you consent to being contacted by a home service business regarding it. You agree not to submit false, misleading, or spam requests.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3 font-sans">Limitation of Liability</h2>
          <p className="text-muted-foreground leading-relaxed">
            Valley Home Pros shall not be held liable for any damages, losses, or disputes arising from services provided by any business listed in or matched through the directory. Our role is limited to publishing listings and, where requested, facilitating an initial introduction.
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}
