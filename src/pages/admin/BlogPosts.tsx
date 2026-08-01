import { useState, useCallback, useEffect, useRef } from "react";
import { PageMeta } from "@/components/PageMeta";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { archiveRow } from "@/lib/archive";
import { Loader2, Plus, Pencil, Trash2, ExternalLink, FileText, Sparkles, ImageIcon, Wand2, Calendar, Save, History, RotateCcw, Crop } from "lucide-react";
import { format } from "date-fns";
import { RichTextEditor } from "@/components/admin/RichTextEditor";
import { AIWriterPanel } from "@/components/admin/AIWriterPanel";
import { AIImageModal } from "@/components/admin/AIImageModal";
import { ImageCropper } from "@/components/admin/ImageCropper";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Post {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  featured_image_url: string | null;
  status: string;
  source: string;
  tags: string[] | null;
  category: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  external_id: string | null;
  meta_title: string | null;
  meta_description: string | null;
  canonical_url: string | null;
  og_image_width: number | null;
  og_image_height: number | null;
  twitter_card_type: string | null;
}

interface PostForm {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  featured_image_url: string;
  status: string;
  tags: string;
  category: string;
  scheduled_at: string;
  meta_title: string;
  meta_description: string;
  canonical_url: string;
  og_image_width: string;
  og_image_height: string;
  twitter_card_type: string;
}

const DEFAULT_FORM: PostForm = {
  title: "",
  slug: "",
  excerpt: "",
  content: "",
  featured_image_url: "",
  status: "draft",
  tags: "",
  category: "",
  scheduled_at: "",
  meta_title: "",
  meta_description: "",
  canonical_url: "",
  og_image_width: "",
  og_image_height: "",
  twitter_card_type: "summary_large_image",
};

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

import { BlogPostTable } from "./blog/BlogPostTable";
import { BlogPostDialog } from "./blog/BlogPostDialog";

export default function BlogPostsPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PostForm>(DEFAULT_FORM);
  const [showVersions, setShowVersions] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>("");

  // Autosave drafts every 30s while editing
  useEffect(() => {
    if (!dialogOpen || !editingId) return;
    if (form.status !== "draft") return;

    const formKey = JSON.stringify(form);
    if (formKey === lastSavedRef.current) return;

    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async () => {
      if (!form.title.trim() || !form.content.trim()) return;
      setAutosaveStatus("saving");
      try {
        const tagsArray = form.tags ? form.tags.split(",").map(t => t.trim()).filter(Boolean) : null;
        await supabase.from("posts").update({
          title: form.title,
          slug: form.slug,
          excerpt: form.excerpt || null,
          content: form.content,
          featured_image_url: form.featured_image_url || null,
          tags: tagsArray,
          category: form.category || null,
        }).eq("id", editingId);
        lastSavedRef.current = formKey;
        setAutosaveStatus("saved");
        setTimeout(() => setAutosaveStatus("idle"), 2000);
      } catch {
        setAutosaveStatus("idle");
      }
    }, 30000);

    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); };
  }, [form, dialogOpen, editingId]);

  const { data: posts, isLoading } = useQuery({
    queryKey: ["admin_posts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("posts")
        .select("*")
        // Archived rows are removed from view but never destroyed — see src/lib/archive.ts
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Post[];
    },
  });

  // Fetch versions for current post
  const { data: versions, refetch: refetchVersions } = useQuery({
    queryKey: ["post_versions", editingId],
    enabled: !!editingId && showVersions,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("post_versions")
        .select("*")
        .eq("post_id", editingId!)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data;
    },
  });

  async function saveVersionSnapshot(postId: string, currentForm: PostForm) {
    const { data: session } = await supabase.auth.getSession();
    const tagsArray = currentForm.tags ? currentForm.tags.split(",").map(t => t.trim()).filter(Boolean) : null;
    await supabase.from("post_versions").insert({
      post_id: postId,
      title: currentForm.title,
      content: currentForm.content,
      excerpt: currentForm.excerpt || null,
      featured_image_url: currentForm.featured_image_url || null,
      tags: tagsArray,
      category: currentForm.category || null,
      saved_by: session?.session?.user?.id || null,
    });
  }

  const saveMutation = useMutation({
    mutationFn: async (values: PostForm & { id?: string }) => {
      const tagsArray = values.tags ? values.tags.split(",").map(t => t.trim()).filter(Boolean) : null;
      const payload: Partial<Post> = {
        title: values.title,
        slug: values.slug,
        excerpt: values.excerpt || null,
        content: values.content,
        featured_image_url: values.featured_image_url || null,
        status: values.status,
        tags: tagsArray,
        category: values.category || null,
        scheduled_at: values.status === "scheduled" && values.scheduled_at ? values.scheduled_at : null,
        published_at: values.status === "published" ? new Date().toISOString() : null,
        meta_title: values.meta_title || null,
        meta_description: values.meta_description || null,
        canonical_url: values.canonical_url || null,
        og_image_width: values.og_image_width ? parseInt(values.og_image_width) : null,
        og_image_height: values.og_image_height ? parseInt(values.og_image_height) : null,
        twitter_card_type: values.twitter_card_type || "summary_large_image",
      };

      if (values.id) {
        await saveVersionSnapshot(values.id, values);
        const { error } = await supabase.from("posts").update(payload).eq("id", values.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("posts").insert({
          ...payload,
          source: "native",
          slug: payload.slug || "",
          title: payload.title || "",
          content: payload.content || "",
        }).select("id").single();
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_posts"] });
      if (editingId) refetchVersions();
      toast({ title: editingId ? "Post updated" : "Post created" });
      closeDialog();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Archived, not destroyed — published posts may have inbound links and
      // search rankings, so removal needs to be reversible.
      const { error } = await archiveRow("posts", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_posts"] });
      toast({ title: "Post deleted" });
      setDeleteId(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function restoreVersion(version: { title: string; content: string; excerpt?: string | null; featured_image_url?: string | null; tags?: string[] | null; category?: string | null }) {
    setForm(prev => ({
      ...prev,
      title: version.title,
      content: version.content,
      excerpt: version.excerpt || "",
      featured_image_url: version.featured_image_url || "",
      tags: version.tags?.join(", ") || "",
      category: version.category || "",
    }));
    setShowVersions(false);
    toast({ title: "Version restored", description: "Review the changes and save when ready." });
  }

  function openCreate() {
    setEditingId(null);
    setForm(DEFAULT_FORM);
    setDialogOpen(true);
  }

  function openEdit(post: Post) {
    setEditingId(post.id);
    setForm({
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt || "",
      content: post.content,
      featured_image_url: post.featured_image_url || "",
      status: post.status,
      tags: post.tags?.join(", ") || "",
      category: post.category || "",
      scheduled_at: post.scheduled_at || "",
      meta_title: post.meta_title || "",
      meta_description: post.meta_description || "",
      canonical_url: post.canonical_url || "",
      og_image_width: post.og_image_width?.toString() || "",
      og_image_height: post.og_image_height?.toString() || "",
      twitter_card_type: post.twitter_card_type || "summary_large_image",
    });
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingId(null);
    setForm(DEFAULT_FORM);
    setShowVersions(false);
  }

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      </AdminLayout>
    );
  }

  return (
    <>
      <PageMeta title="Blog Posts | Admin" description="Manage blog posts." />
      <AdminLayout>
        <div className="flex items-start justify-between gap-4 mb-2">
          <h1 className="text-2xl font-bold font-sans">Blog Posts</h1>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" /> New Post
          </Button>
        </div>
        <p className="mb-6 max-w-3xl text-sm text-muted-foreground">
          Articles on the public site. Drafts stay private until published, and a post given a future
          publish date goes live on its own via the scheduled job in Settings.
        </p>

        {!posts?.length ? (
          <div className="text-center py-16 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-40" />
            <p className="text-lg font-medium">No blog posts yet</p>
            <p className="text-sm mt-1">Create your first post or connect ContentFlow to auto-publish.</p>
          </div>
        ) : (
          <BlogPostTable
            posts={posts}
            onEdit={openEdit}
            onDelete={setDeleteId}
          />
        )}

        <BlogPostDialog
          open={dialogOpen}
          onClose={closeDialog}
          editingId={editingId}
          form={form}
          setForm={setForm}
          onSave={() => saveMutation.mutate({ ...form, id: editingId || undefined })}
          isSaving={saveMutation.isPending}
          autosaveStatus={autosaveStatus}
          versions={versions}
          onRestoreVersion={restoreVersion}
          showVersions={showVersions}
          setShowVersions={setShowVersions}
        />

        {/* Delete Confirmation */}
        <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this post?</AlertDialogTitle>
              <AlertDialogDescription>This removes it from the site. The record is archived, not destroyed, and can be restored.</AlertDialogDescription>
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
