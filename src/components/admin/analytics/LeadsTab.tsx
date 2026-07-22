import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, TrendingUp, Target, Zap } from "lucide-react";
import { format } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid,
} from "recharts";
import { KpiCard } from "./KpiCard";
import { Database } from "@/integrations/supabase/types";

type LeadRow = Partial<Database["public"]["Tables"]["leads"]["Row"]>;
type EventRow = Partial<Database["public"]["Tables"]["analytics_events"]["Row"]>;

interface Props {
  leads: LeadRow[];
  prevLeads: LeadRow[];
  events: EventRow[];
  prevEvents: EventRow[];
  verticalFilter: string;
  onVerticalFilterChange: (v: string) => void;
  verticals: string[];
  range?: string;
}

function computeFormAbandonment(events: EventRow[]) {
  const formSteps = events.filter((e) => e.event_type === "form_step");
  const step1 = formSteps.filter((e) => e.event_name === "form_step_1_complete").length;
  const step3 = formSteps.filter((e) => e.event_name === "form_step_3_submit").length;
  const rate = step1 > 0 ? ((step1 - step3) / step1) * 100 : 0;
  return { step1, step3, rate };
}

function computeAvgScore(leads: LeadRow[]) {
  const scored = leads.filter((l) => l.lead_score != null);
  if (scored.length === 0) return 0;
  return Math.round(scored.reduce((a: number, l: LeadRow) => a + (l.lead_score || 0), 0) / scored.length);
}

export function LeadsTab({ leads, prevLeads, events, prevEvents, verticalFilter, onVerticalFilterChange, verticals, range = "30d" }: Props) {
  const navigate = useNavigate();

  const filtered = useMemo(
    () => verticalFilter === "all" ? leads : leads.filter((l) => l.vertical === verticalFilter),
    [leads, verticalFilter]
  );
  const prevFiltered = useMemo(
    () => verticalFilter === "all" ? prevLeads : prevLeads.filter((l) => l.vertical === verticalFilter),
    [prevLeads, verticalFilter]
  );

  const totalLeads = filtered.length;
  const prevTotalLeads = prevFiltered.length;
  const avgScore = useMemo(() => computeAvgScore(filtered), [filtered]);
  const prevAvgScore = useMemo(() => computeAvgScore(prevFiltered), [prevFiltered]);
  const formAbandonment = useMemo(() => computeFormAbandonment(events), [events]);
  const prevFormAbandonment = useMemo(() => computeFormAbandonment(prevEvents), [prevEvents]);

  // Lead volume over time
  const volumeOverTime = useMemo(() => {
    const counts = new Map<string, number>();
    filtered.forEach((l) => {
      const day = format(new Date(l.created_at), "MMM d");
      counts.set(day, (counts.get(day) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([date, count]) => ({ date, count }));
  }, [filtered]);

  // Leads by vertical
  const byVertical = useMemo(() => {
    const counts = new Map<string, number>();
    leads.forEach((l) => { if (l.vertical) counts.set(l.vertical, (counts.get(l.vertical) || 0) + 1); });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([vertical, count]) => ({ vertical, count }));
  }, [leads]);

  // Lead quality trend
  const qualityTrend = useMemo(() => {
    const weeklyScores = new Map<string, { sum: number; count: number }>();
    filtered.forEach((l) => {
      if (l.lead_score != null) {
        const week = format(new Date(l.created_at), "MMM d");
        const entry = weeklyScores.get(week) || { sum: 0, count: 0 };
        entry.sum += l.lead_score;
        entry.count += 1;
        weeklyScores.set(week, entry);
      }
    });
    return Array.from(weeklyScores.entries()).map(([date, { sum, count }]) => ({
      date,
      avgScore: Math.round(sum / count),
    }));
  }, [filtered]);

  // By source - compute derived lead_source for chart display
  const bySource = useMemo(() => {
    const counts = new Map<string, number>();
    filtered.forEach((l) => {
      // Same derivation logic as AnalyticsDetail
      const src = l.utm_source || l.source || "direct";
      counts.set(src, (counts.get(src) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([source, count]) => ({ source, count }));
  }, [filtered]);

  // By city
  const byCity = useMemo(() => {
    const counts = new Map<string, number>();
    filtered.forEach((l) => {
      if (l.city) counts.set(l.city, (counts.get(l.city) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([city, count]) => ({ city, count }));
  }, [filtered]);

  const handleVerticalClick = (vertical: string) => {
    navigate(`/admin/analytics/leads_all?range=${range}&filterKey=vertical&filterValue=${encodeURIComponent(vertical)}`);
  };

  // Fixed: use lead_source derived field for drill-down
  const handleSourceClick = (source: string) => {
    navigate(`/admin/analytics/leads_all?range=${range}&filterKey=lead_source&filterValue=${encodeURIComponent(source)}`);
  };

  const handleCityClick = (city: string) => {
    navigate(`/admin/analytics/leads_all?range=${range}&filterKey=city&filterValue=${encodeURIComponent(city)}`);
  };

  return (
    <div className="space-y-6">
      {/* Filter */}
      <div className="flex justify-end">
        <Select value={verticalFilter} onValueChange={onVerticalFilterChange}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="All Verticals" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Verticals</SelectItem>
            {verticals.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* KPI Cards with trends */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={FileText} value={totalLeads.toLocaleString()} label="Total Leads" currentValue={totalLeads} previousValue={prevTotalLeads} href={`/admin/analytics/leads_all?range=${range}`} />
        <KpiCard icon={Target} value={String(avgScore)} label="Avg Lead Score" currentValue={avgScore} previousValue={prevAvgScore} href={`/admin/analytics/leads_scored?range=${range}`} />
        <KpiCard icon={TrendingUp} value={String(formAbandonment.step3)} label="Form Completions" currentValue={formAbandonment.step3} previousValue={prevFormAbandonment.step3} href={`/admin/analytics/form_completions?range=${range}`} />
        <KpiCard icon={Zap} value={`${formAbandonment.rate.toFixed(1)}%`} label="Form Abandonment" currentValue={formAbandonment.rate} previousValue={prevFormAbandonment.rate} invertTrend href={`/admin/analytics/form_abandonment?range=${range}`} />
      </div>

      {/* Lead volume over time */}
      <Card>
        <CardHeader><CardTitle className="text-base">Lead Volume Over Time</CardTitle></CardHeader>
        <CardContent>
          {volumeOverTime.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={volumeOverTime}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" className="text-xs" interval="preserveStartEnd" />
                <YAxis allowDecimals={false} className="text-xs" />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }} />
                <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No lead data yet.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Leads by Vertical</CardTitle></CardHeader>
          <CardContent>
            {byVertical.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={byVertical}>
                  <XAxis dataKey="vertical" className="text-xs" />
                  <YAxis allowDecimals={false} className="text-xs" />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }} />
                  <Bar 
                    dataKey="count" 
                    fill="hsl(var(--primary))" 
                    radius={[4, 4, 0, 0]} 
                    className="cursor-pointer"
                    onClick={(data) => {
                      if (data?.vertical) handleVerticalClick(data.vertical);
                    }}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No data.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Lead Quality Trend</CardTitle></CardHeader>
          <CardContent>
            {qualityTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={qualityTrend}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" className="text-xs" interval="preserveStartEnd" />
                  <YAxis domain={[0, 100]} className="text-xs" />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }} />
                  <Line type="monotone" dataKey="avgScore" stroke="hsl(var(--accent))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No scored leads yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Leads by Source</CardTitle></CardHeader>
          <CardContent>
            {bySource.length > 0 ? (
              <ResponsiveContainer width="100%" height={Math.max(200, bySource.length * 32)}>
                <BarChart data={bySource} layout="vertical">
                  <XAxis type="number" allowDecimals={false} className="text-xs" />
                  <YAxis type="category" dataKey="source" width={100} className="text-xs" />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }} />
                  <Bar 
                    dataKey="count" 
                    fill="hsl(var(--accent))" 
                    radius={[0, 4, 4, 0]} 
                    className="cursor-pointer"
                    onClick={(data) => {
                      if (data?.source) handleSourceClick(data.source);
                    }}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No source data.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Top Cities</CardTitle></CardHeader>
          <CardContent>
            {byCity.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>City</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byCity.map((c) => (
                    <TableRow key={c.city} className="cursor-pointer hover:bg-muted/50" onClick={() => handleCityClick(c.city)}>
                      <TableCell className="text-sm">{c.city}</TableCell>
                      <TableCell className="text-right text-sm font-semibold">{c.count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No city data.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
