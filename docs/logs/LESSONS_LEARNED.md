# Lessons Learned - 2026-03-13

## Process Improvements

- **ES Module Compatibility**: Node scripts in a "type": "module" project should use `.cjs` extension if they rely on CommonJS `require`.
- **Repo Normalization**: Moving source code to the root and merging `package.json` simplifies workspace management and ensures automated scripts (like `drift` and `scan`) target the correct paths by default.

## Technical Insights

- **Navigation Flow**: Decoupling navigation from static lists into a dynamic component using `useAuth` and role-based hooks (`useIsAdmin`, `useIsProvider`) significantly improves the user experience for various account types.
- **Drift Management**: Documenting drift violations in `ENHANCEMENTS.md` and `DECISIONS.md` before refactoring helps track technical debt without blocking immediate project normalization.
- **Dynamic Email Templates**: Extracting hardcoded email bodies into a database-backed template system with a variables parser (`{{var}}`) enables non-technical admin customization without requiring code redeployments.
- **SMTP Testing**: Providing a "Test Preview" UI that invokes the backend with mock data is essential for safely validating HTML edits before they affect live automated notifications.
- **Component Reuse**: Leveraging existing TipTap-based `RichTextEditor` logic for email templates provides a consistent administrative experience while simplifying complex HTML rendering tasks.
- **Admin Alert Topology**: Triggering an administrative `notify-admin-email` call from separate edge functions (like `submit-feedback`) centralizes email logic. This reduces duplicate SMTP connections and creates a cleaner architecture.

## Session - 2026-03-22

- **Modular Admin Architecture**: Splitting large pages like `Settings.tsx` into specialized sub-components (Account, Analytics, SMTP) drastically improves readability and fulfills the 500-line quality gate requirement.
- **Type Safety Strategy**: Systematically replacing `any` with specific interfaces (`Lead`, `Post`) and using `unknown as Json` for Supabase metadata ensures robust code and clean lint reports.
- **GA4 Transition**: Moving real-time tracking from Supabase Edge Functions to GA4 (gtag.js) is a high-impact solution for reducing critical database server load (resolving 99% CPU/IO spikes).
- **Deployment Flow**: Strict adherence to `drift_check.cjs`, `security_scan.cjs`, and automated versioning (`release.cjs patch`) ensures high-quality production releases in bidirectional sync environments.

## Session - 2026-07-19

- **Vitest Workspace Integration**: Including `tests/` paths explicitly in `vitest.config.ts` allows test files separated from `src/` to be detected and run cleanly by the local runner.
- **Mocking Contexts in Vitest**: Using detailed mocks for Supabase hooks (`useAuth`, `useIsAdmin`, `useIsProvider`) and React Query providers prevents query client context errors and unhandled state transitions during unit tests.
- **Git State Hygiene**: When working with shared workspaces that contain untracked or modified files, staging changes precisely and utilizing `git stash --keep-index` allows safe committing and pushing without polluting the remote with unrelated work.

