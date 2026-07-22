---
name: deploy
description: "Secure Release, Version Bump, and Lovable Sync Guard"
---
1. **Sync Guard (Ghost Repo Protection):**
   Run `git remote -v`. Verify the remote URL matches the expected Lovable/GitHub repository. If unknown, STOP.
2. **Quality Gates:**
   Run `node scripts/drift_check.cjs`, `node scripts/security_scan.cjs`, and all tests. NEVER commit with failing tests.
3. **Auto-Version:**
   Run `node scripts/release.cjs patch`.
4. **Deploy:**
   Commit changes securely.
   Run `git push origin main` to trigger Vercel deployment.
5. **Silent Learning:**
   Append session summary to `docs/logs/LESSONS_LEARNED.md`.
