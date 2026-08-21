-- ============================================================================
-- Outreach: add a working opt-out to the live email copy.
--
-- Found while auditing the unsubscribe path: code comments in
-- inboundClassifier.ts and emailSafety.ts assert the outreach copy "literally
-- instructs reply STOP", but it never did — it only ever asked recipients to
-- reply YES. The only opt-out mechanism was a human happening to reply with
-- a stop-ish word that classifyReply() matches. That's not a conspicuous
-- opt-out under CAN-SPAM, and it's not what Gmail/Yahoo bulk-sender rules
-- expect either (a List-Unsubscribe header, added separately in mailer.ts /
-- send-outreach-drip/index.ts via the new `unsubscribe` edge function).
--
-- This updates variant 'A' for both stages IN PLACE, unlike the original
-- seed migration's "byte-for-byte reference copy" framing — this is a
-- compliance fix to existing live copy, not a new experiment. The variant
-- row content must stay in sync with DEFAULT_OUTREACH_TEMPLATES in
-- _shared/directory.ts (updated in the same change), same as the original
-- seed's own invariant.
--
-- Only variant 'A' is touched. Any other variant an admin has since added is
-- left as-is — this migration can't know whether it needs the same fix, and
-- silently rewriting content an admin wrote is a worse outcome than leaving
-- it for a human to check.
--
-- Rollback: re-run the original INSERT bodies from
--   20260814130000_outreach_variants_and_daily_cap.sql
--   (restores the pre-compliance copy; not recommended).
-- ============================================================================

UPDATE public.outreach_template_variants
SET
  body = E'Hi {{owner_name}},\n\nI built a local directory for {{city}} businesses and added {{business_name}}. I want to make sure your phone number ({{phone}}) is correct before we push it live.\n\nIf it is correct, please reply YES. If not, let me know what to change.\n\nDon''t want future emails about this listing? Reply STOP, or unsubscribe here: {{unsubscribe_url}}\n\nBest,\n{{sender_name}}',
  updated_at = now()
WHERE email_type = 'outreach_verify'
  AND variant_key = 'A';

UPDATE public.outreach_template_variants
SET
  body = E'Hi {{owner_name}},\n\nHere is the live listing we set up for you:\n{{claim_url}}\n\nIt''s free to claim, and here''s exactly what that means: once you do, homeowners can request quotes straight from the page. Every request goes only to you — we never sell or share it, and there''s no fee or commission. Your own phone number is on the page too, so calls go directly to you, not through us.\n\nClaiming takes under a minute — just confirm your email and phone.\n\nDon''t want future emails about this listing? Reply STOP, or unsubscribe here: {{unsubscribe_url}}\n\nBest,\n{{sender_name}}',
  updated_at = now()
WHERE email_type = 'outreach_preview'
  AND variant_key = 'A';
