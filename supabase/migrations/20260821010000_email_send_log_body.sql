-- ============================================================================
-- Stores the actual body of every outbound email, not just the subject.
--
-- WHY: email_send_log has never recorded body text. The subject is exact,
-- but /admin's "Sent Emails" page had to RECONSTRUCT the body by re-rendering
-- the current template against the business's current info — which drifts
-- the moment either changes, and for an audit log of what a real business
-- was actually told, an approximation is close to worthless. Flagged
-- directly: "reconstructed does me no good."
--
-- Bounded like subject/error_message already are (MAX_SUBJECT, MAX_ERROR in
-- emailLog.ts) — an email body is bigger than either, so the cap here is
-- correspondingly larger, not absent. One pathological body must not be able
-- to bloat this table unbounded.
--
-- Existing rows get body = NULL. Not backfillable: the real bodies were
-- genuinely never captured, and synthesizing one now would just be today's
-- reconstruction with an extra step. The admin UI keeps reconstructing ONLY
-- for these pre-existing NULL rows, now correctly framed as "before this was
-- tracked" rather than "always approximate".
--
-- Rollback:
--   ALTER TABLE public.email_send_log DROP COLUMN IF EXISTS body;
-- ============================================================================

ALTER TABLE public.email_send_log
  ADD COLUMN IF NOT EXISTS body text;

-- Read-only for the client (the admin UI only ever SELECTs this table; every
-- write happens under the service role in edge functions), so no grant is
-- needed — `authenticated` already has whatever SELECT access the existing
-- Sent Emails page relies on for every other column here.
