import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect } from "vitest";
import { OutreachReadiness } from "../../src/components/admin/OutreachReadiness";
import type { ReadinessResult } from "../../src/lib/outreachReadiness";

/**
 * A check that passed is done, not ongoing news. The property that matters:
 * passing checks stop eating permanent screen space once there's nothing
 * left to act on, but stay reachable — "6 checks passing" is still a real,
 * verifiable claim, never silently dropped.
 */

function renderPanel(result: ReadinessResult) {
  return render(
    <MemoryRouter>
      <OutreachReadiness result={result} />
    </MemoryRouter>,
  );
}

const okCheck = (id: string, label: string) => ({ id, label, detail: `${label} is fine.`, level: "ok" as const });
const attentionCheck = (id: string, label: string) => ({
  id,
  label,
  detail: `${label} needs a look.`,
  level: "attention" as const,
});

describe("OutreachReadiness", () => {
  it("all checks passing: collapsed behind a summary by default, still reachable", () => {
    const { container } = renderPanel({
      headline: "Outreach is live",
      sublabel: "Up to 10 a day, 10 still available today.",
      level: "ok",
      checks: [okCheck("delivery", "Delivery confirmed"), okCheck("copy", "Email copy"), okCheck("schedule", "Automatic sending")],
    });

    // Real, checkable claim, not a silent drop — but collapsed, not a
    // permanent wall of rows.
    expect(screen.getByText("3 checks passing")).toBeInTheDocument();
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    // Still genuinely present, just not the default view.
    expect(screen.getByText("Delivery confirmed is fine.")).toBeInTheDocument();
  });

  it("a check needing attention renders outside the collapsed summary, always visible", () => {
    const { container } = renderPanel({
      headline: "Outreach is not sending",
      sublabel: "One thing is in the way: delivery confirmed.",
      level: "blocked",
      checks: [okCheck("copy", "Email copy"), attentionCheck("delivery", "Delivery confirmed")],
    });

    expect(screen.getByText("Delivery confirmed needs a look.")).toBeInTheDocument();
    expect(screen.getByText("1 check passing")).toBeInTheDocument();

    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    // The passing row lives inside the (closed) details, the attention row
    // does not — that's what keeps it always visible.
    expect(details.contains(screen.getByText("Email copy is fine."))).toBe(true);
    expect(details.contains(screen.getByText("Delivery confirmed needs a look."))).toBe(false);
  });
});
