import { PageMeta } from "@/components/PageMeta";
import { Header } from "@/components/public/Header";
import { Footer } from "@/components/public/Footer";
import { CTAButton } from "@/components/public/CTAButton";
import { FadeIn } from "@/components/public/FadeIn";
import { TreePine, Flame, Home } from "lucide-react";

const BrushClearing = () => {
  const scrollToForm = () => {
    window.location.href = "/#quote-form";
  };

  return (
    <>
      <PageMeta
        title="LAFD Brush Clearing & Fire Mitigation Sherman Oaks"
        description="Ensure your Sherman Oaks property meets LAFD brush clearance requirements. Expert hillside fire mitigation and defensible space clearing."
      />
      <Header />
      
      <main className="py-20 md:py-28">
        <div className="container max-w-4xl">
          <FadeIn>
            <div className="mb-6 inline-flex items-center rounded-full border border-orange-200 bg-orange-100 px-3 py-1 text-sm text-orange-700">
              <Flame className="mr-2 h-4 w-4" /> LAFD Compliant
            </div>
            <h1 className="text-4xl font-black tracking-tight md:text-5xl lg:text-6xl mb-6">
              Hillside Brush Clearing & Fire Mitigation
            </h1>
            <p className="text-xl text-muted-foreground mb-8">
              Protect your home from Southern California wildfires. We provide professional brush clearing services to meet strict Los Angeles Fire Department (LAFD) regulations and create defensible space around your property.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 mb-12">
              <CTAButton onClick={scrollToForm}>Get a Brush Clearing Quote</CTAButton>
            </div>
          </FadeIn>

          <FadeIn delay={0.1}>
            <h2 className="text-3xl font-bold mb-4">The Importance of Defensible Space</h2>
            <div className="prose prose-lg mb-12">
              <p>
                Sherman Oaks and the surrounding hills of the San Fernando Valley are located in Very High Fire Hazard Severity Zones (VHFHSZ). Every year, the Santa Ana winds increase the risk of devastating wildfires spreading rapidly through dry brush and overgrown vegetation.
              </p>
              <p>
                Creating a "defensible space" is not just a recommendation—it's a legal requirement. By removing deadwood, thinning canopies, and clearing ground brush, you starve approaching fires of the fuel they need, giving firefighters a much better chance of saving your home.
              </p>
            </div>
          </FadeIn>

          <div className="grid gap-8 sm:grid-cols-2 mb-12">
            <FadeIn delay={0.2} className="rounded-xl border bg-card p-6 shadow-sm">
              <TreePine className="h-10 w-10 text-green-500 mb-4" />
              <h3 className="text-xl font-bold mb-2">Canopy Thinning & Pruning</h3>
              <p className="text-muted-foreground">
                We safely reduce the density of large trees near your home, preventing "fire ladders" where flames can climb from the ground into the upper branches and spread to your roof.
              </p>
            </FadeIn>
            <FadeIn delay={0.3} className="rounded-xl border bg-card p-6 shadow-sm">
              <Home className="h-10 w-10 text-blue-500 mb-4" />
              <h3 className="text-xl font-bold mb-2">Property Line Clearing</h3>
              <p className="text-muted-foreground">
                We ensure the mandated clearance zones around structures (typically 200 feet from any building) are thoroughly managed, removing highly flammable chaparral and dead vegetation.
              </p>
            </FadeIn>
          </div>

          <FadeIn delay={0.4} className="rounded-2xl bg-muted p-8 text-center mt-12">
            <h2 className="text-2xl font-bold mb-4">Don't Risk an LAFD Fine</h2>
            <p className="text-muted-foreground mb-6 max-w-xl mx-auto">
              Ensure your property passes inspection and stays safe this fire season. Get connected with a licensed brush clearing professional today.
            </p>
            <CTAButton onClick={scrollToForm}>Request an Estimate</CTAButton>
          </FadeIn>
        </div>
      </main>

      <Footer />
    </>
  );
};

export default BrushClearing;
