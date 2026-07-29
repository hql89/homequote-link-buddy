import { useState, useEffect, useCallback } from "react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { PageMeta } from "@/components/PageMeta";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { HelpTip } from "@/components/admin/HelpTip";
import { directoryDb, setBusinessPhotoStatus, type BusinessPhotoRow } from "@/integrations/supabase/directory";
import { Loader2, Check, X, ImageOff } from "lucide-react";

interface PendingPhoto extends BusinessPhotoRow {
  url: string;
  business_name: string;
  city: string;
}

export default function PhotoModerationPage() {
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);

    const { data: photoRows, error: photoErr } = await directoryDb
      .from("business_photos")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (photoErr) {
      toast({ title: "Couldn't load photos", description: photoErr.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    const rows = (photoRows ?? []) as BusinessPhotoRow[];
    const businessIds = [...new Set(rows.map((p) => p.business_id))];

    // Two queries rather than a nested select: the hand-typed directoryDb
    // client doesn't model PostgREST's embedded-resource joins, and the
    // straightforward version reads fine at moderation-queue volume.
    const businessNames = new Map<string, { business_name: string; city: string }>();
    if (businessIds.length > 0) {
      const { data: bizRows } = await directoryDb
        .from("businesses")
        .select("id, business_name, city")
        .in("id", businessIds);
      for (const b of (bizRows ?? []) as { id: string; business_name: string; city: string }[]) {
        businessNames.set(b.id, { business_name: b.business_name, city: b.city });
      }
    }

    setPhotos(
      rows.map((p) => ({
        ...p,
        url: directoryDb.storage.from("business-photos").getPublicUrl(p.storage_path).data.publicUrl,
        business_name: businessNames.get(p.business_id)?.business_name ?? "Unknown business",
        city: businessNames.get(p.business_id)?.city ?? "",
      })),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function moderate(photoId: string, status: "approved" | "rejected") {
    setBusyId(photoId);
    const error = await setBusinessPhotoStatus(photoId, status);
    if (error) {
      toast({ title: "That didn't save", description: error.message, variant: "destructive" });
    } else {
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
      toast({ title: status === "approved" ? "Photo approved" : "Photo rejected" });
    }
    setBusyId(null);
  }

  return (
    <AdminLayout>
      <PageMeta title="Photo Moderation | Admin" description="Review photos uploaded by claimed listings." />
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold font-sans">Photo Moderation</h1>
          {photos.length > 0 && <Badge variant="secondary">{photos.length} pending</Badge>}
          <HelpTip>
            A claimed listing's owner can upload photos of their work at any time — the only
            credential is the same link that let them claim the listing. Nothing they upload goes
            public until you approve it here.
          </HelpTip>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Approving replaces the generated icon on their listing with these photos. Rejecting
          keeps the icon and removes the photo from their manage page — the owner is not
          notified either way.
        </p>

        {loading ? (
          <div className="mt-10 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
        ) : photos.length === 0 ? (
          <div className="mt-10 flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <ImageOff className="h-8 w-8" aria-hidden="true" />
            <p className="text-sm">Nothing waiting for review.</p>
          </div>
        ) : (
          <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {photos.map((photo) => (
              <li key={photo.id} className="overflow-hidden rounded-lg border border-border bg-card">
                <img src={photo.url} alt={photo.caption ?? photo.business_name} className="aspect-video w-full object-cover" />
                <div className="p-3">
                  <p className="truncate text-sm font-medium">{photo.business_name}</p>
                  <p className="text-xs text-muted-foreground">{photo.city}</p>
                  {photo.caption && <p className="mt-1 text-xs text-muted-foreground">"{photo.caption}"</p>}
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1 gap-1"
                      disabled={busyId === photo.id}
                      onClick={() => moderate(photo.id, "approved")}
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 gap-1"
                      disabled={busyId === photo.id}
                      onClick={() => moderate(photo.id, "rejected")}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                      Reject
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminLayout>
  );
}
