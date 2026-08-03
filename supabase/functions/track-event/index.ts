import { serviceRoleKey as readServiceRoleKey } from "../_shared/supabaseKeys.ts";
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
    const payload = await req.json();
    const ip_address = getClientIp(req);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      readServiceRoleKey()
    );

    // Check if this IP is in the excluded_ips list (server-side exclusion)
    if (ip_address && ip_address !== 'unknown') {
      const { data: ipSetting } = await supabase
        .from('admin_settings')
        .select('setting_value')
        .eq('setting_key', 'excluded_ips')
        .maybeSingle();

      if (ipSetting?.setting_value && Array.isArray(ipSetting.setting_value)) {
        if ((ipSetting.setting_value as string[]).includes(ip_address)) {
          return new Response(JSON.stringify({ success: true, skipped: 'ip_excluded' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    }

    // Check if the request is from a Lovable preview domain
    const pageUrl = payload.page_url || '';
    const eventReferrer = payload.referrer || '';
    const isLovablePreview =
      pageUrl.includes('lovableproject.com') ||
      pageUrl.includes('lovable.app') ||
      eventReferrer.includes('lovableproject.com') ||
      eventReferrer.includes('lovable.app');

    if (isLovablePreview) {
      const { data: setting } = await supabase
        .from('admin_settings')
        .select('setting_value')
        .eq('setting_key', 'exclude_preview_views')
        .maybeSingle();

      if (setting?.setting_value === true) {
        return new Response(JSON.stringify({ success: true, skipped: 'preview_excluded' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const {
      event_type,
      event_name,
      page_path,
      referrer,
      utm_source,
      utm_medium,
      utm_campaign,
      gclid,
      session_id,
      visitor_id,
      user_agent,
      screen_width,
      screen_height,
      metadata,
      language,
      timezone,
      page_title,
      page_url,
      connection_type,
      is_touch_device,
    } = payload;

    if (!event_type) {
      return new Response(JSON.stringify({ error: 'event_type required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { error } = await supabase.from('analytics_events').insert({
      event_type,
      event_name: event_name || null,
      page_path: page_path || null,
      referrer: referrer || null,
      utm_source: utm_source || null,
      utm_medium: utm_medium || null,
      utm_campaign: utm_campaign || null,
      gclid: gclid || null,
      session_id: session_id || null,
      visitor_id: visitor_id || null,
      user_agent: user_agent || null,
      screen_width: screen_width || null,
      screen_height: screen_height || null,
      metadata: metadata || null,
      ip_address,
      language: language || null,
      timezone: timezone || null,
      page_title: page_title || null,
      page_url: page_url || null,
      connection_type: connection_type || null,
      is_touch_device: is_touch_device ?? null,
    });

    if (error) {
      console.error('[track-event] Insert error:', error);
      return new Response(JSON.stringify({ success: false, error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[track-event] Error:', err);
    return new Response(JSON.stringify({ success: false }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
