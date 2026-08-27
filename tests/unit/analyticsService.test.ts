import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * `analytics_events` went empty on 2026-03-22 when trackEvent was rewritten to
 * send only to Google Analytics. These tests pin the two properties that
 * regression cost us: events reach our own queryable table, and the claim
 * token in the outreach link never rides along with them.
 */

const invoke = vi.fn(() => Promise.resolve({ data: null, error: null }));

vi.mock("../../src/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...(args as [])) },
  },
}));

import {
  trackPageView,
  trackClick,
} from "../../src/services/analyticsService";

/** Body of the single track-event call. */
function sentBody(): Record<string, unknown> {
  expect(invoke).toHaveBeenCalledTimes(1);
  const [fn, opts] = invoke.mock.calls[0] as unknown as [string, { body: Record<string, unknown> }];
  expect(fn).toBe("track-event");
  return opts.body;
}

/**
 * A URL object exposes every property the service reads from window.location
 * (hostname, pathname, search, href), so it stands in directly. Stubbed rather
 * than driven through history.replaceState because jsdom serves pages from
 * localhost, which the service now deliberately refuses to track.
 */
const ORIGIN = "https://homequotelink.com";
function setLocation(pathOrUrl: string) {
  vi.stubGlobal("location", new URL(pathOrUrl, ORIGIN));
}

describe("analyticsService", () => {
  beforeEach(() => {
    invoke.mockClear();
    invoke.mockImplementation(() => Promise.resolve({ data: null, error: null }));
    localStorage.clear();
    setLocation("/");
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
    window.gtag = vi.fn();
    Object.defineProperty(document, "referrer", { value: "", configurable: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    delete window.gtag;
  });

  it("records a page view in analytics_events", async () => {
    setLocation("/directory/sherman-oaks");
    await trackPageView("/directory/sherman-oaks");

    const body = sentBody();
    expect(body.event_type).toBe("page_view");
    expect(body.page_path).toBe("/directory/sherman-oaks");
    expect(body.visitor_id).toEqual(expect.any(String));
    expect(body.session_id).toEqual(expect.any(String));
  });

  it("still sends to Google Analytics", async () => {
    await trackPageView("/faq");
    expect(window.gtag).toHaveBeenCalledWith("event", "page_view", expect.objectContaining({ page_path: "/faq" }));
  });

  it("names the event for non-page-view types", async () => {
    await trackClick("cta_get_quote", { position: "header" });

    const body = sentBody();
    expect(body.event_type).toBe("click");
    expect(body.event_name).toBe("cta_get_quote");
    expect(body.metadata).toEqual({ position: "header" });
  });

  // ── Claim-token redaction ────────────────────────────────────────────────
  // The outreach email links to /directory/:city/:slug/claim?token=<claim_token>.
  // That token authorizes claiming the listing, so it must not be persisted.

  it("strips the claim token from the recorded URL and path", async () => {
    const CLAIM_TOKEN = "9ff88b09-f62f-4cd4-a719-ac69bfc60907";
    setLocation(`/directory/encino/kord-fire/claim?token=${CLAIM_TOKEN}`);

    await trackPageView(`/directory/encino/kord-fire/claim?token=${CLAIM_TOKEN}`);

    const body = sentBody();
    expect(JSON.stringify(body)).not.toContain(CLAIM_TOKEN);
    expect(body.page_path).toBe("/directory/encino/kord-fire/claim?token=redacted");
    expect(String(body.page_url)).toContain("token=redacted");
    // Attribution survives redaction.
    expect(String(body.page_path)).toContain("/directory/encino/kord-fire/claim");
  });

  it("strips a token carried in the referrer", async () => {
    const CLAIM_TOKEN = "bc10de38-c663-44e1-bfe3-6ae0332ba6da";
    Object.defineProperty(document, "referrer", {
      value: `https://homequotelink.com/directory/encino/x/claim?token=${CLAIM_TOKEN}`,
      configurable: true,
    });

    await trackPageView("/");

    expect(JSON.stringify(sentBody())).not.toContain(CLAIM_TOKEN);
  });

  it("does not send the claim token to Google Analytics either", async () => {
    const CLAIM_TOKEN = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    setLocation(`/directory/encino/x/claim?token=${CLAIM_TOKEN}`);

    await trackPageView(`/directory/encino/x/claim?token=${CLAIM_TOKEN}`);

    expect(JSON.stringify((window.gtag as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(CLAIM_TOKEN);
  });

  it("keeps non-secret query params intact", async () => {
    setLocation("/directory?utm_source=email&page=2");
    await trackPageView("/directory?utm_source=email&page=2");

    const body = sentBody();
    expect(body.page_path).toBe("/directory?utm_source=email&page=2");
    expect(body.utm_source).toBe("email");
  });

  it("redacts other credential-shaped params, not just token", async () => {
    setLocation("/x?access_token=A1&api_key=B2&reset-code=C3&city=encino");
    await trackPageView("/x?access_token=A1&api_key=B2&reset-code=C3&city=encino");

    const path = String(sentBody().page_path);
    expect(path).not.toContain("A1");
    expect(path).not.toContain("B2");
    expect(path).not.toContain("C3");
    expect(path).toContain("city=encino");
  });

  // ── Opt-out ──────────────────────────────────────────────────────────────

  it("sends nothing when admin tracking exclusion is set", async () => {
    localStorage.setItem("hql_ignore_tracking", "true");
    await trackPageView("/");

    expect(invoke).not.toHaveBeenCalled();
    expect(window.gtag).not.toHaveBeenCalled();
  });

  it("sends nothing from a Lovable preview host", async () => {
    setLocation("https://preview.lovable.app/");

    await trackPageView("/");

    expect(invoke).not.toHaveBeenCalled();
    expect(window.gtag).not.toHaveBeenCalled();
  });

  // Local dev shares the production Supabase project, so an untracked
  // localhost would file real page views against the live table and read as
  // visitor traffic on the admin dashboard.
  it.each([
    "http://localhost:5199/faq",
    "http://127.0.0.1:5199/faq",
    "http://app.localhost:5199/faq",
    "http://macbook.local:5199/faq",
  ])("sends nothing from local development (%s)", async (url) => {
    setLocation(url);

    await trackPageView("/faq");

    expect(invoke).not.toHaveBeenCalled();
    expect(window.gtag).not.toHaveBeenCalled();
  });

  // ── Failure isolation ────────────────────────────────────────────────────
  // Two sinks, neither allowed to cost us the other or break the page.

  it("still reaches Google Analytics when the supabase call rejects", async () => {
    invoke.mockImplementation(() => Promise.reject(new Error("network down")));

    await expect(trackPageView("/faq")).resolves.toBeUndefined();
    expect(window.gtag).toHaveBeenCalled();
  });

  it("still reaches analytics_events when gtag is absent", async () => {
    delete window.gtag;

    await expect(trackPageView("/faq")).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("still reaches analytics_events when gtag throws", async () => {
    window.gtag = vi.fn(() => {
      throw new Error("gtag blew up");
    });

    await expect(trackPageView("/faq")).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("does not send to Google Analytics without a measurement ID", async () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "");

    await trackPageView("/faq");

    expect(window.gtag).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
