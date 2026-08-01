/**
 * manage-business-photos
 *
 * Lets a claimed listing's owner list, upload, delete, and reorder their own
 * photos — the only credential is the claim_token emailed to them, the same
 * one claim-listing already trusts. There is no login system for a claimed
 * listing's owner (see claim-listing's own header comment), so this function
 * re-validates the token against businesses.claim_token on every call rather
 * than relying on a session, and writes with the service role — RLS on
 * business_photos deliberately has no anon/authenticated write policy, so
 * this function is the only path a photo can be inserted, deleted, or
 * reordered through.
 *
 * Uploaded photos land status='pending'. Nothing here ever sets 'approved' —
 * that is an admin-only action (see the "Admins can moderate photos" RLS
 * policy), so a photo cannot go public without a human looking at it first.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { corsHeaders, json } from "../_shared/directory.ts";

const JOB_NAME = "manage-business-photos";
const BUCKET = "business-photos";

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_PHOTOS_PER_BUSINESS = 12;
const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

interface PhotoRow {
  id: string;
  storage_path: string;
  caption: string | null;
  sort_order: number;
  status: "pending" | "approved" | "rejected";
  created_at: string;
}

/**
 * Resolves a token to a claimed business. Deliberately requires is_claimed —
 * an unclaimed listing's token is only good for the claim flow itself, never
 * for managing content, since nobody has proven ownership yet.
 */
async function resolveBusiness(supabase: SupabaseClient, token: string): Promise<string | null> {
  const { data } = await supabase
    .from("businesses")
    .select("id")
    .eq("claim_token", token)
    .eq("is_claimed", true)
    .maybeSingle();
  return data?.id ?? null;
}

function publicUrl(supabase: SupabaseClient, storagePath: string): string {
  return supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
}

async function listPhotos(supabase: SupabaseClient, businessId: string) {
  const { data, error } = await supabase
    .from("business_photos")
    .select("id, storage_path, caption, sort_order, status, created_at")
    .eq("business_id", businessId)
    .is("archived_at", null)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(`List failed: ${error.message}`);

  const photos = (data as PhotoRow[]).map((p) => ({ ...p, url: publicUrl(supabase, p.storage_path) }));
  return json({ success: true, photos });
}

async function uploadPhoto(supabase: SupabaseClient, businessId: string, req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) {
    return json({ success: false, error: "No file provided." }, 400);
  }

  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    return json({ success: false, error: "Only JPEG, PNG, or WEBP images are accepted." }, 400);
  }
  if (file.size > MAX_FILE_BYTES) {
    return json({ success: false, error: "Photo is too large — 5MB maximum." }, 400);
  }

  // No session means no per-user rate limiting exists anywhere else in this
  // flow; this cap is what stands between the token endpoint and someone
  // uploading an unbounded number of photos to one listing.
  // Archived photos must not count toward the cap. They are no longer on the
  // listing, so counting them would let a few delete-and-reupload cycles
  // permanently exhaust an owner's twelve slots.
  const { count } = await supabase
    .from("business_photos")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .is("archived_at", null)
    .neq("status", "rejected");
  if ((count ?? 0) >= MAX_PHOTOS_PER_BUSINESS) {
    return json({ success: false, error: `Limit of ${MAX_PHOTOS_PER_BUSINESS} photos reached.` }, 400);
  }

  const { data: maxRow } = await supabase
    .from("business_photos")
    .select("sort_order")
    .eq("business_id", businessId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSortOrder = (maxRow?.sort_order ?? -1) + 1;

  const storagePath = `${businessId}/${crypto.randomUUID()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, bytes, { contentType: file.type, upsert: false });
  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

  const caption = String(form.get("caption") ?? "").trim().slice(0, 200) || null;

  const { data: row, error: insertError } = await supabase
    .from("business_photos")
    .insert({ business_id: businessId, storage_path: storagePath, caption, sort_order: nextSortOrder })
    .select("id, storage_path, caption, sort_order, status, created_at")
    .single();

  if (insertError) {
    // Don't leave an orphaned object in storage if the row never landed.
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw new Error(`Save failed: ${insertError.message}`);
  }

  return json({ success: true, photo: { ...row, url: publicUrl(supabase, row.storage_path) } });
}

async function deletePhoto(supabase: SupabaseClient, businessId: string, photoId: string) {
  const { data: photo } = await supabase
    .from("business_photos")
    .select("*")
    .eq("id", photoId)
    .eq("business_id", businessId) // scoped to this token's own business — cannot touch another listing's photo
    .is("archived_at", null)
    .maybeSingle();

  if (!photo) return json({ success: false, error: "Photo not found." }, 404);

  // Archived rather than deleted, per the project's archive-first policy.
  //
  // Two deliberate choices here:
  //  1. The storage file is LEFT IN PLACE. Archiving the row while deleting
  //     the file would make the record unrestorable, which defeats the point.
  //     Reclaiming that storage belongs with the purge path, not here.
  //  2. admin_archive_row() is not used: this runs under the service role on
  //     behalf of a contractor holding a claim token, not a signed-in admin,
  //     so is_admin() would reject it. The audit row is written directly with
  //     actor_context 'edge_function' to record that distinction.
  const { error } = await supabase
    .from("business_photos")
    .update({ archived_at: new Date().toISOString(), archive_reason: "removed by business owner" })
    .eq("id", photoId);
  if (error) throw new Error(`Archive failed: ${error.message}`);

  const { error: auditError } = await supabase.from("data_audit_log").insert({
    actor_user_id: null,
    actor_context: "edge_function",
    action: "archive",
    table_name: "business_photos",
    row_id: photoId,
    row_snapshot: photo,
    reason: "removed by business owner",
  });
  // The photo is already archived; failing the owner's request because the
  // audit write failed would be the wrong trade. Surface it and continue.
  if (auditError) {
    console.error(`[${JOB_NAME}] failed to write data_audit_log for photo ${photoId}:`, auditError.message);
  }

  return json({ success: true });
}

async function reorderPhotos(supabase: SupabaseClient, businessId: string, orderedIds: unknown) {
  if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== "string")) {
    return json({ success: false, error: "photo_ids must be an array of ids." }, 400);
  }

  // Confirm every id actually belongs to this business before writing
  // anything — a partial reorder across two listings would corrupt the
  // ordering of a business that never authorised the request.
  const { data: owned } = await supabase
    .from("business_photos")
    .select("id")
    .eq("business_id", businessId)
    .in("id", orderedIds as string[]);

  if ((owned?.length ?? 0) !== orderedIds.length) {
    return json({ success: false, error: "One or more photos do not belong to this listing." }, 400);
  }

  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from("business_photos")
      .update({ sort_order: i })
      .eq("id", orderedIds[i] as string);
    if (error) throw new Error(`Reorder failed: ${error.message}`);
  }

  return json({ success: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const contentType = req.headers.get("content-type") ?? "";
    let action: string;
    let token: string;
    let photoId = "";
    let orderedIds: unknown = null;

    if (contentType.includes("multipart/form-data")) {
      // Cloned so uploadPhoto can re-read the body as formData — Request
      // bodies are single-use.
      const probe = await req.clone().formData();
      action = String(probe.get("action") ?? "");
      token = String(probe.get("token") ?? "");
    } else {
      const body = await req.json().catch(() => ({}));
      action = String(body.action ?? "");
      token = String(body.token ?? "");
      photoId = String(body.photo_id ?? "");
      orderedIds = body.photo_ids;
    }

    if (!token) return json({ success: false, error: "Missing token." }, 400);

    const businessId = await resolveBusiness(supabase, token);
    if (!businessId) {
      return json({ success: false, error: "This link is invalid or the listing hasn't been claimed yet." }, 403);
    }

    switch (action) {
      case "list":
        return await listPhotos(supabase, businessId);
      case "upload":
        return await uploadPhoto(supabase, businessId, req);
      case "delete":
        return await deletePhoto(supabase, businessId, photoId);
      case "reorder":
        return await reorderPhotos(supabase, businessId, orderedIds);
      default:
        return json({ success: false, error: "Unknown action." }, 400);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${JOB_NAME}]`, message);
    return json({ success: false, error: "Could not complete that action." }, 500);
  }
});
