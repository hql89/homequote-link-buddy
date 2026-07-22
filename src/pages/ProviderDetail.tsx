import { useState, useEffect, useCallback } from "react";
import { Database } from "@/integrations/supabase/types";

type BuyerProfile = Database["public"]["Tables"]["buyer_profiles"]["Row"];
type Buyer = Database["public"]["Tables"]["buyers"]["Row"];
type ReviewRow = Database["public"]["Tables"]["reviews"]["Row"];
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/public/Header";
import { Footer } from "@/components/public/Footer";
import { PageMeta } from "@/components/PageMeta";
import { StarRating } from "@/components/reviews/StarRating";
import { ReviewCard } from "@/components/reviews/ReviewCard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin, Wrench, Globe, Shield, Clock, Loader2 } from "lucide-react";

export default function ProviderDetail() {
  const { id } = useParams<{ id: string }>();
  const [buyer, setBuyer] = useState<Buyer | null>(null);
  const [profile, setProfile] = useState<BuyerProfile | null>(null);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadProvider = useCallback(async () => {
    if (!id) return;
    const [buyerRes, profileRes, reviewsRes] = await Promise.all([
      supabase.from("buyers").select("*").eq("id", id).single(),
      supabase.from("buyer_profiles").select("*").eq("buyer_id", id).maybeSingle(),
      supabase.from("reviews").select("*").eq("buyer_id", id).order("created_at", { ascending: false }),
    ]);

    setBuyer(buyerRes.data);
    setProfile(profileRes.data);
    setReviews(reviewsRes.data || []);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    if (id) loadProvider();
  }, [id, loadProvider]);

  if (loading) {
    return (
      <>
        <Header />
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
        <Footer />
      </>
    );
  }

  if (!buyer) {
    return (
      <>
        <Header />
        <div className="container py-20 text-center">
          <h1 className="text-2xl font-bold text-primary">Provider Not Found</h1>
        </div>
        <Footer />
      </>
    );
  }

  const avgRating = reviews.length > 0
    ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10
    : 0;

  return (
    <>
      <PageMeta
        title={`${buyer.business_name} | HomeQuoteLink`}
        description={profile?.company_description || `View reviews for ${buyer.business_name}`}
      />
      <Header />
      <main className="container py-10 space-y-8">
        <div className="space-y-4">
          <h1 className="text-3xl font-bold font-serif text-primary">{buyer.business_name}</h1>
          <div className="flex items-center gap-4">
            <StarRating rating={Math.round(avgRating)} readonly />
            <span className="text-muted-foreground">
              {avgRating > 0 ? `${avgRating} out of 5` : "No reviews yet"} · {reviews.length} review{reviews.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            {profile?.company_description && (
              <Card>
                <CardHeader><CardTitle className="text-lg">About</CardTitle></CardHeader>
                <CardContent><p className="text-sm text-muted-foreground">{profile.company_description}</p></CardContent>
              </Card>
            )}

            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-foreground">Reviews</h2>
              {reviews.length === 0 ? (
                <p className="text-muted-foreground">No reviews yet. Be the first!</p>
              ) : (
                reviews.map(r => (
                  <ReviewCard
                    key={r.id}
                    rating={r.rating}
                    reviewText={r.review_text}
                    reviewerName={null}
                    createdAt={r.created_at}
                    isVerified={r.is_verified}
                    buyerResponse={r.buyer_response}
                    buyerRespondedAt={r.buyer_responded_at}
                    buyerName={buyer.business_name}
                  />
                ))
              )}
            </div>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-lg">Details</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {(buyer.service_areas || []).length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" /> Service Areas</p>
                    <div className="flex flex-wrap gap-1">
                      {buyer.service_areas.map((a: string) => <Badge key={a} variant="secondary" className="text-xs">{a}</Badge>)}
                    </div>
                  </div>
                )}
                {(buyer.supported_service_types || []).length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Wrench className="h-3 w-3" /> Services</p>
                    <div className="flex flex-wrap gap-1">
                      {buyer.supported_service_types.map((s: string) => <Badge key={s} variant="outline" className="text-xs">{s}</Badge>)}
                    </div>
                  </div>
                )}
                {profile?.website && (
                  <div className="flex items-center gap-1 text-sm">
                    <Globe className="h-3 w-3 text-muted-foreground" />
                    <a href={profile.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{profile.website}</a>
                  </div>
                )}
                {profile?.license_number && (
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Shield className="h-3 w-3" /> License: {profile.license_number}
                  </div>
                )}
                {profile?.years_in_business && (
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Clock className="h-3 w-3" /> {profile.years_in_business} years in business
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
