-- /admin/enrichment is getting a new "Ready for outreach" section that lets
-- an admin flip `outreach_paused` per business. Without this grant that
-- write would fail with "permission denied for table businesses" — the same
-- root cause as 20260726230000_allow_admin_publish_businesses.sql
-- (is_published), 20260729150000_admin_reply_actions_grants.sql
-- (outreach_suppressed_at, website_url), and
-- 20260731130000_admin_enrichment_review_grants.sql (email_confidence and
-- friends): every one of those columns needed its own explicit column GRANT
-- before RLS was even consulted, because GRANTs and RLS policies are
-- separate layers — a policy scoped to is_admin() does nothing for a column
-- the role was never granted UPDATE on in the first place.
--
-- `outreach_paused` currently has SELECT granted to `authenticated` but no
-- UPDATE (confirmed via information_schema.column_privileges before writing
-- this), unlike the three columns above which already got fixed the hard
-- way. Closing that gap here, before the UI ships, instead of after.

GRANT UPDATE (outreach_paused) ON public.businesses TO authenticated;

-- The existing "Admins can publish businesses" policy already covers
-- FOR UPDATE ... USING (is_admin()) WITH CHECK (is_admin()) with no column
-- restriction of its own — RLS policies don't scope by column, only GRANTs
-- do. Non-admin authenticated users pass this grant and are then stopped by
-- that policy. So no new policy is needed, only the grant.

-- Rollback:
--   REVOKE UPDATE (outreach_paused) ON public.businesses FROM authenticated;
