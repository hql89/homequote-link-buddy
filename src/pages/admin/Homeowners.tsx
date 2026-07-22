import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { format } from "date-fns";
import { Search, User } from "lucide-react";

interface Review {
  id: string;
  rating: number;
  review_text?: string | null;
  buyers?: { business_name?: string | null } | null;
}

export default function Homeowners() {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: homeowners, isLoading } = useQuery({
    queryKey: ["admin-homeowners"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("homeowner_profiles")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const selected = homeowners?.find((h) => h.id === selectedId);

  const { data: selectedReviews } = useQuery({
    queryKey: ["admin-homeowner-reviews", selected?.user_id],
    enabled: !!selected,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reviews")
        .select("*, buyers(business_name)")
        .eq("reviewer_user_id", selected!.user_id);
      if (error) throw error;
      return (data as unknown) as Review[];
    },
  });

  const { data: selectedLeads } = useQuery({
    queryKey: ["admin-homeowner-leads", selected?.linked_lead_ids],
    enabled: !!selected && (selected.linked_lead_ids?.length ?? 0) > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("id, full_name, service_type, status, created_at")
        .in("id", selected!.linked_lead_ids!);
      if (error) throw error;
      return data;
    },
  });

  const filtered = homeowners?.filter((h) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      h.email?.toLowerCase().includes(q) ||
      h.full_name?.toLowerCase().includes(q)
    );
  });

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-foreground">Homeowners</h1>
          <Badge variant="secondary">{homeowners?.length ?? 0} total</Badge>
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Linked Leads</TableHead>
                <TableHead>Signed Up</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
              ) : filtered?.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No homeowners found</TableCell></TableRow>
              ) : (
                filtered?.map((h) => (
                  <TableRow key={h.id} className="cursor-pointer" onClick={() => setSelectedId(h.id)}>
                    <TableCell className="font-medium">{h.full_name || "—"}</TableCell>
                    <TableCell>{h.email}</TableCell>
                    <TableCell>{h.phone || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{h.linked_lead_ids?.length ?? 0}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {h.created_at ? format(new Date(h.created_at), "MMM d, yyyy") : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={!!selectedId} onOpenChange={() => setSelectedId(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="h-5 w-5" /> {selected?.full_name || selected?.email}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">Email:</span> {selected.email}</div>
                <div><span className="text-muted-foreground">Phone:</span> {selected.phone || "—"}</div>
                <div><span className="text-muted-foreground">Signed up:</span> {selected.created_at ? format(new Date(selected.created_at), "PPp") : "—"}</div>
              </div>

              <div>
                <h3 className="font-semibold mb-2">Linked Leads ({selectedLeads?.length ?? 0})</h3>
                {selectedLeads?.length ? (
                  <div className="space-y-1">
                    {selectedLeads.map((l) => (
                      <div key={l.id} className="flex items-center justify-between rounded bg-muted p-2">
                        <span>{l.service_type || "Lead"} — {l.full_name}</span>
                        <Badge variant="outline">{l.status}</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground">No linked leads</p>
                )}
              </div>

              <div>
                <h3 className="font-semibold mb-2">Reviews ({selectedReviews?.length ?? 0})</h3>
                {selectedReviews?.length ? (
                  <div className="space-y-1">
                    {selectedReviews.map((r) => (
                      <div key={r.id} className="rounded bg-muted p-2">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{r.buyers?.business_name || "Unknown"}</span>
                          <span>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span>
                        </div>
                        {r.review_text && <p className="text-muted-foreground mt-1">{r.review_text}</p>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground">No reviews posted</p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
