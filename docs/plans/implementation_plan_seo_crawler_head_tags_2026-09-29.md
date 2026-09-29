# Implementation Plan: Serve real per-page head tags to crawlers (ENH-012)

## Plain summary

- **What it does:** Makes every page tell search engines what it actually is. Today all 553 pages
  hand over the same file, carrying the homepage's name and a line saying "I'm a copy of the
  homepage — index that instead." This gives each contractor listing, each city page and each
  ordinary page its own name, description and identity, in the file a search engine receives,
  before any code runs in the browser.
- **Does this already exist?** Half of it. Every page already works out its own correct name and
  description — that work is done and stays. It just happens a moment too late, after the page
  loads, which a visitor sees but a search engine often does not. Nothing needs inventing; the
  existing answers need delivering earlier. No tool or setting already in the project does this.
- **Is this the best way?** I believe so, and I considered two alternatives. Building all 553 pages
  in advance would go stale the moment you publish a new contractor and would slow every release.
  Rebuilding the site to assemble pages on the server is a far larger change than the problem
  warrants. The chosen route intercepts the page on its way out and fills in the right details —
  small, always current, and it does not touch how the site behaves for visitors.
- **What you will notice / what stays the same:** Visitors notice nothing. The site looks and
  behaves exactly as now. What changes is only what a search engine is handed. Nothing appears in
  search immediately — re-listing takes weeks, and I cannot shorten that.
- **Risks:** Three worth knowing. Search engines may take weeks to revisit, so silence afterwards
  does not mean failure — I will give you a way to confirm the fix itself worked on day one, which
  is a separate question from whether traffic follows. If the lookup this needs is ever
  unavailable, the page must still load normally rather than break; I will build it to fall back
  silently and will test that. And this makes your pages eligible to be listed — it does not
  promise anyone is searching. That question only becomes answerable once this ships.
- **Undo:** **Moderate** — restore the files and redeploy; minutes of work, then a deploy. Nothing
  is permanent: no database changes, no messages sent, nothing published outside your own site. I
  will rehearse the undo before shipping by confirming the site serves correctly with the new piece
  switched off.
- **Who does the work:** Strong model throughout. It is small but it is judgment-heavy — one wrong
  identity line is what caused this problem in the first place, and the failure mode is silent. No
  part is worth splitting into its own thread.
- **Cost:** Small.
- **How you will know it worked:** I will fetch a contractor's page the way a search engine does,
  with nothing running in the browser, and show you that contractor's name in the page's title and
  that page's own address as its identity. Today both say the homepage. That check needs no
  judgment and I will run it on the live site after deploying, not just locally.
- **What else it touches:** Your outreach emails and your sitemap both build links from one shared
  setting for the site's address, so the decision below reaches them. Nothing else is affected, and
  no other open plan in the project touches these areas. One step may need you: see below.
- **What you need to decide:** One thing — your site answers to two addresses, with and without the
  "www". Everything in the code says the plain one; the live site redirects to the "www" one. They
  have to agree, or the fix repeats the same mistake in a quieter way. **My recommendation: change
  the code to say "www", which matches what visitors already land on.** I can do that entirely
  myself and verify it. The alternative — making the plain address primary — keeps the code as-is
  but needs you to change a setting in your hosting dashboard, which I cannot and should not do.

---

## Objective

Every route on the site returns the same static `index.html`, whose head contains the homepage's
`<title>`, the homepage's description, and `<link rel="canonical" href="https://homequotelink.com/">`.
The canonical is the damaging part: all 553 URLs in the sitemap declare themselves duplicates of
the homepage, which is an explicit instruction not to index them. `PageMeta` computes the correct
values per route but does so in a `useEffect`, so they exist only after JS executes.

This plan delivers correct head tags in the HTML a crawler receives, without changing what visitors
experience and without a build-time data dependency, and settles the apex-vs-`www` inconsistency
that would otherwise reintroduce a weaker version of the same problem.

## Acceptance Criteria

- [ ] `curl -sL https://<host>/directory/<city>/<slug>` returns that business's name in `<title>`,
      a listing-specific `<meta name="description">`, and `<link rel="canonical">` equal to that
      page's own absolute URL — with no JavaScript executed.
- [ ] The same holds for a city page (`/directory/<city>`) and the directory index (`/directory`).
- [ ] No route anywhere on the site returns a canonical pointing at `/` unless it *is* `/`.
- [ ] Crawler-facing `<title>`/description for a given route are byte-identical to what `PageMeta`
      sets for that same route in the browser — one source of truth, verified by test.
- [ ] Hosts agree: the sitemap, the canonical tags and `SITE_URL` all use the same host, and that
      host serves 200 rather than redirecting.
- [ ] A failure of the metadata lookup serves the page unchanged rather than erroring — proven by a
      test that simulates the failure.
- [ ] `npm run typecheck`, `npx eslint`, `npm run build` and `npx vitest run` all clean; test count
      up by the new tests and no existing test changed to accommodate this.

## Component Discovery

### Reused Existing
- `PageMeta` — keeps its job for client-side navigation. Unchanged behaviour; it will consume the
  extracted metadata module rather than computing strings inline.
- `pageTitle()` / `SITE_NAME` / `SITE_URL` in `src/lib/constants.ts` — the title convention and host
  already live here and are reused rather than restated.
- The `public_business_listings` view and the exact query shape `supabase/functions/sitemap`
  already uses — the middleware needs the same rows, so it reuses the established read path rather
  than inventing one. Reads the view, never `businesses` (claim token exclusion).
- `src/pages/DirectoryListing.tsx` / `DirectoryCity.tsx` / `DirectoryIndex.tsx` — the title and
  description strings they already build are moved, not rewritten.

### New (Justified)
- `src/lib/routeMeta.ts` — pure functions deriving `{title, description, canonicalPath}` from a
  route's data. **Justified because the alternative is duplication:** the crawler path and the
  browser path must produce identical strings, and today those strings are inline in three page
  components. Without one shared source they will drift, and the drift is invisible — exactly the
  failure being fixed. Nothing existing does >80% of this; it is an extraction of logic that is
  currently scattered, not a new capability.
- `middleware.ts` — Vercel edge middleware. No serverless/middleware layer exists in this project
  (`vercel.json` has rewrites only), so there is nothing to extend. Scoped to the routes that need
  it and passes everything else through untouched.

## Files Changed

| File | Change Type | Reason |
|------|-------------|--------|
| `src/lib/routeMeta.ts` | add | Single source for per-route title/description/canonical |
| `middleware.ts` | add | Inject head tags into `index.html` for crawler-visible routes |
| `index.html` | modify | Remove the hardcoded `canonical` — a missing canonical is correct; a wrong one is not. Also affects `/faq`, `/blog`, `/providers`, which have the same bug |
| `src/components/PageMeta.tsx` | modify | Consume `routeMeta` so browser and crawler cannot drift |
| `src/pages/DirectoryListing.tsx` | modify | Use `routeMeta` instead of inline strings |
| `src/pages/DirectoryCity.tsx` | modify | Same |
| `src/pages/DirectoryIndex.tsx` | modify | Same |
| `src/lib/constants.ts` | modify | `SITE_URL` host, per the decision above |
| `supabase/functions/sitemap/index.ts` | config only | Already supports a `SITE_DOMAIN` override; set it rather than editing code |
| `tests/unit/routeMeta.test.ts` | add | Pure-function coverage incl. browser/crawler parity |
| `tests/unit/headInjection.test.ts` | add | String-in/string-out injection, incl. the lookup-failure fallback |

## Database Migrations

**None.** This is a delivery-layer change. No schema change, no data change, no new grants. The
middleware reads the existing `public_business_listings` view with the anon key, which is the same
access the public site already has.

## Test Strategy

- **Unit — `routeMeta`:** the title/description/canonical produced for a listing, a city and the
  index, including a business with no city and one with an apostrophe in its name.
- **Unit — parity:** assert the crawler path and `PageMeta` derive from the same function for the
  same input, so a future edit to one cannot silently diverge.
- **Unit — injection:** given the real `index.html` string, injecting a listing's tags replaces the
  title, the description and the canonical and leaves the rest byte-identical; given a simulated
  lookup failure, the input is returned unchanged.
- **Regression guard:** a test asserting `index.html` contains no hardcoded canonical, so the
  original defect cannot be reintroduced by a future edit.
- **Mutation check:** per `docs/knowledge.md`, each new guard is verified by breaking it once and
  confirming exactly the intended test fails — an unexercised guard is a guess.
- **Manual, on the live site after deploy:** `curl` a listing, a city page and the index; confirm
  the acceptance criteria above with no JS executed. Then request reindexing.

## Rollback

Revert the commit and redeploy. `middleware.ts` is additive — deleting it restores today's exact
behaviour, since every other change is either an extraction with identical output or the removal of
a tag that is currently wrong. Nothing is irreversible: no migration, no data write, no outbound
message. Rehearsal: before shipping, confirm the site serves correctly with the middleware disabled,
so the undo path is known to work rather than assumed.

Host change rollback: restore `SITE_URL` and unset `SITE_DOMAIN`. Since nothing is currently indexed
under either host, there is no search equity to lose in either direction — which is precisely why
this is the cheapest moment to settle it.
