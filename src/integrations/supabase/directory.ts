/**
 * Typed access to the directory-engine tables.
 *
 * Every table and view here is described by the generated `types.ts`, so this
 * file no longer layers a hand-rolled schema over the client — `directoryDb`
 * is the ordinary generated client. What it still owns is the vocabulary the
 * generator cannot express: the CHECK-constraint unions, and the two view Row
 * types whose columns Postgres reports as nullable but which can never
 * actually be null (see {@link toListings}).
 *
 * Reads for the public pages go through the `public_business_listings` view,
 * which omits the claim token — all writes happen in edge functions under the
 * service role, bar the handful of admin updates defined below.
 */
import { supabase } from "./client";
import type { Database } from "./types";

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
 * Every value the `inbound_emails.classification` CHECK constraint accepts.
 *
 * Kept in step with the migrations that widen it (bounce: 20260801280000,
 * self_sent: 20260803220000, ignored: 20260823230000,
 * removal_request: 20260926020000). This union having
 * drifted behind the constraint is not a hypothetical cost: it is typed as a
 * Record key in /admin/replies, so a value missing here renders an EMPTY
 * badge rather than failing to compile — which is exactly what the one
 * production `bounce` row was doing.
 */
export type InboundClassification =
  | "removal_request"
  | "unsubscribe"
  | "confirm"
  | "website"
  | "unclassified"
  | "bounce"
  | "self_sent"
  | "ignored";

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
  classification: InboundClassification;
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
  /**
   * The real, exact text/HTML handed to the send attempt. Added
   * 20260821010000 — null on every row sent before that, which is the only
   * case /admin/outreach-sent falls back to reconstructing.
   */
  body: string | null;
  related_business_id: string | null;
  related_lead_id: string | null;
  status: string;
  method: string | null;
  error_message: string | null;
  bounced_at: string | null;
  bounce_kind: string | null;
}

/**
 * A lead captured through a listing page's "Request a Free Quote" form.
 * Written server-side by submit-directory-lead; the browser only ever reads
 * it (admin visibility), hence Insert/Update: never below, same as
 * email_send_log.
 */
export interface DirectoryLeadRow {
  id: string;
  business_id: string;
  full_name: string;
  phone: string;
  email: string | null;
  created_at: string;
  notified_at: string | null;
  notify_error: string | null;
  /** Set instead of attempting a send when the business's email was already
   *  known-dead (email_undeliverable_at) or suppressed (outreach_suppressed_at)
   *  at submit time — see submit-directory-lead's emailSkipReason(). Never
   *  set together with notify_error: one means "didn't try", the other means
   *  "tried and failed". */
  notify_skipped_reason: string | null;
}

/**
 * The directory tables are read and written through the ordinary generated
 * client — `types.ts` covers every one of them, so nothing is layered on top.
 * Reads of the public pages go through the `public_business_listings` view,
 * which omits the claim token; every other write happens in edge functions
 * under the service role.
 */
export const directoryDb = supabase;

/**
 * Compile-time check that a hand-written Row type above still names only
 * columns the generated schema actually has.
 *
 * Those interfaces are asserted rather than derived — that is the point of
 * them, since they say things Postgres cannot: that a view column is never
 * null, or that a text column only ever holds one of four values. The cost is
 * that a column renamed or dropped in a migration would go unnoticed until a
 * page rendered `undefined`. This makes it fail the build instead. Columns
 * *added* to the schema are deliberately fine: nothing breaks by not
 * declaring one, and several of these types are intentional projections.
 */
type DeclaresOnlyRealColumns<Declared, Row> =
  Exclude<keyof Declared, keyof Row> extends never
    ? true
    : { columnsNotInGeneratedSchema: Exclude<keyof Declared, keyof Row> };

type Assert<T extends true> = T;

type Tables = Database["public"]["Tables"];
type Views = Database["public"]["Views"];

/** The two public views, exactly as the generator writes them. */
type ListingViewRow = Views["public_business_listings"]["Row"];
type CityViewRow = Views["public_directory_cities"]["Row"];

type _ListingColumns = Assert<DeclaresOnlyRealColumns<PublicBusinessListing, ListingViewRow>>;
type _CityColumns = Assert<DeclaresOnlyRealColumns<DirectoryCity, CityViewRow>>;
type _IngestColumns = Assert<DeclaresOnlyRealColumns<IngestQueueRow, Tables["ingest_queue"]["Row"]>>;
type _BusinessColumns = Assert<DeclaresOnlyRealColumns<AdminBusinessRow, Tables["businesses"]["Row"]>>;
type _PhotoColumns = Assert<
  DeclaresOnlyRealColumns<BusinessPhotoRow, Tables["business_photos"]["Row"]>
>;
type _InboundColumns = Assert<
  DeclaresOnlyRealColumns<InboundEmailRow, Tables["inbound_emails"]["Row"]>
>;
type _IgnoredColumns = Assert<
  DeclaresOnlyRealColumns<IgnoredSenderRow, Tables["ignored_senders"]["Row"]>
>;
type _VariantColumns = Assert<
  DeclaresOnlyRealColumns<OutreachVariantRow, Tables["outreach_template_variants"]["Row"]>
>;
type _SendLogColumns = Assert<
  DeclaresOnlyRealColumns<EmailSendLogRow, Tables["email_send_log"]["Row"]>
>;
type _LeadColumns = Assert<
  DeclaresOnlyRealColumns<DirectoryLeadRow, Tables["directory_leads"]["Row"]>
>;

/**
 * Narrows a read of `public_business_listings` to {@link PublicBusinessListing}.
 *
 * Two things separate the generated view Row from what the view really returns:
 *
 * 1. Postgres cannot mark a view column NOT NULL, so the generator types all
 *    fifteen as nullable even though nine can never be null — they are either
 *    NOT NULL columns of `businesses` or total CASE expressions with no ELSE
 *    NULL branch (see 20260801240000_public_views_exclude_archived.sql).
 * 2. `listing_tier` and `services` are wider than the truth: the generator says
 *    `string` and `Json`, the CASE emits only 'featured' or 'free', and the
 *    column holds a JSONB array of service names.
 *
 * Only the second currently has teeth. This project compiles with
 * `strict: false`, so `| null` is erased before it can be checked and point 1
 * cannot produce an error either way — which is why retiring the hand-rolled
 * schema shim caused no breakage at the read sites. The narrowing is kept
 * because point 2 is real regardless of strictness, and because this is where
 * point 1 should already be stated for the day strict mode is turned on:
 * four pages read this view, and an unexplained cast in each is how one of
 * them quietly stops matching the schema. The assumption belongs in one place,
 * next to the migration that justifies it.
 */
export function toListings(rows: ListingViewRow[] | null): PublicBusinessListing[] {
  return (rows ?? []) as PublicBusinessListing[];
}

/** Single-row form of {@link toListings}, for a listing page's `.maybeSingle()` read. */
export function toListing(row: ListingViewRow | null): PublicBusinessListing | null {
  return row as PublicBusinessListing | null;
}

/**
 * Narrows a read of `public_directory_cities` to {@link DirectoryCity}, on the
 * same reasoning as {@link toListings}: `city` and `city_slug` are NOT NULL on
 * `businesses`, and `listing_count` is a `count(*)`, which is never null.
 */
export function toCities(rows: CityViewRow[] | null): DirectoryCity[] {
  return (rows ?? []) as DirectoryCity[];
}

/**
 * Publishes or unpublishes a listing. Publishing only makes the page visible —
 * it never sends outreach, which stays a separate deliberate action.
 */
export async function setBusinessPublished(
  id: string,
  published: boolean,
): Promise<{ message: string } | null> {
  const { error } = await directoryDb
    .from("businesses")
    .update({ is_published: published })
    .eq("id", id);
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
  const table = directoryDb.from("businesses");
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
  const { error } = await directoryDb.from("business_photos").update({ status }).eq("id", id);
  return error;
}

/**
 * One sender-level noise rule, as read by /admin/replies.
 *
 * `match_type: "domain"` covers the domain and its subdomains — `vercel.com`
 * also covers `ship@info.vercel.com`.
 */
export interface IgnoredSenderRow {
  id: string;
  match_type: "address" | "domain";
  pattern: string;
  note: string | null;
  created_at: string;
}

/** Current noise rules, oldest first. */
export async function listIgnoredSenders(): Promise<{
  rows: IgnoredSenderRow[];
  error: { message: string } | null;
}> {
  const { data, error } = await directoryDb
    .from("ignored_senders")
    .select("id, match_type, pattern, note, created_at")
    .order("created_at", { ascending: true });

  return { rows: (data ?? []) as IgnoredSenderRow[], error };
}

/**
 * Adds a noise rule and re-files matching past messages, returning how many
 * were re-filed.
 *
 * Goes through the RPC rather than writing the table directly, and not for
 * permission reasons — `authenticated` already holds table privileges on
 * `inbound_emails`. It is that the RPC runs checks a direct write would
 * skip: it refuses a single-label pattern like "com", and it refuses any
 * pattern matching a real business's email so a contractor can never be
 * muted by accident. Those checks are the whole reason this is safe to put
 * behind a one-click button.
 */
export async function addIgnoredSender(
  matchType: "address" | "domain",
  pattern: string,
  note?: string,
): Promise<{ swept: number; error: { message: string } | null }> {
  const { data, error } = await directoryDb.rpc("admin_add_ignored_sender", {
    p_match_type: matchType,
    p_pattern: pattern,
    p_note: note ?? null,
  });

  return { swept: typeof data === "number" ? data : 0, error };
}

/**
 * Removes a noise rule. Messages already filed as ignored stay filed and stay
 * readable in the Ignored view — removing a rule means "stop ignoring this
 * sender from now on", not "that vendor mail was a real reply after all".
 */
export async function removeIgnoredSender(id: string): Promise<{ message: string } | null> {
  const { error } = await directoryDb.rpc("admin_remove_ignored_sender", { p_id: id });
  return error;
}

/** Marks a logged reply as dealt with. Never changes what the reply says — only that a human read it. */
export async function markReplyHandled(id: string): Promise<{ message: string } | null> {
  const { error } = await directoryDb
    .from("inbound_emails")
    .update({ handled_at: new Date().toISOString() })
    .eq("id", id);
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
  const { error } = await directoryDb.from("businesses").update(values).eq("id", id);
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
  const { error } = await directoryDb
    .from("businesses")
    .update({ outreach_suppressed_at: suppressed ? new Date().toISOString() : null })
    .eq("id", id);
  return error;
}

/**
 * The address that bounced, for each of the businesses passed in.
 *
 * Recoverable without a new column because receive-inbound-email matches a
 * bounce to its business by `businesses.email ILIKE recipient` — so the
 * address on the `bounced` send-log row is exactly what the business had when
 * it was knocked out of outreach. Comparing it against the CURRENT email is
 * how "has anyone actually fixed this?" gets answered.
 *
 * Newest bounce wins: a business that bounced, was fixed, and bounced again
 * must be judged against its latest failure, not its first.
 */
export async function listBouncedRecipients(businessIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (businessIds.length === 0) return map;

  const { data } = await directoryDb
    .from("email_send_log")
    .select("related_business_id, recipient_email, bounced_at")
    .in("related_business_id", businessIds)
    .eq("status", "bounced")
    .order("bounced_at", { ascending: false });

  for (const row of data ?? []) {
    // Rows arrive newest-first, so the first sighting of a business is its
    // most recent bounce and anything after it must not overwrite that.
    if (row.related_business_id && !map.has(row.related_business_id)) {
      map.set(row.related_business_id, row.recipient_email);
    }
  }
  return map;
}

/**
 * Puts a business the bounce excluded back into the outreach pool.
 *
 * Clears `email_undeliverable_at` and nothing else. `outreach_bounced_at` and
 * `outreach_bounce_kind` are the record of what happened, and the drip and
 * emailSkipReason both gate on `email_undeliverable_at` alone — so clearing
 * that one restores eligibility, while erasing the other two would destroy
 * the evidence and buy nothing. Same posture as the rest of this bridge:
 * nothing that happened gets unwritten.
 *
 * The column-level UPDATE grant this needs already exists — granted by
 * 20260801270000_delivery_evidence.sql and confirmed live in production
 * (`authenticated=w` on the column's ACL, 2026-09-27) rather than taken from
 * the migration file, since a migration that never ran looks identical here.
 * Without the grant this fails hard with "permission denied for table
 * businesses" rather than silently doing nothing.
 */
export async function clearEmailUndeliverable(id: string): Promise<{ message: string } | null> {
  const { error } = await directoryDb
    .from("businesses")
    .update({ email_undeliverable_at: null })
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
  const { error } = await directoryDb
    .from("businesses")
    .update({ outreach_paused: paused })
    .eq("id", id);
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
  const table = directoryDb.from("businesses");
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
  const { error } = await supabase
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
  const { error } = await supabase.from("outreach_template_variants").insert({
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
  const { error } = await directoryDb
    .from("businesses")
    .update({ website_url: url })
    .eq("id", businessId);
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
