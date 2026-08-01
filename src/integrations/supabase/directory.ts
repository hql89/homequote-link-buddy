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
  email: string | null;
  email_source_url: string | null;
  email_source_phone: string | null;
  email_source_address: string | null;
  email_confidence: "verified" | "needs_review" | "rejected" | null;
}

/**
 * A photo row as read by admin moderation and the public gallery. Rows are
 * only ever inserted by manage-business-photos (service role) — the typed
 * client's Insert shape below exists for interface symmetry with the other
 * tables, not because the browser ever calls it. The one client-side write is
 * the admin's status update.
 */
export interface BusinessPhotoRow {
  id: string;
  business_id: string;
  storage_path: string;
  caption: string | null;
  sort_order: number;
  status: "pending" | "approved" | "rejected";
  created_at: string;
}

/**
 * A logged reply to our own outreach, as read by /admin/replies. Every field
 * except `handled_at` is set once by receive-inbound-email and never edited
 * from the browser — the one client-side write is marking a reply handled.
 */
export interface InboundEmailRow {
  id: string;
  message_id: string;
  business_id: string | null;
  from_email: string;
  from_name: string | null;
  subject: string | null;
  body_text: string | null;
  classification: "unsubscribe" | "confirm" | "website" | "unclassified";
  is_priority: boolean;
  extracted_url: string | null;
  handled_at: string | null;
  received_at: string;
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
      business_photos: {
        Row: BusinessPhotoRow;
        Insert: Partial<BusinessPhotoRow> & { business_id: string; storage_path: string };
        Update: Partial<BusinessPhotoRow>;
        Relationships: [];
      };
      inbound_emails: {
        Row: InboundEmailRow;
        Insert: Partial<InboundEmailRow> & { message_id: string; from_email: string };
        Update: Partial<InboundEmailRow>;
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

/**
 * Approves or rejects a submitted photo. This only changes the row's status —
 * nothing here touches storage, so a rejected photo's file stays in the
 * bucket even though it stops appearing anywhere.
 */
export async function setBusinessPhotoStatus(
  id: string,
  status: "approved" | "rejected",
): Promise<{ message: string } | null> {
  const table = directoryDb.from("business_photos") as unknown as WritableTable;
  const { error } = await table.update({ status }).eq("id", id);
  return error;
}

/** Marks a logged reply as dealt with. Never changes what the reply says — only that a human read it. */
export async function markReplyHandled(id: string): Promise<{ message: string } | null> {
  const table = directoryDb.from("inbound_emails") as unknown as WritableTable;
  const { error } = await table.update({ handled_at: new Date().toISOString() }).eq("id", id);
  return error;
}

/**
 * Confirms or dismisses an enrichment result that couldn't be auto-verified
 * (the CSLB phone wasn't found on the fetched page). Approving is the only
 * other path to `email_confidence = 'verified'` besides an automatic phone
 * match — an admin who's looked at the source page is an acceptable second
 * source of truth. Rejecting clears the email so it never becomes
 * drip-eligible and is never retried, matching the moderation posture used
 * for photos and inbound replies.
 */
export async function reviewEnrichedEmail(
  id: string,
  decision: "verified" | "rejected",
): Promise<{ message: string } | null> {
  const table = directoryDb.from("businesses") as unknown as WritableTable;
  const values =
    decision === "verified"
      ? { email_confidence: "verified" }
      : { email: null, email_source_url: null, email_confidence: "rejected" };
  const { error } = await table.update(values).eq("id", id);
  return error;
}

/**
 * Suppresses or un-suppresses a business from all future outreach. Separate
 * from `outreach_paused` — this is the recipient's own opt-out and is never
 * touched by re-enabling outreach generally. `receive-inbound-email` sets
 * this automatically on a STOP reply; this is the manual admin equivalent,
 * for suppressing a business proactively or reversing a mistaken one.
 */
export async function setBusinessSuppressed(
  id: string,
  suppressed: boolean,
): Promise<{ message: string } | null> {
  const table = directoryDb.from("businesses") as unknown as WritableTable;
  const { error } = await table
    .update({ outreach_suppressed_at: suppressed ? new Date().toISOString() : null })
    .eq("id", id);
  return error;
}

/**
 * Applies a website URL a business volunteered by reply. Deliberately a
 * separate, explicit admin action rather than automatic — a `From` header is
 * spoofable, and this writes to a public page asserting the business is
 * licensed and verified. Same posture as photo moderation: the owner's
 * submission is a proposal, not a fact, until a human approves it.
 */
export async function applyReplyWebsiteUrl(
  businessId: string,
  url: string,
): Promise<{ message: string } | null> {
  const table = directoryDb.from("businesses") as unknown as WritableTable;
  const { error } = await table.update({ website_url: url }).eq("id", businessId);
  return error;
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
