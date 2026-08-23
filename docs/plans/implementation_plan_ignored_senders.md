# Implementation Plan: Ignored Senders (reply-inbox noise filter)

Status: **built and deployed 2026-08-23.** Migration 20260823230000 applied;
receive-inbound-email at version 8.
Date: 2026-08-23

## Plain-language summary

The Replies page is meant to show contractors answering your outreach. Right
now 17 of its 18 rows are Vercel login codes, GitHub notices and Supabase
marketing. This adds a short list of senders to ignore. Mail from an ignored
sender is still saved (nothing disappears), but it is filed under "Ignored"
instead of landing in your queue. You add to the list with one click on any
noise message you see.

## Objective

Give `/admin/replies` a sender-level ignore list so ordinary operational mail
stops occupying the human review queue, without ever silently discarding a
message and without weakening bounce handling or unsubscribe handling.

The existing `blocked_emails` / `blocked_phones` blocklist is deliberately NOT
extended for this. That list guards the public lead form (`check-blocklist`,
`submit-directory-lead`) and its semantics are "this person may not submit a
quote request". Wiring it into the reply inbox would conflate two unrelated
judgements: adding `vercel.com` there so deploy mail stops showing up would
also start rejecting homeowner leads from that domain. Separate concern,
separate table.

## Acceptance Criteria

- [x] A new `ignored_senders` table exists, holding either a full address
      (`system@vercel.com`) or a domain (`vercel.com`).
- [x] A domain pattern matches subdomains: `vercel.com` matches
      `ship@info.vercel.com`.
- [x] `receive-inbound-email` files a matching message as
      `classification = 'ignored'` with `handled_at` pre-set, and takes **no**
      other action on it — no business match, no auto-suppress, no URL extraction.
- [x] Bounce detection runs BEFORE the ignore check, so ignoring `googlemail.com`
      can never blind the system to a delivery failure from Gmail's daemon.
- [x] An ignored message is still inserted into `inbound_emails` — never dropped.
      A round-trip through the Ignored view can show it.
- [x] The "unhandled" and "all" views exclude ignored rows; a third "ignored"
      tab shows them.
- [x] Each reply card has an "Ignore sender" control offering both
      "this address" and "everything from <domain>".
- [x] Adding a pattern retroactively re-files matching past messages, and the
      confirmation states how many were re-filed.
- [x] Adding a pattern is REFUSED if it would match the email of any row in
      `businesses`, with an error naming the business. You cannot accidentally
      mute a real contractor.
- [x] Adding a pattern is REFUSED for a single-label pattern (`com`, `net`) that
      would match most of the internet.
- [x] Adding a pattern is REFUSED for a public mail provider (`gmail.com`,
      `outlook.com`, …). Added during implementation, not in the original
      plan: the businesses-collision check above is a snapshot of the
      directory as it stands today, so on its own it would allow `gmail.com`
      on a day when no contractor happened to use one — and then silently
      mute every contractor added afterwards.
- [x] An "Ignored senders" section lists current patterns with a Remove button.
- [x] `bounce` and `self_sent` render a correct badge label (existing defect —
      the current 4-key map renders an empty badge for the one bounce row in
      production).
- [x] `npm run lint`, `npx tsc --noEmit`, and `npm test` all pass.

## Component Discovery

### Reused Existing
- `AdminLayout`, `PageMeta`, `HelpTip`, `Badge`, `Button` — page already uses them.
- `dropdown-menu.tsx` (`src/components/ui/`) — already in the project; used for
  the two-option Ignore control. No new UI primitive.
- The "Suppressed businesses" section at the bottom of `Replies.tsx` — the
  Ignored-senders section is the same list+Remove shape, written to match it.
- The add-a-pattern form mirrors `SpamMonitor.tsx`'s existing add-to-blocklist
  form (input + button + toast), so the two management surfaces read alike.
- `admin_recent_alarms` (20260820220000) — template for the new RPCs:
  `SECURITY DEFINER`, `is_admin()` guard, `REVOKE ... FROM anon, PUBLIC`.
- `directoryDb` — the browser client, which carries the admin's JWT, so
  `auth.uid()`/`is_admin()` resolve inside the RPC.

### New (Justified)
- `supabase/functions/_shared/ignoredSenders.ts` — a pure matcher.
  New because no existing module does sender-pattern matching, and it must be
  free of Deno APIs so the unit test can import it directly. This is the same
  convention `inboundClassifier.ts` follows and states in its header.
- `admin_add_ignored_sender` / `admin_remove_ignored_sender` RPCs.
  New because the validation (business-collision check, single-label rejection)
  and the retroactive sweep must be one atomic server-side operation. Note:
  `inbound_emails` already carries table-level privileges for `authenticated`,
  so this is NOT about getting past a grant — it is about not letting the
  browser rewrite `classification` freely, and about the checks being
  unskippable.

## Files Changed

| File | Change Type | Reason |
|------|-------------|--------|
| `supabase/migrations/20260823HHMMSS_ignored_senders.sql` | new | Table, RLS, `ignored` classification, both RPCs |
| `supabase/functions/_shared/ignoredSenders.ts` | new | Pure, testable address/domain matcher |
| `supabase/functions/receive-inbound-email/index.ts` | modify | Load patterns; ignore-check after bounce, before `classifyReply` |
| `src/integrations/supabase/directory.ts` | modify | Widen `classification` union to include `bounce`/`self_sent`/`ignored`; add `IgnoredSenderRow`; add list/add/remove helpers |
| `src/pages/admin/Replies.tsx` | modify | Third view tab, ignore control per card, Ignored-senders section, fixed label map |
| `tests/unit/ignoredSenders.test.ts` | new | Matcher unit tests |
| `tests/unit/Replies.test.tsx` | modify | View filtering, ignore action, label coverage |

## Database Migration

One migration. Full contents summarized:

```sql
CREATE TABLE public.ignored_senders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_type TEXT NOT NULL CHECK (match_type IN ('address', 'domain')),
  pattern    TEXT NOT NULL,                    -- stored lower-cased
  note       TEXT,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_ignored_senders_pattern
  ON public.ignored_senders (match_type, pattern);

ALTER TABLE public.ignored_senders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read ignored senders"
  ON public.ignored_senders FOR SELECT TO authenticated USING (public.is_admin());
-- No client INSERT/DELETE policy: writes go through the RPCs, which run the
-- business-collision check that makes the feature safe.

-- Seventh classification value.
ALTER TABLE public.inbound_emails DROP CONSTRAINT IF EXISTS inbound_emails_classification_check;
ALTER TABLE public.inbound_emails ADD CONSTRAINT inbound_emails_classification_check
  CHECK (classification = ANY (ARRAY[
    'unsubscribe','confirm','website','unclassified','bounce','self_sent','ignored'
  ]));
```

`admin_add_ignored_sender(p_match_type, p_pattern, p_note)` → `integer`
(count of past messages re-filed):
1. `is_admin()` or raise `Forbidden`.
2. Lower-case and trim. Reject a domain pattern with no `.`.
3. Reject if any `businesses.email` matches the pattern — raise with the
   business name. This is the guard that stops a real contractor being muted.
4. Insert (`ON CONFLICT DO NOTHING`).
5. Sweep: `UPDATE inbound_emails SET classification='ignored',
   handled_at = COALESCE(handled_at, now())` where the sender matches AND
   `business_id IS NULL` AND `classification NOT IN ('ignored','bounce')`.
   The `business_id IS NULL` and `bounce` exclusions mean a sweep can never
   hide a message tied to a real business, nor a delivery failure.
6. Return the sweep count.

`admin_remove_ignored_sender(p_id)` → `void`. Deletes the pattern. Past
messages already filed as `ignored` stay filed — they remain visible in the
Ignored tab, and re-litigating history on a delete is more surprising than
leaving it.

### Optional seed (your call — say yes/no)

The migration can pre-fill four domain patterns proven noisy by your own data:
`vercel.com`, `github.com`, `supabase.com`, and address `welcome@supabase.com`.
This would re-file 17 existing rows. `googlemail.com` is deliberately NOT
seeded. Anything seeded is removable from the UI in one click. **Default: skip
the seed** — you click Ignore on the first few and the list builds itself,
which also proves the button works.

### Rollback

```sql
DROP FUNCTION IF EXISTS public.admin_add_ignored_sender(text, text, text);
DROP FUNCTION IF EXISTS public.admin_remove_ignored_sender(uuid);
DROP TABLE IF EXISTS public.ignored_senders;
-- Rows already filed as 'ignored' must be reclassified BEFORE the CHECK is
-- narrowed, or the constraint will not validate:
UPDATE public.inbound_emails SET classification = 'unclassified' WHERE classification = 'ignored';
ALTER TABLE public.inbound_emails DROP CONSTRAINT IF EXISTS inbound_emails_classification_check;
ALTER TABLE public.inbound_emails ADD CONSTRAINT inbound_emails_classification_check
  CHECK (classification = ANY (ARRAY['unsubscribe','confirm','website','unclassified','bounce','self_sent']));
```
Front-end rollback is a `git revert`; the edge function rolls back by
redeploying the previous version. Nothing here is destructive — no message is
ever deleted, so a full rollback loses no mail.

## Ordering inside receive-inbound-email

This is the load-bearing decision in the plan.

```
auth token -> parse -> self-sent guard -> BOUNCE -> IGNORE LIST -> classifyReply
```

- Ignore sits **after** bounce so a pattern can never suppress a delivery
  failure. Ignoring `googlemail.com` still leaves `mailer-daemon@googlemail.com`
  bounces fully processed.
- Ignore sits **before** `classifyReply` so an ignored message takes no
  automatic action at all. This matters concretely: `UNSUBSCRIBE_RE` matches
  the word "unsubscribe", which appears in every marketing footer. Two rows in
  your table (`welcome@supabase.com`, `ship@info.vercel.com`) are already filed
  as "Unsubscribed" for exactly that reason. They caused no damage only because
  neither matched a business. That is luck, not design — this ordering removes
  the luck.
- A read of `ignored_senders` is added to the function. On a read failure the
  function logs and continues **without** ignoring anything — fail-open, because
  the cost of a failed read is a noisy inbox, whereas fail-closed would mean
  dropping a real reply.

## Test Strategy

Unit (`tests/unit/ignoredSenders.test.ts`, pure, no mocks):
- exact address match, case-insensitive
- domain match on the domain itself and on a subdomain
- domain pattern does NOT match a lookalike (`notvercel.com` vs `vercel.com`)
- single-label pattern rejected
- empty pattern list matches nothing

Component (`tests/unit/Replies.test.tsx`, extending the existing jsdom +
mocked-supabase harness — the pattern noted in memory for auth-gated admin
routes):
- an `ignored` row does not appear in the unhandled view
- the ignored view lists it
- "Ignore sender → everything from vercel.com" calls the helper with
  `{match_type: 'domain', pattern: 'vercel.com'}` — never a raw table write
  from the page, matching the rule this codebase has enforced since the
  businesses-publish permission bug
- a `bounce` row renders the "Delivery failed" badge, not an empty one

Manual verification (against the real project, before calling it done):
1. `select classification, count(*) from inbound_emails group by 1` — baseline.
2. Click Ignore on a Vercel row; confirm the toast reports the sweep count.
3. Re-run the query; confirm the count moved and total row count is unchanged.
4. Confirm the Ignored tab shows them and the unhandled queue is short.
5. Attempt to ignore a domain belonging to a real business — confirm refusal.

## Deployment note

`receive-inbound-email` is currently deployed at version 7. Deploy state is not
in git, so the deploy step re-checks `supabase functions list` before and after
`supabase functions deploy receive-inbound-email` and confirms the version
incremented — a code change alone changes nothing about live behavior.

## Out of scope

- Any change to `blocked_emails` / `blocked_phones` or the lead-form path.
- Making `classifyReply` smarter about marketing footers. Narrowing
  `UNSUBSCRIBE_RE` risks missing a real STOP, and the classifier's header is
  explicit that wrongly continuing to email someone who said stop is the
  failure that matters. The ignore list solves the observed problem without
  touching that trade-off.
- Rules on subject or body content. Sender-based only — predictable, and a
  human decides every entry.


## What was actually verified

Executed against the live project on 2026-08-23:

- Migration applied; `supabase migration list` shows local and remote in step.
- `receive-inbound-email` redeployed, version 7 → 8, and a deliberately-wrong
  webhook token returns 401 — which also proves the new `ignoredSenders.ts`
  import resolves, since the module graph loads before the token check.
- `public.sender_matches_pattern` agrees with the TypeScript matcher on all
  four cases that matter: exact address, subdomain, lookalike domain, and
  local-part-only. The two implementations must not drift; this is the check
  that catches it.
- Both RPCs exist; `authenticated` may execute them, `anon` may not.
- Every refusal predicate returns the right verdict against real directory
  data — `com` refused as single-label, `gmail.com` and `GMAIL.COM` refused as
  public providers, `not-an-email` refused as malformed, `vercel.com` allowed.
- 25 unit tests pass (12 matcher, 13 page); full suite 584 pass.
- The ignored-exclusion test was mutation-checked: removing the `.neq` filter
  from the page makes it fail.

Not verified live, and worth knowing:

- The RPCs' `RAISE EXCEPTION` branches were not executed end-to-end. The
  available database connection is read-only and the functions are gated on
  `is_admin()`, which that connection is not. The predicates each branch tests
  were verified individually (above); the `RAISE` wiring around them was read,
  not run.
- No inbound message has yet flowed through the new ignore path in
  production — that needs the n8n webhook token, which is held only in the
  edge-function secrets. First real vendor email to arrive after a rule is
  added will confirm it.
