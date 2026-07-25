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

interface DirectoryDatabase {
  public: {
    Tables: Record<never, never>;
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
