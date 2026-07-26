import { useState } from "react";
import { PageMeta } from "@/components/PageMeta";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { Loader2, Trash2, Search, Image as ImageIcon, Copy } from "lucide-react";
import { format } from "date-fns";

interface MediaAsset {
  id: string;
  url: string;
  thumbnail_url: string | null;
  type: string;
  alt_text: string | null;
  title: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

export default function MediaLibraryPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [previewAsset, setPreviewAsset] = useState<MediaAsset | null>(null);

  const { data: assets, isLoading } = useQuery({
    queryKey: ["media_assets", search],
    queryFn: async () => {
      let query = supabase
        .from("media_assets")
        .select("*")
        .order("created_at", { ascending: false });

      if (search.trim()) {
        query = query.or(`title.ilike.%${search}%,alt_text.ilike.%${search}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as MediaAsset[];
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("media_assets").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["media_assets"] });
      toast({ title: "Asset deleted" });
      setDeleteId(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "URL copied to clipboard" });
    } catch {
      toast({ title: "Failed to copy", description: "Clipboard access was denied.", variant: "destructive" });
    }
  }

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <>
      <PageMeta title="Media Library | Admin" description="Manage media assets." />
      <AdminLayout>
        <div className="mb-6">
          <h1 className="text-2xl font-bold font-sans">Media Library</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Every image uploaded for the site, shared across all blog posts and pages. Deleting one here
            removes it everywhere it is used, so check where it appears before removing it.
          </p>
        </div>

        <div className="relative mb-6 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title or alt text…"
            className="pl-9"
          />
        </div>

        {!assets?.length ? (
          <div className="text-center py-16 text-muted-foreground">
            <ImageIcon className="h-12 w-12 mx-auto mb-3 opacity-40" />
            <p className="text-lg font-medium">No media assets yet</p>
            <p className="text-sm mt-1">Generate images with AI from the blog editor to populate your library.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {assets.map((asset) => (
              <div key={asset.id} className="group relative rounded-lg border border-border bg-card overflow-hidden">
                <div
                  className="aspect-video bg-muted cursor-pointer"
                  onClick={() => setPreviewAsset(asset)}
                >
                  <img
                    src={asset.thumbnail_url || asset.url}
                    alt={asset.alt_text || asset.title || "Media"}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
                <div className="p-2">
                  <p className="text-xs font-medium truncate">{asset.title || "Untitled"}</p>
                  <p className="text-xs text-muted-foreground">{asset.created_at ? format(new Date(asset.created_at), "MMM d, yyyy") : ""}</p>
                </div>
                <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                  <Button variant="secondary" size="icon" className="h-7 w-7" onClick={() => copyUrl(asset.url)}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="destructive" size="icon" className="h-7 w-7" onClick={() => setDeleteId(asset.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Preview Dialog */}
        <Dialog open={!!previewAsset} onOpenChange={(open) => !open && setPreviewAsset(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{previewAsset?.title || "Media Preview"}</DialogTitle>
            </DialogHeader>
            {previewAsset && (
              <div className="space-y-3">
                <img src={previewAsset.url} alt={previewAsset.alt_text || ""} className="w-full rounded-md" />
                {previewAsset.alt_text && <p className="text-sm text-muted-foreground"><strong>Alt text:</strong> {previewAsset.alt_text}</p>}
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => copyUrl(previewAsset.url)} className="gap-1">
                    <Copy className="h-3.5 w-3.5" /> Copy URL
                  </Button>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setPreviewAsset(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this asset?</AlertDialogTitle>
              <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleteId && deleteMutation.mutate(deleteId)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </AdminLayout>
    </>
  );
}
