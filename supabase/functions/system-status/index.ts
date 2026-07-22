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
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

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
    let cronJobs: Record<string, unknown>[] = [];
    try {
      const { data } = await adminClient.rpc("get_cron_jobs");
      cronJobs = data ?? [];
    } catch {
      // pg_cron might not expose via rpc, try direct query
      cronJobs = [];
    }

    // 2. Edge functions list — derive from known functions
    const knownFunctions = [
      "ai-image",
      "ai-writer",
      "notify-admin-email",
      "publish-scheduled",
      "receive-article",
      "rss-feed",
      "send-buyer-notification",
      "sitemap",
      "system-status",
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
