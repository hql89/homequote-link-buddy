import { UseFormReturn } from "react-hook-form";
import { CONTACT_METHODS } from "@/lib/constants";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import type { LeadFormValues } from "../leadFormSchema";

interface ContactStepProps {
  form: UseFormReturn<LeadFormValues>;
  vertical: string | undefined;
  /** Display label for the chosen category, when it came from the `verticals` table. */
  categoryLabel?: string;
  stepRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Turns a vertical slug into readable copy without depending on a fixed map
 * of known verticals — used only when the caller didn't supply a real
 * `categoryLabel` from the `verticals` table.
 */
function humanizeVertical(vertical: string | undefined): string {
  return (vertical || "").replace(/[_-]+/g, " ").trim() || "service";
}

export function ContactStep({ form, vertical, categoryLabel, stepRef }: ContactStepProps) {
  const label = categoryLabel ?? humanizeVertical(vertical);

  return (
    <div className="space-y-4" ref={stepRef} tabIndex={-1}>
      <FormField control={form.control} name="full_name" render={({ field }) => (
        <FormItem>
          <FormLabel>Full Name *</FormLabel>
          <FormControl><Input placeholder="John Smith" {...field} /></FormControl>
          <FormMessage />
        </FormItem>
      )} />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField control={form.control} name="phone" render={({ field }) => (
          <FormItem>
            <FormLabel>Phone *</FormLabel>
            <FormControl><Input type="tel" placeholder="(661) 555-0000" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="email" render={({ field }) => (
          <FormItem>
            <FormLabel>Email *</FormLabel>
            <FormControl><Input type="email" placeholder="you@example.com" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
      </div>

      <FormField control={form.control} name="description" render={({ field }) => (
        <FormItem>
          <FormLabel>Describe the Issue *</FormLabel>
          <FormControl><Textarea rows={3} placeholder="Tell us what's going on…" {...field} /></FormControl>
          <FormMessage />
        </FormItem>
      )} />

      <FormField control={form.control} name="preferred_contact_method" render={({ field }) => (
        <FormItem>
          <FormLabel>Preferred Contact Method</FormLabel>
          <Select onValueChange={field.onChange} value={field.value}>
            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
            <SelectContent>
              {CONTACT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )} />

      <FormField control={form.control} name="consent_to_contact" render={({ field }) => (
        <FormItem className="flex items-start space-x-3 space-y-0">
          <FormControl>
            <Checkbox checked={field.value} onCheckedChange={field.onChange} />
          </FormControl>
          <div className="space-y-1 leading-none">
            <FormLabel className="font-normal text-sm">
              I agree to be contacted about my {label.toLowerCase()} request. *
            </FormLabel>
            <FormMessage />
          </div>
        </FormItem>
      )} />
    </div>
  );
}
