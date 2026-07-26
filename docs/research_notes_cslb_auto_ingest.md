# Research Notes — Automated CSLB Data Ingestion

**Date:** 2026-07-26
**Question:** Can the system automatically fetch CSLB contractor data on a schedule instead of requiring a manual CSV download + upload?

## What I Found

**No stable direct download URL exists.**
Every common URL pattern for the CSLB bulk "Public Sales Record" returns 404. The download portal page itself redirects to a 404. CSLB moved this at some point and there is no publicly documented replacement URL.

**No public API.**
CSLB's Data Portal links only to their web search and to DCA's portal. CA Open Data (data.ca.gov) has no CSLB dataset. DCA's own data portal has no contractor license API.

**What CSLB does expose:**
- A zip-code + classification search at `cslb.ca.gov/OnlineServices/CheckLicenseII/ZipCodeSearch.aspx` — returns HTML, JS-driven, paginated
- An individual license lookup form

The bulk file (if CSLB still offers it) requires navigating a JS-driven form to trigger — there is no `curl`-able static URL.

---

## Option 1: GitHub Actions — Targeted Search Scraper

**Approach:** A scheduled GitHub Actions workflow uses Playwright (headless Chromium) to query the CSLB zip code search for each SFV zip code × each of our 5 classifications. Parses the result HTML, deduplicates, and POSTs candidates to `import-ingest-queue`.

**Pros:**
- Targets exactly what we need — no 300MB statewide file
- Free within GitHub Actions limits (~2,000 min/month)
- Runs in Node.js with no memory/time constraints vs. edge functions
- Secrets (Supabase service role key) stored in GitHub repo secrets
- No infrastructure to maintain — triggers automatically on cron

**Cons / Risks:**
- CSLB HTML structure changes break the scraper (needs monitoring)
- Playwright adds ~200MB of chromium to the Actions runner (slower cold start)
- Search results paginate — need to handle multiple pages per query
- SFV has ~20 zip codes × 5 classifications = ~100 queries per run

**Effort:** M

**Best fit when:** You want full automation with zero manual steps.

---

## Option 2: GitHub Actions — Direct HTTP Fetch (URL Discovery Required)

**Approach:** User manually downloads the CSLB bulk file once with Chrome DevTools Network tab open to capture the real POST request / redirect URL. If that URL is stable (no session token in the path), a scheduled GitHub Actions script can replicate the request with a plain `fetch()`, no Playwright needed.

**Pros:**
- Simpler than Playwright once the URL is known
- Fastest runtime (no browser overhead)
- Bulk file captures everything in one shot

**Cons / Risks:**
- URL might include a session token, making it unstable
- If CSLB rotates the URL or adds CSRF protection, breaks silently
- Statewide file is large (~30–100MB compressed) — Actions runner needs memory

**Effort:** S (once URL is confirmed stable) — otherwise falls back to Option 1

**Best fit when:** You're willing to do one manual inspection to discover the URL.

---

## Option 3: Manual Step Stays, But Automated Processing

**Approach:** Keep the manual "download from CSLB" step but eliminate all the tedium: add a URL field to the Admin Ingestion page. Admin pastes the CSLB download link; a Vercel serverless function fetches the file server-side, streams it, parses, and auto-pushes to the queue. Admin never touches a file.

**Pros:**
- No GitHub Actions setup required
- No scraper to maintain
- Resilient — any CSLB URL change just requires a new paste, not a code fix

**Cons / Risks:**
- Vercel serverless functions have a 60-second timeout — large files may exceed it
- Still requires a human trigger each time (though it's a single paste, not a download)

**Effort:** S

**Best fit when:** You want a quick win with minimal infrastructure.

---

## Recommendation

**Option 1 (GitHub Actions targeted scraper)** for long-term automation. Here's why:

1. No dependency on a bulk file URL that may change or disappear
2. Targets only SFV + our 5 classifications — ~100 queries returns a few hundred candidates, manageable in a single Actions run
3. Free, runs on a weekly or monthly schedule, zero manual steps once set up
4. The existing `import-ingest-queue` edge function is the landing zone — the scraper just needs to format JSON and POST to it with the service role key

The workflow is:
```
GitHub Actions cron (weekly)
  → Playwright queries CSLB zip search (SFV zips × 5 classifications)
  → Deduplicates results
  → Chunks into 500-row batches
  → POST to import-ingest-queue with service role key
  → Logs pass/fail summary to Actions output
```

**Before building:** Confirm the SFV zip codes to target (we need a list). If you want to try Option 2 first (it's cheaper to implement), open Chrome DevTools → Network tab → download from CSLB manually → copy the actual request URL. If the URL has no session token, we can do Option 2 in an hour and skip Playwright entirely.
