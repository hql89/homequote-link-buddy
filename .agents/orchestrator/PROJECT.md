# Project: HomeQuoteLink Lint Fixes

## Architecture
- Modules: `src/pages/admin/` (React components), `supabase/functions/` (Edge functions), `src/services/` (Services), configuration (`tailwind.config.ts`).
- Goal is strictly 0 lint errors/warnings. Data-fetching functions added to `useEffect` dependencies must be wrapped in `useCallback` to prevent infinite loops.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Config & Misc | `tailwind.config.ts`, `src/services/analyticsService.ts`, `supabase/functions/` | none | PLANNED |
| 2 | Admin Dashboard A-L | `src/pages/admin/A*.tsx` to `src/pages/admin/L*.tsx` | none | PLANNED |
| 3 | Admin Dashboard M-Z | `src/pages/admin/M*.tsx` to `src/pages/admin/V*.tsx` | none | PLANNED |

## Interface Contracts
- No new external interfaces. Types will be tightened to use exact representations or Supabase generated types (if available) or proper interfaces.
- Any `useCallback` introduced must correctly memoize without altering application flow.
