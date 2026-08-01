-- ============================================================================
-- data_audit_log — who archived, restored, or permanently deleted what.
--
-- row_snapshot is the load-bearing column: it stores the row exactly as it
-- existed at the moment of the action. That is what would have answered the
-- 2026-07-25 question (which businesses did we email?) even after those rows
-- were destroyed. A purge therefore never loses the contents of what it
-- removed — only the live row goes.
--
-- Append-only in practice. Admin read; writes happen inside SECURITY DEFINER
-- functions, so no INSERT policy is granted to anyone.
--
-- Rollback: DROP TABLE public.data_audit_log;
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.data_audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at   timestamptz NOT NULL DEFAULT now(),

  -- NULL when performed by a service-role/edge-function context rather than a
  -- signed-in admin. actor_context records which.
  actor_user_id uuid,
  actor_context text NOT NULL DEFAULT 'admin_rpc',

  action        text NOT NULL CHECK (action IN ('archive', 'restore', 'purge')),
  table_name    text NOT NULL,
  row_id        uuid NOT NULL,

  -- The row as it was. Survives the row itself.
  row_snapshot  jsonb NOT NULL,

  reason        text
);

COMMENT ON TABLE public.data_audit_log IS
  'Archive/restore/purge history. row_snapshot preserves the full row contents at the time of the action, so a purge never destroys the information — only the live row.';

CREATE INDEX IF NOT EXISTS data_audit_log_occurred_idx
  ON public.data_audit_log (occurred_at DESC);

CREATE INDEX IF NOT EXISTS data_audit_log_row_idx
  ON public.data_audit_log (table_name, row_id);

-- Find a purged record by any field it used to contain, e.g. an email address.
CREATE INDEX IF NOT EXISTS data_audit_log_snapshot_idx
  ON public.data_audit_log USING gin (row_snapshot);

ALTER TABLE public.data_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read data audit log" ON public.data_audit_log;
CREATE POLICY "Admins can read data audit log"
  ON public.data_audit_log
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

GRANT SELECT ON public.data_audit_log TO authenticated;
