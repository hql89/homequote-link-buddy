# Lead-to-Page Directory Engine

Implementation of the "Cold-to-Warm" directory pipeline, adapted to this
project's stack (Vite + React Router SPA + Supabase Edge Functions on Deno). The
blueprint's Next.js API-route examples were reimplemented as edge functions; no
Next.js was introduced.

**Scope note:** the blueprint's Retell.ai pieces — the embedded web chat agent
and the outbound AI voice demo call — are **not built**. Retell is not connected
to this project. The TCPA consent capture went with them, since consent was
collected solely to authorise that call. See
`20260724150000_remove_retell_integration.sql`. What ships is the directory
itself: listing pages, the outreach drip, the claim flow, and quote capture.

## Pipeline

```
ingest-business ──► businesses row ──► /directory/:city/:slug goes live
       │                                        │
       └─► Email 1 (verify, no links)           └─► quote form
                    │                                        │
       send-outreach-drip ─► Email 2 (claim link)   submit-directory-lead
                    │                                        │
       /directory/:city/:slug/claim?token=…        directory_leads + email alert
                    │
       claim-listing (verify email/phone → claimed)
```

## Database

| Object | Purpose |
|---|---|
| `businesses` | Directory listings, claim tokens, drip state |
| `public_business_listings` (view) | Public read surface — **omits `claim_token` and `email`** |
| `directory_leads` | Quote requests from the listing form |

### Security model

`claim_token` is a bearer credential: whoever holds it can claim the listing.
Postgres RLS cannot restrict individual columns, so:

- `anon` / `authenticated` have **no access** to the `businesses` base table.
- Public reads go through `public_business_listings`, which never selects the token.
- All writes happen in edge functions under the service role key.
- Admins can read the full tables via `is_admin()`.

## Edge functions

| Function | Auth | Notes |
|---|---|---|
| `ingest-business` | Service-role key or admin JWT | Creates the listing, sends Email 1 |
| `send-outreach-drip` | Scheduled (pg_cron) | Sends Email 1 retries + Email 2 after 3 days |
| `claim-listing` | `claim_token` | `lookup` and `claim` actions; verifies email/phone against the record |
| `submit-directory-lead` | Public | Quote form; emails the business. Blocklist + rate limit (3/phone, 10/IP per 10 min), logged to `spam_events` |

Shared helpers live in `supabase/functions/_shared/`:
- `mailer.ts` — SMTP primary → Resend fallback
- `directory.ts` — slugify, template rendering, E.164, job logging

## Email

SMTP credentials are read from the existing `admin_settings.smtp_config` row
(same source as `notify-admin-email`) so email stays configured in one place.
Resend is used only when SMTP fails.

Templates are stored in `admin_settings.outreach_templates` and support
`{{variable}}` substitution, falling back to the blueprint defaults in
`_shared/directory.ts`. Email 1 is intentionally plain-text with **no links** to
maximise cold-send deliverability; Email 2 carries the claim link.

## Required secrets

Set in the Supabase project (Edge Function secrets):

| Secret | Required for | Notes |
|---|---|---|
| `RESEND_API_KEY` | Email fallback | Optional — SMTP alone still works |
| `RESEND_SENDER_EMAIL` | Email fallback | Defaults to the SMTP from-address |
| `PUBLIC_SITE_URL` | Claim links in Email 2, unsubscribe links in every outreach email | Set to `https://www.homequotelink.com` on 2026-08-24. The `https://homequotelink.com` fallback in code still works — the apex 308-redirects to `www` — but the explicit `www` value skips that hop, which matters for the RFC 8058 one-click unsubscribe POST fired by mail providers. |

## Deploy

Project ref: **`lrqdbpphallqehpdqalr`** (`admin@homequotelink.com's Project`).

> Multiple Supabase projects on one machine? `supabase functions deploy` falls
> back to an interactive "Select a project" prompt whenever the working
> directory isn't linked — one arrow-key away from deploying into the wrong
> project. Use the npm scripts below: they read the ref from
> `supabase/config.toml` and pass `--project-ref` explicitly, so the target is
> pinned by the repo and works from any directory. The `supabase login` token is
> global (one login covers every project); the *link* is per-directory, so other
> projects are unaffected.

```bash
npm run sb:status       # dry run — prints target project + functions, deploys nothing
npm run sb:deploy       # deploy the 4 directory-engine functions
npm run sb:deploy:all   # deploy every function in the repo
npm run sb:push         # supabase db push --linked
```

To deploy specific functions:

```bash
node scripts/supabase_deploy.cjs claim-listing submit-directory-lead
```

Schedule the drip (daily) via pg_cron, matching the existing
`send-nurture-emails-hourly` job pattern.

### Calling `ingest-business`

This project has **both** legacy JWT keys and new-format keys
(`sb_publishable_…` / `sb_secret_…`). The edge runtime injects the **new-format
secret** as `SUPABASE_SERVICE_ROLE_KEY`, so `ingest-business` only accepts that
value (or an admin user's JWT) — passing the *legacy* `service_role` JWT returns
`Invalid credentials`. Copy the secret key from
**Settings → API Keys → Secret keys**.

## Ingesting a business

```bash
curl -X POST "$SUPABASE_URL/functions/v1/ingest-business" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "business_name": "Valley Tree Pros",
    "city": "Woodland Hills",
    "owner_name": "Dana",
    "phone": "(818) 555-0123",
    "email": "owner@valleytreepros.com",
    "services": ["Tree Removal", "Trimming"],
    "scraped_context": "Family-run arborists serving the SFV since 2009…"
  }'
```

Pass `"send_outreach": false` to create a listing without emailing.

## Verified in production (2026-07-24)

Both migrations applied; 4 functions deployed ACTIVE. Confirmed against the live
project with temporary rows (since deleted — the tables are empty):

- `businesses` and `directory_leads` return **401 to anon** — base tables are closed.
- `public_business_listings` returns **200** with exactly 12 columns;
  `claim_token`, `email` and every Retell/consent column are **absent**.
- The `businesses` table itself no longer has `retell_agent_id`, `retell_llm_id`,
  `demo_call_*`, `has_consented_to_call`, `consented_at` or `consent_ip`.
- `trigger-retell-outbound-call` is deleted — the endpoint returns **404**.
- `claim-listing` resolves a valid token to masked data (`phone_last4`,
  `email_masked`), rejects a malformed token, and completes a claim with **no
  consent field required**.
- `submit-directory-lead` rejects an invalid phone and persists a valid lead.

## Known gaps

- **No `/directory` index route.** Listings are reachable only by direct URL and
  are not linked from site navigation or the sitemap yet.
- **Cold outreach has no unsubscribe link.** Email 1 omits links by design;
  confirm CAN-SPAM posture before sending at volume.
