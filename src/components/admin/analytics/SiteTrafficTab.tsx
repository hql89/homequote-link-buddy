import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Eye, MousePointer, Users, ArrowRightLeft, TrendingUp, Globe, Languages, Clock } from "lucide-react";
import { format } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, CartesianGrid,
} from "recharts";
import { KpiCard } from "./KpiCard";

const COLORS = ["hsl(var(--primary))", "hsl(var(--accent))", "hsl(var(--secondary))", "hsl(150 60% 40%)", "hsl(0 70% 55%)", "hsl(270 50% 55%)", "hsl(180 50% 45%)"];

import { Database } from "@/integrations/supabase/types";

type EventRow = Partial<Database["public"]["Tables"]["analytics_events"]["Row"]>;

interface Props {
  events: EventRow[];
  prevEvents: EventRow[];
}

// Helper to extract hostname from URL
function getHostname(url: string | null): string {
  if (!url) return "Direct";
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// Helper to determine device type from screen width
function getDeviceType(screenWidth: number | null): string {
  if (!screenWidth) return "Unknown";
  if (screenWidth < 768) return "Mobile";
  if (screenWidth < 1024) return "Tablet";
  return "Desktop";
}

function computeStats(events: EventRow[]) {
  if (!events || events.length === 0) return null;

  const pageViews = events.filter((e) => e.event_type === "page_view");
  const clicks = events.filter((e) => e.event_type === "click");
  const formSteps = events.filter((e) => e.event_type === "form_step");
  const conversions = events.filter((e) => e.event_type === "conversion");

  const uniqueVisitors = new Set(events.map((e) => e.visitor_id)).size;
  const uniqueSessions = new Set(events.map((e) => e.session_id)).size;

  const sessionPageCounts = new Map<string, number>();
  pageViews.forEach((e) => {
    if (e.session_id) {
      sessionPageCounts.set(e.session_id, (sessionPageCounts.get(e.session_id) || 0) + 1);
    }
  });
  const totalSessions = sessionPageCounts.size;
  const bouncedSessions = Array.from(sessionPageCounts.values()).filter((c) => c === 1).length;
  const bounceRate = totalSessions > 0 ? (bouncedSessions / totalSessions) * 100 : 0;
  const avgPagesPerSession = totalSessions > 0
    ? Array.from(sessionPageCounts.values()).reduce((a, b) => a + b, 0) / totalSessions
    : 0;

  return {
    totalPageViews: pageViews.length,
    uniqueVisitors,
    uniqueSessions,
    totalClicks: clicks.length,
    totalConversions: conversions.length,
    bounceRate,
    avgPagesPerSession,
  };
}

export function SiteTrafficTab({ events, prevEvents, range = "30d" }: Props & { range?: string }) {
  const navigate = useNavigate();
  const stats = useMemo(() => computeStats(events), [events]);
  const prevStats = useMemo(() => computeStats(prevEvents), [prevEvents]);

  // Detailed stats for charts (current period only)
  const chartData = useMemo(() => {
    if (!events || events.length === 0) return null;

    const pageViews = events.filter((e) => e.event_type === "page_view");
    const clicks = events.filter((e) => e.event_type === "click");
    const formSteps = events.filter((e) => e.event_type === "form_step");
    const conversions = events.filter((e) => e.event_type === "conversion");

    const pvByDay = new Map<string, number>();
    pageViews.forEach((e) => {
      const day = format(new Date(e.created_at), "MMM d");
      pvByDay.set(day, (pvByDay.get(day) || 0) + 1);
    });
    const pageViewsByDay = Array.from(pvByDay.entries()).map(([day, views]) => ({ day, views })).reverse();

    const pageCounts = new Map<string, number>();
    pageViews.forEach((e) => {
      const p = e.page_path || "/";
      pageCounts.set(p, (pageCounts.get(p) || 0) + 1);
    });
    const conversionsByPage = new Map<string, number>();
    conversions.forEach((e) => {
      const p = e.page_path || "/";
      conversionsByPage.set(p, (conversionsByPage.get(p) || 0) + 1);
    });
    const topPages = Array.from(pageCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([page, views]) => ({
        page,
        views,
        conversions: conversionsByPage.get(page) || 0,
        convRate: views > 0 ? (((conversionsByPage.get(page) || 0) / views) * 100).toFixed(1) : "0",
      }));

    const clickCounts = new Map<string, number>();
    clicks.forEach((e) => {
      const name = e.event_name || "unknown";
      clickCounts.set(name, (clickCounts.get(name) || 0) + 1);
    });
    const topClicks = Array.from(clickCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    const funnelCounts = new Map<string, number>();
    formSteps.forEach((e) => {
      const name = e.event_name || "unknown";
      funnelCounts.set(name, (funnelCounts.get(name) || 0) + 1);
    });
    const funnel = [
      { step: "Step 1: Service", count: funnelCounts.get("form_step_1_complete") || 0, eventName: "form_step_1_complete" },
      { step: "Step 2: Location", count: funnelCounts.get("form_step_2_complete") || 0, eventName: "form_step_2_complete" },
      { step: "Step 3: Contact", count: funnelCounts.get("form_step_3_submit") || 0, eventName: "form_step_3_submit" },
    ];

    // Traffic sources computed from PAGE VIEWS only (since we drill into page_views)
    const sourceCounts = new Map<string, number>();
    pageViews.forEach((e) => {
      // Use derived traffic_source: utm_source or "referral" if referrer exists, else "direct"
      const source = e.utm_source || (e.referrer ? "referral" : "direct");
      sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
    });
    const sources = Array.from(sourceCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([source, count]) => ({ source, count }));

    // Device breakdown computed from PAGE VIEWS only (since we drill into page_views)
    const deviceCounts = new Map<string, number>();
    pageViews.forEach((e) => {
      const device = getDeviceType(e.screen_width);
      deviceCounts.set(device, (deviceCounts.get(device) || 0) + 1);
    });
    const devices = Array.from(deviceCounts.entries())
      .filter(([name]) => name !== "Unknown")
      .map(([name, value]) => ({ name, value }));

    // Top referrers computed from PAGE VIEWS with hostnames
    const refCounts = new Map<string, number>();
    pageViews.forEach((e) => {
      if (e.referrer) {
        const host = getHostname(e.referrer);
        refCounts.set(host, (refCounts.get(host) || 0) + 1);
      }
    });
    const topReferrers = Array.from(refCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([domain, count]) => ({ domain, count }));

    // Language distribution (unique visitors)
    const langByVisitor = new Map<string, string>();
    pageViews.forEach((e) => {
      if (e.language && e.visitor_id && !langByVisitor.has(e.visitor_id)) {
        langByVisitor.set(e.visitor_id, e.language);
      }
    });
    const langCounts = new Map<string, number>();
    langByVisitor.forEach((lang) => {
      langCounts.set(lang, (langCounts.get(lang) || 0) + 1);
    });
    const languages = Array.from(langCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([name, value]) => ({ name, value }));

    // Timezone distribution (unique visitors)
    const tzByVisitor = new Map<string, string>();
    pageViews.forEach((e) => {
      if (e.timezone && e.visitor_id && !tzByVisitor.has(e.visitor_id)) {
        tzByVisitor.set(e.visitor_id, e.timezone);
      }
    });
    const tzCounts = new Map<string, number>();
    tzByVisitor.forEach((tz) => {
      tzCounts.set(tz, (tzCounts.get(tz) || 0) + 1);
    });
    const timezones = Array.from(tzCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([name, value]) => ({ name, value }));

    return { pageViewsByDay, topPages, topClicks, funnel, sources, devices, topReferrers, languages, timezones };
  }, [events]);

  // Fixed: use traffic_source derived field for drill-down
  const handleSourceClick = (source: string) => {
    navigate(`/admin/analytics/page_views?range=${range}&filterKey=traffic_source&filterValue=${encodeURIComponent(source)}`);
  };

  // Fixed: use referrer_host derived field for drill-down
  const handleReferrerClick = (domain: string) => {
    navigate(`/admin/analytics/page_views?range=${range}&filterKey=referrer_host&filterValue=${encodeURIComponent(domain)}`);
  };

  // New: handle device click with device_type derived field
  const handleDeviceClick = (deviceType: string) => {
    navigate(`/admin/analytics/page_views?range=${range}&filterKey=device_type&filterValue=${encodeURIComponent(deviceType)}`);
  };

  const handlePageClick = (page: string) => {
    navigate(`/admin/analytics/page_views?range=${range}&filterKey=page_path&filterValue=${encodeURIComponent(page)}`);
  };

  const handleClickElementClick = (name: string) => {
    navigate(`/admin/analytics/clicks?range=${range}&filterKey=event_name&filterValue=${encodeURIComponent(name)}`);
  };

  // Fixed: funnel drills into form_steps metric so all steps are shown
  const handleFunnelClick = (eventName: string) => {
    navigate(`/admin/analytics/form_steps?range=${range}&filterKey=event_name&filterValue=${encodeURIComponent(eventName)}`);
  };

  if (!stats) {
    return <p className="text-center text-muted-foreground py-20">No analytics data yet.</p>;
  }

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <KpiCard icon={Eye} value={stats.totalPageViews.toLocaleString()} label="Page Views" currentValue={stats.totalPageViews} previousValue={prevStats?.totalPageViews} href={`/admin/analytics/page_views?range=${range}`} />
        <KpiCard icon={Users} value={stats.uniqueVisitors.toLocaleString()} label="Visitors" currentValue={stats.uniqueVisitors} previousValue={prevStats?.uniqueVisitors} href={`/admin/analytics/visitors?range=${range}`} />
        <KpiCard icon={ArrowRightLeft} value={stats.uniqueSessions.toLocaleString()} label="Sessions" currentValue={stats.uniqueSessions} previousValue={prevStats?.uniqueSessions} href={`/admin/analytics/sessions?range=${range}`} />
        <KpiCard icon={MousePointer} value={stats.totalClicks.toLocaleString()} label="Clicks" currentValue={stats.totalClicks} previousValue={prevStats?.totalClicks} href={`/admin/analytics/clicks?range=${range}`} />
        <KpiCard icon={TrendingUp} value={stats.totalConversions.toLocaleString()} label="Conversions" currentValue={stats.totalConversions} previousValue={prevStats?.totalConversions} href={`/admin/analytics/conversions?range=${range}`} />
        <KpiCard icon={Globe} value={`${stats.bounceRate.toFixed(1)}%`} label="Bounce Rate" currentValue={stats.bounceRate} previousValue={prevStats?.bounceRate} invertTrend href={`/admin/analytics/bounce?range=${range}`} />
        <KpiCard icon={Eye} value={stats.avgPagesPerSession.toFixed(1)} label="Pages/Session" currentValue={stats.avgPagesPerSession} previousValue={prevStats?.avgPagesPerSession} href={`/admin/analytics/pages_per_session?range=${range}`} />
      </div>

      {/* Charts — same as before */}
      {chartData && (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">Page Views Over Time</CardTitle></CardHeader>
            <CardContent>
              {chartData.pageViewsByDay.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={chartData.pageViewsByDay}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="day" className="text-xs" />
                    <YAxis className="text-xs" />
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }} />
                    <Line type="monotone" dataKey="views" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">No page view data yet.</p>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Lead Form Funnel</CardTitle></CardHeader>
              <CardContent>
                {chartData.funnel.some((f) => f.count > 0) ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={chartData.funnel} layout="vertical">
                      <XAxis type="number" className="text-xs" />
                      <YAxis type="category" dataKey="step" width={120} className="text-xs" />
                      <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }} />
                      <Bar 
                        dataKey="count" 
                        fill="hsl(var(--secondary))" 
                        radius={[0, 4, 4, 0]} 
                        className="cursor-pointer" 
                        onClick={(data) => {
                          if (data?.eventName) handleFunnelClick(data.eventName);
                        }} 
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">No form submissions tracked yet.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Traffic Sources</CardTitle></CardHeader>
              <CardContent>
                {chartData.sources.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie 
                        data={chartData.sources} 
                        dataKey="count" 
                        nameKey="source" 
                        cx="50%" 
                        cy="50%" 
                        outerRadius={80} 
                        label={({ source, percent }) => `${source} (${(percent * 100).toFixed(0)}%)`}
                        className="cursor-pointer"
                        onClick={(_, index) => {
                          const source = chartData.sources[index]?.source;
                          if (source) handleSourceClick(source);
                        }}
                      >
                        {chartData.sources.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} className="cursor-pointer" />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">No source data yet.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Device Breakdown</CardTitle></CardHeader>
              <CardContent>
                {chartData.devices.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie 
                        data={chartData.devices} 
                        dataKey="value" 
                        nameKey="name" 
                        cx="50%" 
                        cy="50%" 
                        outerRadius={80} 
                        label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                        className="cursor-pointer"
                        onClick={(_, index) => {
                          const device = chartData.devices[index]?.name;
                          if (device) handleDeviceClick(device);
                        }}
                      >
                        {chartData.devices.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} className="cursor-pointer" />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">No device data yet.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Top Referrers</CardTitle></CardHeader>
              <CardContent>
                {chartData.topReferrers.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Domain</TableHead>
                        <TableHead className="text-right">Views</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {chartData.topReferrers.map((r) => (
                        <TableRow key={r.domain} className="cursor-pointer hover:bg-muted/50" onClick={() => handleReferrerClick(r.domain)}>
                          <TableCell className="text-sm flex items-center gap-2"><Globe className="h-3 w-3 text-muted-foreground" />{r.domain}</TableCell>
                          <TableCell className="text-right text-sm">{r.count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">No referrer data yet.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Languages className="h-4 w-4" />Language Distribution</CardTitle></CardHeader>
              <CardContent>
                {chartData.languages.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={chartData.languages}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                      >
                        {chartData.languages.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">No language data yet.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4" />Timezone Distribution</CardTitle></CardHeader>
              <CardContent>
                {chartData.timezones.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={chartData.timezones} layout="vertical">
                      <XAxis type="number" className="text-xs" />
                      <YAxis type="category" dataKey="name" width={150} className="text-xs" tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }} />
                      <Bar dataKey="value" fill="hsl(var(--accent))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">No timezone data yet.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Landing Page Performance</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Page</TableHead>
                    <TableHead className="text-right">Views</TableHead>
                    <TableHead className="text-right">Conversions</TableHead>
                    <TableHead className="text-right">Conv. Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {chartData.topPages.map((p) => (
                    <TableRow key={p.page} className="cursor-pointer hover:bg-muted/50" onClick={() => handlePageClick(p.page)}>
                      <TableCell className="text-sm font-mono">{p.page}</TableCell>
                      <TableCell className="text-right text-sm">{p.views}</TableCell>
                      <TableCell className="text-right text-sm">{p.conversions}</TableCell>
                      <TableCell className="text-right text-sm">{p.convRate}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Button Clicks</CardTitle></CardHeader>
              <CardContent>
                {chartData.topClicks.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Element</TableHead>
                        <TableHead className="text-right">Clicks</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {chartData.topClicks.map((c) => (
                        <TableRow key={c.name} className="cursor-pointer hover:bg-muted/50" onClick={() => handleClickElementClick(c.name)}>
                          <TableCell className="text-sm"><Badge variant="outline">{c.name.replace(/_/g, " ")}</Badge></TableCell>
                          <TableCell className="text-right text-sm">{c.count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">No click data yet.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
