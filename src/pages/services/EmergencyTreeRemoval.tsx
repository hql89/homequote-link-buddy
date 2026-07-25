import { PageMeta } from "@/components/PageMeta";
import { Header } from "@/components/public/Header";
import { Footer } from "@/components/public/Footer";
import { CTAButton } from "@/components/public/CTAButton";
import { FadeIn } from "@/components/public/FadeIn";
import { Zap, AlertTriangle, ShieldCheck } from "lucide-react";

const EmergencyTreeRemoval = () => {
  const scrollToForm = () => {
    // In a full implementation, we'd route back to the home page form or have a dedicated form here.
    window.location.href = "/#quote-form";
  };

  return (
    <>
      <PageMeta
        title="24/7 Emergency Tree Removal Sherman Oaks | Valley Home Pros"
        description="Hazardous fallen limb and storm damage tree removal in Sherman Oaks. Fast response times, LADWP compliance, and hillside stabilization."
      />
      <Header />
      
      <main className="py-20 md:py-28">
        <div className="container max-w-4xl">
          <FadeIn>
            <div className="mb-6 inline-flex items-center rounded-full border border-red-200 bg-red-100 px-3 py-1 text-sm text-red-600">
              <Zap className="mr-2 h-4 w-4" /> 24/7 Fast Response
            </div>
            <h1 className="text-4xl font-black tracking-tight md:text-5xl lg:text-6xl mb-6">
              Emergency Tree Removal in Sherman Oaks
            </h1>
            <p className="text-xl text-muted-foreground mb-8">
              When a tree falls on your property, threatens power lines, or blocks your driveway, you can't afford to wait. We connect you with local, highly-rated emergency tree removal experts immediately.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 mb-12">
              <a 
                href="tel:+13108613314" 
                className="inline-flex items-center justify-center rounded-md text-sm font-medium h-14 px-8 text-lg bg-red-600 text-white hover:bg-red-700 shadow-lg"
              >
                Call Now for Immediate Dispatch
              </a>
            </div>
          </FadeIn>

          <FadeIn delay={0.1}>
            <h2 className="text-3xl font-bold mb-4">Why You Need Professional Emergency Tree Service</h2>
            <div className="prose prose-lg mb-12">
              <p>
                Sherman Oaks and the greater San Fernando Valley are prone to extreme weather conditions. High winds during the Santa Ana wind season can cause severe damage to mature oaks, eucalyptus, and pine trees. When a heavy limb snaps or a tree becomes uprooted, it poses an immediate threat to your roof, vehicles, and family's safety.
              </p>
              <p>
                Attempting to remove a fallen tree yourself, especially one tangled in power lines or resting precariously on a structure, is incredibly dangerous. Professional arborists have the heavy machinery, bucket trucks, and specialized training to safely dismantle and remove hazardous trees without causing further damage to your property.
              </p>
            </div>
          </FadeIn>

          <div className="grid gap-8 sm:grid-cols-2 mb-12">
            <FadeIn delay={0.2} className="rounded-xl border bg-card p-6 shadow-sm">
              <AlertTriangle className="h-10 w-10 text-orange-500 mb-4" />
              <h3 className="text-xl font-bold mb-2">LADWP & Power Line Compliance</h3>
              <p className="text-muted-foreground">
                Trees interfering with active power lines require specialized removal techniques. Our pros are experienced in dealing with LADWP regulations and safely clearing vegetation away from high-voltage hazards.
              </p>
            </FadeIn>
            <FadeIn delay={0.3} className="rounded-xl border bg-card p-6 shadow-sm">
              <ShieldCheck className="h-10 w-10 text-green-500 mb-4" />
              <h3 className="text-xl font-bold mb-2">Hillside Stabilization</h3>
              <p className="text-muted-foreground">
                For homes south of Ventura Blvd, hillside tree failures can lead to erosion and mudslides. Emergency removal often involves securing the root structure to stabilize the surrounding soil.
              </p>
            </FadeIn>
          </div>

          <FadeIn delay={0.4} className="rounded-2xl bg-muted p-8 text-center mt-12">
            <h2 className="text-2xl font-bold mb-4">Don't Wait Until It Gets Worse</h2>
            <p className="text-muted-foreground mb-6 max-w-xl mx-auto">
              If you have a tree that looks dangerous, or one that has already fallen, contact us immediately for a priority assessment.
            </p>
            <CTAButton onClick={scrollToForm}>Get a Free Assessment</CTAButton>
          </FadeIn>
        </div>
      </main>

      <Footer />
    </>
  );
};

export default EmergencyTreeRemoval;
