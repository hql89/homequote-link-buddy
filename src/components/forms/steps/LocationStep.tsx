import { UseFormReturn } from "react-hook-form";
import { SFV_CITIES } from "@/lib/constants";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { LeadFormValues } from "../leadFormSchema";

interface LocationStepProps {
  form: UseFormReturn<LeadFormValues>;
  stepRef: React.RefObject<HTMLDivElement | null>;
}

export function LocationStep({ form, stepRef }: LocationStepProps) {
  return (
    <div className="space-y-4" ref={stepRef} tabIndex={-1}>
      <FormField control={form.control} name="city" render={({ field }) => (
        <FormItem>
          <FormLabel>City *</FormLabel>
          <Select onValueChange={field.onChange} value={field.value}>
            <FormControl><SelectTrigger><SelectValue placeholder="Select city" /></SelectTrigger></FormControl>
            <SelectContent>
              {SFV_CITIES.map((city) => (
                <SelectItem key={city} value={city}>
                  {city}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )} />

      {form.watch("city") === "Other / Outside SCV" && (
        <p className="text-sm text-muted-foreground bg-muted rounded-md p-3">
          We're currently focused on the Santa Clarita Valley but expanding soon. Submit your request and we'll do our best to help or point you in the right direction.
        </p>
      )}

      <FormField control={form.control} name="zip_code" render={({ field }) => (
        <FormItem>
          <FormLabel>ZIP Code *</FormLabel>
          <FormControl><Input placeholder="91354" {...field} /></FormControl>
          <FormMessage />
        </FormItem>
      )} />
    </div>
  );
}
