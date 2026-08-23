-- ============================================================================
-- Ignored senders: a sender-level noise filter for the reply inbox.
--
-- /admin/replies exists to show contractors answering our outreach. In
-- practice the outreach mailbox also receives ordinary operational mail —
-- Vercel login codes, GitHub notices, vendor marketing — and every one of
-- those messages was landing in the human review queue. At the time this was
-- written, 17 of the 18 rows in inbound_emails were that kind of mail.
--
-- Deliberately NOT the existing blocked_emails/blocked_phones tables. Those
-- guard the public lead form, and their meaning is "this person may not
-- submit a quote request". Adding vercel.com there to quiet the reply inbox
-- would also start rejecting homeowner leads from that domain. Two unrelated
-- judgements, so two tables.
--
-- Nothing here deletes or discards a message. An ignored message is still
-- inserted into inbound_emails in full — it is filed under a different
-- classification and pre-marked handled, so it is out of the queue but always
-- readable. That is the same posture as the rest of this bridge: an unmatched
-- sender is logged with business_id null rather than dropped.
--
-- Rollback: see the block at the foot of this file.
-- ============================================================================

CREATE TABLE public.ignored_senders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'address' = one exact mailbox; 'domain' = that domain and its subdomains.
  match_type TEXT NOT NULL CHECK (match_type IN ('address', 'domain')),
  -- Always stored lower-cased and trimmed by admin_add_ignored_sender.
  pattern TEXT NOT NULL,
  note TEXT,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_ignored_senders_pattern
  ON public.ignored_senders (match_type, pattern);

ALTER TABLE public.ignored_senders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read ignored senders"
  ON public.ignored_senders
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- No client INSERT/DELETE policy on purpose. Writes go through the two RPCs
-- below, which run the validation that makes this feature safe to hand an
-- admin — above all the check that a pattern cannot match a real business's
-- email address. A direct table write would skip it.

-- ── Seventh classification value ────────────────────────────────────────────
-- Without this the receiver cannot record an ignored message at all: the
-- CHECK would reject the insert, the function would throw, and the message
-- would be lost — which is precisely the silent-drop this design avoids.
ALTER TABLE public.inbound_emails
  DROP CONSTRAINT IF EXISTS inbound_emails_classification_check;

ALTER TABLE public.inbound_emails
  ADD CONSTRAINT inbound_emails_classification_check
  CHECK (classification = ANY (ARRAY[
    'unsubscribe'::text,
    'confirm'::text,
    'website'::text,
    'unclassified'::text,
    'bounce'::text,
    'self_sent'::text,
    'ignored'::text
  ]));

COMMENT ON COLUMN public.inbound_emails.classification IS
  'ignored = the sender matched public.ignored_senders — ordinary mail, not a reply to our outreach. Stored in full and pre-marked handled, never discarded. Checked AFTER bounce detection (so an ignore rule can never hide a delivery failure) and BEFORE classifyReply (so an ignored message triggers no automatic action).';

-- ── Shared matcher ──────────────────────────────────────────────────────────
-- One definition of "does this address match this pattern", used by both the
-- collision check and the retroactive sweep. A domain pattern matches the
-- domain itself and any subdomain: vercel.com matches ship@info.vercel.com.
--
-- The lookalike case is what the '@'/'.' anchoring is for: pattern
-- 'vercel.com' must NOT match someone@notvercel.com.
CREATE OR REPLACE FUNCTION public.sender_matches_pattern(
  p_email TEXT,
  p_match_type TEXT,
  p_pattern TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_email IS NULL OR p_pattern IS NULL THEN false
    WHEN p_match_type = 'address' THEN lower(trim(p_email)) = p_pattern
    WHEN p_match_type = 'domain' THEN
      lower(trim(p_email)) LIKE ('%@' || p_pattern)
      OR lower(trim(p_email)) LIKE ('%.' || p_pattern)
    ELSE false
  END;
$$;

-- ── Add a pattern ───────────────────────────────────────────────────────────
-- Returns how many past messages were re-filed, so the UI can say so rather
-- than leaving the admin to guess whether anything happened.
CREATE OR REPLACE FUNCTION public.admin_add_ignored_sender(
  p_match_type TEXT,
  p_pattern TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pattern TEXT;
  v_conflict TEXT;
  v_swept INTEGER;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF p_match_type NOT IN ('address', 'domain') THEN
    RAISE EXCEPTION 'match_type must be address or domain';
  END IF;

  v_pattern := lower(trim(coalesce(p_pattern, '')));
  -- Strip a leading '@' so pasting "@vercel.com" as a domain works.
  IF p_match_type = 'domain' THEN
    v_pattern := ltrim(v_pattern, '@');
  END IF;

  IF v_pattern = '' THEN
    RAISE EXCEPTION 'Enter an address or domain to ignore.';
  END IF;

  -- Shape validation. The single-label rejection is the important half: a
  -- pattern of 'com' would match most of the internet, including every
  -- contractor we have ever emailed.
  IF p_match_type = 'address' THEN
    IF v_pattern !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' THEN
      RAISE EXCEPTION 'That is not a valid email address.';
    END IF;
  ELSE
    IF v_pattern !~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' THEN
      RAISE EXCEPTION 'Enter a full domain such as vercel.com — a single word like "com" would match almost every sender.';
    END IF;
  END IF;

  -- Consumer mail providers can never be ignored wholesale. The
  -- businesses-collision check below is a snapshot of the directory as it
  -- stands right now, so on its own it would happily allow 'gmail.com' on a
  -- day when no contractor happened to use one — and then silently mute every
  -- contractor added afterwards. Refused here rather than only in the UI,
  -- because a guard that lives in a button is not a guard.
  IF p_match_type = 'domain' AND v_pattern IN (
    'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com',
    'outlook.com', 'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com',
    'mac.com', 'proton.me', 'protonmail.com', 'gmx.com', 'zoho.com',
    'comcast.net', 'sbcglobal.net', 'att.net', 'verizon.net', 'pacbell.net',
    'earthlink.net', 'cox.net', 'charter.net', 'roadrunner.com'
  ) THEN
    RAISE EXCEPTION 'Not ignored: % is a public email provider that contractors use. Ignore the exact address instead.', v_pattern;
  END IF;

  -- The guard that makes this safe to hand an admin: a rule can never be
  -- created that would mute a business we actually contact. Checked against
  -- every business, archived or not, because an archived row can be restored.
  SELECT b.business_name INTO v_conflict
  FROM public.businesses b
  WHERE b.email IS NOT NULL
    AND public.sender_matches_pattern(b.email, p_match_type, v_pattern)
  LIMIT 1;

  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'Not ignored: % is a real business in your directory using that address. Ignoring it would hide their replies.', v_conflict;
  END IF;

  INSERT INTO public.ignored_senders (match_type, pattern, note)
  VALUES (p_match_type, v_pattern, nullif(trim(coalesce(p_note, '')), ''))
  ON CONFLICT (match_type, pattern) DO NOTHING;

  -- Retroactive sweep. Without it the inbox stays full of the noise the admin
  -- just asked to be rid of.
  --
  -- The three exclusions are each load-bearing:
  --   business_id IS NULL  — never re-file a message tied to a real business
  --   classification <> 'bounce' — never hide a delivery failure
  --   classification <> 'ignored' — idempotent, and keeps the returned count honest
  WITH swept AS (
    UPDATE public.inbound_emails ie
    SET classification = 'ignored',
        handled_at = COALESCE(ie.handled_at, now())
    WHERE ie.business_id IS NULL
      AND ie.classification NOT IN ('ignored', 'bounce')
      AND public.sender_matches_pattern(ie.from_email, p_match_type, v_pattern)
    RETURNING 1
  )
  SELECT count(*)::INTEGER INTO v_swept FROM swept;

  RETURN v_swept;
END;
$$;

-- ── Remove a pattern ────────────────────────────────────────────────────────
-- Messages already filed as 'ignored' stay filed. They remain fully visible
-- in the Ignored view, and rewriting history on a delete would be more
-- surprising than leaving it: the admin removing a rule is saying "stop
-- ignoring this sender from now on", not "that vendor mail was a real reply
-- after all".
CREATE OR REPLACE FUNCTION public.admin_remove_ignored_sender(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  DELETE FROM public.ignored_senders WHERE id = p_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_add_ignored_sender(text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_add_ignored_sender(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_add_ignored_sender(text, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_remove_ignored_sender(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_remove_ignored_sender(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_remove_ignored_sender(uuid) TO authenticated;

GRANT SELECT ON public.ignored_senders TO authenticated;

-- No rows are seeded. The list is built by clicking "Ignore sender" on real
-- noise as it arrives, which also proves the button works before it is
-- trusted with a bulk sweep.

-- ============================================================================
-- Rollback:
--   DROP FUNCTION IF EXISTS public.admin_add_ignored_sender(text, text, text);
--   DROP FUNCTION IF EXISTS public.admin_remove_ignored_sender(uuid);
--   DROP TABLE IF EXISTS public.ignored_senders;
--   DROP FUNCTION IF EXISTS public.sender_matches_pattern(text, text, text);
--   -- Rows already filed as 'ignored' MUST be reclassified before the CHECK
--   -- is narrowed, or the constraint will not validate:
--   UPDATE public.inbound_emails SET classification = 'unclassified'
--     WHERE classification = 'ignored';
--   ALTER TABLE public.inbound_emails
--     DROP CONSTRAINT IF EXISTS inbound_emails_classification_check;
--   ALTER TABLE public.inbound_emails
--     ADD CONSTRAINT inbound_emails_classification_check
--     CHECK (classification = ANY (ARRAY[
--       'unsubscribe','confirm','website','unclassified','bounce','self_sent'
--     ]));
-- No message is deleted anywhere in this migration, so a full rollback loses
-- no mail.
-- ============================================================================
