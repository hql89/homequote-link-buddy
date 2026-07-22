## 2026-05-24T18:32:07-07:00
You are a teamwork_preview_explorer. Your mission is to analyze the M-Z Admin Dashboard components and recommend a fix strategy for all lint errors and hook warnings.
Target files:
- src/pages/admin/MediaLibrary.tsx
- src/pages/admin/ProviderApplications.tsx
- src/pages/admin/ResetPassword.tsx
- src/pages/admin/Reviews.tsx
- src/pages/admin/Routing.tsx
- src/pages/admin/SpamMonitor.tsx
- src/pages/admin/SystemStatus.tsx
- src/pages/admin/Verticals.tsx

Read /Volumes/WD 1 TB/HomeQuoteLink/.agents/sub_orch_m3/SCOPE.md and /Volumes/WD 1 TB/HomeQuoteLink/.agents/original_prompt.md.
Analyze the 'any' types in these files and determine the proper strict TypeScript interfaces (use existing Supabase generated types if applicable, or define custom ones).
Also check for 'react-hooks/exhaustive-deps' warnings. If you find missing dependencies for data-fetching functions, recommend wrapping those functions in useCallback to prevent infinite loops.
Write your analysis and fix strategy to 'handoff.md' in your working directory.
Your working directory is /Volumes/WD 1 TB/HomeQuoteLink/.agents/teamwork_preview_explorer_m_z_1/
Do NOT implement the fixes. Just recommend the strategy.
