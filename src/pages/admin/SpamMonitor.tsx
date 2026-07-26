import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { PageMeta } from "@/components/PageMeta";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, ShieldAlert, ShieldBan, Clock, Ban } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";

const EVENT_LABELS: Record<string, { label: string; icon: typeof ShieldAlert; variant: "destructive" | "secondary" | "default" }> = {
  blocked_email: { label: "Blocked Email", icon: ShieldBan, variant: "destructive" },
  blocked_phone: { label: "Blocked Phone", icon: ShieldBan, variant: "destructive" },
  rate_limited: { label: "Rate Limited", icon: Clock, variant: "secondary" },
};

type TimeRange = "24h" | "7d" | "30d";

function useSpamEvents(range: TimeRange) {
  return useQuery({
    queryKey: ["spam-events", range],
    queryFn: async () => {
      const hours = range === "24h" ? 24 : range === "7d" ? 168 : 720;
      const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from("spam_events" as never)
        .select("*")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      return data as Array<{
        id: string;
        event_type: string;
        email: string | null;
        phone: string | null;
        ip_address: string | null;
        metadata: Record<string, unknown> | null;
        created_at: string;
      }>;
    },
    refetchInterval: 120000,
  });
}

export default function SpamMonitor() {
  const [range, setRange] = useState<TimeRange>("24h");
  const { data: events, isLoading } = useSpamEvents(range);
  const queryClient = useQueryClient();
  const [blocking, setBlocking] = useState<Record<string, boolean>>({});

  const counts = {
    blocked_email: events?.filter((e) => e.event_type === "blocked_email").length ?? 0,
    blocked_phone: events?.filter((e) => e.event_type === "blocked_phone").length ?? 0,
    rate_limited: events?.filter((e) => e.event_type === "rate_limited").length ?? 0,
  };

  async function blockEmail(email: string) {
    const key = `email:${email}`;
    setBlocking((p) => ({ ...p, [key]: true }));
    try {
      const normalized = email.toLowerCase().trim();
      const { error } = await supabase.from("blocked_emails").upsert(
        { email_normalized: normalized },
        { onConflict: "email_normalized" }
      );
      if (error) throw error;
      toast({ title: "Email blocked", description: `${normalized} has been added to the blocklist.` });
      queryClient.invalidateQueries({ queryKey: ["spam-events"] });
    } catch (err: unknown) {
      toast({ title: "Failed to block email", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBlocking((p) => ({ ...p, [key]: false }));
    }
  }

  async function blockPhone(phone: string) {
    const key = `phone:${phone}`;
    setBlocking((p) => ({ ...p, [key]: true }));
    try {
      const normalized = phone.replace(/\D/g, "").slice(-10);
      const { error } = await supabase.from("blocked_phones").upsert(
        { phone_normalized: normalized },
        { onConflict: "phone_normalized" }
      );
      if (error) throw error;
      toast({ title: "Phone blocked", description: `${normalized} has been added to the blocklist.` });
      queryClient.invalidateQueries({ queryKey: ["spam-events"] });
    } catch (err: unknown) {
      toast({ title: "Failed to block phone", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBlocking((p) => ({ ...p, [key]: false }));
    }
  }

  return (
    <AdminLayout>
      <PageMeta title="Spam Monitor | Admin" description="Monitor blocked and rate-limited submission attempts" />
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Spam Monitor</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Submissions the site refused before they became leads. These never reached your inbox and
              never notified a buyer — this page is a record of what was stopped, not a queue of work.
            </p>
          </div>
          <Select value={range} onValueChange={(v) => setRange(v as TimeRange)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">Last 24 hours</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Summary cards */}
        <div className="grid gap-4 sm:grid-cols-3">
          {Object.entries(EVENT_LABELS).map(([key, { label, icon: Icon }]) => (
            <div key={key} className="rounded-lg border bg-card p-4 flex items-center gap-4">
              <div className="rounded-full bg-muted p-2">
                <Icon className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold text-card-foreground">{counts[key as keyof typeof counts]}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Event log table */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !events?.length ? (
          <div className="text-center py-12 text-muted-foreground">
            <ShieldAlert className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>No spam events in this time range — looking clean!</p>
          </div>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead className="w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => {
                  const config = EVENT_LABELS[event.event_type] ?? {
                    label: event.event_type,
                    variant: "default" as const,
                  };
                  const isAlreadyBlocked = event.event_type === "blocked_email" || event.event_type === "blocked_phone";

                  return (
                    <TableRow key={event.id}>
                      <TableCell>
                        <Badge variant={config.variant}>{config.label}</Badge>
                      </TableCell>
                      <TableCell className="text-sm font-mono">
                        {event.email || "—"}
                      </TableCell>
                      <TableCell className="text-sm font-mono">
                        {event.phone || "—"}
                      </TableCell>
                      <TableCell className="text-sm font-mono text-muted-foreground">
                        {event.ip_address || "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {format(new Date(event.created_at), "MMM d, h:mm a")}
                      </TableCell>
                      <TableCell>
                        {!isAlreadyBlocked && (
                          <div className="flex gap-1">
                            {event.email && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-destructive hover:text-destructive"
                                    disabled={blocking[`email:${event.email}`]}
                                    onClick={() => blockEmail(event.email!)}
                                  >
                                    {blocking[`email:${event.email}`] ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Ban className="h-3.5 w-3.5" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Block this email</TooltipContent>
                              </Tooltip>
                            )}
                            {event.phone && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-destructive hover:text-destructive"
                                    disabled={blocking[`phone:${event.phone}`]}
                                    onClick={() => blockPhone(event.phone!)}
                                  >
                                    {blocking[`phone:${event.phone}`] ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <ShieldBan className="h-3.5 w-3.5" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Block this phone</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
