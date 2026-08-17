# Project Knowledge

Durable technical learnings. Newest first.

---

## Supabase's request logs live behind a different door than the database
**Context**: Needed to verify zero production traffic was still using a disabled legacy API
key — a 24-hour window of real request logs, not a code-level assumption.

**Learning**: Supabase splits into two separately-authenticated backends: the actual Postgres
database (reachable via `supabase db query --linked`, used everywhere else this project talks
to Postgres) and a separate log/analytics store behind the dashboard's Logs Explorer. The CLI
has no subcommand for the second one, and the Management API token it uses internally lives in
the OS keychain — not readable from a script, and not something worth extracting even if it
were technically possible. A CSV exported from the Logs Explorer UI by hand is also not a
reliable substitute: the default export view can omit the `headers` field entirely (confirmed
— a real export handed over mid-investigation had `headers: {}` on all 246 rows), so it can
look like log access without containing what's actually needed.

**Pattern**: Use Supabase's hosted MCP server (`https://mcp.supabase.com/mcp`) instead of
fighting the CLI or relying on manual exports. Its `query_logs` tool runs real SQL against the
unified log stream (`edge_logs`, `postgres_logs`, `function_logs`, etc. — request headers like
the API key prefix live under `log_attributes['request.sb.apikey.apikey.prefix']`). This
project now has that connection configured — see the `homequote-supabase-mcp-access` memory
entry before re-deriving any of this.

---

## MCP OAuth is one-login-at-a-time; use header auth to keep projects isolated
**Context**: This machine has many unrelated Supabase accounts across other local projects.
A remote MCP server's default auth (OAuth, sign in through a browser) risks one project's
sign-in silently logging out another project's session — the whole Claude Code install shares
one OAuth login per server type.

**Learning**: Supabase also doesn't offer a project-scoped Personal Access Token — a PAT is
always account-wide by design. So isolation can't come from the credential itself; it has to
come from how the credential is wired up.

**Pattern**: In `.mcp.json`, use `headers: { "Authorization": "Bearer ${VAR_NAME}" }` instead
of relying on OAuth discovery, with a *project-specific* variable name (e.g.
`SUPABASE_PAT_HOMEQUOTE`, never a generic `SUPABASE_PAT`) — that's what actually prevents a
second project's config from colliding with this one, even though both may hold account-wide
tokens underneath. Put the real token in `.claude/settings.local.json`'s `env` block (verify
it's gitignored on the machine in question with `git check-ignore` — don't assume), never in
`.mcp.json` itself, which is meant to be committed. `project_ref=` and `read_only=true` as URL
params on the server are what bound this token's actual reach, since the token itself
couldn't be scoped.

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

---

## Deployment state is invisible to git — and outdates audits within hours
**Context**: Reviewing the admin settings menu on 2026-07-27. An audit written the previous
day (`docs/audit_admin_settings_2026-07-26.md`) said 19 of 27 edge functions were undeployed
and that analytics had been dead since March.

**Learning**: Ten functions were deployed on 2026-07-26 between 22:58 and 23:02 — after that
audit was written, with only one intervening commit. Deploys leave **no trace in the repo**,
so any conclusion of the form "this panel controls nothing" has a shelf life measured in
hours. Re-checking flipped the verdict on three of the seven settings panels: Analytics
Exclusions went from inert to fully live, and SMTP went from one working email type to five.

**Pattern**: `supabase functions list --project-ref lrqdbpphallqehpdqalr` before reasoning
about what any admin control actually does. It returns JSON including `created_at`, needs
**no DB password** (unlike `migration list` or `db query`), and is far safer than probing
endpoints with HTTP — a probe of `send-outreach-drip` would send real email. Diff the slugs
against `ls supabase/functions/` to get the undeployed set.

---

## Settings panels that write keys nothing reads
**Context**: The Perplexity panel stored an API key in `admin_settings.perplexity_config`.

**Learning**: The only references anywhere were the panel that writes the key and the page
that renders the panel. Phase 2 enrichment in `implementation_plan.md` was never built, so a
live credential sat in the database with no consumer. The inverse also exists:
`outreach_templates` is read by the deployed `send-outreach-drip` via
`_shared/directory.ts`, but has no admin panel at all — that copy is locked to code defaults.

**Pattern**: Trace every `setting_key` to a reader before building or keeping a panel —
`grep -rn "<setting_key>" src/ supabase/`. A key with writers and no readers is a liability,
not a feature; a key with readers and no writers is a control you think you have and don't.

---

## `system-status` called an RPC that does not exist  *(fixed & deployed 2026-08-01)*
**Context**: Verifying the Scheduled Tasks card on the System Status page.

**Learning**: `supabase/functions/system-status/index.ts` called `adminClient.rpc("get_cron_jobs")`.
That function appears in **no migration**. The call was wrapped in a try/catch that set
`cronJobs = []`, so the card was structurally guaranteed to render its empty state forever —
it had never once displayed a job. Repointing it at `admin_list_cron_jobs` wasn't a plain
rename either: that function is `SECURITY DEFINER` gated on `is_admin()`, which reads
`auth.uid()` — and this edge function's cron call used `adminClient` (service-role, no user
context), so a naive fix would have traded one always-empty result for an always-`Forbidden`
one. The fix reuses `userClient` (built from the caller's own `Authorization` header,
already used above to verify the admin), so `auth.uid()` resolves to the same user already
confirmed as an admin.

The same file's `knownFunctions` health-check list was independently stale — 10 hardcoded
slugs against 26 real functions in `supabase/functions/`, missing 12 deployed ones and
including several that were never deployed. Expanded to the full list; deliberately keeps
functions known to be undeployed, since pinging them and getting a real "unreachable" is
itself the information that page exists to show.

**Pattern**: A `catch` that substitutes an empty collection turns a wiring bug into a
plausible-looking empty state. When a panel is *always* empty, check whether the thing
feeding it exists before assuming there's no data. Separately: a `SECURITY DEFINER` function
gated on `is_admin()` needs a client carrying the *caller's* JWT, not a service-role client —
same gotcha as the migration-time `Forbidden` case already in this file, just triggered from
an edge function instead of a migration.

**Status**: Fixed in `7c307b5`. Deployed to production.

---

## SECURITY DEFINER views aren't always wrong — context matters
**Context**: Supabase's security linter flagged `public_business_listings` and
`public_directory_cities` as CRITICAL for being SECURITY DEFINER-style views. The reflex
fix (set `security_invoker = true`) would break the public directory.

**Learning**: `public.businesses` has exactly two RLS policies, both gated on `is_admin()` —
anon has zero read access. These two views are the **only path** a site visitor ever sees a
business through. A DEFINER-style view runs the query as the owner (bypassing the caller's
RLS) — that's what lets it hand a filtered slice to anon despite anon having no direct grant
on the table. Flipping to `security_invoker = true` would enforce the *caller's* RLS instead,
and since anon's RLS on businesses is nothing, the entire public directory would return zero
rows to every visitor.

**Pattern**: The view's own WHERE clause (`is_published = true AND archived_at IS NULL`,
see `20260801240000`) is not a convenience filter on top of RLS — for anon, it *is* the
entire access control. If that clause is ever loosened or dropped without adding an
equivalent anon-readable RLS policy to businesses first, unpublished/archived rows become
public with nothing to catch it. Document this caveat on the view objects themselves via
`COMMENT ON VIEW` (appears in Supabase dashboard schema view, not just code). See
`20260801290000_document_view_security_definer_rationale.sql`.

---

## Admin writes fail silently without column GRANTs
**Context**: `Enrichment.tsx`'s Confirm/Dismiss buttons failed in production with
"permission denied for table businesses", even though the RLS policy passed (is_admin()).

**Learning**: Supabase grants privileges in two layers: table-level and column-level. An RLS
policy gates *rows*. A `GRANT UPDATE (column_name)` gates *columns* within those rows. A write
can pass RLS and still fail at the column grant step. The review queue was built and shipped
without a `GRANT UPDATE (email, email_source_url, ...)` on the columns it writes, so every
admin write was rejected.

**Pattern**: When adding a new admin write path, check what columns the code writes, then
add a `GRANT UPDATE (col1, col2, ...)` in a migration. The existing "Admins can publish
businesses" RLS policy already covers the row level; the grant adds the column level. This
has shipped broken three times on this project (is_published, outreach_suppressed_at,
email_* columns) — verify in production against your actual RLS policies before assuming
the pattern is in place.

---

## Hand-declared tables need WritableTable casts for proper typing
**Context**: `PhotoModeration.tsx` failed TypeScript with "Argument of type '{ status:
'rejected' | 'approved' }' is not assignable to parameter of type 'never'" when updating
`business_photos`.

**Learning**: Supabase's client auto-generates types from the schema in `types.ts`. Tables
manually typed in the codebase (like `business_photos`, defined only in migrations and RLS,
not schema inspection) resolve their write generics as `never` because the client has no
schema for them. This doesn't affect reads — only writes.

**Pattern**: For hand-declared tables, use the `WritableTable` cast pattern already
established in `directory.ts` for the `businesses` table. Create a typed function once (e.g.,
`setBusinessPhotoStatus`), apply the narrow `as unknown as WritableTable` cast there, and
call that function from everywhere else. This keeps the cast in one place and gives you real
type-checking on the values passed to it. See `src/integrations/supabase/directory.ts:269`
for the working example.
