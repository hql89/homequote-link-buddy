import { useState } from "react";
import { useBuyers, useInsertBuyer, useUpdateBuyer, useDeleteBuyer } from "@/hooks/useBuyers";
import { supabase } from "@/integrations/supabase/client";
import { PageMeta } from "@/components/PageMeta";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { VERTICALS } from "@/lib/constants";
import type { Buyer, BuyerInsert } from "@/types";

const emptyBuyer: BuyerInsert = {
  business_name: "", contact_name: "", email: "", phone: "",
  service_areas: [], supported_service_types: [], daily_lead_cap: undefined, notes: "", vertical: "plumbing",
};

export default function BuyersPage() {
  const { data: buyers, isLoading } = useBuyers();
  const insertBuyer = useInsertBuyer();
  const updateBuyer = useUpdateBuyer();
  const deleteBuyer = useDeleteBuyer();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBuyer, setEditingBuyer] = useState<Partial<Buyer> & BuyerInsert>(emptyBuyer);
  const [isEditing, setIsEditing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; leadCount: number } | null>(null);

  function openNew() {
    setEditingBuyer({ ...emptyBuyer });
    setIsEditing(false);
    setDialogOpen(true);
  }

  function openEdit(buyer: Buyer) {
    setEditingBuyer({ ...buyer });
    setIsEditing(true);
    setDialogOpen(true);
  }

  async function handleSave() {
    try {
      if (isEditing && "id" in editingBuyer && editingBuyer.id) {
        await updateBuyer.mutateAsync({ id: editingBuyer.id, ...editingBuyer });
      } else {
        await insertBuyer.mutateAsync(editingBuyer as BuyerInsert);
      }
      setDialogOpen(false);
      toast({ title: isEditing ? "Buyer updated" : "Buyer created" });
    } catch (error: unknown) {
      if (error instanceof Error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    }
  }

  async function handleDeleteClick(buyer: Buyer) {
    try {
      const { count, error } = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("assigned_buyer_id", buyer.id);
      if (error) throw error;
      setDeleteTarget({ id: buyer.id, name: buyer.business_name, leadCount: count ?? 0 });
    } catch (error: unknown) {
      if (error instanceof Error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await deleteBuyer.mutateAsync(deleteTarget.id);
      toast({ title: "Buyer deleted" });
    } catch (error: unknown) {
      if (error instanceof Error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    }
    setDeleteTarget(null);
  }

  return (
    <>
      <PageMeta title="Buyers | Admin" description="Manage buyer accounts." />
      <AdminLayout>
        <div className="flex items-start justify-between gap-4 mb-2">
          <h1 className="text-2xl font-bold font-sans">Buyers</h1>
          <Button onClick={openNew} className="gap-2"><Plus className="h-4 w-4" /> Add Buyer</Button>
        </div>
        <p className="mb-6 max-w-3xl text-sm text-muted-foreground">
          Contractors who receive leads from the site. A buyer must exist here before any lead can be
          assigned to them, and their email address is where lead notifications are sent — so check it
          carefully when adding one.
        </p>

        {isLoading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Business Name</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                   <TableHead>Vertical</TableHead>
                   <TableHead>Active</TableHead>
                   <TableHead>Cap</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {buyers?.map((buyer) => (
                  <TableRow key={buyer.id}>
                    <TableCell className="font-medium">{buyer.business_name}</TableCell>
                    <TableCell>{buyer.contact_name}</TableCell>
                    <TableCell className="text-sm">{buyer.email}</TableCell>
                    <TableCell className="text-sm">{buyer.phone}</TableCell>
                    <TableCell className="text-sm capitalize">{buyer.vertical}</TableCell>
                    <TableCell>{buyer.is_active ? "✓" : "—"}</TableCell>
                    <TableCell>{buyer.daily_lead_cap ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(buyer)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDeleteClick(buyer)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(!buyers || buyers.length === 0) && (
                  <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">No buyers yet.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{isEditing ? "Edit Buyer" : "Add Buyer"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div><Label>Business Name *</Label><Input value={editingBuyer.business_name} onChange={(e) => setEditingBuyer({ ...editingBuyer, business_name: e.target.value })} /></div>
              <div><Label>Contact Name *</Label><Input value={editingBuyer.contact_name} onChange={(e) => setEditingBuyer({ ...editingBuyer, contact_name: e.target.value })} /></div>
              <div><Label>Email *</Label><Input type="email" value={editingBuyer.email} onChange={(e) => setEditingBuyer({ ...editingBuyer, email: e.target.value })} /></div>
              <div><Label>Phone *</Label><Input value={editingBuyer.phone} onChange={(e) => setEditingBuyer({ ...editingBuyer, phone: e.target.value })} /></div>
              <div><Label>Daily Lead Cap</Label><Input type="number" value={editingBuyer.daily_lead_cap ?? ""} onChange={(e) => setEditingBuyer({ ...editingBuyer, daily_lead_cap: e.target.value ? parseInt(e.target.value) : undefined })} /></div>
              <div><Label>Service Areas (comma-separated)</Label><Input value={(editingBuyer.service_areas || []).join(", ")} onChange={(e) => setEditingBuyer({ ...editingBuyer, service_areas: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })} /></div>
              <div><Label>Service Types (comma-separated)</Label><Input value={(editingBuyer.supported_service_types || []).join(", ")} onChange={(e) => setEditingBuyer({ ...editingBuyer, supported_service_types: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })} /></div>
              <div>
                <Label>Vertical</Label>
                <Select value={editingBuyer.vertical || "plumbing"} onValueChange={(v) => setEditingBuyer({ ...editingBuyer, vertical: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(VERTICALS).map(([key, v]) => <SelectItem key={key} value={key}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Notes</Label><Textarea value={editingBuyer.notes || ""} onChange={(e) => setEditingBuyer({ ...editingBuyer, notes: e.target.value })} /></div>
              <div className="flex items-center gap-2">
                <Switch checked={editingBuyer.is_active ?? true} onCheckedChange={(v) => setEditingBuyer({ ...editingBuyer, is_active: v })} />
                <Label>Active</Label>
              </div>
              <Button onClick={handleSave} className="w-full">{isEditing ? "Update" : "Create"} Buyer</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Delete confirmation dialog */}
        <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete "{deleteTarget?.name}"?</AlertDialogTitle>
              <AlertDialogDescription>
                {deleteTarget && deleteTarget.leadCount > 0
                  ? `This buyer has ${deleteTarget.leadCount} lead${deleteTarget.leadCount !== 1 ? "s" : ""} assigned. Deleting will unassign those leads. This cannot be undone.`
                  : "Delete this buyer? This cannot be undone."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </AdminLayout>
    </>
  );
}
