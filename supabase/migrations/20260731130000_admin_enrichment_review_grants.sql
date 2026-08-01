-- /admin/enrichment's Confirm and Dismiss buttons both failed in production
-- with "permission denied for table businesses". Same root cause as
-- 20260726230000_allow_admin_publish_businesses.sql (is_published) and
-- 20260729150000_admin_reply_actions_grants.sql (outreach_suppressed_at,
-- website_url): the review queue was built and shipped without a column
-- GRANT for the columns it writes, so every write from the browser was
-- rejected before RLS was even consulted.
--
-- Confirm writes email_confidence. Dismiss additionally clears the whole
-- discovered payload — email, email_source_url, email_source_phone,
-- email_source_address — because leaving scraped evidence attached to a row
-- an admin has just rejected is how stale contact data gets re-trusted later.
--
-- enriched_at is deliberately NOT granted: it is the "already processed, do
-- not retry" marker, and a dismissed row must stay dismissed rather than
-- being picked up again by the next enrichment batch.

GRANT UPDATE (
  email,
  email_source_url,
  email_source_phone,
  email_source_address,
  email_confidence
) ON public.businesses TO authenticated;

-- As with the reply-actions grant, the existing "Admins can publish
-- businesses" policy already covers FOR UPDATE ... USING (is_admin())
-- WITH CHECK (is_admin()) with no column restriction of its own — RLS
-- policies don't scope by column, only GRANTs do. Non-admin authenticated
-- users pass the grant check and are then stopped by that policy. So no new
-- policy is needed here, only the grant.

-- Rollback:
--   REVOKE UPDATE (email, email_source_url, email_source_phone,
--                  email_source_address, email_confidence)
--     ON public.businesses FROM authenticated;
