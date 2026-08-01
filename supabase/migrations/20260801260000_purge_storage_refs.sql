-- ============================================================================
-- Storage-aware purge.
--
-- THE GAP THIS CLOSES: archiving a photo deliberately leaves the file in
-- storage (a restored photo with a missing file is worse than an orphaned
-- file). But purging then deleted only the row, so the file was stranded
-- forever with nothing left pointing at it — purge reclaimed no space at all,
-- which is the entire reason purge exists.
--
-- Postgres cannot delete from Supabase Storage: the bytes live behind the
-- storage API, and deleting from storage.objects in SQL would orphan the
-- object rather than remove it. So the sequence has to be driven from an edge
-- function (supabase/functions/purge-archived), and these two functions are
-- the halves it needs:
--
--   admin_purgeable_refs()  — what is about to be purged, and which files
--                             belong to it
--   admin_purge_by_ids()    — purge exactly those ids, nothing else
--
-- Splitting it this way means the edge function deletes files for precisely
-- the rows it then purges. A cutoff+limit on both halves would be a race: a
-- concurrent archive could shift the window between the two calls.
--
-- ORDER OF OPERATIONS (in the edge function): files first, then rows. If the
-- row delete then fails, the file is gone but the row remains — visible,
-- archived, and reportable. The reverse leaves an untracked orphan nobody can
-- ever find. A visible inconsistency beats an invisible leak.
--
-- Rollback: DROP FUNCTION public.admin_purgeable_refs(text, timestamptz, integer);
--           DROP FUNCTION public.admin_purge_by_ids(text, uuid[]);
-- ============================================================================

-- ── What would be purged, plus its files ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_purgeable_refs(
  p_table  text,
  p_before timestamptz,
  p_limit  integer DEFAULT 100
)
RETURNS TABLE (id uuid, storage_refs text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_refs_expr text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF NOT (p_table = ANY (public.archivable_tables())) THEN
    RAISE EXCEPTION 'Table is not archivable: %', p_table;
  END IF;

  IF p_before IS NULL THEN
    RAISE EXCEPTION 'p_before is required';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 10000';
  END IF;

  -- Each branch is a fixed literal chosen by this function, never caller
  -- input, so interpolating it into the query below introduces no injection
  -- surface. Tables holding no files yield an empty array.
  IF p_table = 'business_photos' THEN
    -- A bare path inside the 'business-photos' bucket.
    v_refs_expr := 'ARRAY_REMOVE(ARRAY[t.storage_path], NULL)';
  ELSIF p_table = 'media_assets' THEN
    -- Full public URLs; the edge function parses bucket and path out of them.
    v_refs_expr := 'ARRAY_REMOVE(ARRAY[t.url, t.thumbnail_url], NULL)';
  ELSE
    v_refs_expr := 'ARRAY[]::text[]';
  END IF;

  RETURN QUERY EXECUTE format(
    'SELECT t.id, %s
       FROM public.%I t
      WHERE t.archived_at IS NOT NULL AND t.archived_at < $1
      ORDER BY t.archived_at
      LIMIT $2', v_refs_expr, p_table)
    USING p_before, p_limit;
END;
$$;

-- ── Purge exactly these ids ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_purge_by_ids(
  p_table text,
  p_ids   uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor  uuid := auth.uid();
  v_purged integer := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF NOT (p_table = ANY (public.archivable_tables())) THEN
    RAISE EXCEPTION 'Table is not archivable: %', p_table;
  END IF;

  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('table', p_table, 'purged', 0);
  END IF;

  -- Snapshot before destroying. `archived_at IS NOT NULL` appears in both
  -- statements, so a live row is unreachable no matter what ids are supplied.
  EXECUTE format(
    'INSERT INTO public.data_audit_log
       (actor_user_id, actor_context, action, table_name, row_id, row_snapshot, reason)
     SELECT $1, ''admin_rpc'', ''purge'', %L, t.id, to_jsonb(t), t.archive_reason
       FROM public.%I t
      WHERE t.id = ANY($2) AND t.archived_at IS NOT NULL', p_table, p_table)
    USING v_actor, p_ids;

  EXECUTE format(
    'DELETE FROM public.%I WHERE id = ANY($1) AND archived_at IS NOT NULL', p_table)
    USING p_ids;
  GET DIAGNOSTICS v_purged = ROW_COUNT;

  RETURN jsonb_build_object('table', p_table, 'purged', v_purged);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_purgeable_refs(text, timestamptz, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_purge_by_ids(text, uuid[]) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_purgeable_refs(text, timestamptz, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_by_ids(text, uuid[]) TO authenticated;
