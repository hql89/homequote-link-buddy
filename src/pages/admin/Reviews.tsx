import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { archiveRow } from "@/lib/archive";
import { format } from "date-fns";
import { CheckCircle, Trash2, XCircle } from "lucide-react";

interface ReviewWithBuyer {
  id: string;
  reviewer_user_id: string;
  buyer_id: string;
  rating: number;
  review_text: string | null;
  buyer_response: string | null;
  is_verified: boolean;
  created_at: string;
  buyers: {
    business_name: string;
  } | null;
}

export default function Reviews() {
  const [ratingFilter, setRatingFilter] = useState<string>("all");
  const queryClient = useQueryClient();

  const { data: reviews, isLoading, isError, error } = useQuery({
    queryKey: ["admin-reviews"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reviews")
        .select("*, buyers(business_name)")
        // Archived rows are removed from view but never destroyed — see src/lib/archive.ts
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ReviewWithBuyer[];
    },
  });

  const { data: homeowners } = useQuery({
    queryKey: ["admin-homeowners-map"],
    queryFn: async () => {
      const { data, error } = await supabase.from("homeowner_profiles").select("user_id, full_name, email");
      if (error) throw error;
      return new Map(data.map((h) => [h.user_id, h]));
    },
  });

  const toggleVerified = useMutation({
    mutationFn: async ({ id, verified }: { id: string; verified: boolean }) => {
      const { error } = await supabase.from("reviews").update({ is_verified: verified }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-reviews"] });
      toast({ title: "Review updated" });
    },
  });

  const deleteReview = useMutation({
    mutationFn: async (id: string) => {
      // Archived rather than destroyed: a review is someone's words about a
      // business, and removing it is a moderation decision worth being able
      // to review and reverse.
      const { error } = await archiveRow("reviews", id, "removed by admin");
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-reviews"] });
      toast({ title: "Review deleted" });
    },
  });

  const filtered = reviews?.filter((r) => {
    if (ratingFilter !== "all" && r.rating !== parseInt(ratingFilter)) return false;
    return true;
  });

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-foreground">Reviews</h1>
            {!isError && <Badge variant="secondary">{reviews?.length ?? 0} total</Badge>}
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Feedback homeowners left after a job. Reviews are collected by the automated follow-up email
            sent a few days after a lead is submitted.
          </p>
        </div>

        <div className="flex gap-2">
          <Select value={ratingFilter} onValueChange={setRatingFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Filter by rating" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ratings</SelectItem>
              {[5, 4, 3, 2, 1].map((r) => (
                <SelectItem key={r} value={String(r)}>{r} star{r > 1 ? "s" : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reviewer</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead>Review</TableHead>
                <TableHead>Response</TableHead>
                <TableHead>Verified</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
              ) : isError ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center">
                    <p className="font-medium text-destructive">Couldn't load reviews</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {(error as Error)?.message}
                    </p>
                  </TableCell>
                </TableRow>
              ) : filtered?.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No reviews</TableCell></TableRow>
              ) : (
                filtered?.map((r) => {
                  const reviewer = homeowners?.get(r.reviewer_user_id);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{reviewer?.full_name || reviewer?.email || r.reviewer_user_id.slice(0, 8)}</TableCell>
                      <TableCell>{r.buyers?.business_name || "—"}</TableCell>
                      <TableCell>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{r.review_text || "—"}</TableCell>
                      <TableCell>{r.buyer_response ? <Badge variant="outline">Yes</Badge> : "—"}</TableCell>
                      <TableCell>
                        {r.is_verified ? (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        ) : (
                          <XCircle className="h-4 w-4 text-muted-foreground" />
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.created_at ? format(new Date(r.created_at), "MMM d, yyyy") : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => toggleVerified.mutate({ id: r.id, verified: !r.is_verified })}
                            title={r.is_verified ? "Unverify" : "Verify"}
                          >
                            <CheckCircle className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete review?</AlertDialogTitle>
                                <AlertDialogDescription>This removes it from the site. The record is archived, not destroyed, and can be restored.</AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteReview.mutate(r.id)}>Delete</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </AdminLayout>
  );
}
