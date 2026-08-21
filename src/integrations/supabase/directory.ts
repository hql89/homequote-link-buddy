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
  /** Full CSLB licence class list, e.g. "B| C10| C36". `vertical_slug` is only
   *  the single class the listing is filed under for display. */
  classification: string | null;
  is_published: boolean;
  created_at: string;
  email: string | null;
  email_source_url: string | null;
  email_source_phone: string | null;
  email_source_address: string | null;
  email_confidence: "verified" | "needs_review" | "rejected" | null;
  /**
   * Advisory only — a model's read on whether the found site is really this
   * business, shown on the review queue. Never decides anything: a row leaves
   * the queue only when a human clicks Confirm or Dismiss.
   */
  email_review_verdict: "likely_match" | "likely_mismatch" | "unclear" | null;
  email_review_notes: string | null;
  email_review_assessed_at: string | null;
  outreach_paused: boolean;
  outreach_email_1_sent_at: string | null;
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

/**
 * The two cold-outreach emails. Same strings as `email_send_log.email_type`
 * and the seeded `outreach_template_variants.email_type` — one vocabulary for
 * these two stages everywhere, rather than a separate 'verify'/'preview' set.
 */
export type OutreachEmailType = "outreach_verify" | "outreach_preview";

/**
 * One editable version of one outreach email. Several may be active per
 * stage; the send job picks between them by `weight` and records which one
 * it used, which is what makes A/B comparison possible.
 */
export interface OutreachVariantRow {
  id: string;
  email_type: OutreachEmailType;
  /** Admin-assigned label, unique per email_type. 'A' is the seeded original. */
  variant_key: string;
  subject: string;
  body: string;
  /** Relative send frequency among active variants. 0 means never send. */
  weight: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** One row of `admin_outreach_variant_stats()`. */
export interface OutreachVariantStats {
  email_type: OutreachEmailType;
  variant_key: string;
  sent_count: number;
  replied_count: number;
  claimed_count: number;
  last_sent_at: string | null;
}

/**
 * One row of every email the app has actually sent — outreach, delivery
 * probes, admin notifications. Written once, at send time, by
 * `supabase/functions/_shared/mailer.ts`; never edited from the browser.
 *
 * `subject` is the real, already-rendered line that went out — reliable.
 * There is no column for the rendered body: reconstructing one (as
 * /admin/outreach/sent does) means re-running the current template against
 * the business's current info, which can drift from what was actually
 * emailed if either has changed since.
 */
export interface EmailSendLogRow {
  id: string;
  sent_at: string;
  job_name: string;
  email_type: string;
  recipient_email: string;
  recipient_kind: string | null;
  subject: string | null;
  related_business_id: string | null;
  related_lead_id: string | null;
  status: string;
  method: string | null;
  error_message: string | null;
  bounced_at: string | null;
  bounce_kind: string | null;
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
      outreach_template_variants: {
        Row: OutreachVariantRow;
        Insert: Partial<OutreachVariantRow> & {
          email_type: OutreachEmailType;
          variant_key: string;
          subject: string;
          body: string;
        };
        Update: Partial<OutreachVariantRow>;
        Relationships: [];
      };
      email_send_log: {
        Row: EmailSendLogRow;
        // Read-only from the browser — every row is written server-side by
        // the mailer, at send time.
        Insert: never;
        Update: never;
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
 * source of truth. Rejecting clears the whole discovered payload — the email
 * and the source URL/phone/address it was found alongside — so it never
 * becomes drip-eligible and no stale scraped evidence outlives the rejection,
 * matching the moderation posture used for photos and inbound replies.
 *
 * Every column written here needs a matching column GRANT for `authenticated`
 * (see 20260731130000_admin_enrichment_review_grants.sql). Adding a field to
 * either payload without extending that grant fails at runtime with
 * "permission denied for table businesses" — the grant is checked before RLS,
 * so it surfaces as a hard error rather than a silent no-op.
 */
export async function reviewEnrichedEmail(
  id: string,
  decision: "verified" | "rejected",
): Promise<{ message: string } | null> {
  const table = directoryDb.from("businesses") as unknown as WritableTable;
  const values =
    decision === "verified"
      ? { email_confidence: "verified" }
      : {
          email: null,
          email_source_url: null,
          email_source_phone: null,
          email_source_address: null,
          email_confidence: "rejected",
          // The assessment is reasoning ABOUT the evidence being cleared on
          // the line above. Left behind it would be a verdict with nothing to
          // verdict on — and would resurface, stale, if this row were ever
          // re-enriched and re-queued.
          email_review_verdict: null,
          email_review_notes: null,
          email_review_assessed_at: null,
        };
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
 * Turns cold outreach on or off for a single business. Every ingested row
 * starts paused (process-ingest-queue sets outreach_paused: true so a fresh
 * import is silent until reviewed) and nothing in the UI could flip it back
 * — this is that switch. Deliberately separate from `setBusinessSuppressed`:
 * suppression is the recipient's own opt-out and must survive this being
 * toggled either way; this is the sender-side "should we contact them at
 * all yet" decision.
 */
export async function setBusinessOutreachPaused(
  id: string,
  paused: boolean,
): Promise<{ message: string } | null> {
  const table = directoryDb.from("businesses") as unknown as WritableTable;
  const { error } = await table.update({ outreach_paused: paused }).eq("id", id);
  return error;
}

/**
 * Bulk form of {@link setBusinessOutreachPaused}, same chunking as
 * {@link setBusinessesPublished} and for the same reason: the id list travels
 * in the query string, so it has to be split.
 *
 * Exists because the per-business switch was doing double duty as both "is
 * this business OK to contact" (a real judgment call) and "how fast do we
 * send" (already handled, better, by the daily limit in outreach_config) —
 * so a verified batch was 100+ identical clicks that added no protection the
 * daily cap didn't already provide. This lets that be one deliberate action
 * instead. The per-business switch stays for the actual exceptions.
 */
export async function setBusinessesOutreachPaused(
  ids: string[],
  paused: boolean,
): Promise<{ updated: number; error: { message: string } | null }> {
  const table = directoryDb.from("businesses") as unknown as WritableTable;
  let updated = 0;

  for (let i = 0; i < ids.length; i += PUBLISH_CHUNK) {
    const chunk = ids.slice(i, i + PUBLISH_CHUNK);
    const { error } = await table.update({ outreach_paused: paused }).in("id", chunk);
    if (error) return { updated, error };
    updated += chunk.length;
  }

  return { updated, error: null };
}

/** Loads every outreach template variant, both stages, for the editor. */
export async function loadOutreachVariants(): Promise<{
  variants: OutreachVariantRow[];
  error: { message: string } | null;
}> {
  const { data, error } = await directoryDb
    .from("outreach_template_variants")
    .select("id, email_type, variant_key, subject, body, weight, is_active, created_at, updated_at")
    .order("email_type", { ascending: true })
    .order("variant_key", { ascending: true });

  return { variants: (data ?? []) as OutreachVariantRow[], error };
}

/**
 * Saves one variant's editable fields.
 *
 * `email_type` and `variant_key` are deliberately not updatable — they are
 * the identity the send log references. Renaming a variant after it has sent
 * would silently re-attribute or orphan its results.
 */
export async function saveOutreachVariant(
  id: string,
  values: Pick<OutreachVariantRow, "subject" | "body" | "weight" | "is_active">,
): Promise<{ message: string } | null> {
  const { error } = await directoryDb
    .from("outreach_template_variants")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", id);
  return error;
}

/** Adds a new variant for a stage, seeded from whatever the admin was editing. */
export async function createOutreachVariant(
  values: Pick<OutreachVariantRow, "email_type" | "variant_key" | "subject" | "body"> &
    Partial<Pick<OutreachVariantRow, "weight" | "is_active">>,
): Promise<{ message: string } | null> {
  const { error } = await directoryDb.from("outreach_template_variants").insert({
    weight: 1,
    // New variants start switched off. Adding one is an editing step, not a
    // decision to start mailing it — that's the active toggle, made once the
    // copy actually reads the way the admin wants.
    is_active: false,
    ...values,
  });
  return error;
}

export async function deleteOutreachVariant(id: string): Promise<{ message: string } | null> {
  const { error } = await directoryDb.from("outreach_template_variants").delete().eq("id", id);
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
