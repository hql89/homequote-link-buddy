# Implementation Plan — Inbound Email (Reply Handling)

**Date:** 2026-07-29
**Status:** Shipped 2026-07-29
**Pattern source:** Mivos.ai's `n8n_email_webhook_workflow.json` +
`receive-email-lead` (read-only reference; nothing in that project was
modified)

## Read this first — the dependency chain

**0 of 536 businesses have an email address.** Verified:
`SELECT count(*) FILTER (WHERE email IS NOT NULL) FROM businesses` → 0.

CSLB's record layout has no email field, which is exactly why Phase 2
enrichment exists in the root `implementation_plan.md` — and it is still
unbuilt and still needs `PERPLEXITY_API_KEY`, which is not in the project's
secrets today. `send-outreach-drip` filters `.not("email", "is", null)`, so
right now it would send zero emails at any daily limit.

Nothing sends → nothing replies → this inbound bridge has no traffic.

So the real order is:

1. **Email enrichment** (root plan Phase 2) — unbuilt, blocked on a Perplexity key
2. **Outreach control panel + A/B** (`implementation_plan_outreach_ab_testing.md`) — planned, unbuilt
3. **This plan** — inbound reply handling

This is worth building, and the no-link template makes it *more* necessary
rather than less: that template's entire mechanic depends on replies being
read (phone confirmation, the website-URL P.S., and STOP). But building it
before step 1 means it sits idle. Recommend approving the sequence, not just
this document.

## What Mivos does, and what we should copy

| Mivos | Adopt? |
|---|---|
| n8n IMAP trigger → HTTP POST to an edge function | **Yes** — works against the SMTP mailbox already configured |
| Generic payload `{from, to, subject, text, html}` | **Yes** — same shape, so the n8n node is near-identical |
| Path/header token auth against a secret | **Yes** |
| `extractEmail()` / `extractName()` header parsing | **Yes** — same `Name <addr>` problem |
| Dual Resend-webhook + n8n support | **No** — `RESEND_API_KEY` isn't set on this project, so the Resend branch would be dead code. SMTP+IMAP only until that changes |
| **AI extraction of arbitrary structured data** | **No** — see below |

### The deliberate divergence: no AI classification

Mivos uses an LLM because it turns *arbitrary* inbound mail into rich
structured lead records. Our problem is far narrower: classifying replies to
an email **we wrote**, which literally instructs "reply YES" and "reply
STOP". The categories are known in advance.

Deterministic matching is better here on every axis that matters —
predictable, unit-testable, free, no key to provision, and no chance a model
silently mis-classifies an unsubscribe. It also matches this project's
standing rule that a model never supplies facts (the rule that killed
`ai-company-lookup` and constrains Perplexity to URLs only).

If a reply doesn't match a known pattern, it goes to a human queue. That is
strictly better than a confident wrong guess.

## Scope

### 1. Schema

**`inbound_emails`** — every received message, logged before any
interpretation, so nothing is lost and everything is auditable.

```
inbound_emails
  id
  message_id text unique        -- dedupe; IMAP re-polls happen
  business_id uuid null → businesses(id)
  from_email, from_name, subject, body_text
  classification text           -- 'unsubscribe' | 'confirm' | 'website' | 'unclassified'
  extracted_url text null
  handled_at timestamptz null   -- admin marked it dealt with
  received_at timestamptz default now()
```

`message_id UNIQUE` is the dedupe guard. An IMAP trigger re-delivering the
same message must be a no-op, not a second suppression or a duplicate queue
entry.

RLS: admin-read, service-role-write — same posture as `ingest_queue`,
verified against production the way every table this session has been.

**Also adds `businesses.outreach_suppressed_at timestamptz`.** This column
was scoped to `implementation_plan_outreach_ab_testing.md`, which is still
unbuilt. Unsubscribe-handling is the one thing this plan actually needs to
*write*, so it's added here rather than pulling in that whole panel as a
prerequisite. When that plan is executed, it must not recreate this column —
this note is the cross-reference.

### 2. `receive-inbound-email` edge function

Auth: `INBOUND_EMAIL_WEBHOOK_TOKEN` secret, compared against a path segment
or `x-webhook-token` header (Mivos's approach). Deployed `--no-verify-jwt`
since n8n has no Supabase session, exactly like the other public functions.

Flow:

1. Validate token → 401 on mismatch
2. Parse `{from, to, subject, text, html}`
3. `extractEmail(from)` → match `businesses.email` (case-insensitive).
   Unmatched sender is still logged, with `business_id` null and
   `classification = 'unclassified'` — never silently dropped
4. Classify deterministically (below)
5. Act, log, return 200

**Classification rules, in order:**

- **Unsubscribe** — body matches `/\b(stop|unsubscribe|remove me|opt out|take me off)\b/i`.
  Sets `businesses.outreach_suppressed_at = now()`.
- **Confirm** — body's first ~100 chars match `/\byes\b/i` and no
  unsubscribe match. Records confirmation; does **not** publish anything.
- **Website** — body contains a URL. Captured to `extracted_url` for admin
  review; does **not** write `businesses.website_url` directly.
- **Unclassified** — everything else. Queued for a human.

**Unsubscribe wins over everything.** Checked first, and a reply containing
both "yes" and "stop" suppresses. The asymmetry is deliberate: wrongly
suppressing someone costs one lost listing; wrongly continuing to email
someone who asked us to stop is the failure that actually matters.

### What happens to a genuine inquiry ("how much does this cost", "call me")

**Not written to `leads` or `directory_leads`.** Both model a homeowner
requesting a quote from a contractor; whoever replies to this outreach is a
contractor replying to *us*, and repurposing either table for that would
corrupt what admin views and exports built against them assume.

It already lands in `unclassified` — every reply that isn't a clean
STOP/YES/URL match does — and the admin Replies queue already surfaces it
for a human. The one addition: `classification` gets a lightweight
`priority` companion (not a new category, a sort hint) — `true` when the
body contains `?`, "interested", "call me", "price", or "cost" — so a real
inquiry doesn't sit behind routine noise in the queue. This is a sort order,
not an action; nothing is created, replied to, or published automatically
from it.

### 3. Why the URL is not auto-applied

A replied URL goes onto a public page that asserts the business is licensed
and verified. `From` headers are spoofable, and this is the same class of
risk as user-uploaded photos — which this project already decided to
moderate. So: same pattern, admin approves in one click.

Judgment call, not a certainty. If you'd rather auto-apply and correct
afterwards, that changes one branch, not the design.

### 4. Admin UI — new `/admin/replies` page

The original sketch was a section inside `/admin/outreach`, but that page is
part of the still-unbuilt outreach A/B plan. Standalone for now; nothing
prevents folding it in later.

- Unhandled replies, newest first, showing sender, matched business,
  classification, and the raw body
- Per-reply actions: **Apply website URL**, **Suppress**, **Mark handled**
- Suppressed-business list with un-suppress
- A "no matching business" bucket, so replies from an unknown address are
  visible rather than invisible

### 5. n8n workflow

Two nodes, mirroring Mivos: IMAP Read trigger → HTTP Request POST to
`/functions/v1/receive-inbound-email` with the token, body shaped
`{from, to, subject, text, html}`. Exported to
`n8n/inbound_email_workflow.json` in this repo with credentials
placeholdered, so it is version-controlled rather than existing only inside
an n8n instance — the same failure mode as the deploy-state-not-in-git
problem this project has already been bitten by.

## Explicitly out of scope

- **Auto-replying.** Nothing in this system may send mail in response to
  inbound mail. An auto-responder meeting a vacation auto-responder is a
  mail loop, and it is a genuinely bad failure. Every reply is answered by a
  human or not at all.
- **Threading / conversation view.** One-shot classification only.
- **Attachment handling.** Ignored.
- **Resend inbound.** Reconsider if `RESEND_API_KEY` is ever provisioned.

## Test strategy

- Classifier unit tests: STOP variants, YES variants, both-in-one-message
  (must suppress), URL extraction, plain prose → unclassified, empty body
- `extractEmail` against `Name <a@b.com>`, bare addresses, malformed input
- Dedupe: posting the same `message_id` twice suppresses once, logs once
- Token auth: wrong/missing token → 401, verified against production
- Unmatched sender is logged rather than dropped

## Acceptance criteria

- [x] A STOP reply sets `outreach_suppressed_at` and the business is
      excluded from both send queries thereafter
- [x] The same message delivered twice suppresses once and logs one row
- [x] A reply with a URL never changes the public listing without an admin click
- [x] A reply from an unknown address is visible in admin, not dropped
- [x] Wrong token → 401, verified against production
- [x] No code path sends email in response to inbound email
- [x] n8n workflow JSON committed with credentials placeholdered
- [x] Gate clean: tests, lint, tsc, build

## Rollback

```sql
DROP TABLE IF EXISTS public.inbound_emails;
```
Delete the edge function and disable the n8n workflow. `outreach_suppressed_at`
is intentionally **not** dropped here — it is owned by the outreach plan, and
suppressions already collected must survive a rollback of this bridge.
