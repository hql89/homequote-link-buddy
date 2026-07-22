import { useState, useEffect, useCallback } from "react";
import { User } from "@supabase/supabase-js";
import { Database } from "@/integrations/supabase/types";

type HomeownerProfile = Database["public"]["Tables"]["homeowner_profiles"]["Row"];
type PartialLead = Partial<Database["public"]["Tables"]["leads"]["Row"]>;
type ReviewRow = Database["public"]["Tables"]["reviews"]["Row"];
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/public/Header";
import { Footer } from "@/components/public/Footer";
import { PageMeta } from "@/components/PageMeta";
import { ReviewForm } from "@/components/reviews/ReviewForm";
import { ReviewCard } from "@/components/reviews/ReviewCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, LogOut } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Account() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<HomeownerProfile | null>(null);
  const [leads, setLeads] = useState<PartialLead[]>([]);
  const [myReviews, setMyReviews] = useState<ReviewRow[]>([]);
  const [buyers, setBuyers] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [reviewingLead, setReviewingLead] = useState<string | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  const checkAuth = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { navigate("/login"); return; }
    setUser(user);

    const { data: prof } = await supabase
      .from("homeowner_profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    setProfile(prof);

    // Find leads by email
    if (user.email) {
      const { data: userLeads } = await supabase
        .from("leads")
        .select("id, full_name, service_type, status, assigned_buyer_id, created_at")
        .eq("email_normalized", user.email.toLowerCase().trim())
        .order("created_at", { ascending: false });

      setLeads(userLeads || []);

      // Load buyer names
      const buyerIds = [...new Set((userLeads || []).map(l => l.assigned_buyer_id).filter((id): id is string => !!id))];
      if (buyerIds.length > 0) {
        const { data: buyerData } = await supabase
          .from("buyers")
          .select("id, business_name")
          .in("id", buyerIds);
        const map = new Map<string, string>();
        (buyerData || []).forEach(b => map.set(b.id, b.business_name));
        setBuyers(map);
      }
    }

    // Load my reviews
    const { data: reviews } = await supabase
      .from("reviews")
      .select("*")
      .eq("reviewer_user_id", user.id);
    setMyReviews(reviews || []);

    setLoading(false);
  }, [navigate]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  const reviewedLeadIds = new Set(myReviews.map(r => r.lead_id));
  const reviewableLeads = leads.filter(
    l => l.assigned_buyer_id && ["sent", "closed"].includes(l.status) && !reviewedLeadIds.has(l.id)
  );

  if (loading) {
    return (
      <><Header /><div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div><Footer /></>
    );
  }

  return (
    <>
      <PageMeta title="My Account | HomeQuoteLink" description="View your service requests and leave reviews." />
      <Header />
      <main className="container py-10 space-y-8 max-w-3xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold font-serif text-primary">My Account</h1>
            <p className="text-muted-foreground">{user?.email}</p>
          </div>
          <Button variant="outline" size="sm" onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" /> Sign Out
          </Button>
        </div>

        <Card>
          <CardHeader><CardTitle>My Service Requests</CardTitle></CardHeader>
          <CardContent>
            {leads.length === 0 ? (
              <p className="text-muted-foreground">No service requests found linked to your email.</p>
            ) : (
              <div className="space-y-3">
                {leads.map(l => (
                  <div key={l.id} className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="font-medium text-sm">{l.service_type || "Plumbing Service"}</p>
                      <p className="text-xs text-muted-foreground">
                        {l.assigned_buyer_id ? `Matched to ${buyers.get(l.assigned_buyer_id) || "a provider"}` : "Pending match"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={l.status === "sent" ? "default" : "secondary"}>{l.status}</Badge>
                      {reviewableLeads.find(rl => rl.id === l.id) && (
                        <Button size="sm" variant="outline" onClick={() => setReviewingLead(l.id)}>
                          Leave Review
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {reviewingLead && (
          <Card>
            <CardHeader><CardTitle>Write a Review</CardTitle></CardHeader>
            <CardContent>
              <ReviewForm
                buyerId={leads.find(l => l.id === reviewingLead)?.assigned_buyer_id || ""}
                leadId={reviewingLead}
                onSuccess={() => {
                  setReviewingLead(null);
                  checkAuth();
                }}
              />
            </CardContent>
          </Card>
        )}

        {myReviews.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-foreground">My Reviews</h2>
            {myReviews.map(r => (
              <ReviewCard
                key={r.id}
                rating={r.rating}
                reviewText={r.review_text}
                reviewerName={profile?.full_name}
                createdAt={r.created_at}
                isVerified={r.is_verified}
                buyerResponse={r.buyer_response}
                buyerRespondedAt={r.buyer_responded_at}
              />
            ))}
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
