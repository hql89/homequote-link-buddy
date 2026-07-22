import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Database } from "@/integrations/supabase/types";

export type Vertical = Database["public"]["Tables"]["verticals"]["Row"];

export function useVerticals() {
  return useQuery({
    queryKey: ["verticals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("verticals")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data as Vertical[];
    },
  });
}

export function useActiveVerticals() {
  return useQuery({
    queryKey: ["verticals", "active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("verticals")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data as Vertical[];
    },
    staleTime: 5 * 60 * 1000, // cache for 5 min
  });
}

export function useUpdateVertical() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Vertical> & { id: string }) => {
      const { data, error } = await supabase
        .from("verticals")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as Vertical;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["verticals"] });
    },
  });
}

export function useInsertVertical() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vertical: Omit<Vertical, "id" | "created_at" | "updated_at">) => {
      const { data, error } = await supabase
        .from("verticals")
        .insert(vertical)
        .select()
        .single();
      if (error) throw error;
      return data as Vertical;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["verticals"] });
    },
  });
}

export function useDeleteVertical() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("verticals")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["verticals"] });
    },
  });
}
