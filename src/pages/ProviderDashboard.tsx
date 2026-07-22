import { useState, useEffect, useCallback } from "react";
import { User } from "@supabase/supabase-js";
import { Database } from "@/integrations/supabase/types";

type BuyerProfile = Database["public"]["Tables"]["buyer_profiles"]["Row"];
type Buyer = Database["public"]["Tables"]["buyers"]["Row"];
type ReviewRow = Database["public"]["Tables"]["reviews"]["Row"];
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/public/Header";
import { Footer } from "@/components/public/Footer";
import { PageMeta } from "@/components/PageMeta";
import { StarRating } from "@/components/reviews/StarRating";
import { ReviewCard } from "@/components/reviews/ReviewCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, LogOut, Sparkles, MessageSquare } from "lucide-react";

export default function ProviderDashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [buyerProfile, setBuyerProfile] = useState<BuyerProfile | null>(null);
  const [buyer, setBuyer] = useState<Buyer | null>(null);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [responseText, setResponseText] = useState("");
  const [form, setForm] = useState({
    company_description: "",
    website: "",
    years_in_business: "",
    license_number: "",
  });
  const navigate = useNavigate();
  const { toast } = useToast();

  const checkAuth = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { navigate("/provider/login"); return; }
    setUser(user);

    const { data: profile } = await supabase
      .from("buyer_profiles")
      .select("*, buyers(*)")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profile) {
      setBuyerProfile(profile);
      setBuyer(profile.buyers as unknown as Buyer);
      setForm({
        company_description: profile.company_description || "",
        website: profile.website || "",
        years_in_business: profile.years_in_business?.toString() || "",
        license_number: profile.license_number || "",
      });

      const { data: revs } = await supabase
        .from("reviews")
        .select("*")
        .eq("buyer_id", profile.buyer_id)
        .order("created_at", { ascending: false });
      setReviews(revs || []);
    }

    setLoading(false);
  }, [navigate]);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  const handleSave = async () => {
    if (!buyerProfile) return;
    setSaving(true);
    const { error } = await supabase
      .from("buyer_profiles")
      .update({
        company_description: form.company_description || null,
        website: form.website || null,
        years_in_business: form.years_in_business ? parseInt(form.years_in_business) : null,
        license_number: form.license_number || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", buyerProfile.id);
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Profile updated!" });
    }
  };

  const handleAiLookup = async () => {
    if (!buyer) return;
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-company-lookup", {
        body: {
          company_name: buyer.business_name,
          city: (buyer.service_areas || [])[0] || "Unknown",
        },
      });
      if (error) throw error;
      if (data?.result) {
        setForm(prev => ({
          ...prev,
          company_description: data.result.description || prev.company_description,
          years_in_business: data.result.years_in_business?.toString() || prev.years_in_business,
          license_number: data.result.license_number || prev.license_number,
          website: data.result.website || prev.website,
        }));
        toast({ title: "AI auto-fill complete", description: "Review the filled fields and save." });
      }
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      toast({ title: "AI lookup failed", description: err, variant: "destructive" });
    }
    setAiLoading(false);
  };

  const handleRespond = async (reviewId: string) => {
    if (!responseText.trim()) return;
    const { error } = await supabase
      .from("reviews")
      .update({
        buyer_response: responseText.trim(),
        buyer_responded_at: new Date().toISOString(),
      })
      .eq("id", reviewId);
    if (error) {
      toast({ title: "Failed to respond", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Response posted!" });
      setRespondingTo(null);
      setResponseText("");
      checkAuth();
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  if (loading) {
    return <><Header /><div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div><Footer /></>;
  }

  if (!buyerProfile) {
    return (
      <>
        <Header />
        <main className="container py-20 text-center max-w-md mx-auto space-y-4">
          <h1 className="text-2xl font-bold text-primary">No Provider Profile Found</h1>
          <p className="text-muted-foreground">
            Your account email doesn't match any registered provider. Make sure you sign up with the same email used in your buyer account.
          </p>
          <Button variant="outline" onClick={handleSignOut}><LogOut className="mr-2 h-4 w-4" /> Sign Out</Button>
        </main>
        <Footer />
      </>
    );
  }

  const avgRating = reviews.length > 0
    ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10
    : 0;

  return (
    <>
      <PageMeta title="Provider Dashboard | HomeQuoteLink" description="Manage your provider profile and respond to reviews." />
      <Header />
      <main className="container py-10 space-y-8 max-w-3xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold font-serif text-primary">{buyer?.business_name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <StarRating rating={Math.round(avgRating)} readonly size="sm" />
              <span className="text-sm text-muted-foreground">{avgRating} ({reviews.length} reviews)</span>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleSignOut}><LogOut className="mr-2 h-4 w-4" /> Sign Out</Button>
        </div>

        <Card className="border-2 border-primary/20 bg-primary/5 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl text-primary">
              <Sparkles className="h-5 w-5" /> ServiceStack OS Status: Inactive
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              You are currently on the free directory tier. Upgrade to ServiceStack OS for $297/mo or opt-in to our 20% Revenue Share program to unlock:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
              <li>Instant Missed-Call Text-Back</li>
              <li>Automated 5-Star Review Funnel</li>
              <li>Exclusive Sherman Oaks Tree Service Leads</li>
            </ul>
            <Button onClick={() => window.location.href = 'mailto:setup@shermanoakshomepros.com'} className="mt-2 bg-primary text-primary-foreground hover:bg-primary/90">
              Schedule Setup Call to Activate
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Company Profile</CardTitle>
              <Button variant="outline" size="sm" onClick={handleAiLookup} disabled={aiLoading}>
                {aiLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                AI Auto-Fill
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Company Description</Label>
              <Textarea
                value={form.company_description}
                onChange={(e) => setForm(f => ({ ...f, company_description: e.target.value }))}
                placeholder="Tell customers about your business..."
                rows={4}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Website</Label>
                <Input value={form.website} onChange={(e) => setForm(f => ({ ...f, website: e.target.value }))} placeholder="https://..." />
              </div>
              <div className="space-y-2">
                <Label>Years in Business</Label>
                <Input type="number" value={form.years_in_business} onChange={(e) => setForm(f => ({ ...f, years_in_business: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>License Number</Label>
                <Input value={form.license_number} onChange={(e) => setForm(f => ({ ...f, license_number: e.target.value }))} />
              </div>
            </div>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save Profile
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-foreground">Customer Reviews</h2>
          {reviews.length === 0 ? (
            <p className="text-muted-foreground">No reviews yet.</p>
          ) : (
            reviews.map(r => (
              <div key={r.id} className="space-y-2">
                <ReviewCard
                  rating={r.rating}
                  reviewText={r.review_text}
                  reviewerName={null}
                  createdAt={r.created_at}
                  isVerified={r.is_verified}
                  buyerResponse={r.buyer_response}
                  buyerRespondedAt={r.buyer_responded_at}
                  buyerName={buyer?.business_name}
                />
                {!r.buyer_response && (
                  respondingTo === r.id ? (
                    <div className="ml-4 space-y-2">
                      <Textarea
                        value={responseText}
                        onChange={(e) => setResponseText(e.target.value)}
                        placeholder="Write your response..."
                        rows={3}
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleRespond(r.id)}>Post Response</Button>
                        <Button size="sm" variant="outline" onClick={() => { setRespondingTo(null); setResponseText(""); }}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" className="ml-4" onClick={() => setRespondingTo(r.id)}>
                      <MessageSquare className="mr-2 h-4 w-4" /> Respond
                    </Button>
                  )
                )}
              </div>
            ))
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
