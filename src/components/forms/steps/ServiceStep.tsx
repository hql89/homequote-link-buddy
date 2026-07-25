import { UseFormReturn } from "react-hook-form";
import { getServiceTypes, URGENCY_LEVELS } from "@/lib/constants";
import type { VerticalKey } from "@/lib/constants";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { LeadFormValues } from "../leadFormSchema";

interface ServiceStepProps {
  form: UseFormReturn<LeadFormValues>;
  vertical: VerticalKey | string;
  /**
   * Service options for the selected category, supplied by the caller when the
   * category comes from the `verticals` table. Without this the list falls back
   * to the hardcoded VERTICALS map, which only knows tree service — so a
   * homeowner picking "Plumbing" would be offered stump grinding.
   */
  serviceTypes?: readonly string[];
  stepRef: React.RefObject<HTMLDivElement | null>;
}

export function ServiceStep({ form, vertical, serviceTypes, stepRef }: ServiceStepProps) {
  const options = serviceTypes?.length ? serviceTypes : getServiceTypes(vertical);

  return (
    <div className="space-y-4" ref={stepRef} tabIndex={-1}>
      <FormField control={form.control} name="service_type" render={({ field }) => (
        <FormItem>
          <FormLabel>What do you need help with? *</FormLabel>
          <Select onValueChange={field.onChange} value={field.value}>
            <FormControl><SelectTrigger><SelectValue placeholder="Select service" /></SelectTrigger></FormControl>
            <SelectContent>
              {options.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )} />

      <FormField control={form.control} name="urgency" render={({ field }) => (
        <FormItem>
          <FormLabel>How urgent is this? *</FormLabel>
          <Select onValueChange={field.onChange} value={field.value}>
            <FormControl><SelectTrigger><SelectValue placeholder="How urgent?" /></SelectTrigger></FormControl>
            <SelectContent>
              {URGENCY_LEVELS.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )} />
    </div>
  );
}
