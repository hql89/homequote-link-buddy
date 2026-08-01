-- Adds the phone number and location snippet found on the fetched page
-- alongside the email, so an admin reviewing a 'needs_review' row can see
-- *why* it didn't auto-verify — the CSLB phone (businesses.phone) next to
-- what the site actually shows, and a "City, CA zip" snippet to catch a
-- business whose site clearly lists an address outside the service area.
-- Neither column feeds email_confidence automatically — same rule as the
-- rest of Phase 2: only a phone match promotes a row to 'verified', these
-- are extract-and-surface signals for the human review step.

ALTER TABLE public.businesses
  ADD COLUMN email_source_phone TEXT,
  ADD COLUMN email_source_address TEXT;

-- Rollback:
--   ALTER TABLE public.businesses DROP COLUMN email_source_phone, DROP COLUMN email_source_address;
