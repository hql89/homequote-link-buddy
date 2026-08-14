# Implementation Plan — Outreach Admin Panel, A/B Testing, True Daily Rate

**Date:** 2026-07-29, revised 2026-08-14
**Status:** Awaiting approval (revision)
**Blocks:** you can't safely turn outreach on without a real daily cap, and
you can't edit or A/B test the copy at all right now — there's no UI for
either.

## Revision note (2026-08-14)

Since this was first drafted, three of its original blockers shipped through
separate, smaller pieces of work — this revision removes what's done and
keeps only what's still missing:

- **`businesses.outreach_suppressed_at`** — already exists, already wired
  into `send-outreach-drip`'s query filters.
- **Manual suppress/unsuppress UI** — already live on `/admin/replies`
  (`setBusinessSuppressed`, called from `Replies.tsx`).
- **Inbound email capability** — the original plan assumed none existed
  ("this system currently has no inbound-email capability at all"). That's
  no longer true: an n8n IMAP bridge (`HomeQuoteLink Inbound Email Bridge`,
  active as of 2026-08-11) reads the outreach mailbox and posts to
  `receive-inbound-email`, which auto-suppresses on a STOP reply. The manual
  action on Replies.tsx is now the human-override path, not the only path.
- **`outreach_paused` review UI** — already live on `/admin/enrichment`
  ("Ready for outreach" section, shipped this session).

Also correcting one internal-consistency issue in the original: it used
`stage: 'verify' | 'preview'`, but every other place in this codebase
(`email_send_log.email_type`, `DEFAULT_OUTREACH_TEMPLATES` keys, the
`renderTemplate` call sites) already uses `outreach_verify` /
`outreach_preview`. This revision uses those same strings throughout instead
of introducing a third vocabulary for the same two things.

## What's still actually missing

- `send-outreach-drip`'s `BATCH_LIMIT = 50` is a hardcoded constant, not
  admin-configurable, and it's **per invocation, not per day** — nothing
  counts sends since midnight, so two runs (or two "Run now" clicks) in one
  day would double it. This is the exact risk flagged this session: *"i
  don't want to turn it on and it send 100 per day when i set it to 10."*
- Two fixed templates, hardcoded in `_shared/directory.ts`. Overridable in
  principle via an `admin_settings` row, but **no UI has ever written to
  it** — there's no way to edit copy or run more than one variant.
- No admin page for outreach content/rate/results exists — only the on/off
  cron toggle on Background Jobs.

## Scope

### 1. Schema

**New table `outreach_sends`** — a log, not a JSON blob, because it has to
answer two different questions: "how many emails went out today" (rate
enforcement) and "which variant converts better" (A/B). Reusing
`businesses`' two timestamp columns, or bolting a column onto
`email_send_log`, can't cleanly do either.

```sql
outreach_sends
  id uuid primary key default gen_random_uuid()
  business_id uuid references businesses(id)
  email_type text not null check (email_type in ('outreach_verify','outreach_preview'))
  variant_key text not null          -- which template variant was used
  sent_at timestamptz not null default now()
```

**New table `outreach_template_variants`** — replaces the single
subject/body pair per email with N variants, each independently
active/inactive and weighted.

```sql
outreach_template_variants
  id uuid primary key default gen_random_uuid()
  email_type text not null check (email_type in ('outreach_verify','outreach_preview'))
  variant_key text not null          -- 'A', 'B', ... admin-assigned
  subject text not null
  body text not null
  weight int not null default 1      -- relative send frequency
  is_active bool not null default true
  created_at timestamptz not null default now()
  updated_at timestamptz not null default now()
  unique (email_type, variant_key)
```

Seeded in the same migration with the current live copy from
`DEFAULT_OUTREACH_TEMPLATES` as each email's variant `'A'`, `is_active =
true`, `weight = 1` — so this ships as a no-op for anyone not actively
editing: same copy, same behavior, just now in an editable table instead of
a code constant.

**`admin_settings.outreach_config` gets a new `daily_limit` field**
(default `10` — deliberately low; matches the field already used for
`ingest_config`/`enrichment_config`, read-merge-written the same way
`SMTPSettings.tsx` already merges `delivery_verified_at` into this same
key). No separate `enabled` flag — that's already the existing
`send-outreach-drip-daily` cron toggle on Background Jobs; a second on/off
switch controlling the same job would just be confusing.

RLS: admin-read (`is_admin()`), no client insert/update/delete policy —
both tables are written only by the service-role edge function, same
posture as `job_run_logs`.

### 2. `send-outreach-drip` rewrite

- Reads `outreach_config.daily_limit`.
- **True daily cap, not per-run:** `SELECT count(*) FROM outreach_sends
  WHERE sent_at >= <start of today, UTC>` → this run's budget is `daily_limit
  minus that count`, clamped to zero. Holds across multiple runs or manual
  "Run now" clicks on the same calendar day — the exact gap flagged this
  session.
- Budget is shared across both emails combined (not 10 of each) — matches
  how the number was described when asked for: *"set to 10 = at most 10 go
  out."*
- `BATCH_LIMIT` stays as an internal page-size ceiling on each query, now
  additionally capped by remaining budget:
  `.limit(Math.max(0, Math.min(BATCH_LIMIT, remainingBudget)))`. If budget
  hits zero after Email 1, the Email 2 query is skipped outright rather than
  fetched and discarded.
- For each send, picks a variant via weighted-random among that email's
  `is_active` rows in `outreach_template_variants` (falls back to failing
  that email type loudly, not silently, if an admin has deactivated every
  variant), renders subject/body from the picked variant, and logs
  `{business_id, email_type, variant_key}` to `outreach_sends` immediately
  after a successful send.
- Everything else — drip delay, claim-token URL, suppression/pause/
  undeliverable filters, SMTP failover — unchanged.
- Run metadata gains `daily_limit`, `sent_today_before_run`,
  `budget_remaining_after` for the Recent Runs panel and for debugging "why
  didn't it send."

### 3. Admin UI — new `/admin/outreach` page

- **Daily send limit** — number input, writes `outreach_config.daily_limit`
  (merge-write, same pattern as the SMTP page's delivery confirmation).
- **Template variant editor**, per email (`outreach_verify` labeled "Email
  1 — phone verification", `outreach_preview` labeled "Email 2 — listing
  preview + claim link"):
  - Cards per variant: Subject input, Body textarea, weight, active toggle.
  - Live preview panel per variant, resolved with a real business from
    "Ready for outreach" when one exists, otherwise clearly-labeled example
    data ("Example data — no eligible business yet") — never silently
    faked as real.
  - Add variant (max 3, to keep the UI and the sample-size math sane) /
    remove variant (blocked at 1 remaining — an email type must always have
    something to send).
  - **Non-blocking warning** on `outreach_verify` variants whose body
    contains something that looks like a URL: "Email 1's reply rate depends
    on having zero links; this variant looks like it has one." Doesn't block
    save — someone might deliberately want to test that assumption — it
    just stops it from happening by accident.
  - Save per email type, upserts into `outreach_template_variants`.
- **Per-variant results** — sent count, plus (for `outreach_verify`) count
  of businesses with any inbound reply after the send, or (for
  `outreach_preview`) count and rate of `businesses.is_claimed` after the
  send. Computed via a new admin-gated RPC
  (`admin_outreach_variant_stats`, `SECURITY DEFINER`, `is_admin()`-checked,
  same shape as `admin_recent_job_runs`) joining `outreach_sends` to
  `inbound_emails` / `businesses`.
- **Recent runs** — reuses the existing `job_run_logs` panel; adds a
  bespoke `send-outreach-drip` formatter to `jobRunSummary.ts` (same
  treatment `process-ingest-queue` and `enrich-business-email` already got)
  instead of relying on the generic numeric fallback.
- **"Run now"** button (`supabase.functions.invoke("send-outreach-drip")`),
  same pattern as Ingest and Enrichment pages — useful since pg_cron still
  isn't installed on this project and the job is only reachable by schedule
  or by hand.
- Nav entry in `AdminLayout`: `/admin/outreach`.
- One-line pointer added to the "Send outreach emails" row on Background
  Jobs: content, daily limit, and results now live on the new page; the
  on/off switch stays where it is.

## Explicitly out of scope here

- **Installing pg_cron.** Separate decision, unaffected by this.
- **Turning outreach on, or un-pausing anyone.** This plan builds the
  control panel and the real cap. Flipping the switch and choosing who gets
  un-paused stays a decision made afterward, by you, same as every prior
  step this session.
- **Statistical significance testing.** Rates are shown as raw ratios.
  Confidence intervals / early-stopping is a reasonable follow-up once
  there's real send volume — premature at today's 15 eligible businesses.

## Test strategy

- jsdom tests for the new Outreach page (mocked `directoryDb`/`supabase`,
  same pattern as `Enrichment.test.tsx`): variant list renders, add/remove
  variant, save calls the right upsert shape, link-warning fires on a body
  containing `http`, results table renders from a mocked RPC response.
- Daily-cap math and weighted-variant selection: pure-function unit tests
  (no Deno runtime needed — same reason `emailSafety.ts` was split out of
  `mailer.ts` so it's testable under vitest) against synthetic
  `outreach_sends` counts spanning a UTC day boundary.
- `jobRunSummary` extension: unit tested against the actual metadata shape
  the rewritten function emits.
- Full suite + `tsc --noEmit` gate, as with every change this session.

## Acceptance criteria

- [ ] `/admin/outreach` renders daily-limit control, template variants,
      per-variant results, recent runs, "Run now"
- [ ] Daily limit is enforced across multiple runs/clicks in one calendar
      day, not just within a single run
- [ ] A variant marked inactive is never selected for a new send
- [ ] Reply/claim rate per variant is computed correctly against real data
- [ ] Nothing sends differently by default — seeded variant 'A' matches
      today's live copy exactly
- [ ] No behavior change to suppression, pausing, or the cron toggle
- [ ] Gate clean: tests, lint, `tsc --noEmit`

## Rollback

```sql
DROP TABLE IF EXISTS public.outreach_sends;
DROP TABLE IF EXISTS public.outreach_template_variants;
UPDATE admin_settings
  SET setting_value = setting_value - 'daily_limit'
  WHERE setting_key = 'outreach_config';
```
`send-outreach-drip` reverts to the previous commit (back to hardcoded
`BATCH_LIMIT = 50`, per-run, no variants). No data loss on `businesses`.
