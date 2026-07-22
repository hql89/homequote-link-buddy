import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { DollarSign, Users, Zap, Target } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { Database } from "@/integrations/supabase/types";

type LeadRow = Partial<Database["public"]["Tables"]["leads"]["Row"]>;
type BuyerRow = Partial<Database["public"]["Tables"]["buyers"]["Row"]>;

interface Props {
  leads: LeadRow[];
  prevLeads: LeadRow[];
  buyers: BuyerRow[];
  verticalFilter: string;
  onVerticalFilterChange: (v: string) => void;
  verticals: string[];
  range?: string;
}

const STATUS_ORDER = ["new", "routed", "accepted", "sold"];
const STATUS_COLORS: Record<string, string> = {
  new: "hsl(var(--muted-foreground))",
  routed: "hsl(var(--accent))",
  accepted: "hsl(var(--primary))",
  sold: "hsl(150 60% 40%)",
};

export function RevenueTab({ leads, prevLeads, buyers, verticalFilter, onVerticalFilterChange, verticals, range = "30d" }: Props) {
  const navigate = useNavigate();

  const filtered = useMemo(
    () => verticalFilter === "all" ? leads : leads.filter((l) => l.vertical === verticalFilter),
    [leads, verticalFilter]
  );
  const prevFiltered = useMemo(
    () => verticalFilter === "all" ? prevLeads : prevLeads.filter((l) => l.vertical === verticalFilter),
    [prevLeads, verticalFilter]
  );

  const totalSold = filtered.filter((l) => l.status === "sold").length;
  const prevTotalSold = prevFiltered.filter((l) => l.status === "sold").length;
  const totalRouted = filtered.filter((l) => l.assigned_buyer_id).length;
  const prevTotalRouted = prevFiltered.filter((l) => l.assigned_buyer_id).length;
  const closeRate = totalRouted > 0 ? (totalSold / totalRouted) * 100 : 0;
  const prevCloseRate = prevTotalRouted > 0 ? (prevTotalSold / prevTotalRouted) * 100 : 0;
  const paidCount = filtered.filter((l) => l.gclid).length;
  const prevPaidCount = prevFiltered.filter((l) => l.gclid).length;

  // Status funnel
  const funnel = useMemo(() => {
    const counts = new Map<string, number>();
    filtered.forEach((l) => counts.set(l.status, (counts.get(l.status) || 0) + 1));
    return STATUS_ORDER.map((status) => ({
      status: status.charAt(0).toUpperCase() + status.slice(1),
      statusKey: status,
      count: counts.get(status) || 0,
      fill: STATUS_COLORS[status],
    }));
  }, [filtered]);

  // Buyer performance
  const buyerPerformance = useMemo(() => {
    const buyerMap = new Map(buyers.map((b) => [b.id, b]));
    const stats = new Map<string, { received: number; accepted: number; sold: number }>();
    filtered.forEach((l) => {
      if (l.assigned_buyer_id) {
        const entry = stats.get(l.assigned_buyer_id) || { received: 0, accepted: 0, sold: 0 };
        entry.received++;
        if (l.status === "accepted" || l.status === "sold") entry.accepted++;
        if (l.status === "sold") entry.sold++;
        stats.set(l.assigned_buyer_id, entry);
      }
    });
    return Array.from(stats.entries())
      .map(([buyerId, s]) => ({
        buyerId,
        name: buyerMap.get(buyerId)?.business_name || "Unknown",
        ...s,
        acceptRate: s.received > 0 ? ((s.accepted / s.received) * 100).toFixed(0) : "0",
      }))
      .sort((a, b) => b.received - a.received)
      .slice(0, 10);
  }, [filtered, buyers]);

  // Revenue per vertical
  const revenueByVertical = useMemo(() => {
    const counts = new Map<string, number>();
    leads.filter((l) => l.status === "sold").forEach((l) => {
      counts.set(l.vertical, (counts.get(l.vertical) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([vertical, count]) => ({ vertical, sold: count }));
  }, [leads]);

  // Paid vs organic
  const paidVsOrganic = useMemo(() => {
    const paid = filtered.filter((l) => l.gclid).length;
    const organic = filtered.length - paid;
    return [
      { type: "Paid (GCLID)", count: paid, isPaid: true },
      { type: "Organic", count: organic, isPaid: false },
    ];
  }, [filtered]);

  // Top service types
  const topServiceTypes = useMemo(() => {
    const typeStats = new Map<string, { total: number; sold: number }>();
    filtered.forEach((l) => {
      const st = l.service_type || "unknown";
      const entry = typeStats.get(st) || { total: 0, sold: 0 };
      entry.total++;
      if (l.status === "sold") entry.sold++;
      typeStats.set(st, entry);
    });
    return Array.from(typeStats.entries())
      .filter(([, s]) => s.total >= 2)
      .map(([type, s]) => ({
        type,
        total: s.total,
        sold: s.sold,
        convRate: ((s.sold / s.total) * 100).toFixed(1),
      }))
      .sort((a, b) => b.sold - a.sold)
      .slice(0, 10);
  }, [filtered]);

  const handleStatusClick = (status: string) => {
    navigate(`/admin/analytics/leads_all?range=${range}&filterKey=status&filterValue=${encodeURIComponent(status)}`);
  };

  const handleVerticalClick = (vertical: string) => {
    navigate(`/admin/analytics/leads_sold?range=${range}&filterKey=vertical&filterValue=${encodeURIComponent(vertical)}`);
  };

  const handlePaidClick = (isPaid: boolean) => {
    if (isPaid) {
      navigate(`/admin/analytics/leads_paid?range=${range}`);
    } else {
      navigate(`/admin/analytics/leads_all?range=${range}`);
    }
  };

  const handleServiceTypeClick = (type: string) => {
    navigate(`/admin/analytics/leads_all?range=${range}&filterKey=service_type&filterValue=${encodeURIComponent(type)}`);
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
        <KpiCard icon={DollarSign} value={String(totalSold)} label="Leads Sold" currentValue={totalSold} previousValue={prevTotalSold} href={`/admin/analytics/leads_sold?range=${range}`} />
        <KpiCard icon={Users} value={String(totalRouted)} label="Leads Routed" currentValue={totalRouted} previousValue={prevTotalRouted} href={`/admin/analytics/leads_routed?range=${range}`} />
        <KpiCard icon={Target} value={`${closeRate.toFixed(1)}%`} label="Close Rate" currentValue={closeRate} previousValue={prevCloseRate} href={`/admin/analytics/leads_sold?range=${range}`} />
        <KpiCard icon={Zap} value={String(paidCount)} label="Paid Leads" currentValue={paidCount} previousValue={prevPaidCount} href={`/admin/analytics/leads_paid?range=${range}`} />
      </div>

      {/* Status Funnel */}
      <Card>
        <CardHeader><CardTitle className="text-base">Lead Status Funnel</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={funnel}>
              <XAxis dataKey="status" className="text-xs" />
              <YAxis allowDecimals={false} className="text-xs" />
              <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }} />
              <Bar 
                dataKey="count" 
                radius={[4, 4, 0, 0]} 
                className="cursor-pointer"
                onClick={(data) => {
                  if (data?.statusKey) handleStatusClick(data.statusKey);
                }}
              >
                {funnel.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} className="cursor-pointer" />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Buyer Performance</CardTitle></CardHeader>
          <CardContent>
            {buyerPerformance.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Buyer</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                    <TableHead className="text-right">Accepted</TableHead>
                    <TableHead className="text-right">Sold</TableHead>
                    <TableHead className="text-right">Accept %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {buyerPerformance.map((b) => (
                    <TableRow key={b.buyerId}>
                      <TableCell className="text-sm font-medium">{b.name}</TableCell>
                      <TableCell className="text-right text-sm">{b.received}</TableCell>
                      <TableCell className="text-right text-sm">{b.accepted}</TableCell>
                      <TableCell className="text-right text-sm">{b.sold}</TableCell>
                      <TableCell className="text-right text-sm">{b.acceptRate}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No routed leads yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Paid vs Organic Leads</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={paidVsOrganic}>
                <XAxis dataKey="type" className="text-xs" />
                <YAxis allowDecimals={false} className="text-xs" />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }} />
                <Bar 
                  dataKey="count" 
                  fill="hsl(var(--primary))" 
                  radius={[4, 4, 0, 0]} 
                  className="cursor-pointer"
                  onClick={(data) => {
                    if (data?.isPaid !== undefined) handlePaidClick(data.isPaid);
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Sold Leads by Vertical</CardTitle></CardHeader>
          <CardContent>
            {revenueByVertical.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={revenueByVertical}>
                  <XAxis dataKey="vertical" className="text-xs" />
                  <YAxis allowDecimals={false} className="text-xs" />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }} />
                  <Bar 
                    dataKey="sold" 
                    fill="hsl(150 60% 40%)" 
                    radius={[4, 4, 0, 0]} 
                    className="cursor-pointer"
                    onClick={(data) => {
                      if (data?.vertical) handleVerticalClick(data.vertical);
                    }}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No sold leads yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Top Service Types</CardTitle></CardHeader>
          <CardContent>
            {topServiceTypes.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    <TableHead className="text-right">Sold</TableHead>
                    <TableHead className="text-right">Conv %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topServiceTypes.map((s) => (
                    <TableRow key={s.type} className="cursor-pointer hover:bg-muted/50" onClick={() => handleServiceTypeClick(s.type)}>
                      <TableCell className="text-sm"><Badge variant="outline">{s.type}</Badge></TableCell>
                      <TableCell className="text-right text-sm">{s.total}</TableCell>
                      <TableCell className="text-right text-sm">{s.sold}</TableCell>
                      <TableCell className="text-right text-sm">{s.convRate}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">Not enough data.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
