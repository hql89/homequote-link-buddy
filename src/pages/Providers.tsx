import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/public/Header";
import { Footer } from "@/components/public/Footer";
import { PageMeta } from "@/components/PageMeta";
import { Input } from "@/components/ui/input";
import { StarRating } from "@/components/reviews/StarRating";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, MapPin, Wrench, Loader2 } from "lucide-react";

interface ProviderWithStats {
  id: string;
  business_name: string;
  service_areas: string[] | null;
  supported_service_types: string[] | null;
  avg_rating: number;
  review_count: number;
  profile?: {
    company_description: string | null;
    logo_url: string | null;
  };
}

export default function Providers() {
  const [providers, setProviders] = useState<ProviderWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    loadProviders();
  }, []);

  const loadProviders = async () => {
    const { data: buyers } = await supabase
      .from("buyers")
      .select("id, business_name, service_areas, supported_service_types")
      .eq("is_active", true);

    if (!buyers) { setLoading(false); return; }

    const { data: profiles } = await supabase
      .from("buyer_profiles")
      .select("buyer_id, company_description, logo_url");

    const { data: reviews } = await supabase
      .from("reviews")
      .select("buyer_id, rating");

    const profileMap = new Map((profiles || []).map(p => [p.buyer_id, p]));
    const reviewMap = new Map<string, { sum: number; count: number }>();
    (reviews || []).forEach(r => {
      const existing = reviewMap.get(r.buyer_id!) || { sum: 0, count: 0 };
      existing.sum += r.rating;
      existing.count += 1;
      reviewMap.set(r.buyer_id!, existing);
    });

    const result: ProviderWithStats[] = buyers.map(b => {
      const stats = reviewMap.get(b.id) || { sum: 0, count: 0 };
      const prof = profileMap.get(b.id);
      return {
        ...b,
        avg_rating: stats.count > 0 ? Math.round((stats.sum / stats.count) * 10) / 10 : 0,
        review_count: stats.count,
        profile: prof ? { company_description: prof.company_description, logo_url: prof.logo_url } : undefined,
      };
    });

    setProviders(result);
    setLoading(false);
  };

  const filtered = providers.filter(p =>
    p.business_name.toLowerCase().includes(search.toLowerCase()) ||
    (p.service_areas || []).some(a => a.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <>
      <PageMeta title="Find Local Tree Service Pros in Sherman Oaks | Sherman Oaks Home Pros" description="Browse verified tree service providers in Sherman Oaks and the San Fernando Valley. Read reviews, compare services, and find the right arborist near you." canonicalPath="/providers" />
      <Header />
      <main className="container py-10 space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold font-serif text-primary">Find a Tree Service Pro</h1>
          <p className="text-muted-foreground">Browse verified providers and read reviews from real customers.</p>
        </div>

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or city..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <p className="text-muted-foreground py-8">No providers found.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map(p => (
              <Link key={p.id} to={`/providers/${p.id}`}>
                <Card className="hover:shadow-md transition-shadow h-full">
                  <CardContent className="pt-5 space-y-3">
                    <div className="flex items-start justify-between">
                      <h3 className="font-semibold text-primary text-lg">{p.business_name}</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <StarRating rating={Math.round(p.avg_rating)} readonly size="sm" />
                      <span className="text-sm text-muted-foreground">
                        {p.avg_rating > 0 ? `${p.avg_rating}` : "No reviews"} ({p.review_count})
                      </span>
                    </div>
                    {p.profile?.company_description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">{p.profile.company_description}</p>
                    )}
                    <div className="flex flex-wrap gap-1">
                      {(p.service_areas || []).slice(0, 3).map(a => (
                        <Badge key={a} variant="secondary" className="text-xs gap-1">
                          <MapPin className="h-3 w-3" /> {a}
                        </Badge>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {(p.supported_service_types || []).slice(0, 3).map(s => (
                        <Badge key={s} variant="outline" className="text-xs gap-1">
                          <Wrench className="h-3 w-3" /> {s}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
