-- Root plan Phase 2 (email enrichment): storage for the discover → fetch →
-- verify → extract chain. See implementation_plan.md, "Discovery source:
-- Perplexity Sonar" for the full design this implements.
--
-- email_confidence is the drip-eligibility gate: only 'verified' rows (CSLB
-- phone matched somewhere on the fetched page) are safe to email. 'needs_review'
-- means an email was found but identity could not be confirmed automatically —
-- an admin decides. 'rejected' means an admin looked and said no. NULL means
-- not yet processed, or processed and nothing was found — either way, not
-- retried automatically once enriched_at is set.

ALTER TABLE public.businesses
  ADD COLUMN email_source_url TEXT,
  ADD COLUMN email_confidence TEXT CHECK (email_confidence IN ('verified', 'needs_review', 'rejected')),
  ADD COLUMN enriched_at TIMESTAMPTZ;

-- The enrichment worker's candidate query: unenriched, published rows.
CREATE INDEX idx_businesses_enrichment_pending
  ON public.businesses (created_at)
  WHERE enriched_at IS NULL AND is_published = true;

-- Rollback:
--   DROP INDEX IF EXISTS idx_businesses_enrichment_pending;
--   ALTER TABLE public.businesses DROP COLUMN email_source_url, DROP COLUMN email_confidence, DROP COLUMN enriched_at;
