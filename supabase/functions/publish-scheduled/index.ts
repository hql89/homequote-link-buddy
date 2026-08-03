import { serviceRoleKey as readServiceRoleKey } from "../_shared/supabaseKeys.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const JOB_NAME = 'publish-scheduled-posts';
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;

async function withRetries<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_ATTEMPTS) break;
      const delay = BASE_BACKOFF_MS * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200);
      console.warn(`[publish-scheduled] ${label} attempt ${attempt} failed, retrying in ${delay}ms`, err);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

async function logRun(
  supabase: ReturnType<typeof createClient>,
  status: 'success' | 'failure' | 'partial',
  attempts: number,
  durationMs: number,
  errorMessage: string | null,
  metadata: Record<string, unknown>,
) {
  try {
    await supabase.from('job_run_logs').insert({
      job_name: JOB_NAME,
      status,
      attempts,
      duration_ms: durationMs,
      error_message: errorMessage,
      metadata,
    });
  } catch (logErr) {
    console.error('[publish-scheduled] failed to write job_run_logs:', logErr);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  let attemptsUsed = 0;
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    readServiceRoleKey(),
  );

  try {
    // Find all scheduled posts that are due
    const now = new Date().toISOString();
    const posts = await withRetries('fetch scheduled posts', async () => {
      attemptsUsed++;
      const { data, error } = await supabase
        .from('posts')
        .select('id, title, slug')
        .eq('status', 'scheduled')
        .lte('scheduled_at', now);
      if (error) throw error;
      return data;
    });

    if (!posts || posts.length === 0) {
      await logRun(supabase, 'success', attemptsUsed, Date.now() - startedAt, null, { published: 0 });
      return new Response(JSON.stringify({ success: true, published: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const ids = posts.map(p => p.id);
    await withRetries('publish posts', async () => {
      attemptsUsed++;
      const { error } = await supabase
        .from('posts')
        .update({ status: 'published', published_at: now })
        .in('id', ids);
      if (error) throw error;
    });

    console.log(`[publish-scheduled] Published ${posts.length} post(s):`, posts.map(p => p.slug));
    await logRun(supabase, 'success', attemptsUsed, Date.now() - startedAt, null, {
      published: posts.length,
      slugs: posts.map((p) => p.slug),
    });

    return new Response(JSON.stringify({
      success: true,
      published: posts.length,
      slugs: posts.map(p => p.slug),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[publish-scheduled]', msg);
    await logRun(supabase, 'failure', attemptsUsed || 1, Date.now() - startedAt, msg, {});
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
