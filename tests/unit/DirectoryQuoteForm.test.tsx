import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { DirectoryQuoteForm } from "@/components/directory/DirectoryQuoteForm";

/**
 * ENH-030. The form used to say "<business> has been notified and will reach
 * out shortly" on every success — including for a business with no email
 * address, which is the state the only claimed listing was in. Observed live
 * on 2026-11-09: the page said West Valley Builders had been notified while
 * the lead row recorded "Business has no email address on file, so there was
 * nobody to notify."
 *
 * These tests pin the two endings and, more importantly, pin the absence of
 * the promise. The positive branch stops at "should be in touch" on purpose:
 * `notified` means the message was accepted for delivery, and this domain's
 * relay has been observed accepting a message and dropping it silently
 * afterwards (ENH-006). Nothing here may claim contact will happen.
 */
const invoke = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

// fireEvent rather than user-event: this repo does not depend on the latter,
// and nothing here needs per-keystroke fidelity.
function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Dana Homeowner" } });
  fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "8185550123" } });
  fireEvent.click(screen.getByRole("button", { name: /request a free quote/i }));
}

function renderForm() {
  render(
    <DirectoryQuoteForm
      businessId="biz-1"
      businessName="West Valley Builders Inc."
      businessPhone="+18189172197"
    />,
  );
}

beforeEach(() => invoke.mockReset());

describe("DirectoryQuoteForm — what the homeowner is told", () => {
  it("offers the phone number but does not promise contact when the email was accepted", async () => {
    invoke.mockResolvedValue({ data: { success: true, leadId: "l1", notified: true }, error: null });
    renderForm();
    fillAndSubmit();

    await waitFor(() => expect(screen.getByText("Request sent")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "(818) 917-2197" })).toHaveAttribute(
      "href",
      "tel:+18189172197",
    );
    expect(screen.queryByText(/has been notified/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/will reach out/i)).not.toBeInTheDocument();
  });

  it("says plainly that the business could not be reached, and says to call them", async () => {
    invoke.mockResolvedValue({ data: { success: true, leadId: "l2", notified: false }, error: null });
    renderForm();
    fillAndSubmit();

    await waitFor(() => expect(screen.getByText("We have your request")).toBeInTheDocument());
    expect(screen.getByText(/could not reach/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "(818) 917-2197" })).toBeInTheDocument();
    expect(screen.queryByText(/has been notified/i)).not.toBeInTheDocument();
  });

  /**
   * The function returning no `notified` field means an older deployment is
   * live. Guessing "yes" there would reinstate the exact false promise this
   * change removes, so the unknown case takes the honest branch.
   */
  it("takes the honest branch when the server does not say either way", async () => {
    invoke.mockResolvedValue({ data: { success: true, leadId: "l3" }, error: null });
    renderForm();
    fillAndSubmit();

    await waitFor(() => expect(screen.getByText("We have your request")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "(818) 917-2197" })).toBeInTheDocument();
  });

  /**
   * Caught by looking at the rendered page, not by these tests: the first cut
   * ran the name through endSentence(), which appends a full stop to a name
   * that lacks one. The business used everywhere else here is "West Valley
   * Builders Inc." — already ending in a dot, so it looked right. For the
   * other 536 published businesses it read "We could not reach Aria Electric.
   * by email". Hence a fixture name with no trailing punctuation.
   */
  it("reads as one sentence for a business whose name has no trailing full stop", async () => {
    invoke.mockResolvedValue({ data: { success: true, leadId: "l4", notified: false }, error: null });
    render(
      <DirectoryQuoteForm businessId="biz-2" businessName="Aria Electric" businessPhone="+18185551234" />,
    );
    fillAndSubmit();

    await waitFor(() => expect(screen.getByText("We have your request")).toBeInTheDocument());
    expect(screen.getByText(/We could not reach Aria Electric by email/)).toBeInTheDocument();
    expect(screen.queryByText(/Aria Electric\. by email/)).not.toBeInTheDocument();
  });

  it("still reports a real failure as a failure, not as a success with a phone number", async () => {
    invoke.mockResolvedValue({ data: { success: false, error: "Too many requests." }, error: null });
    renderForm();
    fillAndSubmit();

    await waitFor(() => expect(screen.getByText(/too many requests/i)).toBeInTheDocument());
    expect(screen.queryByText("Request sent")).not.toBeInTheDocument();
    expect(screen.queryByText("We have your request")).not.toBeInTheDocument();
  });
});
