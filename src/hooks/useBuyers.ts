import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BuyerInsert, BuyerUpdate } from "@/types";
import { archiveRow } from "@/lib/archive";

export function useBuyers() {
  return useQuery({
    queryKey: ["buyers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("buyers").select("*").is("archived_at", null).order("business_name");
      if (error) throw error;
      return data;
    },
  });
}

export function useInsertBuyer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (buyer: BuyerInsert) => {
      const { data, error } = await supabase.from("buyers").insert(buyer).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["buyers"] }),
  });
}

export function useUpdateBuyer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: BuyerUpdate & { id: string }) => {
      const { data, error } = await supabase.from("buyers").update(updates).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["buyers"] }),
  });
}

export function useDeleteBuyer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Archived, not destroyed — a buyer record is a real business we have a
      // relationship with. Restorable from the database if removed in error.
      const { error } = await archiveRow("buyers", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["buyers"] }),
  });
}
