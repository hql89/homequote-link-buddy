import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageMeta } from "@/components/PageMeta";
import { Header } from "@/components/public/Header";
import { Footer } from "@/components/public/Footer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Star, CheckCircle, Loader2 } from "lucide-react";

export default function Feedback() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [hired, setHired] = useState<boolean | null>(null);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [reviewText, setReviewText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  if (!token) {
    return (
      <>
        <PageMeta title="Feedback | Valley Home Pros" description="Share your feedback." />
        <Header />
        <main className="container max-w-lg mx-auto py-20 text-center">
          <p className="text-muted-foreground">Invalid feedback link.</p>
        </main>
        <Footer />
      </>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("submit-feedback", {
        body: { token, hired_plumber: hired, rating: rating || null, review_text: reviewText || null },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setSubmitted(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <>
        <PageMeta title="Thank You | Valley Home Pros" description="Thank you for your feedback." />
        <Header />
        <main className="container max-w-lg mx-auto py-20 text-center space-y-4">
          <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
          <h1 className="text-2xl font-bold">Thank You!</h1>
          <p className="text-muted-foreground">Your feedback helps us connect homeowners with the best plumbers. We really appreciate it!</p>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <PageMeta title="Share Your Feedback | Valley Home Pros" description="Tell us about your experience." />
      <Header />
      <main className="container max-w-lg mx-auto py-12 px-4">
        <h1 className="text-2xl font-bold mb-2">How Was Your Experience?</h1>
        <p className="text-muted-foreground mb-8">Your feedback helps us improve and connect homeowners with the best plumbers.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Hired question */}
          <div className="space-y-2">
            <Label>Did you end up hiring the plumber?</Label>
            <div className="flex gap-3">
              <Button
                type="button"
                variant={hired === true ? "default" : "outline"}
                onClick={() => setHired(true)}
                className="flex-1"
              >
                Yes
              </Button>
              <Button
                type="button"
                variant={hired === false ? "default" : "outline"}
                onClick={() => setHired(false)}
                className="flex-1"
              >
                No
              </Button>
            </div>
          </div>

          {/* Star rating */}
          <div className="space-y-2">
            <Label>How would you rate your overall experience?</Label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  onClick={() => setRating(star)}
                  className="p-1 transition-transform hover:scale-110"
                >
                  <Star
                    className={`h-8 w-8 ${
                      star <= (hoverRating || rating)
                        ? "fill-yellow-400 text-yellow-400"
                        : "text-muted-foreground/30"
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Review text */}
          <div className="space-y-2">
            <Label>Tell us more (optional)</Label>
            <Textarea
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              placeholder="How was the communication? Were they professional? Would you recommend them?"
              rows={4}
            />
          </div>

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Submit Feedback
          </Button>
        </form>
      </main>
      <Footer />
    </>
  );
}
