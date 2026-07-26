import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { TooltipProvider } from "../../src/components/ui/tooltip";
import { HelpTip, PageHeading, FieldHint } from "../../src/components/admin/HelpTip";

function renderWithProvider(ui: React.ReactNode) {
  // App.tsx mounts TooltipProvider at the root; mirror that here.
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

describe("HelpTip", () => {
  it("exposes its text to assistive tech without needing a hover", () => {
    renderWithProvider(<HelpTip>Runs never send email.</HelpTip>);
    // Tooltips do not open on tap, so the trigger itself must carry the text —
    // otherwise the help is unreachable on touch and to screen readers.
    expect(screen.getByRole("button", { name: "Runs never send email." })).toBeInTheDocument();
  });

  it("is reachable by keyboard, not hover-only", () => {
    renderWithProvider(<HelpTip>Runs never send email.</HelpTip>);
    const trigger = screen.getByRole("button");
    trigger.focus();
    expect(trigger).toHaveFocus();
  });

  it("falls back to a generic label when the help is not plain text", () => {
    renderWithProvider(
      <HelpTip>
        <span>Rich content</span>
      </HelpTip>,
    );
    expect(screen.getByRole("button", { name: "More information" })).toBeInTheDocument();
  });

  it("does not submit the surrounding form when clicked", () => {
    renderWithProvider(<HelpTip>Help</HelpTip>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });
});

describe("PageHeading", () => {
  it("renders the title as the page heading with its description", () => {
    render(<PageHeading title="Business Ingestion" description="Import a licence export." />);
    expect(screen.getByRole("heading", { name: "Business Ingestion" })).toBeInTheDocument();
    expect(screen.getByText("Import a licence export.")).toBeInTheDocument();
  });

  it("renders trailing actions passed as children", () => {
    render(
      <PageHeading title="Leads" description="Everything homeowners submitted.">
        <button type="button">Export</button>
      </PageHeading>,
    );
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
  });
});

describe("FieldHint", () => {
  it("renders its text", () => {
    render(<FieldHint>Applies to the next run.</FieldHint>);
    expect(screen.getByText("Applies to the next run.")).toBeInTheDocument();
  });
});
