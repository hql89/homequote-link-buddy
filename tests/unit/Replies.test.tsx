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

/**
 * Returned only for the "Ignored" view. A bounce row rides along in the
 * unhandled fixture below to cover the badge-label map, which is keyed on the
 * classification union and renders an EMPTY badge for any value missing from
 * it — how `bounce` rows sat unlabelled in production.
 */
const ignoredRows = [
  {
    id: "reply-4",
    message_id: "msg-4",
    business_id: null,
    from_email: "system@vercel.com",
    from_name: "Vercel",
    subject: "092303 is your Vercel log in code",
    body_text: "Here is your login code.",
    classification: "ignored",
    is_priority: false,
    extracted_url: null,
    handled_at: "2026-08-23T00:00:00Z",
    received_at: "2026-08-23T00:00:00Z",
  },
];

const ignoredSenderRows = [
  { id: "rule-1", match_type: "domain", pattern: "vercel.com", note: null, created_at: "2026-08-23T00:00:00Z" },
];

/** Only returned when the page asks for "All" — includes an already-handled row. */
const allReplyRows = [
  ...replyRows,
  {
    id: "reply-3",
    message_id: "msg-3",
    business_id: null,
    from_email: "old@example.com",
    from_name: null,
    subject: "Re: Quick question",
    body_text: "Already dealt with.",
    classification: "unclassified",
    is_priority: false,
    extracted_url: null,
    handled_at: "2026-07-27T00:00:00Z",
    received_at: "2026-07-27T00:00:00Z",
  },
];

// Unfiltered, this row WOULD appear in the unhandled queue and push its count
// to 3. It is the fixture the exclusion test depends on.
replyRows.push(ignoredRows[0]);

// Added to the "All" fixture rather than the unhandled queue so it exercises
// the badge-label map without changing the unhandled count the other tests
// assert on.
allReplyRows.push({
  id: "reply-bounce",
  message_id: "msg-bounce",
  business_id: null,
  from_email: "mailer-daemon@googlemail.com",
  from_name: "Mail Delivery Subsystem",
  subject: "Delivery Status Notification (Failure)",
  body_text: "Address not found.",
  classification: "bounce",
  is_priority: false,
  extracted_url: null,
  handled_at: null,
  received_at: "2026-07-28T02:00:00Z",
});

const businessRows = [
  { id: "biz-1", business_name: "Lux Air HVAC", city: "Tarzana", outreach_suppressed_at: null },
];

const addIgnoredCalls: { matchType: string; pattern: string }[] = [];
const removeIgnoredCalls: string[] = [];

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
 * Three views, told apart by which filter the page reaches for:
 *   unhandled → .neq(classification, ignored) then .is("handled_at", null)
 *   all       → .neq(classification, ignored) then .limit()
 *   ignored   → .eq("classification", "ignored") then .limit()
 *
 * .limit() must not clobber a view already pinned by .eq(), since the ignored
 * query calls both — hence the explicit view variable rather than assigning
 * rows directly, which is what the two-view version of this stub did.
 */
function makeInboundEmailsChain(unhandledRows: unknown[], allRows: unknown[], ignoredViewRows: unknown[]) {
  const chain: Record<string, unknown> = {};
  let view: "unhandled" | "all" | "ignored" = "unhandled";
  // .neq("classification", "ignored") is APPLIED, not just accepted. A stub
  // that swallowed it would let the exclusion test pass on a page that had
  // dropped the filter entirely — the fixtures below deliberately seed an
  // ignored row into the unhandled set so the filter has something to do.
  let excludeIgnored = false;
  const applyFilters = (rows: unknown[]) =>
    excludeIgnored
      ? rows.filter((r) => (r as { classification: string }).classification !== "ignored")
      : rows;
  chain.select = () => chain;
  chain.neq = () => {
    excludeIgnored = true;
    return chain;
  };
  chain.eq = () => {
    view = "ignored";
    return chain;
  };
  chain.is = () => {
    view = "unhandled";
    return chain;
  };
  chain.order = () => chain;
  chain.limit = () => {
    if (view !== "ignored") view = "all";
    return chain;
  };
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) =>
    resolve({
      data: applyFilters(view === "unhandled" ? unhandledRows : view === "all" ? allRows : ignoredViewRows),
      error: null,
    });
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
      if (table === "inbound_emails") return makeInboundEmailsChain(replyRows, allReplyRows, ignoredRows);
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
  listIgnoredSenders: () => Promise.resolve({ rows: ignoredSenderRows, error: null }),
  addIgnoredSender: (matchType: string, pattern: string) => {
    addIgnoredCalls.push({ matchType, pattern });
    return Promise.resolve({ swept: 3, error: null });
  },
  removeIgnoredSender: (id: string) => {
    removeIgnoredCalls.push(id);
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
  addIgnoredCalls.length = 0;
  removeIgnoredCalls.length = 0;
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

  it("shows each reply's received date/time", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Lux Air HVAC — Tarzana/)).toBeInTheDocument());

    const expected = new Date("2026-07-28T00:00:00Z").toLocaleString();
    const card = screen.getByText(/Lux Air HVAC — Tarzana/).closest("li")!;
    expect(within(card).getByText(expected)).toBeInTheDocument();
  });

  it("switching to All shows an already-handled reply, with no actions to re-handle it", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Lux Air HVAC — Tarzana/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "all" }));

    await waitFor(() => expect(screen.getByText("Already dealt with.")).toBeInTheDocument());
    const handledCard = screen.getByText("Already dealt with.").closest("li")!;
    expect(within(handledCard).getByText("Handled")).toBeInTheDocument();
    expect(within(handledCard).queryByRole("button", { name: /mark handled/i })).not.toBeInTheDocument();

    // The unhandled COUNT BADGE (e.g. "2 unhandled") is a claim about the
    // unhandled queue — it must not keep showing once a different view is on
    // screen. (The view-toggle button is also labelled "unhandled" — this
    // only targets the digit-prefixed badge text.)
    expect(screen.queryByText(/^\d+ unhandled$/)).not.toBeInTheDocument();
  });

  /**
   * The label map is keyed on the classification union, so a value missing
   * from it renders an empty badge instead of failing to compile. That is not
   * hypothetical — the one real `bounce` row in production rendered blank
   * until 2026-08-23.
   */
  it("labels a bounce rather than rendering an empty badge", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Lux Air HVAC — Tarzana/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "all" }));

    await waitFor(() => expect(screen.getByText("Delivery failed")).toBeInTheDocument());
  });

  it("keeps ignored mail out of the unhandled queue but reachable in its own view", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Lux Air HVAC — Tarzana/)).toBeInTheDocument());

    // The whole point: vendor noise is not competing for attention here.
    expect(screen.queryByText(/Vercel log in code/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ignored" }));

    // ...but it was never discarded, and is one click away.
    await waitFor(() => expect(screen.getByText(/Vercel log in code/)).toBeInTheDocument());
    expect(screen.getByText("Ignored sender")).toBeInTheDocument();
  });

  it("offers both an address and a domain rule, and calls the helper rather than writing the table", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("No matching business")).toBeInTheDocument());

    const card = screen.getByText("No matching business").closest("li")!;
    fireEvent.click(within(card).getByRole("button", { name: /ignore sender/i }));

    // Both choices are spelled out — the domain rule is the broader hammer
    // and must never be applied without the admin seeing which domain.
    expect(within(card).getByRole("button", { name: "Just unknown@example.com" })).toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", { name: "Everything from example.com" }));

    await waitFor(() =>
      expect(addIgnoredCalls).toContainEqual({ matchType: "domain", pattern: "example.com" }),
    );
  });

  it("adds a typed pattern, treating a bare domain as a domain rule", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Lux Air HVAC — Tarzana/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/address or domain to ignore/i), {
      target: { value: "github.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ignore" }));

    await waitFor(() =>
      expect(addIgnoredCalls).toContainEqual({ matchType: "domain", pattern: "github.com" }),
    );
  });

  it("adds a typed pattern containing @ as an address rule", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Lux Air HVAC — Tarzana/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/address or domain to ignore/i), {
      target: { value: "welcome@supabase.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ignore" }));

    await waitFor(() =>
      expect(addIgnoredCalls).toContainEqual({ matchType: "address", pattern: "welcome@supabase.com" }),
    );
  });

  it("lists existing rules and removes one through the helper", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("vercel.com")).toBeInTheDocument());

    const rule = screen.getByText("vercel.com").closest("li")!;
    fireEvent.click(within(rule).getByRole("button", { name: /remove/i }));

    await waitFor(() => expect(removeIgnoredCalls).toContain("rule-1"));
  });
});
