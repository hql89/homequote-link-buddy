import { useState } from "react";
import { useVerticals, useUpdateVertical, useInsertVertical, useDeleteVertical } from "@/hooks/useVerticals";
import type { Vertical } from "@/hooks/useVerticals";
import { PageMeta } from "@/components/PageMeta";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";

const emptyVertical = {
  slug: "",
  label: "",
  professional_label: "professional",
  professional_label_plural: "professionals",
  service_types: [] as string[],
  is_active: true,
  sort_order: 0,
  icon_name: "",
  hero_title: "",
  hero_description: "",
  meta_title: "",
  meta_description: "",
};

export default function VerticalsPage() {
  const { data: verticals, isLoading } = useVerticals();
  const updateVertical = useUpdateVertical();
  const insertVertical = useInsertVertical();
  const deleteVertical = useDeleteVertical();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Vertical> & typeof emptyVertical>(emptyVertical);
  const [isEditing, setIsEditing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Vertical | null>(null);

  function openNew() {
    setEditing({ ...emptyVertical, sort_order: (verticals?.length ?? 0) + 1 });
    setIsEditing(false);
    setDialogOpen(true);
  }

  function openEdit(v: Vertical) {
    setEditing({ ...v });
    setIsEditing(true);
    setDialogOpen(true);
  }

  async function handleSave() {
    try {
      if (isEditing && editing.id) {
        await updateVertical.mutateAsync(editing);
      } else {
        const { id, created_at, updated_at, ...rest } = editing;
        await insertVertical.mutateAsync(rest);
      }
      setDialogOpen(false);
      toast({ title: isEditing ? "Vertical updated" : "Vertical created" });
    } catch (error: unknown) {
      toast({ title: "Error", description: (error as Error).message, variant: "destructive" });
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await deleteVertical.mutateAsync(deleteTarget.id);
      toast({ title: "Vertical deleted" });
    } catch (error: unknown) {
      toast({ title: "Error", description: (error as Error).message, variant: "destructive" });
    }
    setDeleteTarget(null);
  }

  return (
    <>
      <PageMeta title="Verticals | Admin" description="Manage service verticals." />
      <AdminLayout>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold font-sans">Service Verticals</h1>
            <p className="text-sm text-muted-foreground">Manage the service categories available on the site.</p>
          </div>
          <Button onClick={openNew} className="gap-2"><Plus className="h-4 w-4" /> Add Vertical</Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Service Types</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {verticals?.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="text-sm">{v.sort_order}</TableCell>
                    <TableCell className="font-medium">{v.label}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{v.slug}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {v.service_types.slice(0, 3).map((s) => (
                          <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
                        ))}
                        {v.service_types.length > 3 && (
                          <Badge variant="outline" className="text-xs">+{v.service_types.length - 3}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{v.is_active ? "✓" : "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(v)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(v)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(!verticals || verticals.length === 0) && (
                  <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">No verticals configured.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{isEditing ? "Edit Vertical" : "Add Vertical"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div><Label>Label *</Label><Input value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} placeholder="HVAC / AC" /></div>
                <div><Label>Slug *</Label><Input value={editing.slug} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} placeholder="hvac" /></div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div><Label>Professional Label</Label><Input value={editing.professional_label} onChange={(e) => setEditing({ ...editing, professional_label: e.target.value })} placeholder="plumber" /></div>
                <div><Label>Professional Plural</Label><Input value={editing.professional_label_plural} onChange={(e) => setEditing({ ...editing, professional_label_plural: e.target.value })} placeholder="plumbers" /></div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div><Label>Icon Name</Label><Input value={editing.icon_name || ""} onChange={(e) => setEditing({ ...editing, icon_name: e.target.value })} placeholder="Droplets" /></div>
                <div><Label>Sort Order</Label><Input type="number" value={editing.sort_order} onChange={(e) => setEditing({ ...editing, sort_order: parseInt(e.target.value) || 0 })} /></div>
              </div>
              <div>
                <Label>Service Types (comma-separated) *</Label>
                <Input
                  value={(editing.service_types || []).join(", ")}
                  onChange={(e) => setEditing({ ...editing, service_types: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })}
                  placeholder="AC Repair, Furnace Install, ..."
                />
              </div>
              <div><Label>Hero Title</Label><Input value={editing.hero_title || ""} onChange={(e) => setEditing({ ...editing, hero_title: e.target.value })} /></div>
              <div><Label>Hero Description</Label><Textarea value={editing.hero_description || ""} onChange={(e) => setEditing({ ...editing, hero_description: e.target.value })} rows={2} /></div>
              <div><Label>Meta Title</Label><Input value={editing.meta_title || ""} onChange={(e) => setEditing({ ...editing, meta_title: e.target.value })} /></div>
              <div><Label>Meta Description</Label><Input value={editing.meta_description || ""} onChange={(e) => setEditing({ ...editing, meta_description: e.target.value })} /></div>
              <div className="flex items-center gap-2">
                <Switch checked={editing.is_active ?? true} onCheckedChange={(v) => setEditing({ ...editing, is_active: v })} />
                <Label>Active</Label>
              </div>
              <Button onClick={handleSave} className="w-full">{isEditing ? "Update" : "Create"} Vertical</Button>
            </div>
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete "{deleteTarget?.label}"?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove this vertical from the site. Existing leads with this vertical will still be accessible. This cannot be undone.
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
