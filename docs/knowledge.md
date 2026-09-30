# Project Knowledge

Durable technical learnings. Newest first.

---

## A concatenated `.select()` string silently loses supabase-js's column typing
**Context**: Extending `submit-directory-lead`'s business lookup to select two more
columns, written as `"a, b, c" + " ,d, e"` for line-length reasons. `deno check` then
failed with 10 errors, all `Property 'x' does not exist on type 'GenericStringError'` —
every field on `business`, even ones untouched by the edit.

**Learning**: supabase-js infers the shape of a query's result from the *literal string
type* of the argument passed to `.select()`. That inference only works when TypeScript can
see the argument as a string literal. A `+`-concatenated string widens to the general
`string` type at the call site, so the overload resolution can't parse column names out of
it and falls back to an opaque `GenericStringError` — every field access after that reads
as nonexistent, even fields that were already being selected correctly before the edit.

**Pattern**: Keep a `.select()` argument as a single unbroken string literal (a multi-line
template literal without interpolation works fine — line breaks inside the literal don't
break inference, only concatenation via `+` does). If the column list needs to be
constructed dynamically, that has to happen outside the type-checked call, e.g. building it
in a `const` and asserting the type back to a literal, not by writing `+` at the call site.

---

## Committing in a repo shared with a concurrent session: pathspec, not `-a`
**Context**: Went to commit a finished, reviewed change and found the working tree also
contained unrelated staged and unstaged changes from a different concurrent session
(a same-day canary-frequency change) that had not been part of this conversation at all.

**Learning**: `git commit -- <path> <path> ...` commits exactly the given paths' current
content — staged or not — without touching the index state of any other path. This is safe
to run even while another process holds unrelated changes staged in the same working tree;
`git add -A` or `git commit -a` are not, since either would sweep in and commit the other
session's in-progress work as if it were part of this one. New (untracked) files still need
an explicit `git add <path>` first — `git commit -- <path>` alone does not pick up a file
git has never seen — but that `git add` is likewise scoped to only the path given.

**Pattern**: Before committing in this repo, run `git status --short` first and confirm
every modified/staged path is one you actually touched this session. If it isn't, commit
by explicit pathspec (after `git add`-ing any new files by the same explicit paths) rather
than a blanket `-a`/`-A`, so a commit's authorship in `git log` stays honest about who
actually reviewed what's in it.

---

## Bundle-hash comparison can't detect a rebuild that changes nothing observable
**Context**: After untracking `.env` from git (moving its four values to Vercel's own
dashboard-configured Environment Variables instead), verified the resulting deploy by polling
the live site's bundle filename for 5+ minutes, expecting it to change. It never did, which
briefly looked like the build had silently failed or never run.

**Learning**: A Vite build's output hash is a function of the *bundle's content*, not of
where its inputs came from. Moving an environment variable's source from a committed `.env`
file to Vercel's dashboard doesn't change any source code, and if the actual values are
identical (as they were here — the dashboard was seeded with the same four values the file
had), the compiled output is byte-for-byte identical too. Same hash is the *correct* outcome
of a successful rebuild in that specific case, not evidence of a stuck or failed one. The
technique isn't wrong in general (see the Vercel-deploy-block entries above, where it
correctly detected staleness) — it specifically can't distinguish "never rebuilt" from
"rebuilt and produced identical output" when the change under test doesn't touch bundled
content.

**Pattern**: Hash comparison proves a deploy is *not* stale when the hash changes, but an
unchanged hash is inconclusive on its own — it needs the platform's own deployment status
(Vercel's Deployments list, in this project's case) as the actual source of truth for
whether a build ran at all. Reach for hash-diffing to confirm *what* shipped; reach for the
platform's own status to confirm *whether* something shipped. Don't substitute one for the
other when the change being verified is exactly the kind that can legitimately produce no
observable diff (env-var source relocation, comment-only changes, anything not compiled into
the bundle).

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

## Hand-declared tables need WritableTable casts  *(superseded 2026-09-27 — see below)*
**Context**: `PhotoModeration.tsx` failed TypeScript with "Argument of type '{ status:
'rejected' | 'approved' }' is not assignable to parameter of type 'never'" when updating
`business_photos`.

**Learning**: Supabase's client auto-generates types from the schema in `types.ts`. Tables
manually typed in the codebase (like `business_photos`, defined only in migrations and RLS,
not schema inspection) resolve their write generics as `never` because the client has no
schema for them. This doesn't affect reads — only writes.

**Superseded**: the diagnosis was right but the premise expired. `types.ts` had simply gone
stale — the tables were never un-inspectable, and regenerating it (d44cef2, cf9b22e) covered
all of them. `WritableTable` and the `DirectoryDatabase` shim it propped up were deleted in
4b1a0a5; writes now go through the real generated builder. **Do not reach for this pattern
again.** A table resolving to `never` on write means `types.ts` is behind the database, so
regenerate it first and only hand-declare if the table genuinely is not there. See
*Regenerate before hand-declaring* below.

---

## "Sent", "arrived" and "not spam-filtered" are three different claims
**Context**: Outreach halts itself unless a human confirmed delivery in the last 14 days, and
that confirmation is deliberately a separate button from "send test email". It looked like
belt-and-braces until the first real alarm email was forced through on 2026-09-27.

**Learning**: The alarm email was accepted by SMTP, logged `status: 'sent'`, and then rejected
by MailChannels — the relay inside this domain's SPF record — with `550 5.7.1 [CS] Message
blocked`. An ordinary test email from the same sender four hours earlier was delivered. The
sender was not blocked; the *content* was. The subject line had 120 characters of machine
output pasted into it ("... has failed 3 runs in a row, most recently ... Latest error: ...")
which reads exactly like the spam it was filtered as.

**Pattern**: Anything this project sends to a human — alerts especially — must look like
ordinary mail: a short fixed subject, detail in the body, no error strings or IDs in the
subject. And treat the three states as distinct when reasoning about delivery: SMTP accepting
a message proves nothing about arrival, and arrival proves nothing about the inbox rather
than spam. Only a human (or the Gmail connector) reading the inbox settles it. An alert that
is silently spam-filtered is worse than no alert, because it manufactures false confidence.

---

## A job that reports "success" while achieving nothing is the expensive failure mode
**Context**: `enrich-business-email` ran for 30 consecutive mornings against an expired
Perplexity key. Every row failed with HTTP 401. Every run logged `status: 'success'`, because
the function only called a run failed when the whole invocation threw. The admin page
summarised it as "0 verified", indistinguishable from a genuinely quiet day, and outreach
sent nothing for 28 days.

**Learning**: Three separate layers each rendered "broken" as "nothing to report": the
function's status, the page's summary (which returned no text at all when a run had no
`considered` count, so the panel simply disappeared), and the alarm sweep (which looks for
failed runs). Any one of them being honest would have surfaced it within a day.

**Pattern**: Distinguish *findings* from *faults* in run outcomes. `no_url` / `no_email` /
`fetch_failed` are findings about a business — plenty of contractors have no website — and
must never make a run look broken. A row that *threw* is a fault. All rows throwing means the
run achieved nothing and is a failure, not a success. Put the rule in a pure, tested function
(`summariseEnrichmentRun`) rather than inline, and make the UI render a failed run explicitly
rather than falling through to a conditional that hides it.

---

## Where a business *is* vs. where it *says it works*
**Context**: Enrichment marked a business `verified` only when a phone number found on its
website matched the CSLB licence phone. The operator's judgement, and it is right: contractors
routinely publish tracking numbers, answering services and mobiles never filed with CSLB, so a
mismatch says very little. A site placing the business outside the service area says a lot.

**Learning**: Rewriting the rule to lead on location surfaced two traps. First, nearly every
contractor site carries a long service-area footer, so treating a city *named on the page* as
evidence of location would verify a Fresno company that happens to list Sherman Oaks — the
exact case the change existed to catch. An address and a mention are different kinds of
evidence and must be kept apart. Second, every city this directory covers is a neighbourhood
of the City of Los Angeles, so an address reading "Los Angeles, CA" is entirely consistent
with a Tarzana business; the first cut flagged it as out-of-area.

**Pattern**: Three tiers, not two — covered (verify), nearby/greater LA and the Valley
(unremarkable, neither proof nor flag), genuinely distant (review). Detection had to improve
alongside the rule: the old address regex demanded `<City>, CA <zip>` exactly and found a
location on only 8 of 27 businesses, so leading with a signal that missing would have pushed
everything into the review queue. Out-of-area never auto-rejects, though the column permits
it — that is a reason for a person to look, not grounds to discard a business unattended.

---

## Mutation-test any "keep these two lists in sync" test
**Context**: Two tests existed specifically to catch drift — one pinning `alarmDisplay`'s
titles to the `AlarmKind` union, one that should have pinned the inbound classification set to
its CHECK constraint. Both passed while the drift they guarded against was present.

**Learning**: The alarm test asserted only that a title was non-empty and different from the
kind slug. `toDisplayAlarm` falls back to the raw error message for an unknown kind, and that
fallback satisfied both assertions — so `outreach_bounce_rate` shipped with no display entry
and the test stayed green. The classification test did not exist at all, despite a comment in
`directory.ts` recording that the union had already drifted behind the constraint once and
rendered an empty badge in production.

**Pattern**: A sync test must prove the value came from the mapping, not merely that *some*
value came back — give the fallback a distinctive sentinel and assert the result is not it.
Then verify the test by deliberately removing an entry and watching it fail, naming the
offender. A test that has never been seen to fail is a guess.

---

## `strict: false` means no nullability claim in `types.ts` is ever checked
**Context**: A task to retire the `DirectoryDatabase` shim was briefed with an expected
blocker: the generated view Rows type every column as `string | null` (Postgres cannot mark a
view column NOT NULL) where the hand-written `PublicBusinessListing` declares them
non-nullable, so the read sites relying on non-null should have failed to compile. They did
not — not one error.

**Learning**: `tsconfig.app.json` sets `"strict": false` and `tsconfig.json` sets
`strictNullChecks: false`, so TypeScript erases `| null` before anything can check it.
Verified directly rather than inferred: probing the inferred type of a read shows
`businesses.owner_name` — genuinely `string | null` in the generated Row — coming back as
plain `string`. This is not a view quirk or a supabase-js quirk; it is project-wide and
applies to every table.

**Pattern**: Never conclude a nullability mismatch is safe because `tsc` is green — it cannot
fail on one. Reason from the migration or the view SQL instead. Any plan whose safety argument
is "the compiler will catch it if a column can be null" is unfounded here. Conversely, don't
budget time for null-related type errors when swapping type sources; they will not appear.
Turning strict mode on is its own project with a wide blast radius, not a side effect of
another change.

---

## Regenerate before hand-declaring, and guard what you still hand-write
**Context**: `directory.ts` carried a hand-rolled `DirectoryDatabase` schema layered over the
client, plus two cast helpers (`WritableTable`, `RpcClient`) that existed only to feed it —
twelve `as unknown as` casts in one file. Its stated premise was that the tables and RPCs were
"absent from the generated `types.ts`". They were not absent; `types.ts` was just stale.

**Learning**: A stale `types.ts` is invisible in CI — Vite does not typecheck, so the build
stays green while `.from(...)` resolves to `never` and editor tooling rots. The workaround for
that invisibility (hand-declare the table, cast around the write) then long outlives the
problem, and each cast that papers over the gap also silently disables checking on everything
it touches: the `RpcClient` cast was erasing argument checking on RPCs that had been properly
generated for weeks.

**Pattern**: Two rules.

1. When a table or RPC types as `never`, regenerate `types.ts` first. Hand-declaring is the
   last resort, and if you do it, write the premise down so the next person can test whether
   it still holds — that comment is what made this cleanup findable.
2. Hand-written Row types are still worth keeping where they say what the generator cannot
   (CHECK-constraint unions like `InboundClassification`, view invariants, deliberate
   projections like `AdminBusinessRow`). But asserted shapes drift silently, so constrain
   them: `DeclaresOnlyRealColumns` in `directory.ts` fails the build if a hand-written type
   names a column the generated schema lacks, while allowing added columns. Verify such a
   guard by simulating the drift and watching it name the offender — an unexercised guard is
   a guess (see *Mutation-test any "keep these two lists in sync" test*).

Corollary for the narrowing itself: when a view's Row is genuinely wider than reality, state
the assumption once at the boundary rows enter the app (`toListings` / `toListing` /
`toCities`), next to the migration that justifies it — not as an unexplained cast in each of
the four pages that read the view.

---

## SMTP accepting a message is not the end of its journey
**Context**: Outreach was paused on 2026-09-28 after one of two emails was rejected by
MailChannels — the relay inside this domain's SPF record — and never reached the contractor.

**Learning**: The rejection arrives *after* SMTP has accepted and closed the connection. The
send therefore succeeds from the sender's point of view: `logEmailSend` writes `status: 'sent'`
and returns cleanly, and the bounce turns up seconds later as a separate inbound message. Two
consequences follow that are not obvious from reading the code:

1. **The Resend fallback in `mailer.ts` can never fire for this failure.** It triggers when
   SMTP throws. SMTP does not throw — it accepted. Anyone reading that fallback and assuming
   the project is protected against delivery failure is reading it wrong; it covers
   *connection* failure only. Moving to Resend therefore means making it the primary route,
   not configuring the existing fallback (ENH-006).
2. **`email_send_log.status = 'sent'` is a claim about acceptance, not delivery.** Cross-check
   against the actual inbox (the Gmail connector works for this) before concluding a send
   arrived. That is how the blocked message was found: the delivery record said sent, the BCC
   copy was absent from the inbox.

**Pattern**: Treat "accepted", "delivered" and "not spam-filtered" as three separate claims and
never let evidence for one be reported as evidence for another. When a send path has an
after-the-fact rejection mode, the only trustworthy confirmation is the receiving side.

---

## `cron.job` cannot be written from a migration on this project
**Context**: Pausing outreach by `update cron.job set active = false` failed with
`42501 permission denied for table job`, despite earlier migrations in the same session having
successfully called `cron.schedule(...)` and `cron.unschedule(...)`.

**Learning**: The migration role can EXECUTE pg_cron's functions but has no direct DML rights
on `cron.job`. The project already has the right tool: `public.admin_toggle_cron_job(jobname,
enable)`, SECURITY DEFINER and gated on `is_admin()`, which unschedules on disable and
re-creates the entry from a hardcoded schedule/command on enable. 20260814130000 states
outright that this toggle *is* the off switch for the outreach job.

**Pattern**: To change a scheduled job's state, use `admin_toggle_cron_job` (via Admin →
Settings → Background Jobs, which calls it) or `cron.schedule`/`cron.unschedule` inside a
migration — never `UPDATE cron.job`. Note the toggle recreates from a hardcoded definition, so
a schedule changed by migration must also be changed in that function or the next enable will
silently revert it.

---

## `example.com` is filtered by this project's own extractor
**Context**: Three new tests for the email extractor failed returning `[]` for perfectly
ordinary addresses.

**Learning**: `PLACEHOLDER_EMAIL_DOMAINS` in `emailEnrichment.ts` filters `example.com`,
`example.org`, `test.com`, `domain.com`, `mysite.com` and similar, because contractor sites
built from templates ship those addresses verbatim. The filter is correct; the test fixtures
were wrong.

**Pattern**: Use a plausible business domain in fixtures for anything touching email
extraction. A failing test here is far more likely to be the fixture than the filter.

---

## Measure a new filter's precision against real rows before shipping it
**Context**: An off-domain email had to stop reaching `verified` after a web developer's
address was stored as a contractor's contact and cold-mailed twice. The obvious rule —
refuse any address not on the page's own domain — shipped and deployed before anyone
counted what it would catch.

**Learning**: Counted afterwards against the 34 enriched businesses, it would have moved
**7 of 28 verified rows** into the review queue to catch **1** real problem. Six of the
seven were the business's own address on a shared provider
(`toptechbuilders@gmail.com` for Top Tech Builders Inc, and three more) or on a
near-variant of their own domain. Small contractors overwhelmingly use shared mailboxes —
5 of 34 here — so that was the common case, not an edge one. The missing distinction: a
shared mail provider is **no information**, not a red flag. `gmail.com` belongs to no
business; `micahrich.com` belongs to someone specific.

**Pattern**: "Strictly more conservative" is not a free claim. Being conservative about
sending pushes cost onto the review queue, and a check that fires six times wrongly per
real catch trains the operator to click past the queue it fills — which costs more than
the original defect. Before shipping a filter, run its predicate over the real table and
count what it would flag, how many of those are already flagged, and how many are actually
wrong. That is one SQL query and it changed the design here. Then pin the legitimate rows
it must not flag, by name, so a future tightening has to confront them rather than
rediscovering this.

---

## Metadata that only exists after JS runs is invisible to the check that matters
**Context**: 553 pages with a correct sitemap, crawling allowed, and zero search traffic
ever. `PageMeta` computed each route's title, description and canonical correctly — in a
`useEffect`. Every route served the same static `index.html`, whose canonical named the
homepage.

**Learning**: The content was right and the delivery was wrong, which is the hard version
of this bug: nothing a human looks at is broken. A visitor sees the correct page. The
sitemap is complete. Robots.txt allows everything. Every externally checkable signal
passes. The only thing that surfaces it is fetching a URL and reading the head — `curl`,
not a browser, because a browser runs the JS that hides the problem.

**Pattern**: For anything a crawler, a link preview or an email client consumes, the test
is the raw response, never the rendered page. `curl -sL <url>` and read `<title>` and the
canonical. Two corollaries: a *wrong* canonical is far worse than a missing one (a missing
one means "this URL is itself"), so never put a canonical in a shell served for every
route; and when the same string must be produced for both a crawler and a browser, derive
both from one function (`src/lib/routeMeta.ts`) — two copies drift, and this drift is
invisible by construction.

---

## Vercel edge middleware can only be verified in production
**Context**: The fix above is `middleware.ts`. It cannot run under `vite` or `vitest`.

**Learning**: Unit tests can cover everything the middleware *calls* but not that Vercel
picks up the file, honours the `matcher`, or exposes `VITE_*` env vars to the edge runtime.
Certifying it locally would have been a false claim of the kind this project has been
bitten by before (see *Deployment state is invisible to git*).

**Pattern**: Structure it so the untestable part is as thin as possible — the matcher, the
shell fetch, the response — and push route matching and data mapping into plain modules
with the network injected (`crawlerMeta.ts` takes a `RowFetcher`). Then deploy and `curl`,
in that order, and say plainly that the wiring is unproven until you have. Give the
middleware a failure posture of doing nothing: returning `undefined` serves the page
unmodified, because a missing meta tag costs a crawl while a thrown middleware costs the
visitor the page.

---

## git's auto-merge can delete working code and leave the typecheck green
**Context**: Recovering an unmerged commit from a diverged remote onto this line.
`git cherry-pick` reported conflicts in two files, which were resolved. It silently
auto-merged a third region, dropping three separate JSX blocks — a badge, a button's
guard condition, and the note that replaced the button.

**Learning**: The result compiled cleanly with zero type errors, and the feature was half
built: a button appeared where it should have been hidden, and the explanatory text did not
appear at all. Only the recovered tests caught it. A conflict marker is a *loud* merge
failure; a successful auto-merge that drops a hunk is a silent one, and TypeScript cannot
see a missing JSX element because nothing references it.

**Pattern**: After any cherry-pick or merge that touches a component, diff the result
against the *source* commit's version of that file, not just against your own branch —
`git diff <source-commit> -- <file>` shows what did not come across. Never treat a green
typecheck as evidence a merge was complete. If the incoming commit brought tests, run that
file specifically and first; if it did not, be more suspicious, not less. Related: a hunk
cut through the middle of a block on both sides means naive "keep both" resolution
unbalances the braces — the shared tail closes only the last side, and vitest reports
`Expected '}', got '<eof>'` with no test names, which does not look like a merge error.

---

## Marking a row "needs review" stops nothing from being sent
**Context**: A web developer's address was stored as a contractor's contact and cold-mailed
twice. The code path was fixed, but that row still held the wrong address. The obvious
cautious cleanup was to drop it from `verified` to `needs_review` and let a human look.

**Learning**: That would have been theatre. `email_confidence` is **not consulted by
anything that sends**. `emailSkipReason()` in `supabase/functions/_shared/directory.ts`
gates on `email_undeliverable_at` and `outreach_suppressed_at` and nothing else, so a row
at `needs_review` still receives homeowner quote-request notifications. Flagging it would
have shown as handled on `/admin/enrichment` while an uninvolved third party kept receiving
a homeowner's name and phone number. Only clearing the address — or suppressing the
business — actually stops a send.

**Pattern**: `email_confidence` is an input to *human review*, not a send gate. Before
treating a confidence change as remediation, read the gate that the send path actually
consults and confirm your field appears in it. More generally: a status column only protects
you if something reads it, and "it appears on the admin screen" is not the same as "it is
enforced". Check the enforcement point, not the display.

---

## A code fix to enrichment is forward-only — a rule change needs a re-queue
**Context**: The off-domain email rule shipped and deployed, then two rows were found still
carrying verdicts the new rule would not have given them.

**Learning**: `enrich-business-email` selects candidates on `enriched_at IS NULL`, so it
never revisits a row it has already processed. Every enrichment rule change is therefore
forward-only by construction: it governs rows not yet seen and leaves existing verdicts
exactly as the old rule left them. Deploying the fix is half the job.

**Pattern**: Ship the rule, then re-queue the rows the old rule judged, by clearing
`enriched_at` — the pattern `20260926050000` and `20260929000000` both use. Clear only
`enriched_at`, not the email: a run that finds no website that day would otherwise lose a
genuine address, and a successful run overwrites it anyway. Candidates come back ordered
`created_at` ascending, so old rows return near the front rather than behind the backlog.
Two things to state when you do it: which rows and why they were previously spared (the
earlier migration deliberately skipped `verified` rows on reasoning that later stopped
holding), and that the re-queue is inert until a run happens — with the daily job failing
for a missing Vault secret, that means a manual "Run now".

---

## The generator understates nullability in two fixed, predictable ways
**Context**: Retiring the last two cast helpers that sat over Supabase RPCs — `ArchiveRpc` in
`src/lib/archive.ts` and the `admin_recent_alarms` cast in `AlarmBanner.tsx` — both on the
stated premise that their RPCs were absent from the generated `types.ts`. As with
`directory.ts` before them, the premise was stale: all of them were present, with signatures
matching the deployed functions exactly.

**Learning**: Swapping a cast for the generated type does not automatically make the result
*correct*, because the generator is wrong about nullability in two specific ways, both
reproducible:

1. A `RETURNS TABLE (...)` column is **always** generated non-null, even when the function
   selects it straight from a nullable column. `admin_list_archived`'s `archived_by` and
   `archive_reason`, and `admin_recent_alarms`' `error_message`, all generate as `string` and
   are genuinely null in production rows.
2. A `param text DEFAULT NULL` argument generates as `param?: string` — optional, but not
   nullable. The optionality is the generator rendering the default; it loses that NULL is an
   accepted value.

Separately, any `jsonb` column or output generates as `Json`, which includes scalars and
arrays, not just objects. Combined with `strict: false` (see *`strict: false` means no
nullability claim in `types.ts` is ever checked*), none of the three can ever surface as a
compile error, so "it now uses the generated type" is not evidence of anything.

**Pattern**: Re-state the real nullability at the boundary rather than inheriting the
generator's optimism — `?? null` where the column is nullable, `?? {}` where a caller will
`Object.entries` the value. Confirm it from the migration or, better, the deployed function
(`pg_get_function_result` / `pg_get_function_identity_arguments`), because the migration may
not be what is running.

And prefer a mapping function that **names every column** over a keyof-subset guard like
`DeclaresOnlyRealColumns`. It is strictly stronger: the property accesses fail the build if a
column is renamed *and* force the nullability decision to be made per column rather than
inherited wholesale. Verified by renaming `archive_reason`, `error_message` and `table_name` in
the generated types and confirming the build failed naming each one — under the previous casts
all three compiled silently and would have rendered blank.

Counter-rule learned the same day: do not change a verified wire format for the sake of type
tidiness. `admin_archive_row`'s `p_reason` was almost switched from an explicit `null` to an
omitted key, on the correct-but-unverified reasoning that PostgREST would fall through to
`DEFAULT NULL`. An existing test pinned the null. The generated type being imprecise is not a
reason to alter what an audited path sends.

---

## Spreading an unchecked jsonb value corrupts the write instead of failing it
**Context**: Three admin screens merge the existing `admin_settings.setting_value` into the row
they upsert back, so that writing one preference does not clobber the others — a deliberate
pattern, added after earlier clobbering bugs. Each spelled the read
`...((existing?.setting_value as Record<string, unknown>) ?? {})`.

**Learning**: The `?? {}` in that expression protects the one case that needs no protection.
`...(null)` and `...(undefined)` are both no-ops in an object literal, so null was always
harmless. The dangerous values are the ones the cast asserts away: `setting_value` is jsonb,
a bare string is legal in it, and `{..."ab"}` spreads to `{0:"a",1:"b"}`. That result is then
upserted over the real settings row — the write succeeds, reports success, and the settings
are gone. A number or boolean spreads to `{}`, quietly discarding whatever was there.

**Pattern**: On any jsonb read that feeds a spread, `Object.entries`, `Object.keys` or a
property access chain, check the shape instead of asserting it — `jsonObject()` in
`src/integrations/supabase/json.ts` does exactly this and returns null for anything that is not
a plain object. Reach for it rather than writing another `as Record<string, unknown>`. The
general shape of the mistake is worth remembering beyond jsonb: a `?? fallback` next to a cast
often guards the benign branch while the cast hides the harmful one, which makes the line
*look* defensive. Ask which values the cast is suppressing, not which one the fallback catches.
