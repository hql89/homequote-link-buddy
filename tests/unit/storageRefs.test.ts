import { describe, it, expect } from "vitest";
import { resolveStorageRef } from "../../supabase/functions/_shared/storageRefs";

/**
 * This decides which file gets permanently deleted during a purge, so both
 * failure directions matter: resolving too loosely could delete something that
 * was never ours, and resolving too strictly leaks storage forever.
 */

describe("resolveStorageRef — bare paths (business_photos)", () => {
  it("resolves a stored path to the photos bucket", () => {
    expect(resolveStorageRef("abc-123/photo.jpg", "business_photos")).toEqual({
      bucket: "business-photos",
      path: "abc-123/photo.jpg",
    });
  });

  it("tolerates a leading slash", () => {
    expect(resolveStorageRef("/abc-123/photo.jpg", "business_photos")?.path)
      .toBe("abc-123/photo.jpg");
  });

  it("refuses a bare path from a table with no known bucket", () => {
    // Guessing here could delete an unrelated object that happened to match.
    expect(resolveStorageRef("something.jpg", "media_assets")).toBeNull();
    expect(resolveStorageRef("something.jpg", "businesses")).toBeNull();
  });

  it("returns null for empty or whitespace input", () => {
    expect(resolveStorageRef("", "business_photos")).toBeNull();
    expect(resolveStorageRef("   ", "business_photos")).toBeNull();
  });
});

describe("resolveStorageRef — full URLs (media_assets)", () => {
  const base = "https://lrqdbpphallqehpdqalr.supabase.co/storage/v1/object";

  it("parses a public URL into bucket and path", () => {
    expect(resolveStorageRef(`${base}/public/blog-images/2026/hero.png`, "media_assets")).toEqual({
      bucket: "blog-images",
      path: "2026/hero.png",
    });
  });

  it("parses signed and authenticated URL forms", () => {
    expect(resolveStorageRef(`${base}/sign/blog-images/a.png`, "media_assets")?.bucket)
      .toBe("blog-images");
    expect(resolveStorageRef(`${base}/authenticated/blog-images/a.png`, "media_assets")?.bucket)
      .toBe("blog-images");
  });

  it("drops a query string rather than treating it as part of the filename", () => {
    const ref = `${base}/sign/blog-images/a.png?token=abc123&expires=99`;
    expect(resolveStorageRef(ref, "media_assets")).toEqual({
      bucket: "blog-images",
      path: "a.png",
    });
  });

  it("decodes percent-encoded paths back to the real object name", () => {
    const ref = `${base}/public/blog-images/my%20photo%20(1).png`;
    expect(resolveStorageRef(ref, "media_assets")?.path).toBe("my photo (1).png");
  });

  it("keeps a malformed encoding verbatim instead of dropping the file", () => {
    const ref = `${base}/public/blog-images/bad%ZZ.png`;
    expect(resolveStorageRef(ref, "media_assets")?.path).toBe("bad%ZZ.png");
  });

  it("returns null for an external URL that was never in our storage", () => {
    // media_assets.url can legitimately hold a third-party image.
    expect(resolveStorageRef("https://images.example.com/foo.png", "media_assets")).toBeNull();
    expect(resolveStorageRef("https://cdn.example.com/storage/foo.png", "media_assets")).toBeNull();
  });

  it("handles nested paths", () => {
    expect(resolveStorageRef(`${base}/public/blog-images/a/b/c/d.png`, "media_assets")?.path)
      .toBe("a/b/c/d.png");
  });

  it("returns null when a bucket is named but no object path follows", () => {
    expect(resolveStorageRef(`${base}/public/blog-images/`, "media_assets")).toBeNull();
    expect(resolveStorageRef(`${base}/public/blog-images`, "media_assets")).toBeNull();
  });
});
