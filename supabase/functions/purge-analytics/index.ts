import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Extract client IP from various headers (in priority order)
function getClientIp(req: Request): string {
  const cfIp = req.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const firstIp = forwardedFor.split(',')[0]?.trim();
    if (firstIp) return firstIp;
  }
  const fastlyIp = req.headers.get('fastly-client-ip');
  if (fastlyIp) return fastlyIp.trim();
  const trueClientIp = req.headers.get('true-client-ip');
  if (trueClientIp) return trueClientIp.trim();
  return 'unknown';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate admin auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userErr } = await anonClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check admin status
    const userId = user.id;
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: adminRow } = await serviceClient
      .from('admin_users')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (!adminRow) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { visitor_id, register_ip } = body;
    const callerIp = getClientIp(req);

    // If register_ip is true, store this IP in excluded_ips setting
    if (register_ip) {
      const { data: existing } = await serviceClient
        .from('admin_settings')
        .select('setting_value')
        .eq('setting_key', 'excluded_ips')
        .maybeSingle();

      const ipList: string[] = Array.isArray(existing?.setting_value) ? existing.setting_value : [];

      if (callerIp !== 'unknown' && !ipList.includes(callerIp)) {
        ipList.push(callerIp);
        await serviceClient
          .from('admin_settings')
          .upsert(
            { setting_key: 'excluded_ips', setting_value: ipList },
            { onConflict: 'setting_key' }
          );
      }

      // If only registering IP (no purge requested), return early
      if (!visitor_id && !body.purge) {
        return new Response(JSON.stringify({ success: true, registered_ip: callerIp !== 'unknown' ? callerIp : null }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // If unregister_ip is true, remove this IP from excluded_ips
    if (body.unregister_ip) {
      const { data: existing } = await serviceClient
        .from('admin_settings')
        .select('setting_value')
        .eq('setting_key', 'excluded_ips')
        .maybeSingle();

      let ipList: string[] = Array.isArray(existing?.setting_value) ? existing.setting_value : [];
      ipList = ipList.filter((ip: string) => ip !== callerIp);

      await serviceClient
        .from('admin_settings')
        .upsert(
          { setting_key: 'excluded_ips', setting_value: ipList },
          { onConflict: 'setting_key' }
        );

      return new Response(JSON.stringify({ success: true, unregistered_ip: callerIp }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use database function to purge (avoids PostgREST schema cache issues)
    const ipParam = (callerIp && callerIp !== 'unknown') ? callerIp : null;
    const visitorParam = visitor_id || null;

    if (!ipParam && !visitorParam) {
      return new Response(JSON.stringify({ error: 'Could not determine IP or visitor_id for purge', count: 0, ip: callerIp }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: count, error: deleteErr } = await serviceClient
      .rpc('purge_analytics_by_ip_or_visitor', {
        p_ip: ipParam,
        p_visitor_id: visitorParam,
      });

    if (deleteErr) {
      console.error('[purge-analytics] Delete error:', deleteErr);
      return new Response(JSON.stringify({ error: deleteErr.message, count: 0 }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[purge-analytics] Deleted ${count} records for ip=${callerIp}, visitor_id=${visitor_id}`);

    return new Response(JSON.stringify({ success: true, count, ip: callerIp, visitor_id: visitor_id || null }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[purge-analytics] Error:', err);
    return new Response(JSON.stringify({ error: 'Internal error', count: 0 }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
