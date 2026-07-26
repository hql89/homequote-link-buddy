import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { PageMeta } from "@/components/PageMeta";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { CheckCircle, XCircle, Eye, Loader2 } from "lucide-react";
import { VERTICALS } from "@/lib/constants";

interface Application {
  id: string;
  user_id: string;
  buyer_id: string | null;
  company_description: string | null;
  website: string | null;
  license_number: string | null;
  years_in_business: number | null;
  logo_url: string | null;
  created_at: string | null;
}

export default function ProviderApplications() {
  const queryClient = useQueryClient();
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Application | null>(null);
  const [approveForm, setApproveForm] = useState({
    business_name: "",
    contact_name: "",
    email: "",
    phone: "",
    vertical: "plumbing",
    service_areas: "",
  });

  const { data: applications, isLoading } = useQuery({
    queryKey: ["provider-applications"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("buyer_profiles")
        .select("*")
        .is("buyer_id", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Application[];
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (app: Application) => {
      // Create the buyer record
      const { data: buyer, error: buyerError } = await supabase
        .from("buyers")
        .insert({
          business_name: approveForm.business_name,
          contact_name: approveForm.contact_name,
          email: approveForm.email,
          phone: approveForm.phone,
          vertical: approveForm.vertical,
          service_areas: approveForm.service_areas.split(",").map(s => s.trim()).filter(Boolean),
          is_active: true,
        })
        .select()
        .single();
      if (buyerError) throw buyerError;

      // Link the buyer_profile to the new buyer
      const { error: linkError } = await supabase
        .from("buyer_profiles")
        .update({ buyer_id: buyer.id })
        .eq("id", app.id);
      if (linkError) throw linkError;

      return buyer;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-applications"] });
      queryClient.invalidateQueries({ queryKey: ["buyers"] });
      queryClient.invalidateQueries({ queryKey: ["admin-buyer-profiles"] });
      toast({ title: "Provider approved", description: "Buyer record created and profile linked." });
      setSelectedApp(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (app: Application) => {
      const { error } = await supabase
        .from("buyer_profiles")
        .delete()
        .eq("id", app.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-applications"] });
      queryClient.invalidateQueries({ queryKey: ["admin-buyer-profiles"] });
      toast({ title: "Application rejected", description: "Profile has been removed." });
      setRejectTarget(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  function openApprove(app: Application) {
    setApproveForm({
      business_name: "",
      contact_name: "",
      email: "",
      phone: "",
      vertical: "plumbing",
      service_areas: "",
    });
    setSelectedApp(app);
  }

  return (
    <>
      <PageMeta title="Provider Applications | Admin" description="Review and approve provider applications." />
      <AdminLayout>
        <div className="space-y-6">
          <div>
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold font-sans">Provider Applications</h1>
              <Badge variant="secondary">{applications?.length ?? 0} pending</Badge>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Contractors who applied to join the network through the public sign-up form. Approving one
              creates a buyer that leads can be routed to; until then they receive nothing.
            </p>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : !applications || applications.length === 0 ? (
            <div className="rounded-lg border bg-card p-10 text-center text-muted-foreground">
              No pending applications.
            </div>
          ) : (
            <div className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead>Website</TableHead>
                    <TableHead>License</TableHead>
                    <TableHead>Years</TableHead>
                    <TableHead>Applied</TableHead>
                    <TableHead className="w-[140px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {applications.map((app) => (
                    <TableRow key={app.id}>
                      <TableCell className="max-w-[200px] truncate">{app.company_description || "—"}</TableCell>
                      <TableCell className="text-sm">{app.website || "—"}</TableCell>
                      <TableCell className="text-sm">{app.license_number || "—"}</TableCell>
                      <TableCell>{app.years_in_business ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {app.created_at ? format(new Date(app.created_at), "MMM d, yyyy") : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" title="Review & Approve" onClick={() => openApprove(app)}>
                            <CheckCircle className="h-4 w-4 text-primary" />
                          </Button>
                          <Button variant="ghost" size="icon" title="Reject" onClick={() => setRejectTarget(app)}>
                            <XCircle className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* Approve dialog */}
        <Dialog open={!!selectedApp} onOpenChange={(open) => { if (!open) setSelectedApp(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Approve Provider Application</DialogTitle>
            </DialogHeader>
            {selectedApp && (
              <div className="space-y-4">
                {selectedApp.company_description && (
                  <div className="rounded bg-muted p-3 text-sm">
                    <p className="font-medium text-xs text-muted-foreground mb-1">Applicant's Description</p>
                    {selectedApp.company_description}
                  </div>
                )}
                {selectedApp.website && (
                  <p className="text-sm">Website: <a href={selectedApp.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{selectedApp.website}</a></p>
                )}

                <p className="text-sm font-medium text-muted-foreground">Fill in buyer details to create the account:</p>

                <div><Label>Business Name *</Label><Input value={approveForm.business_name} onChange={(e) => setApproveForm({ ...approveForm, business_name: e.target.value })} /></div>
                <div><Label>Contact Name *</Label><Input value={approveForm.contact_name} onChange={(e) => setApproveForm({ ...approveForm, contact_name: e.target.value })} /></div>
                <div><Label>Email *</Label><Input type="email" value={approveForm.email} onChange={(e) => setApproveForm({ ...approveForm, email: e.target.value })} /></div>
                <div><Label>Phone *</Label><Input value={approveForm.phone} onChange={(e) => setApproveForm({ ...approveForm, phone: e.target.value })} /></div>
                <div>
                  <Label>Vertical</Label>
                  <Select value={approveForm.vertical} onValueChange={(v) => setApproveForm({ ...approveForm, vertical: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(VERTICALS).map(([key, v]) => <SelectItem key={key} value={key}>{v.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Service Areas (comma-separated)</Label><Input value={approveForm.service_areas} onChange={(e) => setApproveForm({ ...approveForm, service_areas: e.target.value })} placeholder="Santa Clarita, Valencia" /></div>

                <Button
                  onClick={() => approveMutation.mutate(selectedApp)}
                  disabled={!approveForm.business_name || !approveForm.email || !approveForm.phone || !approveForm.contact_name || approveMutation.isPending}
                  className="w-full"
                >
                  {approveMutation.isPending ? "Creating…" : "Approve & Create Buyer"}
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Reject confirmation */}
        <AlertDialog open={!!rejectTarget} onOpenChange={(open) => { if (!open) setRejectTarget(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reject this application?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently remove the provider profile. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => rejectTarget && rejectMutation.mutate(rejectTarget)}>Reject</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </AdminLayout>
    </>
  );
}
