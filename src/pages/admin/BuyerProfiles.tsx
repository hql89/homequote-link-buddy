import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Building, ExternalLink, Search } from "lucide-react";

interface BuyerData {
  business_name?: string | null;
  email?: string | null;
  phone?: string | null;
  is_active?: boolean | null;
}

interface BuyerProfile {
  id: string;
  company_description?: string | null;
  website?: string | null;
  license_number?: string | null;
  years_in_business?: number | null;
  ai_enriched_data?: Record<string, unknown> | null;
  created_at?: string | null;
  buyers?: BuyerData | null;
}

interface ProfileEditForm {
  company_description: string;
  website: string;
  license_number: string;
  years_in_business: string;
}

export default function BuyerProfiles() {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: profiles, isLoading } = useQuery({
    queryKey: ["admin-buyer-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("buyer_profiles")
        .select("*, buyers(business_name, email, phone, is_active)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as unknown) as BuyerProfile[];
    },
  });

  const selected = profiles?.find((p) => p.id === selectedId);

  const [editForm, setEditForm] = useState<ProfileEditForm>({
    company_description: "",
    website: "",
    license_number: "",
    years_in_business: "",
  });

  const openDetail = (profile: BuyerProfile) => {
    setSelectedId(profile.id);
    setEditForm({
      company_description: profile.company_description || "",
      website: profile.website || "",
      license_number: profile.license_number || "",
      // Stored as a number; the form field is a string input.
      years_in_business: profile.years_in_business?.toString() ?? "",
    });
  };

  const updateProfile = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("buyer_profiles")
        .update({
          company_description: editForm.company_description || null,
          website: editForm.website || null,
          license_number: editForm.license_number || null,
          years_in_business: editForm.years_in_business ? parseInt(editForm.years_in_business) : null,
        })
        .eq("id", selectedId!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-buyer-profiles"] });
      toast({ title: "Profile updated" });
      setSelectedId(null);
    },
  });

  const filtered = profiles?.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return p.buyers?.business_name?.toLowerCase().includes(q) || p.website?.toLowerCase().includes(q);
  });

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-foreground">Buyer Profiles</h1>
          <Badge variant="secondary">{profiles?.length ?? 0} total</Badge>
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by business name…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Business</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Website</TableHead>
                <TableHead>License</TableHead>
                <TableHead>Years</TableHead>
                <TableHead>AI Data</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
              ) : filtered?.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No profiles</TableCell></TableRow>
              ) : (
                filtered?.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer" onClick={() => openDetail(p)}>
                    <TableCell className="font-medium">{p.buyers?.business_name || "—"}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{p.company_description || "—"}</TableCell>
                    <TableCell>
                      {p.website ? (
                        <a href={p.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <ExternalLink className="h-3 w-3" /> Link
                        </a>
                      ) : "—"}
                    </TableCell>
                    <TableCell>{p.license_number || "—"}</TableCell>
                    <TableCell>{p.years_in_business ?? "—"}</TableCell>
                    <TableCell>{p.ai_enriched_data ? <Badge>Yes</Badge> : "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {p.created_at ? format(new Date(p.created_at), "MMM d, yyyy") : "—"}
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
              <Building className="h-5 w-5" /> {selected?.buyers?.business_name || "Profile"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Company Description</Label>
              <Textarea value={editForm.company_description} onChange={(e) => setEditForm({ ...editForm, company_description: e.target.value })} rows={3} />
            </div>
            <div>
              <Label>Website</Label>
              <Input value={editForm.website} onChange={(e) => setEditForm({ ...editForm, website: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>License Number</Label>
                <Input value={editForm.license_number} onChange={(e) => setEditForm({ ...editForm, license_number: e.target.value })} />
              </div>
              <div>
                <Label>Years in Business</Label>
                <Input type="number" value={editForm.years_in_business} onChange={(e) => setEditForm({ ...editForm, years_in_business: e.target.value })} />
              </div>
            </div>

            {selected?.ai_enriched_data && (
              <div>
                <Label>AI Enriched Data</Label>
                <pre className="mt-1 rounded bg-muted p-3 text-xs overflow-auto max-h-40">
                  {JSON.stringify(selected.ai_enriched_data, null, 2)}
                </pre>
              </div>
            )}

            <Button onClick={() => updateProfile.mutate()} disabled={updateProfile.isPending} className="w-full">
              {updateProfile.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
