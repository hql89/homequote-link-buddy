-- ============================================================================
-- Read side of the archive: what is currently archived, so it can be reviewed
-- and restored.
--
-- Without this there is no way to see an archived row from the UI at all —
-- archiving would be a one-way trip in practice even though admin_restore_row
-- exists. The Archive screen (/admin/archive) is built on these two.
--
-- Both are admin-gated and whitelisted through archivable_tables(), same as
-- the write side. Identifiers are quoted with %I; values travel as USING
-- parameters.
--
-- Rollback: DROP FUNCTION public.admin_archived_summary();
--           DROP FUNCTION public.admin_list_archived(text, integer, integer);
-- ============================================================================

-- ── Counts per table, for the overview ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_archived_summary()
RETURNS TABLE (table_name text, archived_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t text;
  n bigint;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  FOREACH t IN ARRAY public.archivable_tables() LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE archived_at IS NOT NULL', t) INTO n;
    table_name := t;
    archived_count := n;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- ── One table's archived rows ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_archived(
  p_table  text,
  p_limit  integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id             uuid,
  label          text,
  archived_at    timestamptz,
  archived_by    uuid,
  archive_reason text,
  row_data       jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF NOT (p_table = ANY (public.archivable_tables())) THEN
    RAISE EXCEPTION 'Table is not archivable: %', p_table;
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 500';
  END IF;

  -- `label` is a best-effort human name for the row. The tables have no shared
  -- naming column, so rather than a per-table CASE that silently rots when a
  -- table is added to archivable_tables(), fall through the plausible
  -- candidates and end at the id, which always exists.
  RETURN QUERY EXECUTE format(
    'SELECT t.id,
            COALESCE(
              to_jsonb(t)->>''business_name'',
              to_jsonb(t)->>''title'',
              to_jsonb(t)->>''full_name'',
              to_jsonb(t)->>''contact_name'',
              to_jsonb(t)->>''email'',
              to_jsonb(t)->>''caption'',
              to_jsonb(t)->>''slug'',
              t.id::text
            ) AS label,
            t.archived_at,
            t.archived_by,
            t.archive_reason,
            to_jsonb(t) AS row_data
       FROM public.%I t
      WHERE t.archived_at IS NOT NULL
      ORDER BY t.archived_at DESC
      LIMIT $1 OFFSET $2', p_table)
    USING p_limit, GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_archived_summary() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_archived(text, integer, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_archived_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_archived(text, integer, integer) TO authenticated;
