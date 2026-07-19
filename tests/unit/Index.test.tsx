import { render, screen } from "@testing-library/react";
import React from "react";
import Index from "../../src/pages/Index";
import { BrowserRouter } from "react-router-dom";
import { vi, describe, it, expect } from "vitest";

// Mock framer-motion to avoid animation issues in tests
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock auth & role hooks to avoid Supabase calls
vi.mock("../../src/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    signOut: vi.fn(),
  }),
}));

vi.mock("../../src/hooks/useIsAdmin", () => ({
  useIsAdmin: () => ({
    isAdmin: false,
  }),
}));

vi.mock("../../src/hooks/useIsProvider", () => ({
  useIsProvider: () => ({
    isProvider: false,
  }),
}));

// Mock the active verticals hook
vi.mock("../../src/hooks/useVerticals", () => ({
  useActiveVerticals: () => ({
    data: [
      { id: "1", label: "Plumbing", slug: "plumbing", icon_name: "Droplets", service_types: ["Drain cleaning"] },
      { id: "2", label: "HVAC", slug: "hvac", icon_name: "Wind", service_types: ["AC repair"] },
    ],
    isLoading: false,
    error: null,
  }),
}));

// Mock the lead form submission hook
vi.mock("../../src/components/forms/useLeadFormSubmit", () => ({
  useLeadFormSubmit: () => ({
    onSubmit: vi.fn(),
    savePartialLead: vi.fn(),
    insertLead: { isPending: false },
    inlineSuccess: false,
    honeypot: "",
    setHoneypot: vi.fn(),
    mathChallenge: null,
    mathAnswer: "",
    setMathAnswer: vi.fn(),
    mathError: "",
    setMathError: vi.fn(),
  }),
}));

// Mock analytics service
vi.mock("../../src/services/analyticsService", () => ({
  trackClick: vi.fn(),
  trackFormStep: vi.fn(),
  trackConversion: vi.fn(),
}));

describe("Index page", () => {
  it("renders the hero heading correctly", () => {
    render(
      <BrowserRouter>
        <Index />
      </BrowserRouter>
    );

    const heading = screen.getByRole("heading", {
      name: /Santa Clarita Home Service Directory/i,
    });
    expect(heading).toBeInTheDocument();
  });
});
