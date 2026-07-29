# Implementation Plan — Business Imagery

**Date:** 2026-07-26
**Status:** Awaiting approval
**Note:** Filed here rather than as the root `implementation_plan.md`, which is
still the active ingestion plan — its Phase 2 (email enrichment) is unbuilt.

## Context

536 listings, none with an image. `businesses` has no image column at all, and
the only storage bucket is `blog-images`.

Ruled out, recorded so it is not revisited:

- **Google My Business / Maps photos** — scraping breaches Google's ToS. This is
  the same reason CSLB was chosen over Google Maps as the data source (see the
  root plan, "Why CSLB rather than Google Maps"). Routing the fetch through
  Perplexity does not change what it is.
- **Places API** — licensed, but bars retaining most Place content beyond ~30
  days, so a permanent listing page cannot be built on it.
- **Street View** — 171 of 536 are Sole Owners whose CSLB `MailingAddress` is
  frequently their home. A commercial yard cannot be reliably distinguished from
  a residence, so this risks publishing photos of people's houses. The root plan
  already established the mailing address is never published for this reason.
- **Licensed stock by trade** — legal, but a stock plumber on a named listing
  implies it is their team or their work. That is fabricated data on a page
  whose entire value is being trustworthy — the same rule that killed
  `ai-company-lookup`.

Two phases, in order.

---

## Phase A — Generated visual identity (ships first)

Every listing gets a deterministic generated mark. Not a photograph and not
pretending to be one: a trade icon on a colour derived from the business name.
Stable, so a business always renders identically.

### Files

| File | Change |
|---|---|
| `src/lib/businessMark.ts` | **new** — pure: name → palette index, initials |
| `src/components/directory/BusinessMark.tsx` | **new** — renders the mark, sizes sm/md/lg |
| `src/components/directory/DirectoryBusinessCard.tsx` | add mark to the card |
| `src/pages/DirectoryListing.tsx` | add mark to the detail hero |
| `src/pages/admin/Ingest.tsx` | small mark in the review table |
| `tests/unit/businessMark.test.ts` | **new** |

Reuses `ui/avatar.tsx` (shadcn) for the shape/fallback primitive rather than
introducing a second avatar abstraction.

### Design decisions

**Curated palette, not free-form HSL.** Hashing a name straight into
`hsl(h, s%, l%)` gives unpredictable contrast — some combinations fail against
the icon, and results differ between light and dark. The hash instead indexes a
fixed array of ~8 pairs, each checked for contrast in both themes. Bounded and
reviewable.

**Trade icon primary, initials only as fallback.** Initials are actively bad for
the 52 personal-name listings — "GG" for Georgiy Grekov reads like a rendering
bug — and carry no information. The vertical's icon says what the business does.
Initials are used only when `vertical` is missing.

**No files, no storage, no network.** Pure SVG. Nothing to upload, migrate,
cache-bust or pay for, and it cannot 404.

### Database
None. No columns, no migration.

### Tests
- Same name → same colour every time (determinism is the whole contract)
- Different names spread across the palette rather than clustering
- Personal names, empty string, unicode, very long names
- Missing/unknown vertical falls back to initials rather than rendering blank

### Acceptance criteria
- [ ] All 536 listings render a mark on card and detail page
- [ ] Same business shows the same colour on both pages and across reloads
- [ ] Legible in light and dark
- [ ] No layout shift — fixed dimensions
- [ ] Accessible name describes the business, not the decoration
- [ ] Gate clean: tests, lint, tsc, build

### Rollback
Revert the commit. No migration, nothing persisted.

---

## Phase B — Contractor photo uploads via the claim flow

The real pipeline. A contractor claims their listing, verifies by phone, and
uploads their own work under your terms — which also makes photos the reason to
claim.

Already in place: `claim-listing` deployed, phone verification, Supabase
storage, `is_claimed`, provider dashboard.

### Files

| File | Change |
|---|---|
| `supabase/migrations/<ts>_business_photos.sql` | **new** — table, bucket, RLS |
| `src/pages/ProviderDashboard.tsx` | upload / reorder / delete |
| `src/components/directory/BusinessGallery.tsx` | **new** — public gallery |
| `src/pages/DirectoryListing.tsx` | gallery when photos exist, mark when not |
| `src/pages/admin/…` | moderation queue |

### Database

A `business_photos` table rather than a JSON column — photos need ordering,
per-row moderation state, and their own RLS.

```
business_photos
  id, business_id → businesses(id) ON DELETE CASCADE
  storage_path, caption, sort_order
  status: pending | approved | rejected
  uploaded_by → auth.users(id), created_at
```

Bucket `business-photos`, public read. Writes restricted by RLS to the
authenticated owner of a **claimed** listing.

Note: the publish fix (migration `20260726230000`) showed this table's grants
are minimal by default — `authenticated` had SELECT only. Expect to grant
explicitly here too, and scope it as tightly.

### Moderation is not optional

This makes you a host of public user-uploaded images. Without review a claimed
listing can put anything on your domain. Photos land `pending`; only `approved`
rows are publicly readable, enforced in RLS rather than hidden in the UI.

### Tests
- A contractor cannot upload to a listing they have not claimed — verified
  against production the same way the publish grant was
- `pending` and `rejected` are invisible to anon
- Upload rejects by MIME type and size
- Deleting a business removes its photo rows

### Acceptance criteria
- [ ] Claimed contractor can upload, reorder, delete their own photos
- [ ] Unclaimed or other-listing uploads refused at the database
- [ ] Anon sees only `approved`
- [ ] Admin can approve/reject
- [ ] Listing falls back to the Phase A mark when no approved photo exists
- [ ] Gate clean

### Rollback
```sql
DROP TABLE IF EXISTS public.business_photos;
DELETE FROM storage.buckets WHERE id = 'business-photos';
```
Listings fall back to Phase A marks. Storage objects must be purged separately —
note before running.

---

## Sequencing

Phase A ships and is verified before Phase B starts. A is self-contained and
reversible; B carries a migration, public user content and a moderation surface,
and should not ride along with it.

## Open question for approval

Phase B lets contractors put images on your domain. This plan assumes **admin
approval before public**. Say so now if you would rather auto-approve and
moderate reactively — it changes the RLS design, not just the UI.
