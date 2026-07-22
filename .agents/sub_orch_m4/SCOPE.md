# Scope: Milestone 4 - Remaining Lint Errors

## Architecture
- Modules: `src/components/forms/`, `src/components/public/`, `src/components/ui/`, `src/hooks/`, `src/pages/` (non-admin)

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 4.1 | Components & Hooks | `src/components/*`, `src/hooks/*` | none | DONE |
| 4.2 | Public Pages | `src/pages/*.tsx` (non-admin) | none | DONE |

## Interface Contracts
- Use `useCallback` for data fetchers added to `useEffect` deps. No pegging DB.
- Resolve all `@typescript-eslint/no-explicit-any`, `react-hooks/exhaustive-deps`, `react-refresh/only-export-components`, and `@typescript-eslint/no-empty-object-type` errors.
