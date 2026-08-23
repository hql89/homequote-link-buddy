import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { BlogPostTable } from "../../src/pages/admin/blog/BlogPostTable";

/**
 * The property under test: a published post shows when it actually went
 * live (published_at), not just when the draft was created — those can
 * differ significantly, and prior to this fix published_at was fetched by
 * the parent page but never rendered anywhere in this table.
 */

const basePost = {
  id: "post-1",
  title: "How to unclog a drain",
  slug: "how-to-unclog-a-drain",
  source: "native",
  tags: null,
  created_at: "2026-07-01T12:00:00Z",
  published_at: null as string | null,
};

describe("BlogPostTable", () => {
  it("shows the publish date for a published post, not the creation date", () => {
    render(
      <BlogPostTable
        posts={[{ ...basePost, status: "published", published_at: "2026-07-15T12:00:00Z" }]}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText("Jul 15, 2026")).toBeInTheDocument();
    expect(screen.queryByText("Jul 1, 2026")).not.toBeInTheDocument();
  });

  it("falls back to the creation date for a draft with no published_at", () => {
    render(
      <BlogPostTable
        posts={[{ ...basePost, status: "draft", published_at: null }]}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText("Jul 1, 2026")).toBeInTheDocument();
  });
});
