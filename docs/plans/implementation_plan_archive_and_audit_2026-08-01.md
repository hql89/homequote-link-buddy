# Implementation Plan — Archive-First Deletion & Outbound Audit Trail

**Status:** Draft — awaiting approval
**Date:** 2026-08-01
**Triggered by:** an unanswerable question about real outbound email (see Objective)

---

## Objective

On 2026-07-25 `submit-directory-lead` sent four "new quote request" notification
emails to businesses. `job_run_logs` recorded each as delivered (`notified: true`)
along with a `business_id` and `lead_id`. Both the `businesses` rows and the
`directory_leads` rows were subsequently hard-deleted. The audit trail survived,
but every identifier in it now points at nothing — so **we cannot determine which
email addresses received real outbound mail.**

Notably, no application code deletes from `businesses` or `directory_leads`.
Those rows were removed out-of-band (Supabase dashboard or raw SQL), which means
a policy that only governs app code would not have prevented this.

This plan makes two guarantees:

1. **We can always answer "who did we actually email?"** — recipient addresses are
   recorded at send time as literal text, never as a reference that can dangle.
2. **Nothing is destroyed on request.** Removal marks a row archived; permanent
   deletion is a separate, deliberate, admin-invoked, size-driven action that
   snapshots the row before it goes.

---

## Acceptance Criteria

- [ ] Every outbound email — from any of the 8 sending code paths — writes a row to
      `email_send_log` containing the literal recipient address, before/independent
      of whether the send succeeds.
- [ ] Deleting the related business or lead does **not** remove or blank that log row.
- [ ] Re-running the 2026-07-25 scenario end-to-end leaves a record that names the
      recipient address, with no dependency on the business still existing.
- [ ] `businesses`, `directory_leads`, `leads`, `buyers` support archiving; archiving
      a business removes it from the public directory, city counts, and sitemap
      within one page load.
- [ ] An archived row can be restored to exactly its prior visible state.
- [ ] No public (anon) request can read an archived row through any path.
- [ ] Permanent deletion is possible **only** via an admin-gated function that
      refuses non-archived rows and writes a full row snapshot to `data_audit_log`
      before deleting.
- [ ] `job_run_logs` is no longer hard-deleted at 30 days by the nightly prune job.
- [ ] Admin UI "delete" actions archive rather than destroy, and say so.
- [ ] `npx vitest run` passes with new coverage; no regression in the existing 259.

---

## Design Decisions

### 1. Column convention: `archived_at timestamptz NULL`

Chosen over `is_deleted boolean` and over extending the existing `status` columns.

| Option | Verdict |
|---|---|
| `archived_at timestamptz` | **Chosen.** `NULL` = live. Records *when*, which a boolean loses. Indexes cheaply as a partial index. Orthogonal to existing columns. |
| `is_deleted boolean` | Rejected — throws away the timestamp, which is exactly the forensic detail we just discovered we needed. |
| new value in `status` | Rejected — `businesses` has no `status`; `leads`/`ingest_queue`/`job_run_logs` each have their own `status` with different vocabularies, and every existing query that switches on `status` would need auditing. High blast radius for no gain. |

Paired with `archived_by uuid NULL` and `archive_reason text NULL`.

**Deliberately additive:** `is_published` on `businesses` is untouched. Archived and
unpublished stay independent — unpublishing is an editorial state a listing returns
from routinely; archiving is removal. Conflating them would make "restore" ambiguous.

### 2. `email_send_log` — the actual fix

Append-only. The recipient is stored as **text captured at send time**, not a
foreign key:

```
id, sent_at, job_name, email_type,
recipient_email      text NOT NULL,   -- literal address, never a reference
recipient_kind       text,            -- 'business' | 'lead' | 'admin' | 'buyer'
subject              text,
related_business_id  uuid NULL,       -- soft reference, NO FK constraint
related_lead_id      uuid NULL,       -- soft reference, NO FK constraint
status               text NOT NULL,   -- 'sent' | 'failed'
method               text,            -- 'smtp' | 'resend' | 'none'
error_message        text NULL
```

The `related_*` columns carry **no FK constraint by design.** A constraint would
either block deletion of the business or cascade and destroy the log — both wrong.
A dangling id is acceptable precisely because `recipient_email` already answers the
question without it.

No RLS-readable-by-anon. Admin read only. Contains personal data (recipient
addresses); per the retention decision in §7 it is kept indefinitely and purged
only when size demands, never on a timer.

### 3. `data_audit_log` — who archived/deleted what

```
id, occurred_at, actor_user_id, actor_context,   -- 'admin_ui' | 'edge_function' | 'sql'
action,          -- 'archive' | 'restore' | 'purge'
table_name, row_id,
row_snapshot jsonb NOT NULL,                     -- full row as it existed
reason text NULL
```

`row_snapshot` is the part that would have rescued the 2026-07-25 case: even after
a purge, the archived row's contents — including the business's email address —
remain readable here.

### 4. Reconciling the nightly prune job

`admin_prune_internal_job_logs()` (enabled 2026-08-01, runs 03:17 UTC) currently
hard-deletes `public.job_run_logs` older than 30 days. That directly contradicts
this plan and would, on 2026-08-25, have destroyed the very evidence that started it.

**Change:** stop deleting `job_run_logs` in the nightly job. Keep pruning
`cron.job_run_details` (>7d) and `net._http_response` (>1d) — those are Postgres
extension internals with no business meaning, genuinely ephemeral, and the actual
growth risk.

`job_run_logs` is 2,978 rows today. At the observed rate it is not a size problem in
any near horizon, and it is now explicitly audit data. It falls under the §7
size-driven purge, not an unattended timer.

### 5. Public read paths — one choke point

Confirmed: **all** public directory reads go through two views, both filtering
`WHERE is_published = true`:

- `public_business_listings`
- `public_directory_cities`

RLS on `businesses` grants SELECT only to admins (`is_admin()`); anon never reads the
table directly. So adding `AND archived_at IS NULL` to both view definitions closes
every public path in one change — no per-query auditing needed, and no risk of
missing a call site.

Sitemap (`supabase/functions/sitemap/index.ts`) and admin screens read separately
and are checked individually in Phase 3.

### 6. Column GRANTs — the known trap

Adding a column to `businesses` that admin code writes to fails at runtime with
`permission denied` unless granted explicitly. This has shipped broken three times.
Every migration adding `archived_at` / `archived_by` / `archive_reason` to
`businesses` **must** include, in the same file:

```sql
GRANT UPDATE (archived_at, archived_by, archive_reason) ON public.businesses TO authenticated;
```

Verified post-deploy by an actual archive-then-restore against the live project, not
by reading the migration.

### 7. Retention & permanent deletion

Permanent deletion is never automatic and never scheduled.

`admin_purge_archived(p_table text, p_archived_before timestamptz, p_limit int)`:
- requires `is_admin()`
- refuses any row where `archived_at IS NULL` — non-archived rows are unreachable
- writes a `data_audit_log` row with a full `row_snapshot` **before** each delete
- returns a count, and logs the run to `job_run_logs`

**How the admin decides it's time:** `admin_database_diagnostics()` already returns
per-table sizes and row counts, already surfaced under Settings → Background Jobs →
Database diagnostics. Reuse it — no new size dashboard. Purge is a deliberate button
press with a typed confirmation, following the existing "Start sending" confirm-dialog
pattern in `BackgroundJobsSettings.tsx`.

---

## Component Discovery

### Reused (existing)
- `public_business_listings` / `public_directory_cities` views — single filter point for public reads.
- `is_admin()` — gating for every new function; already the project's standard.
- `logRun()` (`_shared/directory.ts`) + `job_run_logs` — purge/archive job reporting.
- `admin_database_diagnostics()` — table sizes; satisfies the "size constraints" trigger with no new code.
- `summariseRun()` (`src/lib/jobRunSummary.ts`) — add a formatter branch for the purge job rather than a new reporting layer.
- `BackgroundJobsSettings.tsx` confirm-dialog pattern (`ManagedJob.confirm`) — reused for the purge confirmation.
- `sendOutreachEmail()` (`_shared/mailer.ts`) — single funnel for 5 of 8 send paths; instrument here, not at each call site.

### New (justified)
- `email_send_log` table — no existing table records recipient addresses. `job_run_logs.metadata` holds only ids, which is the exact failure being fixed.
- `data_audit_log` table — `job_run_logs` describes *jobs*, not row-level mutations, and has no snapshot column.
- `admin_archive_row()` / `admin_restore_row()` / `admin_purge_archived()` — no existing equivalents.

---

## Files Changed

| File | Change | Reason |
|---|---|---|
| `supabase/migrations/2026080117…_email_send_log.sql` | new | Table + RLS + indexes |
| `supabase/migrations/2026080117…_data_audit_log.sql` | new | Table + RLS |
| `supabase/migrations/2026080117…_archived_at_columns.sql` | new | Columns + **GRANTs** + partial indexes |
| `supabase/migrations/2026080117…_public_views_exclude_archived.sql` | new | View redefinition |
| `supabase/migrations/2026080117…_archive_purge_functions.sql` | new | Admin functions |
| `supabase/migrations/2026080117…_prune_job_keep_job_run_logs.sql` | new | Stop deleting audit history |
| `supabase/functions/_shared/mailer.ts` | modify | Log every send attempt + outcome |
| `supabase/functions/_shared/emailLog.ts` | new | Shared insert helper |
| `supabase/functions/notify-admin-email/index.ts` | modify | Own SMTP client — instrument separately |
| `supabase/functions/submit-directory-lead/index.ts` | modify | Pass recipient context |
| `supabase/functions/send-outreach-drip/index.ts` | modify | Pass recipient context (2 sites) |
| `supabase/functions/ingest-business/index.ts` | modify | Pass recipient context |
| `supabase/functions/send-lead-confirmation/index.ts` | modify | Routes via notify-admin-email |
| `supabase/functions/send-buyer-notification/index.ts` | modify | Routes via notify-admin-email |
| `supabase/functions/submit-feedback/index.ts` | modify | Routes via notify-admin-email |
| `supabase/functions/sitemap/index.ts` | modify | Exclude archived |
| `src/integrations/supabase/directory.ts` | modify | Archive/restore helpers; admin reads exclude archived by default |
| `src/hooks/useBuyers.ts` | modify | `.delete()` → archive |
| `src/pages/admin/Reviews.tsx` | modify | `.delete()` → archive |
| `src/pages/admin/BlogPosts.tsx` | modify | `.delete()` → archive |
| `src/pages/admin/MediaLibrary.tsx` | modify | `.delete()` → archive |
| `src/pages/admin/ProviderApplications.tsx` | modify | `.delete()` → archive |
| `supabase/functions/manage-business-photos/index.ts` | modify | `.delete()` → archive |
| `src/lib/jobRunSummary.ts` | modify | Formatter for purge runs |
| `tests/unit/emailSendLog.test.ts` | new | Log-shape + dangling-reference coverage |
| `tests/unit/archiveHelpers.test.ts` | new | Archive/restore helpers |
| `tests/unit/adminArchiveActions.test.tsx` | new | jsdom over mocked client |

**Scope note — `useVerticals.ts` / `useRouting.ts`:** these delete *configuration*
(verticals, routing rules), not records of people or actions. Left as hard deletes;
revisit only if you want config history too.

---

## Database Migrations

Six migrations, each independently reversible. Full SQL written at execution time;
rollback shape:

| Migration | Rollback |
|---|---|
| `email_send_log` | `DROP TABLE public.email_send_log;` |
| `data_audit_log` | `DROP TABLE public.data_audit_log;` |
| `archived_at_columns` | `ALTER TABLE … DROP COLUMN archived_at, DROP COLUMN archived_by, DROP COLUMN archive_reason;` (per table) |
| `public_views_exclude_archived` | `CREATE OR REPLACE VIEW …` restoring the current definitions (captured verbatim below) |
| `archive_purge_functions` | `DROP FUNCTION admin_archive_row/admin_restore_row/admin_purge_archived;` |
| `prune_job_keep_job_run_logs` | `CREATE OR REPLACE FUNCTION admin_prune_internal_job_logs()` restoring the 30-day delete |

Current view definitions, preserved for rollback:

```sql
-- public_business_listings
SELECT id, business_name, slug, city, city_slug, owner_name, phone, website_url,
       services, scraped_context, is_claimed,
       CASE WHEN listing_tier = 'featured' AND (featured_until IS NULL OR featured_until > now())
            THEN 'featured' ELSE 'free' END AS listing_tier,
       CASE WHEN listing_tier = 'featured' AND (featured_until IS NULL OR featured_until > now())
            THEN 0 ELSE 1 END AS tier_rank,
       created_at, vertical_slug
FROM businesses WHERE is_published = true;

-- public_directory_cities
SELECT city, city_slug, count(*)::integer AS listing_count
FROM businesses WHERE is_published = true
GROUP BY city, city_slug;
```

**Data backfill:** none. Existing rows get `archived_at = NULL` (live), which is the
correct current state for all of them.

---

## Test Strategy

**Unit (vitest):**
- `email_send_log` row construction: recipient captured as literal text; row remains
  valid and readable with `related_business_id` pointing at a non-existent id.
- Archive/restore helpers: correct columns set/cleared; restore is exact inverse.
- `summariseRun()` branch for purge runs, matching existing formatter tests.

**jsdom over mocked supabase client** (project convention — admin routes are auth-gated):
- Admin "delete" action issues an archive update, **not** a `.delete()`.
- Archived rows absent from default admin list queries.

**Post-migration verification against the live project** (SQL behaviour vitest cannot cover):
- Archive a business → confirm it disappears from `public_business_listings`,
  `public_directory_cities`, and the sitemap; restore → confirm it returns.
- `admin_purge_archived` on a non-archived row → rejected.
- `admin_purge_archived` on an archived row → `data_audit_log` snapshot written first.
- **GRANT check:** archive-then-restore as an admin JWT, not service role — this is
  the check that catches the `permission denied` trap.

**Regression:** full `npx vitest run` (259 baseline) after each phase.

---

## Execution Order

Phased so the highest-value fix lands first and each phase is independently shippable:

1. **Phase 1 — `email_send_log` + mailer instrumentation.** Closes the actual gap.
   Nothing else depends on it. Ship alone if you want the bleeding stopped fast.
2. **Phase 2 — `data_audit_log` + archive/restore/purge functions.**
3. **Phase 3 — `archived_at` columns, GRANTs, view changes, read-path audit.**
4. **Phase 4 — UI: admin delete → archive; purge control.**
5. ~~**Phase 5 — prune-job retention fix.**~~ **COMPLETE** — shipped 2026-08-01 ahead
   of the rest, see "Status of the urgent item" above.

---

## Rollback

Each phase reverts independently via the table above; migrations are additive
(new tables, new nullable columns, view redefinition) so reverting cannot lose data
written before the revert. Edge functions roll back by redeploying the previous
version from git. Frontend reverts with a normal revert commit.

**One-way door:** none. No existing column is dropped, renamed, or repurposed, and
no data is destroyed by any migration in this plan.

---

## Decisions (confirmed by user, 2026-08-01)

1. **Retention: no time limit.** Nothing is deleted on a schedule, ever. Archived
   rows persist until an admin purges them because the database has actually grown
   too large. There is no age at which a record becomes automatically eligible.
2. **`email_send_log` retention: same — indefinite.** Purged only via the manual,
   size-driven path, despite containing personal data. Revisit if a data-retention
   obligation (e.g. a privacy request) makes indefinite storage inappropriate.
3. **Scope: everything that is not configuration.** `businesses`, `directory_leads`,
   `leads`, `buyers`, `posts`, `reviews`, `media_assets`, `business_photos`,
   `ingest_queue`, and provider applications all get `archived_at`.
   Excluded as configuration, not records: `verticals`, `routing_settings`,
   `admin_settings`. These describe how the site behaves rather than what happened,
   and are already reconstructible from migrations.

### Status of the urgent item

**Done, 2026-08-01, ahead of plan approval** (approved separately as it had a
same-night deadline): migration `20260801170000_prune_job_stop_deleting_job_run_logs.sql`
removes the 30-day `job_run_logs` delete. Verified by executing
`admin_prune_internal_job_logs()` against the live project — row count went
2,978 → 2,979 (its own run record) with the oldest row still 2026-06-19, i.e.
nothing older than 30 days was removed. Phase 5 below is therefore complete.
