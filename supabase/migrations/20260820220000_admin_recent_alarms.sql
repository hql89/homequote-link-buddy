-- ============================================================================
-- Admin-visible read of raiseAlarm()'s records.
--
-- _shared/alarm.ts already detects and durably records four conditions a
-- human needs to know about (the email circuit breaker tripping, an
-- unsubscribe spike, an automatic action's write silently failing, the
-- delivery canary failing) — but nothing has ever read them back. This RPC is
-- that read.
--
-- Not admin_recent_job_runs: that function returns the latest N rows across
-- EVERY job name, and the canary alone writes ~24 rows/day, so a real alarm
-- falls off the end of a 25-row window within hours. This filters to
-- job_name = 'alarm' specifically, using the existing
-- job_run_logs_job_name_created_at_idx index.
--
-- p_since lets the caller ask for only what's new since the operator last
-- looked (stored client-side in admin_settings.alarms_seen_up_to) without
-- re-fetching and re-filtering alarms already acknowledged.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.admin_recent_alarms(timestamptz);
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_recent_alarms(p_since timestamptz DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  error_message text,
  metadata jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  SELECT l.id, l.error_message, l.metadata, l.created_at
  FROM public.job_run_logs l
  WHERE l.job_name = 'alarm'
    AND (p_since IS NULL OR l.created_at > p_since)
  ORDER BY l.created_at DESC
  LIMIT 50;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_recent_alarms(timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_recent_alarms(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_recent_alarms(timestamptz) TO authenticated;
