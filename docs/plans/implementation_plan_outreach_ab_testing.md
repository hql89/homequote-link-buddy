# Implementation Plan — Outreach Admin Panel, A/B Testing, True Daily Rate

**Date:** 2026-07-29
**Status:** Awaiting approval
**Blocks:** every claim, and therefore every photo — outreach is currently
paused on all 536 published listings and there is no admin page to unpause
it, edit its copy, or control its rate.

## What exists today (verified by reading the code, not assumed)

- Two fixed templates, hardcoded in `_shared/directory.ts`: `outreach_verify`
  (Email 1) and `outreach_preview` (Email 2, carries the claim link).
  Overridable via an `admin_settings` row, but **no UI ever writes to it.**
- `send-outreach-drip`'s `BATCH_LIMIT = 50` is a hardcoded constant, not
  admin-configurable — unlike `ingest_config.daily_limit`.
- That limit is **per invocation, not per day.** Nothing counts how many
  emails have gone out since midnight, so two runs in one day send double.
- No admin page for outreach exists at all — no enable toggle reachable from
  the UI, no "Run now," no send history, no per-template performance.

## Scope

### 1. Schema

**New table `outreach_sends`** — a log, not a JSON blob, because it has to
answer two different questions: "how many emails went out today" (rate
enforcement) and "which variant converts better" (A/B). Overloading
`businesses`' two timestamp columns can't do either cleanly.

```
outreach_sends
  id, business_id → businesses(id)
  stage: 'verify' | 'preview'
  variant_key text          -- which template variant was used
  sent_at timestamptz
```

**New table `outreach_template_variants`** — replaces the single
subject/body pair per stage with N variants, each independently toggleable
and weighted.

```
outreach_template_variants
  id, stage: 'verify' | 'preview'
  variant_key text          -- 'a', 'b', ... admin-assigned
  subject text, body text
  weight int default 1      -- relative send frequency
  is_active bool default true
  created_at, updated_at
```

**`admin_settings` row `outreach_config`:** `{ daily_limit: 10, enabled: false }`
— same shape as `ingest_config`, same reason: changeable without a deploy.
Starts `enabled: false` and a low default; nothing sends until you turn it on.

**New column `businesses.outreach_suppressed_at timestamptz`.** Deliberately
separate from the existing `outreach_paused` — that flag is an *admin*
control (temporarily hold a row), this one is a *recipient's own* opt-out and
must never be auto-cleared or overridden by re-enabling outreach. Every
outreach query (both stages, present and future) excludes rows where this is
set, permanently.

RLS: identical posture to `ingest_queue` — admin-read, service-role-write.
Verified against production the same way every other table this session was.

### 2. `send-outreach-drip` rewrite

- Reads `outreach_config`; exits immediately if disabled (matches
  `process-ingest-queue`'s pattern) or if today's send count already meets
  `daily_limit`.
- **True daily cap:** `SELECT count(*) FROM outreach_sends WHERE sent_at >= today`,
  subtracted from `daily_limit` to get this run's actual budget — holds even
  across multiple manual "Run now" clicks in the same day.
- **Both candidate queries (Email 1 and Email 2) exclude
  `outreach_suppressed_at IS NOT NULL`.** A suppressed business is invisible
  to every future run, permanently, independent of the enabled/paused flags.
- Picks a variant per send via weighted random among `is_active` variants for
  that stage; logs the choice to `outreach_sends`.
- Everything else (drip delay, claim-token URL, SMTP failover) is unchanged.

### 2a. The no-link verification template

Replaces the default Email 1 (`outreach_verify`) copy with the plain-text,
link-free, HTML-free structure below — this becomes the seed "a" variant.
The mechanic: no links or styling to trip spam classifiers, and the message
asks about *their own business* rather than pitching anything, so it reads
as a real person, not a campaign. The P.S. asking for their site URL works
because most owners want their link listed for free and will volunteer it —
at zero engineering cost, since a human already has to read every reply to
process the phone-confirmation and unsubscribe requests below.

```
Subject: Quick question about {{business_name}} in {{city}}

Hi {{owner_name}},

I built a local online directory to help promote businesses in {{city}} and
I've added {{business_name}} to it.

I just want to make sure I have your correct business phone number:
{{phone}}.

If this is correct, please reply YES. If not, just let me know what to
change.

Best,
{{sender_name}}

P.S. I also want to make sure I add your website to the listing. Just
reply with your URL and I'll get it added for you.

---
Don't want to be contacted about this listing? Reply STOP and I'll remove
you.
```

Email 2 (`outreach_preview`) is unchanged in structure — it's the one
message in the sequence that's *supposed* to carry a link, sent only after
a reply has (per the mechanic) put the sender's address in good standing —
but gets the same one-line reply-to-opt-out addition.

**Non-blocking guard in the variant editor:** if a `verify`-stage variant's
body appears to contain a URL, show a warning — "Email 1's reply rate
depends on having zero links; this variant looks like it has one" — without
blocking save. The whole point of A/B testing this stage is that someone
might deliberately want to test that assumption; the guard exists so it
doesn't happen by accident.

### 3. Admin UI — new `/admin/outreach` page

Mirrors `Ingest.tsx`'s shape, since it's the same pattern (rate-limited
worker, admin-adjustable, "Run now" button):

- Enabled toggle + daily limit input, writes `outreach_config`
- Template variant editor per stage: add/edit/deactivate variants, adjust
  weight, non-blocking link warning on `verify`-stage variants
- **Per-variant results:** sent count, claimed count, claim rate — computed
  by joining `outreach_sends` to `businesses.is_claimed`
- Recent runs (reuses existing `job_run_logs` + `jobRunSummary` — extends it
  with a `send-outreach-drip` formatter, same as was done for
  `process-ingest-queue`)
- "Run now," since pg_cron still isn't installed
- **Suppress a business:** a lookup-by-name/email field with a "Suppress"
  action, setting `outreach_suppressed_at`. Reversible (a business can be
  un-suppressed) but never automatic in either direction.

### 3a. Unsubscribe — what this can and can't do yet

The template's opt-out line ("Reply STOP") only works end-to-end if
something reads that reply. **This system currently has no inbound-email
capability at all** — it sends via SMTP/Resend and nothing parses replies.
Building automatic "STOP" detection would mean standing up mail-receiving
infrastructure (an inbound webhook or IMAP polling, a parser, verification)
that nothing else in this project has any version of — a genuinely separate
piece of work, not an incremental add to this plan.

The honest MVP, and what this plan builds: a **manual** suppression action
in the admin UI, used by whoever reads the reply inbox — which the template
already requires for the phone-confirmation and website-URL asks, so no new
habit is being introduced. Once suppressed, a business is excluded from
every future send, permanently, regardless of the enabled/paused state.

This meaningfully reduces risk at the 10–30 email/day volumes this plan
targets, but it is not the same guarantee as an automated pipeline, and
"instant" is bounded by how quickly the inbox gets checked. Flagging this
plainly rather than asserting compliance — worth a real legal read if this
scales past a manual-review volume.

### 4. Nav entry
`/admin/outreach` added to `AdminLayout`'s nav list, same as `/admin/photos`.

## Explicitly out of scope here

- **Installing pg_cron.** Still a separate decision; "Run now" is how every
  worker in this project runs today.
- **Actually turning outreach on.** This plan builds the control panel.
  Flipping the switch on real businesses is a decision made in the UI
  afterward, in a small first batch, per the earlier recommendation.
- **Statistical significance testing.** Claim-rate is shown as a raw ratio.
  Formal significance (confidence intervals, early-stopping rules) is a
  reasonable follow-up once there's enough send volume for it to matter —
  premature at 10-30 emails/day.

## Test strategy

- `outreach_sends`/`outreach_template_variants` RLS verified against
  production with the same anon-write-must-fail method used for
  `business_photos` and the businesses-publish fix
- Weighted variant selection: deterministic given a seeded random source,
  unit tested for distribution
- Daily-cap math: unit tested against synthetic `outreach_sends` rows
  spanning a day boundary
- `jobRunSummary` extension: unit tested against the real metadata shape
  the rewritten function emits

## Acceptance criteria

- [ ] `/admin/outreach` renders enabled/limit controls, template variants,
      per-variant results, recent runs
- [ ] Daily limit is enforced across multiple runs in one calendar day, not
      just within one run
- [ ] A variant marked inactive is never selected for a new send
- [ ] Claim rate per variant is computed correctly against real `is_claimed` data
- [ ] Outreach stays `enabled: false` by default after this ships — nothing
      sends until you turn it on
- [ ] A suppressed business is excluded from both send queries, verified
      against production
- [ ] Every default template ends with a plain-text reply-to-opt-out line
- [ ] Gate clean: tests, lint, tsc, build

## Rollback
```sql
DROP TABLE IF EXISTS public.outreach_sends;
DROP TABLE IF EXISTS public.outreach_template_variants;
ALTER TABLE public.businesses DROP COLUMN IF EXISTS outreach_suppressed_at;
DELETE FROM admin_settings WHERE setting_key = 'outreach_config';
```
`send-outreach-drip` reverts to the previous commit; the hardcoded defaults
in `_shared/directory.ts` are untouched by this plan, so this is a clean
revert with no data loss on `businesses`.
