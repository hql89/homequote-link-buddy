-- ============================================================================
-- Ignore Vercel and GitHub notification mail, at the operator's request.
--
-- Seeding was deliberately left out of 20260823230000 so the first rule would
-- be created by clicking the button, proving it worked before it was trusted
-- with a bulk sweep. The operator has since asked for these two directly.
--
-- The interesting part is HOW they are added. admin_add_ignored_sender is
-- gated on is_admin(), which a migration is not — so the obvious move would
-- be a plain INSERT. That would be wrong twice over: it skips the validation
-- that makes a rule safe (public-provider and real-business checks), and it
-- skips the retroactive sweep, leaving the 16 messages this is meant to clear
-- sitting in the queue.
--
-- So the guarded logic moves into an internal function with no admin gate,
-- and admin_add_ignored_sender becomes a thin wrapper that checks is_admin()
-- and delegates. One definition of the rules, two callers. The internal
-- function is executable only by postgres/service_role — it is REVOKEd from
-- anon, authenticated and PUBLIC below, since an ungated validator reachable
-- from the browser would defeat the point of gating the wrapper.
--
-- Rollback: see the foot of this file.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.add_ignored_sender_internal(
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
  IF p_match_type NOT IN ('address', 'domain') THEN
    RAISE EXCEPTION 'match_type must be address or domain';
  END IF;

  v_pattern := lower(trim(coalesce(p_pattern, '')));
  IF p_match_type = 'domain' THEN
    v_pattern := ltrim(v_pattern, '@');
  END IF;

  IF v_pattern = '' THEN
    RAISE EXCEPTION 'Enter an address or domain to ignore.';
  END IF;

  IF p_match_type = 'address' THEN
    IF v_pattern !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' THEN
      RAISE EXCEPTION 'That is not a valid email address.';
    END IF;
  ELSE
    IF v_pattern !~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' THEN
      RAISE EXCEPTION 'Enter a full domain such as vercel.com — a single word like "com" would match almost every sender.';
    END IF;
  END IF;

  IF p_match_type = 'domain' AND v_pattern IN (
    'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com',
    'outlook.com', 'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com',
    'mac.com', 'proton.me', 'protonmail.com', 'gmx.com', 'zoho.com',
    'comcast.net', 'sbcglobal.net', 'att.net', 'verizon.net', 'pacbell.net',
    'earthlink.net', 'cox.net', 'charter.net', 'roadrunner.com'
  ) THEN
    RAISE EXCEPTION 'Not ignored: % is a public email provider that contractors use. Ignore the exact address instead.', v_pattern;
  END IF;

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

-- Callable only by postgres/service_role. An ungated validator the browser
-- could reach would make gating the wrapper pointless.
REVOKE EXECUTE ON FUNCTION public.add_ignored_sender_internal(text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.add_ignored_sender_internal(text, text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.add_ignored_sender_internal(text, text, text) FROM PUBLIC;

-- The admin entry point is now a gate plus a delegation, nothing else. Same
-- signature, so the EXECUTE grant from 20260823230000 carries over and the
-- front end is unaffected.
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
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN public.add_ignored_sender_internal(p_match_type, p_pattern, p_note);
END;
$$;

-- ── The two rules ───────────────────────────────────────────────────────────
-- Both go through the validator above, so if either one ever became unsafe
-- (a contractor turning up on that domain), this migration fails loudly
-- rather than quietly muting them.
DO $$
DECLARE
  v_swept INTEGER;
BEGIN
  v_swept := public.add_ignored_sender_internal(
    'domain', 'vercel.com',
    'Deploy notices and login codes. Not outreach replies.');
  RAISE NOTICE 'vercel.com: % past messages re-filed', v_swept;

  v_swept := public.add_ignored_sender_internal(
    'domain', 'github.com',
    'Account and repository notifications. Not outreach replies.');
  RAISE NOTICE 'github.com: % past messages re-filed', v_swept;
END $$;

-- ============================================================================
-- Rollback:
--   DELETE FROM public.ignored_senders
--     WHERE match_type = 'domain' AND pattern IN ('vercel.com', 'github.com');
--   -- Messages already re-filed stay 'ignored', matching what removing a rule
--   -- through the UI does. To put them back in the queue as well:
--   --   UPDATE public.inbound_emails SET classification = 'unclassified', handled_at = NULL
--   --     WHERE classification = 'ignored'
--   --       AND (from_email LIKE '%@vercel.com' OR from_email LIKE '%.vercel.com'
--   --         OR from_email LIKE '%@github.com' OR from_email LIKE '%.github.com');
--   -- Restoring the pre-refactor shape (guards inlined in the admin function)
--   -- means re-running 20260823230000's definition of admin_add_ignored_sender
--   -- and dropping add_ignored_sender_internal.
-- ============================================================================
