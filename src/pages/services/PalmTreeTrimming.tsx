import { PageMeta } from "@/components/PageMeta";
import { Header } from "@/components/public/Header";
import { Footer } from "@/components/public/Footer";
import { CTAButton } from "@/components/public/CTAButton";
import { FadeIn } from "@/components/public/FadeIn";
import { Wind, Scissors, Palmtree } from "lucide-react";

const PalmTreeTrimming = () => {
  const scrollToForm = () => {
    window.location.href = "/#quote-form";
  };

  return (
    <>
      <PageMeta
        title="Palm Tree Trimming & Skinning Sherman Oaks"
        description="Professional palm tree trimming and skinning in Sherman Oaks. Safely remove heavy, dead fronds and keep your property looking pristine."
      />
      <Header />
      
      <main className="py-20 md:py-28">
        <div className="container max-w-4xl">
          <FadeIn>
            <div className="mb-6 inline-flex items-center rounded-full border border-blue-200 bg-blue-100 px-3 py-1 text-sm text-blue-700">
              <Palmtree className="mr-2 h-4 w-4" /> Aesthetic Maintenance
            </div>
            <h1 className="text-4xl font-black tracking-tight md:text-5xl lg:text-6xl mb-6">
              Palm Tree Trimming & Skinning
            </h1>
            <p className="text-xl text-muted-foreground mb-8">
              Keep your Mexican Fan Palms, Date Palms, and Queen Palms healthy and safe. We provide expert trimming, skinning, and "hurricane cuts" tailored for San Fernando Valley properties.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 mb-12">
              <CTAButton onClick={scrollToForm}>Get a Free Trimming Quote</CTAButton>
            </div>
          </FadeIn>

          <FadeIn delay={0.1}>
            <h2 className="text-3xl font-bold mb-4">The Dangers of Neglected Palm Trees</h2>
            <div className="prose prose-lg mb-12">
              <p>
                While iconic to Southern California, overgrown palm trees pose significant risks. The "skirt" of dead fronds hanging below the canopy is not only an eyesore but a major fire hazard and a haven for pests like rats and pigeons.
              </p>
              <p>
                More importantly, falling palm fronds are heavy and dangerous. During strong Valley winds, a detached frond dropping from 50 feet can cause serious property damage or injury. Regular trimming ensures these hazards are removed safely by trained professionals using the right bucket trucks and climbing gear.
              </p>
            </div>
          </FadeIn>

          <div className="grid gap-8 sm:grid-cols-2 mb-12">
            <FadeIn delay={0.2} className="rounded-xl border bg-card p-6 shadow-sm">
              <Scissors className="h-10 w-10 text-primary mb-4" />
              <h3 className="text-xl font-bold mb-2">Professional Skinning</h3>
              <p className="text-muted-foreground">
                We safely remove the old, fibrous "boots" from the trunk of your palm tree, leaving behind a smooth, clean aesthetic that elevates your property's curb appeal.
              </p>
            </FadeIn>
            <FadeIn delay={0.3} className="rounded-xl border bg-card p-6 shadow-sm">
              <Wind className="h-10 w-10 text-cyan-500 mb-4" />
              <h3 className="text-xl font-bold mb-2">Hurricane Cuts</h3>
              <p className="text-muted-foreground">
                Preparing for high winds? A proper thinning of the canopy reduces wind resistance, ensuring your tall palm trees bend safely rather than breaking during severe storms.
              </p>
            </FadeIn>
          </div>

          <FadeIn delay={0.4} className="rounded-2xl bg-muted p-8 text-center mt-12">
            <h2 className="text-2xl font-bold mb-4">Schedule Your Palm Maintenance</h2>
            <p className="text-muted-foreground mb-6 max-w-xl mx-auto">
              Get matched with local Sherman Oaks arborists who specialize in safe, efficient palm tree care.
            </p>
            <CTAButton onClick={scrollToForm}>Get Your Quote Today</CTAButton>
          </FadeIn>
        </div>
      </main>

      <Footer />
    </>
  );
};

export default PalmTreeTrimming;
