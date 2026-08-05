import { render, screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";

/**
 * The security-relevant property under test: a stored API key must never reach
 * the browser. `admin_settings` is admin-only at the RLS layer, but this page
 * should not pull the secret into component state either — otherwise it lands
 * in screenshots, devtools, and error reports.
 */
const stored: { value: Record<string, unknown> | null } = { value: null };

vi.mock("../../src/integrations/supabase/client", () => {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve({ data: stored.value ? { setting_value: stored.value } : null, error: null }),
    upsert: () => Promise.resolve({ error: null }),
  };
  return { supabase: { from: () => builder } };
});

vi.mock("../../src/hooks/use-toast", () => ({ toast: vi.fn() }));

import { PerplexitySettings } from "../../src/pages/admin/settings/PerplexitySettings";

describe("PerplexitySettings", () => {
  beforeEach(() => {
    stored.value = null;
  });

  it("reports when no key is configured", async () => {
    render(<PerplexitySettings />);
    await waitFor(() => expect(screen.getByText(/No key configured/i)).toBeInTheDocument());
  });

  it("shows only a masked hint for a stored key — never the key itself", async () => {
    const SECRET = "pplx-supersecretvalue9999";
    stored.value = { api_key: SECRET, key_hint: "••••••••9999", enabled: true };

    const { container } = render(<PerplexitySettings />);
    await waitFor(() => expect(screen.getByText(/Key configured/i)).toBeInTheDocument());

    expect(screen.getByText("••••••••9999")).toBeInTheDocument();
    // The raw secret must appear nowhere in the rendered DOM.
    expect(container.innerHTML).not.toContain(SECRET);
    expect(container.innerHTML).not.toContain("supersecretvalue");
  });

  it("leaves the key input empty even when a key is stored", async () => {
    stored.value = { api_key: "pplx-anothersecret1234", key_hint: "••••••••1234", enabled: true };

    render(<PerplexitySettings />);
    await waitFor(() => expect(screen.getByText(/Key configured/i)).toBeInTheDocument());

    const input = screen.getByLabelText(/Replace API key/i) as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.type).toBe("password");
  });

  it("cannot enable the Email Finder before a key exists", async () => {
    render(<PerplexitySettings />);
    await waitFor(() => expect(screen.getByText(/No key configured/i)).toBeInTheDocument());
    expect(screen.getByRole("switch", { name: /Enable Perplexity for the Email Finder/i })).toBeDisabled();
  });
});
