import { useState, useEffect } from "react";
import { directoryDb } from "@/integrations/supabase/directory";
import { BusinessMark } from "@/components/directory/BusinessMark";

interface GalleryPhoto {
  id: string;
  storage_path: string;
  caption: string | null;
  url: string;
}

/** Synchronous URL construction, no network call — same helper the edge function uses. */
function publicPhotoUrl(storagePath: string): string {
  return directoryDb.storage.from("business-photos").getPublicUrl(storagePath).data.publicUrl;
}

interface BusinessGalleryProps {
  businessId: string;
  businessName: string;
  verticalSlug: string | null;
}

/**
 * The listing hero: an approved-photo gallery once a claimed owner has
 * uploaded and an admin has approved at least one, otherwise the Phase A
 * generated mark. Owns its own fetch and loading state so the two never
 * flash one after the other — by the time anything renders, which of the two
 * to show is already decided.
 *
 * Reads business_photos directly rather than through manage-business-photos:
 * this is the public path, gated by the "Anyone can view approved photos" RLS
 * policy (status = 'approved'), not the token-authenticated owner path.
 */
export function BusinessGallery({ businessId, businessName, verticalSlug }: BusinessGalleryProps) {
  const [photos, setPhotos] = useState<GalleryPhoto[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    directoryDb
      .from("business_photos")
      .select("id, storage_path, caption")
      .eq("business_id", businessId)
      .eq("status", "approved")
      // Archived photos are removed from the listing but kept on record.
      .is("archived_at", null)
      .order("sort_order", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Failed to load photos:", error.message);
          setPhotos([]);
          return;
        }
        const rows = (data ?? []) as Omit<GalleryPhoto, "url">[];
        setPhotos(rows.map((p) => ({ ...p, url: publicPhotoUrl(p.storage_path) })));
      });
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  // Nothing decided yet — hold the mark's exact footprint so the hero
  // doesn't jump once the fetch resolves.
  if (photos === null) {
    return <div className="h-16 w-16 shrink-0 animate-pulse rounded-xl bg-muted" aria-hidden="true" />;
  }

  if (photos.length === 0) {
    return <BusinessMark businessName={businessName} verticalSlug={verticalSlug} size="lg" className="rounded-xl" />;
  }

  const [hero, ...rest] = photos;

  return (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
      <a
        href={hero.url}
        target="_blank"
        rel="noopener noreferrer"
        className="col-span-4 row-span-2 overflow-hidden rounded-xl sm:col-span-3"
      >
        <img
          src={hero.url}
          alt={hero.caption ?? `Work by ${businessName}`}
          className="aspect-video w-full object-cover transition hover:opacity-90"
        />
      </a>
      {rest.slice(0, 5).map((photo) => (
        <a
          key={photo.id}
          href={photo.url}
          target="_blank"
          rel="noopener noreferrer"
          className="col-span-2 overflow-hidden rounded-lg sm:col-span-1"
        >
          <img
            src={photo.url}
            alt={photo.caption ?? `Work by ${businessName}`}
            className="aspect-square w-full object-cover transition hover:opacity-90"
          />
        </a>
      ))}
    </div>
  );
}
