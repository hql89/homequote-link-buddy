-- ============================================================================
-- archived_at / archived_by / archive_reason on every table that holds a
-- record of a person or an action. NULL archived_at = live.
--
-- Chosen over a boolean because the timestamp is exactly the forensic detail
-- that was missing on 2026-07-25, and over extending existing `status`
-- columns because those have per-table vocabularies that every existing query
-- switches on.
--
-- Deliberately additive: businesses.is_published is untouched. Unpublishing is
-- an editorial state a listing routinely returns from; archiving is removal.
-- Conflating them would make "restore" ambiguous.
--
-- EXCLUDED as configuration rather than records — these describe how the site
-- behaves, not what happened, and are reconstructible from migrations:
--   admin_settings, admin_users, verticals, routing_settings,
--   blocked_emails, blocked_phones
-- EXCLUDED as append-only audit/telemetry (never archived, only purged):
--   job_run_logs, email_send_log, data_audit_log, analytics_events,
--   spam_events, lead_events, post_metrics, post_versions,
--   lead_nurture_emails, inbound_emails
--
-- ---------------------------------------------------------------------------
-- GRANTS — the trap that has shipped broken three times.
--
-- Verified against information_schema before writing this migration:
--   TABLE-level UPDATE already granted to authenticated (new columns inherit):
--     business_photos, buyer_profiles, buyers, homeowner_profiles, leads,
--     media_assets, posts, reviews
--   NO table-level UPDATE grant (column-level only — MUST grant explicitly):
--     businesses, directory_leads, ingest_queue
-- Without the explicit grants below, archiving those three fails at runtime
-- with "permission denied for table ..." despite the RLS policy allowing it.
-- ---------------------------------------------------------------------------
--
-- Rollback: ALTER TABLE <t> DROP COLUMN archived_at, DROP COLUMN archived_by,
--           DROP COLUMN archive_reason;  -- for each table below
-- ============================================================================

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'businesses', 'directory_leads', 'leads', 'buyers', 'buyer_profiles',
    'homeowner_profiles', 'posts', 'reviews', 'media_assets',
    'business_photos', 'ingest_queue'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format(
      'ALTER TABLE public.%I
         ADD COLUMN IF NOT EXISTS archived_at timestamptz,
         ADD COLUMN IF NOT EXISTS archived_by uuid,
         ADD COLUMN IF NOT EXISTS archive_reason text', t);

    -- Partial index: live rows are the common query, and the index stays small
    -- because it only covers archived ones.
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (archived_at) WHERE archived_at IS NOT NULL',
      t || '_archived_at_idx', t);

    EXECUTE format(
      'COMMENT ON COLUMN public.%I.archived_at IS %L', t,
      'NULL = live. Set by admin_archive_row(). Archived rows are hidden from public views and default admin lists but are never destroyed except by an explicit admin_purge_archived() call.');
  END LOOP;
END;
$$;

-- The three tables without table-level UPDATE. See header.
GRANT UPDATE (archived_at, archived_by, archive_reason) ON public.businesses      TO authenticated;
GRANT UPDATE (archived_at, archived_by, archive_reason) ON public.directory_leads TO authenticated;
GRANT UPDATE (archived_at, archived_by, archive_reason) ON public.ingest_queue    TO authenticated;
