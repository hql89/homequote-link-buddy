# Original User Request

## 2026-05-24T18:25:24-07:00

Resolve 140 linting errors (primarily missing TypeScript types) and React hooks warnings across the admin dashboard and Supabase edge functions, strictly ensuring that no changes cause infinite rendering or database pegging.

Working directory: `/Volumes/WD 1 TB/HomeQuoteLink`
Integrity mode: development

## Requirements

### R1. Resolve Type Safety Issues
Replace all implicit and explicit `any` types in `src/pages/admin/*` and `supabase/functions/*` with strict TypeScript interfaces. Use Supabase generated types or define custom interfaces matching the data structures (e.g., `AnalyticsEvent`, `Lead`, `BlogMetric`).

### R2. Resolve Hook Warnings Safely
Fix `react-hooks/exhaustive-deps` warnings (e.g., missing dependencies like `loadProvider`).
**Critical Constraint:** To prevent pegging the database, you must wrap any data-fetching functions in `useCallback` to maintain referential equality before adding them to `useEffect` dependency arrays. Do not introduce any new background polling or infinite loops.

### R3. UI Configuration Fixes
Replace the forbidden `require()` imports in `tailwind.config.ts` with standard ES6 imports.

## Acceptance Criteria

### Code Quality
- [ ] Running `npm run lint` completes with exactly 0 errors and 0 warnings.
- [ ] Running `npm run build` succeeds without type errors.

### Database Safety
- [ ] Admin dashboard pages render without triggering infinite or recursive API fetch loops (no database pegging).
