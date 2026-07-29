/**
 * Typed access to the directory-engine tables.
 *
 * `types.ts` is auto-generated from the remote schema and must not be edited by
 * hand, so the directory tables are typed here and layered onto the existing
 * client. Reads go through the `public_business_listings` view, which omits the
 * claim token — all writes happen in edge functions under the service role.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./client";

/** Paid listing tier. The view resolves expiry, so this is the effective tier. */
export type ListingTier = "free" | "featured";

export interface PublicBusinessListing {
  id: string;
  business_name: string;
  slug: string;
  city: string;
  city_slug: string;
  owner_name: string | null;
  phone: string | null;
  website_url: string | null;
  services: string[] | null;
  scraped_context: string | null;
  is_claimed: boolean;
  listing_tier: ListingTier;
  /** Sort key only: 0 = featured, 1 = free. Read `listing_tier` for meaning. */
  tier_rank: number;
  created_at: string;
  vertical_slug: string | null;
}

/**
 * Whether a listing gets the paid perks.
 *
 * Expiry is resolved in the `public_business_listings` view, so callers must
 * not re-derive it from `featured_until` — the view is the single source of
 * truth for "is this subscription currently live".
 */
export function isFeatured(
  business: Pick<PublicBusinessListing, "listing_tier"> | null | undefined,
): boolean {
  return business?.listing_tier === "featured";
}

/** One row of the `/directory` city index. */
export interface DirectoryCity {
  city: string;
  city_slug: string;
  listing_count: number;
}

/** A staged ingestion candidate. Admin-only — `raw` holds the source record. */
export interface IngestQueueRow {
  id: string;
  source: string;
  license_number: string | null;
  business_name: string;
  city: string | null;
  phone: string | null;
  classification: string | null;
  vertical_slug: string | null;
  status: "pending" | "ingested" | "skipped" | "failed";
  skip_reason: string | null;
  business_id: string | null;
  processed_at: string | null;
  created_at: string;
}

/**
 * Admin-side projection of `businesses`. The public view deliberately omits
 * `is_published`, since unpublished rows are invisible to it by definition.
 */
export interface AdminBusinessRow {
  id: string;
  business_name: string;
  city: string;
  city_slug: string;
  slug: string;
  phone: string | null;
  license_number: string | null;
  is_published: boolean;
  created_at: string;
}

interface DirectoryDatabase {
  // supabase-js resolves its Insert/Update generics through this key; without
  // it, writes to these tables type as `never`.
  __InternalSupabase: { PostgrestVersion: "14.1" };
  public: {
    Tables: {
      ingest_queue: {
        Row: IngestQueueRow;
        Insert: Partial<IngestQueueRow> & { business_name: string };
        Update: Partial<IngestQueueRow>;
        Relationships: [];
      };
      businesses: {
        Row: AdminBusinessRow;
        Insert: Partial<AdminBusinessRow> & { business_name: string };
        Update: Partial<AdminBusinessRow>;
        Relationships: [];
      };
    };
    Views: {
      public_business_listings: {
        Row: PublicBusinessListing;
      };
      public_directory_cities: {
        Row: DirectoryCity;
      };
    };
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}

export const directoryDb = supabase as unknown as SupabaseClient<DirectoryDatabase>;

/**
 * Minimal write surface for tables absent from the generated `types.ts`.
 *
 * supabase-js resolves its Update generic from the generated Database type, so
 * a hand-declared table types as `never` on write even when reads are fine.
 * Rather than scatter casts at call sites, the one narrow cast lives here.
 */
interface WritableTable {
  update: (values: Record<string, unknown>) => {
    eq: (column: string, value: string) => PromiseLike<{ error: { message: string } | null }>;
    in: (column: string, values: string[]) => PromiseLike<{ error: { message: string } | null }>;
  };
}

/**
 * Publishes or unpublishes a listing. Publishing only makes the page visible —
 * it never sends outreach, which stays a separate deliberate action.
 */
export async function setBusinessPublished(
  id: string,
  published: boolean,
): Promise<{ message: string } | null> {
  const table = directoryDb.from("businesses") as unknown as WritableTable;
  const { error } = await table.update({ is_published: published }).eq("id", id);
  return error;
}

/** Rows per statement. Keeps the generated URL clear of PostgREST's length ceiling. */
const PUBLISH_CHUNK = 100;

/**
 * Bulk form of {@link setBusinessPublished}. Seeding the directory from a CSLB
 * export produces hundreds of listings at once, and publishing those one row at
 * a time is not a real workflow.
 *
 * Chunked because the id list travels in the query string. Returns the number
 * actually updated alongside the first error, so a partial failure reports how
 * far it got rather than leaving the caller guessing.
 */
export async function setBusinessesPublished(
  ids: string[],
  published: boolean,
): Promise<{ updated: number; error: { message: string } | null }> {
  const table = directoryDb.from("businesses") as unknown as WritableTable;
  let updated = 0;

  for (let i = 0; i < ids.length; i += PUBLISH_CHUNK) {
    const chunk = ids.slice(i, i + PUBLISH_CHUNK);
    const { error } = await table.update({ is_published: published }).in("id", chunk);
    if (error) return { updated, error };
    updated += chunk.length;
  }

  return { updated, error: null };
}

/** Claim-page projection returned by the `claim-listing` edge function. */
export interface ClaimBusiness {
  id: string;
  business_name: string;
  slug: string;
  city: string;
  city_slug: string;
  owner_name: string | null;
  services: string[] | null;
  is_claimed: boolean;
  listing_tier: ListingTier;
  phone_last4: string | null;
  email_masked: string | null;
}

/**
 * A quote-request lead, as returned to the token holder alongside a claimed
 * business — proof the listing is generating real leads, all delivered
 * straight to the business.
 */
export interface DirectoryLead {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  message: string | null;
  preferred_time: string | null;
  source: string;
  created_at: string;
}

/** Renders a stored E.164 number as (818) 555-0123. Falls back to the raw input. */
export function formatPhoneDisplay(raw: string): string {
  const d = raw.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length !== 10) return raw;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/** `tel:` href for a stored number, normalising to E.164 where possible. */
export function toTelHref(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `tel:+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `tel:+${d}`;
  return `tel:${raw}`;
}

/** Normalises the `services` JSONB column, which may arrive as a JSON string. */
export function parseServices(raw: unknown): string[] {
  // Null/undefined entries must be dropped *before* String(), otherwise they
  // stringify to a truthy "null" and render as a service on the listing page.
  const clean = (arr: unknown[]): string[] =>
    arr
      .filter((s) => s !== null && s !== undefined)
      .map((s) => String(s).trim())
      .filter(Boolean);

  if (Array.isArray(raw)) return clean(raw);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? clean(parsed) : [];
    } catch {
      return [];
    }
  }
  return [];
}
