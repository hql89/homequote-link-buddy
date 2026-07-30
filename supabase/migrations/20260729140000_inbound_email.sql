-- Inbound reply handling for cold outreach. See
-- docs/plans/implementation_plan_inbound_email.md for the full design and
-- the read-only reference to Mivos.ai's n8n IMAP-bridge pattern this mirrors.

CREATE TABLE public.inbound_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Unique so an IMAP re-poll delivering the same message twice is a no-op,
  -- not a second suppression or a duplicate queue entry.
  message_id TEXT NOT NULL UNIQUE,
  business_id UUID REFERENCES public.businesses(id) ON DELETE SET NULL,
  from_email TEXT NOT NULL,
  from_name TEXT,
  subject TEXT,
  body_text TEXT,
  classification TEXT NOT NULL DEFAULT 'unclassified'
    CHECK (classification IN ('unsubscribe', 'confirm', 'website', 'unclassified')),
  -- Sort hint only, not an action: does the body look like a real question
  -- ("how much", "call me", "?") worth a human's attention before routine
  -- noise. Never used to auto-reply or auto-act.
  is_priority BOOLEAN NOT NULL DEFAULT false,
  extracted_url TEXT,
  handled_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inbound_emails_unhandled ON public.inbound_emails(handled_at, is_priority, received_at)
  WHERE handled_at IS NULL;
CREATE INDEX idx_inbound_emails_business ON public.inbound_emails(business_id);

ALTER TABLE public.inbound_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read inbound emails"
  ON public.inbound_emails
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Marking a reply handled is the only client-side write; the row's content
-- (classification, extracted_url, etc.) is set once by the edge function
-- and never edited from the browser.
CREATE POLICY "Admins can mark replies handled"
  ON public.inbound_emails
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT ON public.inbound_emails TO authenticated;
GRANT UPDATE (handled_at) ON public.inbound_emails TO authenticated;

-- Shared with implementation_plan_outreach_ab_testing.md, which is still
-- unbuilt. Unsubscribe-handling is the one thing THIS plan needs to write,
-- so the column is added here rather than pulling that whole panel in as a
-- prerequisite. Deliberately separate from the existing outreach_paused,
-- which is an admin control (temporarily hold a row) — this one is the
-- recipient's own opt-out and must never be auto-cleared or overridden by
-- re-enabling outreach. When the outreach plan is executed, it must NOT
-- recreate this column.
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS outreach_suppressed_at TIMESTAMPTZ;

-- Rollback:
--   DROP TABLE IF EXISTS public.inbound_emails;
--   -- outreach_suppressed_at is intentionally NOT dropped here: it is
--   -- shared with the outreach plan, and suppressions already collected
--   -- must survive a rollback of this bridge.
