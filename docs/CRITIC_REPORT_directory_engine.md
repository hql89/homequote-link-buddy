# Critic Report — Directory Engine (2026-07-24)

Adversarial review of the directory engine implementation. All blockers below
were fixed and re-verified in the same session.

## Blockers found and fixed

### 1. Admin auth check queried the wrong column (would never match)
`ingest-business` checked `admin_users.id = user.id`, but the table keys on
`user_id` (confirmed against the `is_admin()` definition). Every admin JWT would
have been rejected, leaving the service-role key as the only usable credential.
**Fixed:** query `user_id`.

### 2. Every specific error message was being swallowed
`supabase.functions.invoke` reports any non-2xx response as a generic
`FunctionsHttpError` ("Edge Function returned a non-2xx status code") and nulls
`data`. All the deliberately-worded 400/403/429 messages — wrong email, wrong
phone, rate-limit — would have surfaced to users as that generic string, making
the claim flow undebuggable.
**Fixed:** added `src/lib/edgeFunctionError.ts`, which reads the real JSON body
off `error.context`, and wired it into all three call sites. 7 tests cover it.

### 3. Double-click could place two real phone calls
The demo-call reservation was read-then-write, so two concurrent requests could
both read `demo_call_count = 0` and both dial.
**Fixed:** the reservation update now carries `.eq("demo_call_count", previous)`
as an optimistic-concurrency guard and bails out when it matches zero rows.

### 4. `null` in a services array rendered as the text "null"
`String(null)` yields the truthy string `"null"`, which survived `.filter(Boolean)`
and would have rendered a literal "null" service on the listing page. Caught by a
unit test.
**Fixed:** in both `parseServices` (frontend) and `normaliseServices` (ingest).

### 5. Schema.org breadcrumbs pointed at 404s
The `BreadcrumbList` advertised `/directory` and `/directory/:city` URLs to
search engines; neither route exists.
**Fixed:** those crumbs are now name-only, and the listing itself carries the URL.

### 6. Invalid RLS in the approved plan
The plan's SQL chained `FOR INSERT WITH CHECK (...) FOR UPDATE USING (...)` in a
single `CREATE POLICY` (not valid Postgres) and gated owner claims on a JWT claim
that anonymous claimants never have.
**Fixed:** rewritten during implementation — no anon write policies at all; every
write goes through an edge function under the service role.

### 7. Public lead endpoint had no abuse guards
`submit-directory-lead` is public and sends email, so it could be used to spam a
business with quote requests.
**Fixed:** server-side blocklist check (`blocked_emails` / `blocked_phones`) and a
sliding-window cap (3 per phone, 10 per IP, 10 minutes) reusing the thresholds and
`spam_events` logging already used by `rate-limit-lead`. Blocked senders get a
vague 200 so they learn nothing; rate-limited senders get a 429. Both checks run
in the function, not the client, so they cannot be bypassed.

### 8. Public SELECT would have leaked every claim token
The plan's `USING (is_claimed OR true)` policy on `businesses` would have exposed
`claim_token` to anyone, letting them claim any listing they liked.
**Fixed:** `anon`/`authenticated` are revoked from the base table entirely; public
reads go through the `public_business_listings` view, which omits the token.

## Verified working

> Updated after the Retell removal below — this section describes what ships now.

- **No fake data.** Every CTA is backed by a real endpoint: the call button uses
  the stored phone, the quote form posts to `submit-directory-lead` (persists +
  emails), the claim button hits `claim-listing`.
- **UI states present.** Listing page: loading / error (with retry) / not-found /
  no-phone / no-services / no-description. Claim page: loading / invalid token /
  error (with retry) / idle / submitting / claimed.
- **Claim requires proof of ownership.** The submitted email and phone must match
  the values already on the record, checked server-side; a link-holder who
  doesn't know them cannot claim.
- **The claim token is never exposed.** Verified live: the public view returns 12
  columns and the token is not among them.
- **No hardcoded secrets** (grep-verified; `npm run scan` exits 0).

## Accepted risks / follow-ups

| Item | Severity | Note |
|---|---|---|
| No `/directory` index route | Low | Listings reachable only by direct URL; not in sitemap |
| No unsubscribe in cold outreach | Low | Email 1 is link-free by blueprint design; confirm CAN-SPAM posture before volume sending |
| — | — | *(resolved)* Migrations are now applied to `lrqdbpphallqehpdqalr` and verified live. |

## Gate results

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | 26 error lines — **identical to HEAD baseline**, 0 in new files |
| `npx eslint` (new files) | Clean |
| `npm test` | 29 passed; 1 pre-existing failure (`ProviderDashboardInfinite`, `ResizeObserver` — fails on HEAD too) |
| `npm run build` | Succeeds |
| `npm run drift` | Exit 0 |
| `npm run scan` | Exit 0 |
| Migrations | Both applied live to `lrqdbpphallqehpdqalr` and verified |


## Post-review scope change (2026-07-24)

Retell.ai is not connected to this project, so the web chat widget and the
outbound AI voice demo were removed after this review
(`20260724150000_remove_retell_integration.sql`). The TCPA consent capture was
removed with them — consent existed only to authorise that call, and storing
consent for a call that can never happen is worse than not storing it.

Findings #3 (double-dial race) and the consent-gate verification no longer
apply, since the endpoint they concerned no longer exists. Every other finding
above still stands and remains fixed.
