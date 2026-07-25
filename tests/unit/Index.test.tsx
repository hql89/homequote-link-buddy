import { render, screen } from "@testing-library/react";
import React from "react";
import Index from "../../src/pages/Index";
import { BrowserRouter } from "react-router-dom";
import { vi, describe, it, expect } from "vitest";

// Mock framer-motion to avoid animation issues in tests. Motion-only props are
// stripped so React doesn't warn about unknown DOM attributes.
type MotionDivProps = React.PropsWithChildren<
  React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>
>;

vi.mock("framer-motion", () => {
  // Declared inside the factory: vi.mock is hoisted above module-scope consts.
  const MOTION_ONLY_PROPS = new Set([
    "initial",
    "animate",
    "exit",
    "transition",
    "variants",
    "whileInView",
    "whileHover",
    "whileTap",
    "viewport",
  ]);

  return {
    motion: {
      div: ({ children, ...props }: MotionDivProps) => {
        const domProps = Object.fromEntries(
          Object.entries(props).filter(([key]) => !MOTION_ONLY_PROPS.has(key)),
        );
        return <div {...domProps}>{children}</div>;
      },
    },
    AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
  };
});

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
      {
        id: "1",
        label: "Tree Service & Removal",
        slug: "tree-service",
        icon_name: "TreePine",
        service_types: ["Emergency Tree Removal", "Precision Trimming & Pruning"],
      },
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

    // Hero copy as of the Sherman Oaks / tree-service pivot.
    const heading = screen.getByRole("heading", {
      level: 1,
      name: /Expert Tree Service & Removal in Sherman Oaks, CA/i,
    });
    expect(heading).toBeInTheDocument();
  });
});
