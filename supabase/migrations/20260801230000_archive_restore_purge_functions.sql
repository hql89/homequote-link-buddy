-- ============================================================================
-- admin_archive_row / admin_restore_row / admin_purge_archived
--
-- All three take a table name, so both defences are applied: a hard whitelist
-- (nothing outside ARCHIVABLE_TABLES is reachable) AND format('%I') identifier
-- quoting. Values always travel as USING parameters, never interpolated.
--
-- Purge is the only path that destroys anything. It refuses non-archived rows
-- outright and writes a full row snapshot to data_audit_log BEFORE deleting,
-- so the contents survive even though the row does not.
--
-- Rollback: DROP FUNCTION public.admin_archive_row(text, uuid, text);
--           DROP FUNCTION public.admin_restore_row(text, uuid);
--           DROP FUNCTION public.admin_purge_archived(text, timestamptz, integer);
-- ============================================================================

CREATE OR REPLACE FUNCTION public.archivable_tables()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY[
    'businesses', 'directory_leads', 'leads', 'buyers', 'buyer_profiles',
    'homeowner_profiles', 'posts', 'reviews', 'media_assets',
    'business_photos', 'ingest_queue'
  ];
$$;

-- ── Archive ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_archive_row(
  p_table  text,
  p_id     uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot jsonb;
  v_actor    uuid := auth.uid();
  v_updated  integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF NOT (p_table = ANY (public.archivable_tables())) THEN
    RAISE EXCEPTION 'Table is not archivable: %', p_table;
  END IF;

  -- Snapshot first: if anything below fails, we have still captured the row.
  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id = $1', p_table)
    INTO v_snapshot USING p_id;

  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'No such row: %.%', p_table, p_id;
  END IF;

  EXECUTE format(
    'UPDATE public.%I SET archived_at = now(), archived_by = $2, archive_reason = $3
      WHERE id = $1 AND archived_at IS NULL', p_table)
    USING p_id, v_actor, p_reason;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- Already archived: report it rather than writing a duplicate audit entry.
  IF v_updated = 0 THEN
    RETURN jsonb_build_object('table', p_table, 'id', p_id, 'archived', true, 'already_archived', true);
  END IF;

  INSERT INTO public.data_audit_log
    (actor_user_id, actor_context, action, table_name, row_id, row_snapshot, reason)
  VALUES
    (v_actor, 'admin_rpc', 'archive', p_table, p_id, v_snapshot, p_reason);

  RETURN jsonb_build_object('table', p_table, 'id', p_id, 'archived', true, 'already_archived', false);
END;
$$;

-- ── Restore ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_restore_row(
  p_table text,
  p_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot jsonb;
  v_actor    uuid := auth.uid();
  v_updated  integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF NOT (p_table = ANY (public.archivable_tables())) THEN
    RAISE EXCEPTION 'Table is not archivable: %', p_table;
  END IF;

  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id = $1', p_table)
    INTO v_snapshot USING p_id;

  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'No such row: %.%', p_table, p_id;
  END IF;

  -- Exact inverse of archive: all three columns cleared, nothing else touched.
  EXECUTE format(
    'UPDATE public.%I SET archived_at = NULL, archived_by = NULL, archive_reason = NULL
      WHERE id = $1 AND archived_at IS NOT NULL', p_table)
    USING p_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN jsonb_build_object('table', p_table, 'id', p_id, 'restored', false, 'was_live', true);
  END IF;

  INSERT INTO public.data_audit_log
    (actor_user_id, actor_context, action, table_name, row_id, row_snapshot, reason)
  VALUES
    (v_actor, 'admin_rpc', 'restore', p_table, p_id, v_snapshot, NULL);

  RETURN jsonb_build_object('table', p_table, 'id', p_id, 'restored', true, 'was_live', false);
END;
$$;

-- ── Purge (the only destructive path) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_purge_archived(
  p_table           text,
  p_archived_before timestamptz,
  p_limit           integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_ids     uuid[];
  v_purged  integer := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF NOT (p_table = ANY (public.archivable_tables())) THEN
    RAISE EXCEPTION 'Table is not archivable: %', p_table;
  END IF;

  IF p_archived_before IS NULL THEN
    RAISE EXCEPTION 'p_archived_before is required — refusing to purge without an explicit cutoff';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 10000';
  END IF;

  -- Three explicit steps against a fixed id set. `archived_at IS NOT NULL`
  -- appears in both the selection and the delete, which is what makes a live
  -- row unreachable by this function under any combination of arguments.

  -- 1. Choose the rows.
  EXECUTE format(
    'SELECT array_agg(id) FROM (
        SELECT id FROM public.%I
         WHERE archived_at IS NOT NULL AND archived_at < $1
         ORDER BY archived_at
         LIMIT $2
     ) s', p_table)
    INTO v_ids USING p_archived_before, p_limit;

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('table', p_table, 'purged', 0);
  END IF;

  -- 2. Snapshot every one of them BEFORE anything is destroyed.
  EXECUTE format(
    'INSERT INTO public.data_audit_log
       (actor_user_id, actor_context, action, table_name, row_id, row_snapshot, reason)
     SELECT $1, ''admin_rpc'', ''purge'', %L, t.id, to_jsonb(t), t.archive_reason
       FROM public.%I t
      WHERE t.id = ANY($2)', p_table, p_table)
    USING v_actor, v_ids;

  -- 3. Only now delete.
  EXECUTE format('DELETE FROM public.%I WHERE id = ANY($1) AND archived_at IS NOT NULL', p_table)
    USING v_ids;
  GET DIAGNOSTICS v_purged = ROW_COUNT;

  INSERT INTO public.job_run_logs (job_name, status, attempts, duration_ms, error_message, metadata)
  VALUES ('admin-purge-archived', 'success', 1, NULL, NULL,
          jsonb_build_object('table', p_table, 'purged', v_purged,
                             'archived_before', p_archived_before));

  RETURN jsonb_build_object('table', p_table, 'purged', v_purged);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_archive_row(text, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_restore_row(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_purge_archived(text, timestamptz, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_archive_row(text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_restore_row(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_archived(text, timestamptz, integer) TO authenticated;
