import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";

/**
 * The properties under test:
 *
 * 1. A reply's classification and matched business render correctly, and an
 *    unmatched sender is visibly labelled rather than silently dropped —
 *    the whole point of logging every message regardless of match.
 * 2. Marking a reply handled removes it from the unhandled list.
 * 3. "Apply URL" only appears for a website-classified reply with both an
 *    extracted URL and a matched business — applying a URL with no business
 *    to attach it to is meaningless, and it must never appear for a plain
 *    "unclassified" reply where there is nothing to apply.
 * 4. Suppress calls setBusinessSuppressed(id, true) — never a raw table write
 *    from the page, which is the pattern this whole session has enforced
 *    since the businesses-publish permission bug.
 */

const replyRows = [
  {
    id: "reply-1",
    message_id: "msg-1",
    business_id: "biz-1",
    from_email: "owner@luxairhvac.com",
    from_name: "Lux Air HVAC",
    subject: "Re: Quick question",
    body_text: "Sure, here it is: https://luxairhvac.com",
    classification: "website",
    is_priority: false,
    extracted_url: "https://luxairhvac.com",
    handled_at: null,
    received_at: "2026-07-28T00:00:00Z",
  },
  {
    id: "reply-2",
    message_id: "msg-2",
    business_id: null,
    from_email: "unknown@example.com",
    from_name: null,
    subject: "Re: Quick question",
    body_text: "Who is this?",
    classification: "unclassified",
    is_priority: false,
    extracted_url: null,
    handled_at: null,
    received_at: "2026-07-28T01:00:00Z",
  },
];

const businessRows = [
  { id: "biz-1", business_name: "Lux Air HVAC", city: "Tarzana", outreach_suppressed_at: null },
];

const suppressCalls: { id: string; suppressed: boolean }[] = [];
const applyUrlCalls: { businessId: string; url: string }[] = [];
const markHandledCalls: string[] = [];

function makeChain(finalRows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "not", "is", "order"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) =>
    resolve({ data: finalRows, error: null });
  return chain;
}

/**
 * The page issues two different queries against "businesses" — the
 * suppressed-list query (.not("outreach_suppressed_at", ...)) and the
 * matched-business-info lookup (.in("id", ...)) — and they must return
 * different rows. A stub that ignores which filter was called would let a
 * non-suppressed business leak into the suppressed list, which is exactly
 * the bug this distinction exists to catch.
 */
function makeBusinessesChain(inRows: unknown[], notRows: unknown[]) {
  const chain: Record<string, unknown> = {};
  let rows = inRows;
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.in = () => {
    rows = inRows;
    return chain;
  };
  chain.not = () => {
    rows = notRows;
    return chain;
  };
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) =>
    resolve({ data: rows, error: null });
  return chain;
}

vi.mock("../../src/hooks/use-toast", () => ({ toast: vi.fn() }));

vi.mock("../../src/components/admin/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: unknown }) => children,
}));

vi.mock("../../src/integrations/supabase/directory", () => ({
  directoryDb: {
    from: (table: string) => {
      if (table === "inbound_emails") return makeChain(replyRows);
      // No test business is actually suppressed, so the .not() branch (the
      // suppressed-list query) returns nothing; .in() (business-info lookup
      // for matched replies) returns the fixture.
      if (table === "businesses") return makeBusinessesChain(businessRows, []);
      throw new Error(`Unexpected table: ${table}`);
    },
  },
  markReplyHandled: (id: string) => {
    markHandledCalls.push(id);
    return Promise.resolve(null);
  },
  setBusinessSuppressed: (id: string, suppressed: boolean) => {
    suppressCalls.push({ id, suppressed });
    return Promise.resolve(null);
  },
  applyReplyWebsiteUrl: (businessId: string, url: string) => {
    applyUrlCalls.push({ businessId, url });
    return Promise.resolve(null);
  },
}));

const { default: RepliesPage } = await import("../../src/pages/admin/Replies");
const { TooltipProvider } = await import("../../src/components/ui/tooltip");

function renderPage() {
  return render(
    <TooltipProvider delayDuration={0}>
      <RepliesPage />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  suppressCalls.length = 0;
  applyUrlCalls.length = 0;
  markHandledCalls.length = 0;
});

describe("RepliesPage", () => {
  it("shows the matched business and labels an unmatched sender rather than dropping it", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText(/Lux Air HVAC — Tarzana/)).toBeInTheDocument());
    expect(screen.getByText("No matching business")).toBeInTheDocument();
    expect(screen.getByText("2 unhandled")).toBeInTheDocument();
  });

  it("shows Apply URL only for the website-classified, matched reply", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Lux Air HVAC — Tarzana/)).toBeInTheDocument());

    expect(screen.getByRole("button", { name: /Apply https:\/\/luxairhvac\.com/ })).toBeInTheDocument();

    const unclassifiedCard = screen.getByText("No matching business").closest("li")!;
    expect(within(unclassifiedCard).queryByText(/^Apply /)).not.toBeInTheDocument();
  });

  it("applying a URL calls applyReplyWebsiteUrl and marks the reply handled", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Lux Air HVAC — Tarzana/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Apply https:\/\/luxairhvac\.com/ }));

    await waitFor(() => expect(applyUrlCalls).toContainEqual({ businessId: "biz-1", url: "https://luxairhvac.com" }));
    expect(markHandledCalls).toContain("reply-1");
  });

  it("marking a reply handled removes it from the unhandled list", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("No matching business")).toBeInTheDocument());

    const card = screen.getByText("No matching business").closest("li")!;
    fireEvent.click(within(card).getByRole("button", { name: /mark handled/i }));

    await waitFor(() => expect(screen.queryByText("No matching business")).not.toBeInTheDocument());
    expect(markHandledCalls).toContain("reply-2");
  });

  it("suppress calls setBusinessSuppressed rather than writing the table directly", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Lux Air HVAC — Tarzana/)).toBeInTheDocument());

    const card = screen.getByText(/Lux Air HVAC — Tarzana/).closest("li")!;
    fireEvent.click(within(card).getByRole("button", { name: /suppress/i }));

    await waitFor(() => expect(suppressCalls).toContainEqual({ id: "biz-1", suppressed: true }));
  });
});
