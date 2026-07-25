# Project Knowledge

Durable technical learnings. Newest first.

---

## The phone boundary (load-bearing product invariant)
**Context**: The site is a directory of *other people's* businesses. The owner's fear —
stated directly — was "businesses will think we're trying to steal their leads."

**Learning**: Whose phone number appears on a page is the single detail that separates a
directory partner from a lead broker in a contractor's mind. It cannot be left to
per-page judgement.

**Pattern**: `Header` takes an explicit `variant`:
- `portal` — pages **we** own (home, `/directory`, `/directory/:city`, our SEO guides).
  Carries the Valley matching hotline.
- `listing` — a business's own listing or claim page. Carries **no** site phone and no
  nav. The only `tel:` link on such a page must be that business's own number.

Tracking numbers (CallRail etc.) follow the same ownership split: legitimate on our own
SEO guide pages, never on a business's listing page. Approved 2026-07-25 as a deliberate
change from the original spec.

`tests/unit/HeaderVariant.test.tsx` asserts this. If it fails, a shipped promise is being
broken, not just a test.

---

## Shipped copy constrains future implementation
**Context**: Listing pages state *"Calls go directly to {Business} — no tracking number,
no middleman."* A later instruction called for CallRail number-swapping on those same
pages.

**Learning**: A user-facing promise in production is a constraint on the codebase, not
decoration. Implementing the change as specified would have silently made live copy false
on the exact page where a sceptical contractor checks.

**Pattern**: When an instruction contradicts shipped copy, surface the conflict and
propose a resolution that preserves both goals — don't quietly implement one and break the
other, and don't leave a claim in production the implementation contradicts. Either the
behaviour or the copy changes, in the same commit.

---

## Two sources of truth for service categories
**Context**: The footer advertised Plumbing/HVAC/Landscaping/Electrical while the homepage
form could only select Tree Service.

**Learning**: There are two category systems.
- `public.verticals` (DB) — the real one. Rows for tree-service, plumbing, hvac,
  landscaping, electrical with `service_types`, labels, icons, SEO copy.
- `VERTICALS` in `src/lib/constants.ts` — a legacy hardcoded map containing **only**
  `tree_service`.

The homepage called `useActiveVerticals()` and then rendered from the hardcoded map,
discarding the result.

**Pattern**: Read categories from the `verticals` table. Treat `VERTICALS` as legacy and
never index it directly with a runtime value — `VERTICALS[slug]` is `undefined` for every
DB-backed category and throws on property access. Use `getVertical()`, which falls back
safely. Note the key mismatch: DB slugs are hyphenated (`tree-service`), lead rows use
underscores (`tree_service`).

---

## Dead Supabase project references (recurring bug class)
**Context**: This codebase moved from project `cjdhbiuhzrpruqbbnnqz` to
`lrqdbpphallqehpdqalr`. Stale references keep surfacing, months later, in places nobody
looks.

**Learning**: Found so far — `admin_toggle_cron_job` (two jobs pointed at the dead project
with a matching anon key, so enabling them from the admin UI returned success while the
HTTP call could only fail), and `index.html`'s sitemap link, RSS feed and preconnect.

**Pattern**: `grep -rn "cjdhbiuhzrpruqbbnnqz" .` before assuming a config bug is
elsewhere. These fail silently — nothing errors, the work just never happens.

---

## SPA redirects that preserve SEO need `vercel.json`
**Context**: Planned migration of `/services/*` to `/directory/tree-service/*`.

**Learning**: A React Router `<Navigate>` is a client-side swap and passes **no** ranking
signal. Only a real 301 does.

**Pattern**: Add a `redirects` array to `vercel.json`. Vercel evaluates `redirects` before
`rewrites`, so it works alongside the existing catch-all
`/((?!assets/).*) -> /index.html`.

---

## Supabase CLI notes
- `supabase db query --linked` (not `db execute`); pipe SQL via stdin.
- `cron.job` does not exist until `pg_cron` is installed — a query against it errors with
  `42P01` rather than returning empty. `pg_cron` is **not** currently enabled.
- Migrations run with no JWT, so any `SECURITY DEFINER` function gated on `is_admin()`
  (which reads `auth.uid()`) will raise `Forbidden` if called from a migration. Inline the
  work instead.
- PostgREST bulk insert requires every object in the array to have identical keys.
