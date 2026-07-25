import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { vi, describe, it, expect } from "vitest";
import { Header } from "../../src/components/public/Header";
import { SITE_PHONE } from "../../src/lib/constants";

vi.mock("../../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, signOut: vi.fn() }),
}));
vi.mock("../../src/hooks/useIsAdmin", () => ({ useIsAdmin: () => ({ isAdmin: false }) }));
vi.mock("../../src/hooks/useIsProvider", () => ({ useIsProvider: () => ({ isProvider: false }) }));
vi.mock("../../src/services/analyticsService", () => ({ trackClick: vi.fn() }));

function renderHeader(props: Parameters<typeof Header>[0] = {}) {
  return render(
    <BrowserRouter>
      <Header {...props} />
    </BrowserRouter>,
  );
}

describe("Header variant", () => {
  it("shows the Valley matching hotline on portal pages", () => {
    renderHeader({ variant: "portal" });
    expect(screen.getAllByText(SITE_PHONE).length).toBeGreaterThan(0);
  });

  it("defaults to the portal variant", () => {
    renderHeader();
    expect(screen.getAllByText(SITE_PHONE).length).toBeGreaterThan(0);
  });

  /**
   * The load-bearing one. A business's listing page carries their name at the
   * top; our number appearing there would compete for a call meant for them,
   * and every listing tells them calls reach them directly. If this test ever
   * fails, that promise has been broken.
   */
  it("shows NO site phone number on a business listing page", () => {
    renderHeader({ variant: "listing" });
    expect(screen.queryByText(SITE_PHONE)).toBeNull();
    expect(screen.queryByText(/Call Now/i)).toBeNull();
    expect(document.querySelector('a[href^="tel:"]')).toBeNull();
  });

  it("drops directory nav on a listing page so we don't pull their traffic away", () => {
    renderHeader({ variant: "listing" });
    expect(screen.queryByRole("link", { name: /Directory/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /Blog/i })).toBeNull();
  });

  it("does not link to routes that no longer exist", () => {
    // /cost-guides ("Pricing") and /plumbers were live 404s in the nav.
    renderHeader({ variant: "portal" });
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain("/cost-guides");
    expect(hrefs).not.toContain("/plumbers");
  });
});
