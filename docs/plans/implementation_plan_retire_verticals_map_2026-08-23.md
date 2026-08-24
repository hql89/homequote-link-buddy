# Implementation Plan: Retire the hardcoded VERTICALS map

## Why

`src/lib/constants.ts` has a hardcoded `VERTICALS` object that only ever
defines one entry, `tree_service`. The real list of verticals (currently 5:
tree service, plumbing, HVAC, landscaping, electrical) lives in the
`verticals` database table and is already the source of truth for the
directory pages and — as of this session's earlier fixes — every admin
page. `VERTICALS` and its helpers are the last hardcoded holdout, still
read by the public lead-intake form and the lead-scoring service.

## Scope decisions (confirmed with the user)

- **Lead scoring gap**: `leadScoringService.ts`'s point table only covers
  `tree_service`. Any other vertical will get a **neutral placeholder
  score** for the service-type dimension, clearly commented as "not yet
  tuned" — not a guess at real point values, and not silently 0 (0 already
  means something specific: "known, low-intent service type").
- **Edge functions**: `supabase/functions/notify-admin-email/index.ts` has
  its own separate, already-drifted hardcoded vertical map, and two other
  functions hardcode `"plumbing"` as a default. **Out of scope for this
  pass** — flagged as a follow-up, not touched here.

## What changes

### 1. `src/lib/constants.ts`
Remove: `VERTICALS`, `VerticalKey`, `ALL_SERVICE_TYPES`, `getServiceTypes()`,
`getVertical()`, `verticalFromServiceType()`, `SERVICE_TYPES`. (Confirmed
zero remaining consumers once steps 2–4 land — `VERTICALS`/
`ALL_SERVICE_TYPES`/`SERVICE_TYPES` already have zero live imports today.)
Everything else in the file (site constants, cities, urgency levels, lead
statuses, contact methods) is untouched.

### 2. `src/components/forms/steps/ContactStep.tsx`
Replace the `getVertical(vertical).label` fallback (only reachable if a
caller forgets to pass `categoryLabel`) with a plain humanizer of the
vertical slug itself — `"plumbing"` → `"plumbing"`, `"tree_service"` →
`"tree service"` — so it stays safe without depending on a map that only
ever knew one vertical. Drop the `VerticalKey` type import; `vertical`
becomes a plain `string` prop.

### 3. `src/components/forms/steps/ServiceStep.tsx`
Drop the `getServiceTypes(vertical)` fallback entirely — `Index.tsx` (the
only real caller) already always supplies live `serviceTypes` before this
component can render. Since that was the only use of the `vertical` prop
in this component, the prop is removed too (dead once the fallback is
gone).

### 4. `src/components/forms/LeadCaptureForm.tsx`
Drop the hardcoded `vertical = "tree_service"` default. `vertical` becomes
an optional plain `string` prop, passed through as-is (including the
brief instant during initial vertical auto-selection where it's genuinely
`undefined` — already true today, already harmless, see below).

### 5. `src/components/forms/useLeadFormSubmit.ts`
Drop the `VerticalKey` type import (`vertical: string` instead). Where
`vertical` is spread into the lead insert payload, only include it when
it has a real value (`...(vertical ? { vertical } : {})`) instead of ever
writing a placeholder — the `leads.vertical` database column already has
its own server-side default for the rare case this key is omitted, so
this is strictly more honest than today's forced default, not a new risk.

### 6. `src/services/leadScoringService.ts`
Fix the actual bug this retirement forces into the open: `scoreLead()` is
called with the raw form values, which have never included a `vertical`
field — so `scoreServiceType`'s `vertical` parameter has always been
`undefined` in production, and it has always silently fallen through to
`verticalFromServiceType()`, which only recognizes tree-service service
types and defaults every non-match back to the tree-service table. Net
effect today: **every non-tree-service lead already scores 0 on this
dimension**, indistinguishable from "recognized and rated low-intent".

Fix: drop the unused `vertical` parameter and the `VerticalKey`-keyed
wrapper entirely. `scoreServiceType(serviceType)` checks the existing
tree-service point table; a match uses its real point value, a miss (any
other vertical's service type) gets a documented neutral placeholder
(10 — the table's own midpoint) instead of 0, with a comment explaining
why and that per-vertical tables are a future improvement, not a value
to guess at now.

### 7. Test updates
- `tests/unit/ContactStepVertical.test.tsx`: update the expected label
  text for the "no `categoryLabel` supplied" cases to match the new
  humanizer output instead of the old hardcoded map's exact wording.
- Add a small regression test on `leadScoringService.ts` proving a
  non-tree-service lead gets the neutral placeholder score, not 0.

## Not changing

- `src/lib/verticalIcons.ts`, `getVerticalIcon` — unrelated, no
  `constants.ts` dependency.
- Any edge function (`notify-admin-email`, `send-lead-confirmation`,
  `send-nurture-emails`) — flagged as a follow-up per the scope decision
  above.
- `supabase/functions/_shared/enrichmentAssessment.ts`'s `CLASS_NAMES` —
  a different domain concept (CSLB license-class → trade name for AI
  prompts), not a copy of `VERTICALS`.

## Test strategy

- `npx tsc --noEmit` — confirm no dangling imports anywhere in the
  codebase after the exports are removed.
- `npx eslint .` — full project.
- Updated/new unit tests above, plus the full existing suite
  (`npx vitest run`) to confirm no regressions — particularly
  `Index.test.tsx` (public lead form + vertical picker) and the admin
  tests already covering the live-verticals migration from earlier in
  this session.
- No database migration involved — this is a frontend-only change; the
  `verticals` table and its RLS/grants are untouched.

## Rollback

Pure code change, no migration, no deploy-state dependency — `git revert`
the commit if anything regresses. Nothing to roll back on the database
side.

## Acceptance criteria

- [ ] `VERTICALS`, `VerticalKey`, `ALL_SERVICE_TYPES`, `getServiceTypes`,
      `getVertical`, `verticalFromServiceType`, `SERVICE_TYPES` no longer
      exist in `src/lib/constants.ts`.
- [ ] The public lead form (all 3 steps) still renders and submits
      correctly for a DB-backed vertical (e.g. plumbing), verified via
      the existing `Index.test.tsx` coverage plus the updated
      `ContactStepVertical.test.tsx`.
- [ ] A non-tree-service lead's `lead_score` reflects the documented
      neutral placeholder, not a silent 0, with a passing regression test.
- [ ] `tsc --noEmit`, `eslint .`, and the full `vitest` suite are clean.
