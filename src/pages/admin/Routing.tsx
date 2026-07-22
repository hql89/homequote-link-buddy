import { useState } from "react";
import { useRoutingSettings, useInsertRoutingSetting, useUpdateRoutingSetting, useDeleteRoutingSetting } from "@/hooks/useRouting";
import { useBuyers } from "@/hooks/useBuyers";
import { PageMeta } from "@/components/PageMeta";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { SFV_CITIES, VERTICALS, getServiceTypes } from "@/lib/constants";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import type { RoutingSetting, RoutingSettingInsert } from "@/types";

const emptyRouting: RoutingSettingInsert = {
  city: "", service_type: "", buyer_id: "", max_daily_leads: undefined,
  after_hours_behavior: "", is_active: true,
};

export default function RoutingPage() {
  const { data: settings, isLoading } = useRoutingSettings();
  const { data: buyers } = useBuyers();
  const insertSetting = useInsertRoutingSetting();
  const updateSetting = useUpdateRoutingSetting();
  const deleteSetting = useDeleteRoutingSetting();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<RoutingSetting> & RoutingSettingInsert>(emptyRouting);
  const [isEditing, setIsEditing] = useState(false);

  function openNew() { setEditing({ ...emptyRouting }); setIsEditing(false); setDialogOpen(true); }
  function openEdit(s: RoutingSetting) { setEditing({ ...s }); setIsEditing(true); setDialogOpen(true); }

  async function handleSave() {
    try {
      if (isEditing && "id" in editing && editing.id) {
        await updateSetting.mutateAsync({ id: editing.id, ...editing });
      } else {
        await insertSetting.mutateAsync(editing as RoutingSettingInsert);
      }
      setDialogOpen(false);
      toast({ title: isEditing ? "Routing updated" : "Routing created" });
    } catch (error: unknown) {
      toast({ title: "Error", description: (error as Error).message, variant: "destructive" });
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this routing rule?")) return;
    try {
      await deleteSetting.mutateAsync(id);
      toast({ title: "Routing rule deleted" });
    } catch (error: unknown) {
      toast({ title: "Error", description: (error as Error).message, variant: "destructive" });
    }
  }

  return (
    <>
      <PageMeta title="Routing | Admin" description="Configure lead routing rules." />
      <AdminLayout>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold font-sans">Routing Settings</h1>
            <p className="text-sm text-muted-foreground">Configuration for future automated routing. Currently informational only.</p>
          </div>
          <Button onClick={openNew} className="gap-2"><Plus className="h-4 w-4" /> Add Rule</Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>City</TableHead>
                  <TableHead>Service Type</TableHead>
                  <TableHead>Buyer</TableHead>
                  <TableHead>Max Daily</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {settings?.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.city}</TableCell>
                    <TableCell>{s.service_type}</TableCell>
                    <TableCell>{(s as RoutingSetting & { buyers?: { business_name: string } }).buyers?.business_name || "—"}</TableCell>
                    <TableCell>{s.max_daily_leads ?? "—"}</TableCell>
                    <TableCell>{s.is_active ? "✓" : "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(s)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(s.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(!settings || settings.length === 0) && (
                  <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">No routing rules yet.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{isEditing ? "Edit Routing Rule" : "Add Routing Rule"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>City *</Label>
                <Select value={editing.city} onValueChange={(v) => setEditing({ ...editing, city: v })}>
                  <SelectTrigger><SelectValue placeholder="Select city" /></SelectTrigger>
                  <SelectContent>{SFV_CITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Service Type *</Label>
                <Select value={editing.service_type} onValueChange={(v) => setEditing({ ...editing, service_type: v })}>
                  <SelectTrigger><SelectValue placeholder="Select service" /></SelectTrigger>
                  <SelectContent>{getServiceTypes(editing.vertical || undefined).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Vertical</Label>
                <Select value={editing.vertical || "plumbing"} onValueChange={(v) => setEditing({ ...editing, vertical: v, service_type: "" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(VERTICALS).map(([key, v]) => <SelectItem key={key} value={key}>{v.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Buyer *</Label>
                <Select value={editing.buyer_id} onValueChange={(v) => setEditing({ ...editing, buyer_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select buyer" /></SelectTrigger>
                  <SelectContent>{buyers?.map((b) => <SelectItem key={b.id} value={b.id}>{b.business_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Max Daily Leads</Label><Input type="number" value={editing.max_daily_leads ?? ""} onChange={(e) => setEditing({ ...editing, max_daily_leads: e.target.value ? parseInt(e.target.value) : undefined })} /></div>
              <div><Label>After Hours Behavior</Label><Input value={editing.after_hours_behavior || ""} onChange={(e) => setEditing({ ...editing, after_hours_behavior: e.target.value })} placeholder="e.g. queue, redirect" /></div>
              <div className="flex items-center gap-2">
                <Switch checked={editing.is_active ?? true} onCheckedChange={(v) => setEditing({ ...editing, is_active: v })} />
                <Label>Active</Label>
              </div>
              <Button onClick={handleSave} className="w-full">{isEditing ? "Update" : "Create"} Rule</Button>
            </div>
          </DialogContent>
        </Dialog>
      </AdminLayout>
    </>
  );
}
