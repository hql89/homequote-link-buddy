# Audit — Admin Settings

**Date:** 2026-07-26
**Question:** Do we still need all the admin settings?
**Method:** Traced every `admin_settings` key to its readers, probed every edge function in production, checked data recency.

## Short answer

Only one setting is genuinely premature (Perplexity). The others are all still wanted — but **four of the seven panels currently control nothing**, because the edge functions behind them were never deployed. The problem is not too many settings; it's that most of the backend is missing from production.

## The finding that dominates everything else

**19 of 27 edge functions exist in source but are not deployed.** Verified by direct HTTP probe — they return 404, not an auth error.

Deployed (8): `claim-listing`, `import-ingest-queue`, `ingest-business`, `notify-admin-email`, `process-ingest-queue`, `send-outreach-drip`, `submit-directory-lead`, `twilio-missed-call`

The frontend calls 17 edge functions. **12 of them 404.**

Consequences confirmed against the database:

| Table | Rows | Newest record |
|---|---|---|
| `analytics_events` | 127 | **2026-03-22** — 4 months stale |
| `leads` | 6 | **2026-03-08** — 5 months stale |
| `businesses` | 0 | — |
| `ingest_queue` | 536 | 2026-07-26 ✅ |

`track-event` and `track-view` are not deployed, so **no analytics have been collected since March**. Every number on the Analytics page is a fossil.

`pg_cron` is **not installed** (only `pg_stat_statements` and `pg_net` are). There are no scheduled jobs to toggle.

## Per-setting verdict

| Panel | Verdict | Why |
|---|---|---|
| **Account** | **Keep — working** | Supabase auth. Only panel with no external dependency. |
| **SMTP** | **Keep — partly working** | `notify-admin-email` is deployed, so admin alerts and the test email work. But `send-buyer-notification`, `send-lead-confirmation`, and `send-nurture-emails` are all 404 — so buyers and homeowners currently receive nothing. |
| **Email Templates** | **Keep — partly working** | Read by `notify-admin-email` ✅. Templates for undeployed senders are inert. No DB row exists, so built-in defaults are in use. |
| **Background Jobs** | **Keep, but inert** | `pg_cron` isn't installed and all three managed jobs (`publish-scheduled`, `send-nurture-emails`, log pruning) are undeployed. The toggles have nothing to toggle. Diagnostics and Recent runs *do* work — those read the DB directly. |
| **Analytics Exclusions** | **Keep, but moot today** | `excluded_visitors` and `exclude_preview_views` are read correctly. `excluded_ips` is read by `track-event` — which is 404. Excluding yourself from analytics that aren't running is a no-op. |
| **Perplexity** | **Premature — nothing reads it** | The only references are the panel that writes it and the Settings page that renders it. Phase 2 enrichment was never built. An API key is stored in production that no code path consumes. |
| **Response Log** | **Keep** | Ephemeral in-page log of save/test results. No backend. Cheap and useful. |

## Settings with no UI

`outreach_templates` is read by `_shared/directory.ts` (`loadOutreachTemplates`) and used by the deployed `send-outreach-drip`, but there is **no admin panel to edit it**. Outreach copy is currently locked to the hardcoded defaults. This is the inverse problem: a live setting with no way to change it.

## Recommendations, in order

1. **Deploy the missing functions.** This is the whole ballgame. `track-event` and `track-view` first — every day they're down is another day of lost analytics. Then the email senders, then `system-status` and `purge-analytics` so those admin pages stop erroring.
2. **Delete the stored Perplexity key** until Phase 2 exists. A credential sitting in the database that nothing reads is pure liability. Keep the panel — it's built and tested — but don't store a live key for a feature that isn't wired up.
3. **Install `pg_cron`** or hide the Background Jobs toggles. Right now they imply scheduling that does not exist.
4. **Add an outreach templates panel**, or document that the copy is code-controlled.
5. **Remove `ai-company-lookup` from the frontend.** It fabricates `license_number` and `years_in_business`. It's inert only because it's undeployed — that's luck, not design.

## What is genuinely working

The ingestion pipeline. 536 businesses are queued, both import runs succeeded, and `process-ingest-queue` is deployed and ready. That path is end-to-end sound.
