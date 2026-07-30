-- /admin/replies needs to write two more businesses columns from the
-- browser: outreach_suppressed_at (Suppress/un-suppress) and website_url
-- (Apply a replied URL). The earlier admin-publish fix
-- (20260726230000_allow_admin_publish_businesses.sql) only covered
-- is_published — this is the same fix, extended to the same narrow,
-- column-scoped pattern rather than widening to the whole row.

GRANT UPDATE (outreach_suppressed_at, website_url) ON public.businesses TO authenticated;

-- The existing "Admins can publish businesses" UPDATE policy already covers
-- FOR UPDATE ... USING (is_admin()) WITH CHECK (is_admin()) on this table
-- with no column restriction of its own — RLS policies don't scope by
-- column, only GRANTs do. So no new policy is needed here, only the grant.

-- Rollback:
--   REVOKE UPDATE (outreach_suppressed_at, website_url) ON public.businesses FROM authenticated;
