import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Camera, Loader2, Trash2, ArrowUp, ArrowDown, Clock, CheckCircle2, XCircle } from "lucide-react";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

interface ManagedPhoto {
  id: string;
  url: string;
  caption: string | null;
  sort_order: number;
  status: "pending" | "approved" | "rejected";
}

async function callPhotoFn(body: FormData | Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("manage-business-photos", { body });
  if (error || !data?.success) {
    throw new Error(data?.error ?? error?.message ?? "That didn't work — try again.");
  }
  return data;
}

function StatusBadge({ status }: { status: ManagedPhoto["status"] }) {
  if (status === "approved") {
    return (
      <Badge className="gap-1 bg-green-600 hover:bg-green-600">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
        Live
      </Badge>
    );
  }
  if (status === "rejected") {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" aria-hidden="true" />
        Not approved
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1">
      <Clock className="h-3 w-3" aria-hidden="true" />
      Awaiting review
    </Badge>
  );
}

/**
 * Photo management for a claimed listing. The `token` is the same
 * claim_token the owner used to claim the listing in the first place — there
 * is no login system for a claimed listing's owner, so this reuses that same
 * credential rather than requiring one. See manage-business-photos for the
 * server-side trust model.
 */
export function BusinessPhotoManager({ token }: { token: string }) {
  const [photos, setPhotos] = useState<ManagedPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await callPhotoFn({ action: "list", token });
      setPhotos((data.photos as ManagedPhoto[]) ?? []);
    } catch (err) {
      toast({
        title: "Couldn't load your photos",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file after an error
    if (!file) return;

    if (!ALLOWED_TYPES.has(file.type)) {
      toast({ title: "Unsupported file", description: "Use a JPEG, PNG, or WEBP image.", variant: "destructive" });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast({ title: "Photo is too large", description: "5MB maximum.", variant: "destructive" });
      return;
    }
    if (photos.length >= 12) {
      toast({ title: "Photo limit reached", description: "Delete one to add another.", variant: "destructive" });
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.set("action", "upload");
      form.set("token", token);
      form.set("file", file);
      await callPhotoFn(form);
      toast({ title: "Photo uploaded", description: "It'll appear on your listing once approved." });
      await load();
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(photoId: string) {
    setBusyId(photoId);
    try {
      await callPhotoFn({ action: "delete", token, photo_id: photoId });
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    } catch (err) {
      toast({
        title: "Couldn't delete that photo",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function handleMove(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= photos.length) return;

    const reordered = [...photos];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setPhotos(reordered); // optimistic — reorder reads as instant, not a round trip

    try {
      await callPhotoFn({ action: "reorder", token, photo_ids: reordered.map((p) => p.id) });
    } catch (err) {
      toast({
        title: "Couldn't save that order",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
      await load(); // fall back to the server's actual order
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Camera className="h-5 w-5 text-accent" aria-hidden="true" />
          Photos
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Photos of your work replace the generated icon on your listing. New photos are
          reviewed before they go live — usually within a day.
        </p>

        {loading ? (
          <div className="mt-4 flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
        ) : (
          <>
            {photos.length > 0 && (
              <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {photos.map((photo, i) => (
                  <li key={photo.id} className="group relative overflow-hidden rounded-lg border border-border">
                    <img
                      src={photo.url}
                      alt={photo.caption ?? "Uploaded photo of completed work"}
                      className="aspect-square w-full object-cover"
                    />
                    <div className="absolute left-1 top-1">
                      <StatusBadge status={photo.status} />
                    </div>
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/70 to-transparent p-1.5">
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="secondary"
                          className="h-6 w-6"
                          disabled={i === 0}
                          onClick={() => handleMove(i, -1)}
                          aria-label="Move earlier"
                        >
                          <ArrowUp className="h-3 w-3" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="secondary"
                          className="h-6 w-6"
                          disabled={i === photos.length - 1}
                          onClick={() => handleMove(i, 1)}
                          aria-label="Move later"
                        >
                          <ArrowDown className="h-3 w-3" aria-hidden="true" />
                        </Button>
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="destructive"
                        className="h-6 w-6"
                        disabled={busyId === photo.id}
                        onClick={() => handleDelete(photo.id)}
                        aria-label="Delete photo"
                      >
                        {busyId === photo.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                        ) : (
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                        )}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleFileSelected}
              />
              <Button
                type="button"
                variant="outline"
                disabled={uploading || photos.length >= 12}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Uploading…</>
                ) : (
                  <><Camera className="mr-2 h-4 w-4" aria-hidden="true" />Add a photo</>
                )}
              </Button>
              <p className="mt-1 text-xs text-muted-foreground">
                JPEG, PNG, or WEBP, up to 5MB. {photos.length}/12 used.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
