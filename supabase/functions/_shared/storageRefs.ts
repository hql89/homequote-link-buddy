/**
 * Resolving a stored file reference back to a bucket and object path.
 *
 * The two tables that own files record them differently:
 *   business_photos.storage_path — a bare path inside a known bucket
 *   media_assets.url             — a full public Supabase Storage URL
 *
 * Lives here rather than in purge-archived/index.ts so it can be unit-tested:
 * that module calls Deno.serve() at import time, which vitest cannot load.
 */

/** Tables whose references are bare paths, mapped to the bucket they live in. */
export const DEFAULT_BUCKET: Record<string, string> = {
  business_photos: "business-photos",
};

export interface StorageRef {
  bucket: string;
  path: string;
}

/**
 * Returns null for anything not recognisably ours.
 *
 * That matters: media_assets.url could hold an external image URL that was
 * never in our storage. Guessing a bucket for it would either fail harmlessly
 * or, worse, delete an unrelated object that happened to match the shape.
 */
export function resolveStorageRef(ref: string, table: string): StorageRef | null {
  const trimmed = (ref ?? "").trim();
  if (!trimmed) return null;

  // Bare path — only meaningful for tables with a known home bucket.
  if (!/^https?:\/\//i.test(trimmed)) {
    const bucket = DEFAULT_BUCKET[table];
    if (!bucket) return null;
    const path = trimmed.replace(/^\/+/, "");
    return path ? { bucket, path } : null;
  }

  // `public`, `sign` and `authenticated` are reserved words in the segment
  // after /object/, never bucket names. Treating the prefix as merely optional
  // makes ".../object/public/blog-images" (no filename) parse as bucket
  // "public", object "blog-images" — pointing a delete at the wrong place.
  // So: match the prefixed form first, and only then the bare form, which is
  // rejected if it claims one of those reserved words as its bucket.
  const PREFIXED = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/?#]+)\/([^?#]+)/;
  const BARE = /\/storage\/v1\/object\/([^/?#]+)\/([^?#]+)/;
  const RESERVED = new Set(["public", "sign", "authenticated"]);

  let match = trimmed.match(PREFIXED);
  if (!match) {
    match = trimmed.match(BARE);
    if (!match || RESERVED.has(match[1])) return null;
  }

  const [, bucket, rawPath] = match;
  let path: string;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    // Malformed percent-encoding: use it verbatim rather than dropping the
    // file, since the raw form is what storage was most likely given.
    path = rawPath;
  }
  path = path.replace(/^\/+/, "");

  return path ? { bucket, path } : null;
}
