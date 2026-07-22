import { render } from "@testing-library/react";
import React from "react";
import ProviderDashboard from "./ProviderDashboard";
import { BrowserRouter } from "react-router-dom";
import { vi, describe, it, expect } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock supabase client
vi.mock("@/integrations/supabase/client", () => {
  return {
    supabase: {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "test-user", email: "test@test.com" } } }),
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "test-user" } } } }),
        onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      },
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { buyer_id: "buyer-id" } }),
        order: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: "buyer-id", business_name: "Test Business" } }),
      })),
    },
  };
});

describe("ProviderDashboard", () => {
  it("should not enter an infinite loop when mounted", async () => {
    let renderCount = 0;

    const Profiler = ({ children }: { children: React.ReactNode }) => {
      renderCount++;
      return <>{children}</>;
    };

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Profiler>
            <ProviderDashboard />
          </Profiler>
        </BrowserRouter>
      </QueryClientProvider>
    );

    // Wait a bit to see if renders go crazy
    await new Promise(r => setTimeout(r, 500));

    // Initial mount + state updates from the mocked checkAuth and load data
    expect(renderCount).toBeLessThan(15);
  });
});
