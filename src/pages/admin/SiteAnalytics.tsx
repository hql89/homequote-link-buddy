import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageMeta } from "@/components/PageMeta";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Info } from "lucide-react";
import { startOfDay, subDays } from "date-fns";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SiteTrafficTab } from "@/components/admin/analytics/SiteTrafficTab";
import { LeadsTab } from "@/components/admin/analytics/LeadsTab";
import { RevenueTab } from "@/components/admin/analytics/RevenueTab";
import { BlogTab } from "@/components/admin/analytics/BlogTab";

type DateRange = "7d" | "30d" | "90d";

const RANGE_DAYS: Record<DateRange, number> = { "7d": 7, "30d": 30, "90d": 90 };

export default function SiteAnalyticsPage() {
  const [range, setRange] = useState<DateRange>("30d");
  const [verticalFilter, setVerticalFilter] = useState("all");

  const days = RANGE_DAYS[range];

  const since = useMemo(() => startOfDay(subDays(new Date(), days)).toISOString(), [days]);
  const prevSince = useMemo(() => startOfDay(subDays(new Date(), days * 2)).toISOString(), [days]);

  // Fetch excluded visitors list and preview exclusion setting
  const { data: excludedVisitors } = useQuery({
    queryKey: ["excluded_visitors"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_settings")
        .select("setting_value")
        .eq("setting_key", "excluded_visitors")
        .maybeSingle();
      if (error) throw error;
      return (data?.setting_value as string[]) || [];
    },
  });

  const { data: excludePreviewViews } = useQuery({
    queryKey: ["exclude_preview_views"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_settings")
        .select("setting_value")
        .eq("setting_key", "exclude_preview_views")
        .maybeSingle();
      if (error) throw error;
      return data?.setting_value === true;
    },
  });

  // Current period events
  const { data: rawEvents, isLoading: eventsLoading } = useQuery({
    queryKey: ["analytics_hub_events", range],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analytics_events")
        .select("*")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 300000,
  });

  // Previous period events
  const { data: rawPrevEvents } = useQuery({
    queryKey: ["analytics_hub_prev_events", range],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analytics_events")
        .select("*")
        .gte("created_at", prevSince)
        .lt("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
  });

  const isLovableUrl = (url: string) =>
    url.includes('lovableproject.com') || url.includes('lovable.app');

  // Filter out excluded visitors and optionally lovable preview views
  const events = useMemo(() => {
    if (!rawEvents) return [];
    let filtered = rawEvents;
    if (excludedVisitors?.length) {
      filtered = filtered.filter((e) => !excludedVisitors.includes(e.visitor_id || ""));
    }
    if (excludePreviewViews) {
      filtered = filtered.filter((e) => !isLovableUrl(e.page_url || ""));
    }
    return filtered;
  }, [rawEvents, excludedVisitors, excludePreviewViews]);

  const prevEvents = useMemo(() => {
    if (!rawPrevEvents) return [];
    let filtered = rawPrevEvents;
    if (excludedVisitors?.length) {
      filtered = filtered.filter((e) => !excludedVisitors.includes(e.visitor_id || ""));
    }
    if (excludePreviewViews) {
      filtered = filtered.filter((e) => !isLovableUrl(e.page_url || ""));
    }
    return filtered;
  }, [rawPrevEvents, excludedVisitors, excludePreviewViews]);

  // Current period leads
  const { data: leads, isLoading: leadsLoading } = useQuery({
    queryKey: ["analytics_hub_leads", range],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .gte("created_at", since)
        .order("created_at", { ascending: true })
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
  });

  // Previous period leads
  const { data: prevLeads } = useQuery({
    queryKey: ["analytics_hub_prev_leads", range],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .gte("created_at", prevSince)
        .lt("created_at", since)
        .order("created_at", { ascending: true })
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: buyers } = useQuery({
    queryKey: ["analytics_hub_buyers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("buyers").select("*");
      if (error) throw error;
      return data || [];
    },
  });

  const blogSince = useMemo(() => subDays(new Date(), 30).toISOString(), []);
  const blogPrevSince = useMemo(() => subDays(new Date(), 60).toISOString(), []);

  const { data: rawBlogMetrics } = useQuery({
    queryKey: ["analytics_hub_blog_metrics"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("post_metrics")
        .select("post_id, viewed_at, referrer, session_id")
        .gte("viewed_at", blogSince)
        .order("viewed_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: rawPrevBlogMetrics } = useQuery({
    queryKey: ["analytics_hub_prev_blog_metrics"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("post_metrics")
        .select("post_id, viewed_at, referrer, session_id")
        .gte("viewed_at", blogPrevSince)
        .lt("viewed_at", blogSince)
        .order("viewed_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  // Get excluded session IDs from excluded visitor events
  const excludedSessionIds = useMemo(() => {
    if (!excludedVisitors?.length || !rawEvents) return new Set<string>();
    const sessionIds = new Set<string>();
    rawEvents.forEach((e) => {
      if (excludedVisitors.includes(e.visitor_id || "") && e.session_id) {
        sessionIds.add(e.session_id);
      }
    });
    return sessionIds;
  }, [rawEvents, excludedVisitors]);

  // Filter blog metrics by excluded session IDs
  const blogMetrics = useMemo(() => {
    if (!rawBlogMetrics) return [];
    if (!excludedSessionIds.size) return rawBlogMetrics;
    return rawBlogMetrics.filter((m) => !excludedSessionIds.has(m.session_id || ""));
  }, [rawBlogMetrics, excludedSessionIds]);

  const prevBlogMetrics = useMemo(() => {
    if (!rawPrevBlogMetrics) return [];
    if (!excludedSessionIds.size) return rawPrevBlogMetrics;
    return rawPrevBlogMetrics.filter((m) => !excludedSessionIds.has(m.session_id || ""));
  }, [rawPrevBlogMetrics, excludedSessionIds]);

  const { data: blogPosts } = useQuery({
    queryKey: ["analytics_hub_blog_posts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("posts")
        .select("id, title, slug")
        .eq("status", "published");
      if (error) throw error;
      return data || [];
    },
  });

  const verticals = useMemo(() => {
    if (!leads) return [];
    return Array.from(new Set(leads.map((l) => l.vertical))).sort();
  }, [leads]);

  const isLoading = eventsLoading || leadsLoading;

  return (
    <>
      <PageMeta title="Analytics | Admin" description="Comprehensive analytics dashboard." />
      <AdminLayout>
        <div className="flex items-start justify-between mb-2 gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold font-sans">Analytics</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Traffic, leads, and revenue over the selected period. Visits from browsers you have excluded
              in Settings are not counted, so your own testing does not distort these numbers.
            </p>
          </div>
          <Select value={range} onValueChange={(v) => setRange(v as DateRange)}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Alert className="mb-6 bg-blue-50/50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-900 border">
          <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <AlertTitle className="text-blue-800 dark:text-blue-300">Also tracked in Google Analytics (GA4)</AlertTitle>
          <AlertDescription className="text-blue-700 dark:text-blue-400/90">
            <p className="mb-3">
              Traffic is also tracked in Google Analytics 4 (GA4). The charts and metrics below are{" "}
              <strong>live internal data</strong> for whatever date range you select above — not a historical
              snapshot from before a migration — pulled directly from this site's own analytics_events table.
            </p>
            <a 
              href="https://analytics.google.com/analytics/web/#/a388401023p529410400/reports/intelligenthome" 
              target="_blank" 
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 font-semibold text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline-offset-4 hover:underline"
            >
              View Real-time GA4 Dashboard
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-external-link"><path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
            </a>
          </AlertDescription>
        </Alert>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs defaultValue="traffic" className="space-y-6">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="traffic">Site Traffic</TabsTrigger>
              <TabsTrigger value="leads">Leads</TabsTrigger>
              <TabsTrigger value="revenue">Revenue & ROI</TabsTrigger>
              <TabsTrigger value="blog">Blog</TabsTrigger>
            </TabsList>

            <TabsContent value="traffic">
              <SiteTrafficTab events={events || []} prevEvents={prevEvents || []} range={range} />
            </TabsContent>

            <TabsContent value="leads">
              <LeadsTab
                leads={leads || []}
                prevLeads={prevLeads || []}
                events={events || []}
                prevEvents={prevEvents || []}
                verticalFilter={verticalFilter}
                onVerticalFilterChange={setVerticalFilter}
                verticals={verticals}
                range={range}
              />
            </TabsContent>

            <TabsContent value="revenue">
              <RevenueTab
                leads={leads || []}
                prevLeads={prevLeads || []}
                buyers={buyers || []}
                verticalFilter={verticalFilter}
                onVerticalFilterChange={setVerticalFilter}
                verticals={verticals}
                range={range}
              />
            </TabsContent>

            <TabsContent value="blog">
              <BlogTab metrics={blogMetrics || []} prevMetrics={prevBlogMetrics || []} posts={blogPosts || []} range={range} />
            </TabsContent>
          </Tabs>
        )}
      </AdminLayout>
    </>
  );
}
