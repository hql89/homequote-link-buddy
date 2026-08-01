-- ============================================================================
-- admin_prune_internal_job_logs() hard-deleted public.job_run_logs older than
-- 30 days. That is audit history, and deleting it on a timer contradicts the
-- archive-first policy agreed 2026-08-01 (docs/plans/
-- implementation_plan_archive_and_audit_2026-08-01.md).
--
-- Concretely: job_run_logs is the only surviving record that four real
-- outbound "new quote request" emails were sent on 2026-07-25. Left as-is,
-- the 2026-08-24 run would have destroyed it.
--
-- This migration removes ONLY the job_run_logs delete. The other two targets
-- are kept: cron.job_run_details (>7d) and net._http_response (>1d) are
-- Postgres extension internals with no business meaning and are the actual
-- unbounded-growth risk.
--
-- job_run_logs now falls under the size-driven, admin-invoked purge path
-- instead of an unattended timer. It is 2,978 rows today.
--
-- The returned/logged metadata keeps the same three keys so existing
-- reporting (src/lib/jobRunSummary.ts, Settings -> Background Jobs) keeps
-- rendering; job_run_logs_deleted is now always 0.
--
-- Rollback: re-run migration 20260429151254's definition of this function,
-- which restores the 30-day DELETE.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_prune_internal_job_logs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, net
AS $$
DECLARE
  v_cron_deleted integer := 0;
  v_net_deleted integer := 0;
BEGIN
  DELETE FROM cron.job_run_details
  WHERE start_time < now() - interval '7 days';
  GET DIAGNOSTICS v_cron_deleted = ROW_COUNT;

  DELETE FROM net._http_response
  WHERE created < now() - interval '1 day';
  GET DIAGNOSTICS v_net_deleted = ROW_COUNT;

  -- public.job_run_logs is deliberately NOT pruned here. See header.

  INSERT INTO public.job_run_logs (job_name, status, attempts, duration_ms, error_message, metadata)
  VALUES (
    'prune-internal-job-logs-daily',
    'success',
    1,
    NULL,
    NULL,
    jsonb_build_object(
      'cron_job_run_details_deleted', v_cron_deleted,
      'net_http_response_deleted', v_net_deleted,
      'job_run_logs_deleted', 0
    )
  );

  RETURN jsonb_build_object(
    'cron_job_run_details_deleted', v_cron_deleted,
    'net_http_response_deleted', v_net_deleted,
    'job_run_logs_deleted', 0
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_prune_internal_job_logs() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_prune_internal_job_logs() FROM anon;
