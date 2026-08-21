import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";

/**
 * The properties under test:
 *
 * 1. A sent row shows the real recipient, the real subject, and which
 *    business it went to — the whole point of the page over the aggregate
 *    counts already shown elsewhere.
 * 2. A failed send surfaces its error message rather than looking identical
 *    to a successful one.
 * 3. Opening a row reconstructs the body from the template + business info,
 *    and visibly labels it as reconstructed — never presented as the exact
 *    text that was actually emailed, since that text isn't stored anywhere.
 */

const sendLogRows = [
  {
    id: "log-1",
    sent_at: "2026-08-19T10:00:00Z",
    job_name: "send-outreach-drip",
    email_type: "outreach_verify",
    recipient_email: "owner@luxairhvac.com",
    recipient_kind: "business",
    subject: "Quick question about Lux Air HVAC",
    related_business_id: "biz-1",
    related_lead_id: null,
    status: "sent",
    method: "smtp",
    error_message: null,
    bounced_at: null,
    bounce_kind: null,
  },
  {
    id: "log-2",
    sent_at: "2026-08-18T09:00:00Z",
    job_name: "send-outreach-drip",
    email_type: "outreach_preview",
    recipient_email: "owner@brokenroofing.com",
    recipient_kind: "business",
    subject: "Your listing preview",
    related_business_id: "biz-2",
    related_lead_id: null,
    status: "failed",
    method: "smtp",
    error_message: "SMTP connection refused",
    bounced_at: null,
    bounce_kind: null,
  },
];

const businessRows = [
  { id: "biz-1", business_name: "Lux Air HVAC", city: "Tarzana" },
  { id: "biz-2", business_name: "Broken Roofing", city: "Encino" },
];

const outreachSendsRows = [
  { business_id: "biz-1", email_type: "outreach_verify", variant_key: "A" },
];

function makeEmailLogChain() {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "in", "eq", "order", "range"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) =>
    resolve({ data: sendLogRows, error: null });
  return chain;
}

function makeSimpleChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "in", "eq", "order"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) =>
    resolve({ data: rows, error: null });
  return chain;
}

function makeSingleChain(row: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "in", "eq"]) {
    chain[method] = () => chain;
  }
  chain.maybeSingle = () => Promise.resolve({ data: row, error: null });
  return chain;
}

vi.mock("../../src/hooks/use-toast", () => ({ toast: vi.fn() }));

vi.mock("../../src/components/admin/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: unknown }) => children,
}));

vi.mock("../../src/integrations/supabase/directory", async () => {
  const actual = await vi.importActual<typeof import("../../src/integrations/supabase/directory")>(
    "../../src/integrations/supabase/directory",
  );
  return {
    ...actual,
    directoryDb: {
      from: (table: string) => {
        if (table === "email_send_log") return makeEmailLogChain();
        if (table === "businesses") return makeSimpleChain(businessRows);
        if (table === "outreach_template_variants") {
          return makeSingleChain({ body: "Hi {{owner_name}}, this is {{sender_name}} at {{business_name}}." });
        }
        throw new Error(`Unexpected directoryDb table: ${table}`);
      },
    },
  };
});

vi.mock("../../src/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "outreach_sends") return makeSimpleChain(outreachSendsRows);
      if (table === "businesses") {
        return makeSingleChain({
          business_name: "Lux Air HVAC",
          city: "Tarzana",
          owner_name: "Dana",
          phone: "+18185550142",
          slug: "lux-air-hvac",
          city_slug: "tarzana",
          claim_token: "tok-123",
        });
      }
      if (table === "admin_settings") return makeSingleChain({ from_name: "The Directory Team" });
      throw new Error(`Unexpected supabase table: ${table}`);
    },
  },
}));

const { default: OutreachSentPage } = await import("../../src/pages/admin/OutreachSent");
const { TooltipProvider } = await import("../../src/components/ui/tooltip");

function renderPage() {
  return render(
    <TooltipProvider delayDuration={0}>
      <OutreachSentPage />
    </TooltipProvider>,
  );
}

describe("OutreachSentPage", () => {
  it("shows the real recipient, subject, and matched business for each send", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText(/Lux Air HVAC — Tarzana/)).toBeInTheDocument());
    expect(screen.getByText("owner@luxairhvac.com", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Quick question about Lux Air HVAC")).toBeInTheDocument();
  });

  it("surfaces the error message for a failed send", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText(/Broken Roofing — Encino/)).toBeInTheDocument());
    expect(screen.getByText("SMTP connection refused")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("opening a row reconstructs and labels the body as reconstructed, never as the real sent text", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Lux Air HVAC — Tarzana/)).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole("button", { name: /view body/i })[0]);

    await waitFor(() =>
      expect(screen.getByText(/Hi Dana, this is The Directory Team at Lux Air HVAC\./)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Reconstructed from the current template/)).toBeInTheDocument();
  });
});
