-- ============================================================================
-- Allow 'bounce' as an inbound_emails classification.
--
-- Without this the receiver cannot record a delivery-failure notice at all:
-- the CHECK constraint would reject the insert, the function would throw, and
-- the bounce would be lost — leaving the business it concerns permanently
-- marked as contacted.
--
-- Rollback: restore the four-value CHECK. Note that any rows already stored
-- as 'bounce' must be reclassified first or the constraint will not validate.
-- ============================================================================

ALTER TABLE public.inbound_emails
  DROP CONSTRAINT IF EXISTS inbound_emails_classification_check;

ALTER TABLE public.inbound_emails
  ADD CONSTRAINT inbound_emails_classification_check
  CHECK (classification = ANY (ARRAY[
    'unsubscribe'::text,
    'confirm'::text,
    'website'::text,
    'unclassified'::text,
    'bounce'::text
  ]));

COMMENT ON COLUMN public.inbound_emails.classification IS
  'bounce = a delivery-failure notice, not a human reply. Checked before every other rule, because bounce bodies quote the original message and can otherwise be misread as an unsubscribe.';
