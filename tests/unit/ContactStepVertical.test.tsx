import { render, screen } from "@testing-library/react";
import { useRef } from "react";
import { useForm } from "react-hook-form";
import { describe, it, expect } from "vitest";
import { ContactStep } from "../../src/components/forms/steps/ContactStep";
import { Form } from "../../src/components/ui/form";
import type { LeadFormValues } from "../../src/components/forms/leadFormSchema";

/**
 * Regression guard.
 *
 * ContactStep used to read `VERTICALS[vertical]` directly. That map only
 * contains `tree_service`, so once the homepage began offering DB-backed
 * categories, any non-tree selection made the lookup undefined and `.label`
 * threw — taking down the final step of the lead form, after the user had
 * already filled in everything else.
 */
function Harness({ vertical, categoryLabel }: { vertical: string; categoryLabel?: string }) {
  const form = useForm<LeadFormValues>({
    defaultValues: {
      full_name: "", phone: "", email: "", zip_code: "", city: "",
      service_type: "", urgency: "", description: "",
      preferred_contact_method: "call",
      consent_to_contact: undefined as unknown as true,
    },
  });
  const ref = useRef<HTMLDivElement>(null);
  return (
    <Form {...form}>
      <ContactStep form={form} vertical={vertical} categoryLabel={categoryLabel} stepRef={ref} />
    </Form>
  );
}

describe("ContactStep with DB-backed verticals", () => {
  it("renders for a vertical absent from the hardcoded VERTICALS map", () => {
    expect(() => render(<Harness vertical="plumbing" />)).not.toThrow();
  });

  it("uses the supplied category label in the consent copy", () => {
    render(<Harness vertical="plumbing" categoryLabel="Plumbing" />);
    expect(screen.getByText(/contacted about my plumbing request/i)).toBeInTheDocument();
  });

  it("falls back to a real label rather than crashing when none is supplied", () => {
    render(<Harness vertical="some_unknown_vertical" />);
    expect(screen.getByText(/contacted about my .* request/i)).toBeInTheDocument();
  });

  it("still works for the original tree_service vertical", () => {
    render(<Harness vertical="tree_service" />);
    expect(screen.getByText(/contacted about my tree service & removal request/i)).toBeInTheDocument();
  });
});
