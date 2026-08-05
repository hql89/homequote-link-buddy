import { serviceRoleKey as readServiceRoleKey, publishableKey as readPublishableKey } from "../_shared/supabaseKeys.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify admin
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = readServiceRoleKey();
    const anonKey = readPublishableKey();

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Check admin
    const { data: adminRow } = await adminClient
      .from("admin_users")
      .select("user_id")
      .eq("user_id", user.id)
      .single();
    if (!adminRow) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Cron jobs status
    //
    // admin_list_cron_jobs() is SECURITY DEFINER gated on is_admin(), which
    // reads auth.uid() — that only resolves for a call carrying the caller's
    // own JWT, not the service-role client used everywhere else in this
    // function. Reuse userClient (built from the incoming Authorization
    // header above) so the check sees the same admin already verified.
    //
    // This can still legitimately return nothing: pg_cron is not installed on
    // this project, so the call throws 42P01 and is caught below like any
    // other failure. Settings -> Background Jobs is where "no jobs" is told
    // apart from "couldn't read" (see cronAvailability.ts) — this endpoint
    // only reports what it could confirm.
    let cronJobs: Record<string, unknown>[] = [];
    try {
      const { data, error } = await userClient.rpc("admin_list_cron_jobs");
      if (error) throw error;
      cronJobs = data ?? [];
    } catch {
      cronJobs = [];
    }

    // 2. Edge functions list — mirrors supabase/functions/* (minus _shared).
    // Deployed functions run in isolation and can't enumerate their siblings
    // at runtime, so this has to be maintained by hand alongside that
    // directory. Deliberately includes functions known not to be deployed —
    // that's what turns them "error"/"unreachable" below, which is itself
    // useful information on this page.
    const knownFunctions = [
      "ai-image",
      "ai-writer",
      "analyze-lead",
      "check-blocklist",
      "claim-listing",
      "confirm-canary",
      "email-canary",
      "import-ingest-queue",
      "ingest-business",
      "notify-admin-email",
      "process-ingest-queue",
      "publish-scheduled",
      "purge-analytics",
      "rate-limit-lead",
      "receive-article",
      "rss-feed",
      "send-buyer-notification",
      "send-lead-confirmation",
      "send-nurture-emails",
      "send-outreach-drip",
      "sitemap",
      "submit-directory-lead",
      "submit-feedback",
      "system-status",
      "track-event",
      "track-view",
    ];

    // Ping each function to check health
    const functionStatuses = await Promise.all(
      knownFunctions.map(async (name) => {
        try {
          const resp = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
            method: "OPTIONS",
          });
          return { name, status: resp.status < 500 ? "healthy" : "error", code: resp.status };
        } catch {
          return { name, status: "unreachable", code: 0 };
        }
      })
    );

    // 3. Storage usage
    let storageBuckets: Array<{ name: string; public: boolean; fileCount: number; totalSizeBytes: number }> = [];
    try {
      const { data: buckets } = await adminClient.storage.listBuckets();
      if (buckets) {
        storageBuckets = await Promise.all(
          buckets.map(async (bucket: { name: string; public: boolean }) => {
            const { data: files } = await adminClient.storage.from(bucket.name).list("", { limit: 1000 });
            const fileCount = files?.length ?? 0;
            const totalSize = files?.reduce((sum: number, f: { metadata?: { size?: number } }) => sum + (f.metadata?.size || 0), 0) ?? 0;
            return {
              name: bucket.name,
              public: bucket.public,
              fileCount,
              totalSizeBytes: totalSize,
            };
          })
        );
      }
    } catch {
      // storage might not be available
    }

    // 4. Database stats
    const { count: postsCount } = await adminClient.from("posts").select("*", { count: "exact", head: true });
    const { count: leadsCount } = await adminClient.from("leads").select("*", { count: "exact", head: true });
    const { count: buyersCount } = await adminClient.from("buyers").select("*", { count: "exact", head: true });
    const { count: metricsCount } = await adminClient.from("post_metrics").select("*", { count: "exact", head: true });
    const { count: versionsCount } = await adminClient.from("post_versions").select("*", { count: "exact", head: true });

    const result = {
      timestamp: new Date().toISOString(),
      edgeFunctions: functionStatuses,
      storage: storageBuckets,
      database: {
        posts: postsCount ?? 0,
        leads: leadsCount ?? 0,
        buyers: buyersCount ?? 0,
        postMetrics: metricsCount ?? 0,
        postVersions: versionsCount ?? 0,
      },
      cronJobs,
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
