import { useMemo, useState } from "react";
import { useParams, useSearchParams, Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageMeta } from "@/components/PageMeta";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, X } from "lucide-react";
import { format } from "date-fns";
import { startOfDay, subDays } from "date-fns";
import { ConfigurableTable, ColumnDef } from "@/components/admin/ConfigurableTable";

import { getAnalyticsColumns, getHostname, getDeviceType } from "./analytics/AnalyticsDetailColumns";

const RANGE_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };

const METRIC_LABELS: Record<string, string> = {
  page_views: "Page Views",
  visitors: "Visitors",
  sessions: "Sessions",
  clicks: "Clicks",
  conversions: "Conversions",
  bounce: "Bounced Sessions",
  pages_per_session: "Pages per Session",
  leads_all: "All Leads",
  leads_scored: "Scored Leads",
  form_completions: "Form Completions",
  form_steps: "Form Steps",
  form_abandonment: "Form Abandonment",
  leads_sold: "Leads Sold",
  leads_routed: "Leads Routed",
  leads_paid: "Paid Leads",
  blog_views: "Blog Views",
  blog_today: "Blog Views Today",
  blog_posts: "Published Posts",
};

const LEAD_METRICS = ["leads_all", "leads_scored", "leads_sold", "leads_routed", "leads_paid"];
const BLOG_METRICS = ["blog_views", "blog_today", "blog_posts"];

interface AnalyticsEvent {
  id: string;
  created_at: string;
  visitor_id?: string | null;
  session_id?: string | null;
  event_type?: string | null;
  event_name?: string | null;
  page_path?: string | null;
  referrer?: string | null;
  utm_source?: string | null;
  user_agent?: string | null;
  screen_width?: number | null;
  screen_height?: number | null;
  ip_address?: string | null;
  language?: string | null;
  timezone?: string | null;
  page_title?: string | null;
  page_url?: string | null;
  connection_type?: string | null;
  is_touch_device?: boolean | null;
  [key: string]: unknown;
}

interface AnalyticsLead {
  id: string;
  created_at: string;
  lead_score?: number | null;
  status?: string | null;
  assigned_buyer_id?: string | null;
  gclid?: string | null;
  utm_source?: string | null;
  source?: string | null;
  [key: string]: unknown;
}

interface BlogPost {
  id: string;
  published_at: string;
  title: string;
  slug: string;
  [key: string]: unknown;
}

interface BlogMetric {
  post_id: string;
  viewed_at: string;
  referrer?: string | null;
  session_id?: string | null;
  [key: string]: unknown;
}

type AnalyticsDataRow = Record<string, unknown>;

export default function AnalyticsDetailPage() {
  const { metric } = useParams<{ metric: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const range = searchParams.get("range") || "30d";
  const filterKey = searchParams.get("filterKey");
  const filterValue = searchParams.get("filterValue");
  const days = RANGE_DAYS[range] || 30;
  const since = useMemo(() => startOfDay(subDays(new Date(), days)).toISOString(), [days]);

  const [search, setSearch] = useState("");

  const clearFilter = () => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete("filterKey");
    newParams.delete("filterValue");
    setSearchParams(newParams);
  };

  const isLeadMetric = LEAD_METRICS.includes(metric || "");
  const isBlogMetric = BLOG_METRICS.includes(metric || "");
  const isEventMetric = !isLeadMetric && !isBlogMetric;

  // Fetch excluded visitors list
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

  // Fetch events
  const { data: rawEvents, isLoading: eventsLoading } = useQuery({
    queryKey: ["analytics_detail_events", metric, range],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analytics_events")
        .select("*")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return (data as AnalyticsEvent[]) || [];
    },
    enabled: isEventMetric,
  });

  // Filter out excluded visitors from events
  const events = useMemo(() => {
    if (!rawEvents) return [];
    if (!excludedVisitors?.length) return rawEvents;
    return rawEvents.filter((e) => !excludedVisitors.includes(e.visitor_id || ""));
  }, [rawEvents, excludedVisitors]);

  // Fetch leads
  const { data: leads, isLoading: leadsLoading } = useQuery({
    queryKey: ["analytics_detail_leads", metric, range],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return (data as AnalyticsLead[]) || [];
    },
    enabled: isLeadMetric,
  });

  // Fetch blog metrics - respect range param for all blog metrics
  const { data: rawBlogMetrics, isLoading: blogMetricsLoading } = useQuery({
    queryKey: ["analytics_detail_blog_metrics", metric, range],
    queryFn: async () => {
      const blogSince = metric === "blog_today" 
        ? startOfDay(new Date()).toISOString() 
        : since; // Use the same range as other metrics
      const { data, error } = await supabase
        .from("post_metrics")
        .select("*")
        .gte("viewed_at", blogSince)
        .order("viewed_at", { ascending: false });
      if (error) throw error;
      return (data as BlogMetric[]) || [];
    },
    enabled: isBlogMetric && metric !== "blog_posts",
  });

  // Get excluded session IDs from excluded visitor events
  const excludedSessionIds = useMemo(() => {
    if (!excludedVisitors?.length || !rawEvents) return new Set<string>();
    const sessionIds = new Set<string>();
    rawEvents?.forEach((e) => {
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

  // Fetch blog posts
  const { data: blogPosts, isLoading: blogPostsLoading } = useQuery({
    queryKey: ["analytics_detail_blog_posts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("posts")
        .select("*")
        .eq("status", "published")
        .order("published_at", { ascending: false });
      if (error) throw error;
      return (data as BlogPost[]) || [];
    },
    enabled: isBlogMetric,
  });

  const isLoading = eventsLoading || leadsLoading || blogMetricsLoading || blogPostsLoading;

  // Process data based on metric type
  const processed = useMemo(() => {
    let data: AnalyticsDataRow[] = [];

    // Blog-based metrics
    if (isBlogMetric) {
      if (metric === "blog_posts") {
        data = (blogPosts || []).map((p) => ({
          ...p,
          created_at: p.published_at,
        }));
      } else {
        // blog_views or blog_today — join with post data and add derived fields
        const postMap = new Map((blogPosts || []).map((p) => [p.id, p]));
        data = (blogMetrics || []).map((m) => ({
          ...m,
          created_at: m.viewed_at,
          post_title: postMap.get(m.post_id)?.title || "Unknown",
          post_slug: postMap.get(m.post_id)?.slug || "",
          referrer_host: getHostname(m.referrer || ""),
        }));
      }
    }
    // Lead-based metrics
    else if (isLeadMetric) {
      if (!leads) return [];
      let baseLeads = leads;
      if (metric === "leads_all") baseLeads = leads;
      else if (metric === "leads_scored") baseLeads = leads.filter((l) => l.lead_score != null);
      else if (metric === "leads_sold") baseLeads = leads.filter((l) => l.status === "sold");
      else if (metric === "leads_routed") baseLeads = leads.filter((l) => l.assigned_buyer_id);
      else if (metric === "leads_paid") baseLeads = leads.filter((l) => l.gclid);
      
      // Add derived lead_source field
      data = baseLeads.map((l) => ({
        ...l,
        lead_source: l.utm_source || l.source || "direct",
      }));
    }
    // Event-based metrics
    else {
      if (!events) return [];

      // Add derived fields to all events
      const enrichedEvents = events.map((e) => ({
        ...e,
        traffic_source: e.utm_source || (e.referrer ? "referral" : "direct"),
        referrer_host: getHostname(e.referrer || ""),
        device_type: getDeviceType(e.screen_width || 0),
      }));

      if (metric === "form_completions") {
        data = enrichedEvents.filter((e) => e.event_type === "form_step" && e.event_name === "form_step_3_submit");
      } else if (metric === "form_steps") {
        // New metric: all form step events
        data = enrichedEvents.filter((e) => e.event_type === "form_step");
      } else if (metric === "form_abandonment") {
        const step3Sessions = new Set(
          enrichedEvents.filter((e) => e.event_name === "form_step_3_submit").map((e) => e.session_id)
        );
        data = enrichedEvents.filter(
          (e) => e.event_type === "form_step" && e.event_name === "form_step_1_complete" && !step3Sessions.has(e.session_id)
        );
      } else if (metric === "page_views") {
        data = enrichedEvents.filter((e) => e.event_type === "page_view");
      } else if (metric === "clicks") {
        data = enrichedEvents.filter((e) => e.event_type === "click");
      } else if (metric === "conversions") {
        data = enrichedEvents.filter((e) => e.event_type === "conversion");
      } else if (metric === "visitors") {
        const grouped = new Map<string, AnalyticsEvent[]>();
        enrichedEvents.forEach((e) => {
          const vid = e.visitor_id || "unknown";
          if (!grouped.has(vid)) grouped.set(vid, []);
          grouped.get(vid)!.push(e);
        });
        data = Array.from(grouped.entries()).map(([visitor_id, evts]) => {
          const sorted = evts.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
          const pages = new Set(evts.map((e) => e.page_path));
          return {
            visitor_id,
            first_seen: sorted[0].created_at,
            last_seen: sorted[sorted.length - 1].created_at,
            event_count: evts.length,
            pages_visited: pages.size,
            pages_list: Array.from(pages).join(", "),
            referrer: sorted[0].referrer,
            utm_source: sorted[0].utm_source,
            user_agent: sorted[0].user_agent,
            screen_width: sorted[0].screen_width,
            screen_height: sorted[0].screen_height,
            ip_address: sorted[0].ip_address,
            traffic_source: sorted[0].traffic_source,
            referrer_host: sorted[0].referrer_host,
            device_type: sorted[0].device_type,
            // Extra metadata
            language: sorted[0].language,
            timezone: sorted[0].timezone,
            page_title: sorted[0].page_title,
            page_url: sorted[0].page_url,
            connection_type: sorted[0].connection_type,
            is_touch_device: sorted[0].is_touch_device,
          };
        });
      } else if (metric === "sessions" || metric === "bounce" || metric === "pages_per_session") {
        const grouped = new Map<string, AnalyticsEvent[]>();
        enrichedEvents.forEach((e) => {
          const sid = e.session_id || "unknown";
          if (!grouped.has(sid)) grouped.set(sid, []);
          grouped.get(sid)!.push(e);
        });
        const sessionRows = Array.from(grouped.entries()).map(([session_id, evts]) => {
          const sorted = evts.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
          const pageViews = evts.filter((e) => e.event_type === "page_view").length;
          const startTime = new Date(sorted[0].created_at).getTime();
          const endTime = new Date(sorted[sorted.length - 1].created_at).getTime();
          const durationSec = Math.round((endTime - startTime) / 1000);
          const isBounce = pageViews <= 1;
          const pages = new Set(evts.map((e) => e.page_path));
          return {
            session_id,
            visitor_id: sorted[0].visitor_id,
            start_time: sorted[0].created_at,
            event_count: evts.length,
            page_views: pageViews,
            duration_sec: durationSec,
            is_bounce: isBounce,
            pages_list: Array.from(pages).join(", "),
            referrer: sorted[0].referrer,
            utm_source: sorted[0].utm_source,
            user_agent: sorted[0].user_agent,
            ip_address: sorted[0].ip_address,
            traffic_source: sorted[0].traffic_source,
            referrer_host: sorted[0].referrer_host,
            device_type: sorted[0].device_type,
            // Extra metadata
            language: sorted[0].language,
            timezone: sorted[0].timezone,
            connection_type: sorted[0].connection_type,
            is_touch_device: sorted[0].is_touch_device,
          };
        });

        if (metric === "bounce") data = sessionRows.filter((s) => s.is_bounce);
        else data = sessionRows;
      } else {
        data = enrichedEvents;
      }
    }

    // Apply filter if present - supports both raw and derived fields
    if (filterKey && filterValue && data.length > 0) {
      data = data.filter((item) => String(item[filterKey] ?? "") === filterValue);
    }

    return data;
  }, [events, leads, blogMetrics, blogPosts, metric, isLeadMetric, isBlogMetric, filterKey, filterValue]);

  // Define columns per metric type
  const columns = useMemo((): ColumnDef[] => {
    return getAnalyticsColumns(metric, isLeadMetric, isBlogMetric);
  }, [metric, isLeadMetric, isBlogMetric]);

  return (
    <>
      <PageMeta title={`${METRIC_LABELS[metric || ""] || "Detail"} | Analytics`} description="Analytics detail view" />
      <AdminLayout>
        <div className="space-y-4">
          <div className="flex items-center gap-4 flex-wrap">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/admin/analytics">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back to Analytics
              </Link>
            </Button>
            <h1 className="text-xl font-bold">{METRIC_LABELS[metric || ""] || "Detail"}</h1>
            <Badge variant="outline">{range}</Badge>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Input
              placeholder="Search across all fields..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
            {filterKey && filterValue && (
              <Badge variant="secondary" className="flex items-center gap-1 pl-2 pr-1 py-1">
                <span className="text-xs">Filtered by {filterKey}: {filterValue}</span>
                <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={clearFilter}>
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            )}
          </div>

          {isLoading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : processed.length === 0 ? (
            <p className="text-muted-foreground text-center py-20">No data found.</p>
          ) : (
            <ConfigurableTable
              columns={columns}
              data={processed}
              storageKey={`analytics_${metric}`}
              searchValue={search}
            />
          )}
        </div>
      </AdminLayout>
    </>
  );
}
