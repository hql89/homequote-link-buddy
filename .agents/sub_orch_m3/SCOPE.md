# Scope: Milestone 3 - Admin Dashboard M-Z

## Architecture
- Modules: `src/pages/admin/` (Components starting with M through Z, e.g., `MediaLibrary.tsx`, `ProviderApplications.tsx`, `ResetPassword.tsx`, `Reviews.tsx`, `Routing.tsx`, `SpamMonitor.tsx`, `SystemStatus.tsx`, `Verticals.tsx`)

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 3.1 | M-R components | `MediaLibrary`, `ProviderApplications`, `ResetPassword`, `Reviews`, `Routing` | none | DONE |
| 3.2 | S-Z components | `SpamMonitor`, `SystemStatus`, `Verticals` | none | DONE |

## Interface Contracts
- Use `useCallback` for data fetchers added to `useEffect` deps. No pegging DB.
