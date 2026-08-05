import { serviceRoleKey as readServiceRoleKey } from "../_shared/supabaseKeys.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-contentflow-signature, x-cfs-signature, x-cfs-timestamp, x-cfs-signature-version',
};

async function verifyHmac(secret: string, message: string, receivedHex: string): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return expected === receivedHex;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const respond = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const secret = Deno.env.get('CONTENTFLOW_WEBHOOK_SECRET');
    if (!secret) throw new Error('Webhook secret not configured');

    const bodyText = await req.text();

    // Verify signature (support both v1 and v2)
    const v2Sig = req.headers.get('x-cfs-signature');
    const v1Sig = req.headers.get('x-contentflow-signature');
    const timestamp = req.headers.get('x-cfs-timestamp');
    const version = req.headers.get('x-cfs-signature-version');

    let valid = false;
    if (v2Sig && version === 'v2' && timestamp) {
      const hex = v2Sig.replace('sha256=', '');
      valid = await verifyHmac(secret, `${timestamp}.${bodyText}`, hex);
    } else if (v1Sig) {
      valid = await verifyHmac(secret, bodyText, v1Sig);
    }

    if (!valid) {
      return respond({ success: false, error: 'Invalid signature' }, 401);
    }

    const payload = JSON.parse(bodyText);
    const { event, data } = payload;

    const blogDomain = Deno.env.get('BLOG_DOMAIN') || 'homequote-link-buddy.lovable.app';

    // Acknowledge test events without storing
    if (event === 'post.test') {
      return respond({
        success: true,
        url: `https://${blogDomain}/blog/${data.slug}`,
      });
    }

    if (event !== 'post.published') {
      return respond({ success: false, error: `Unknown event: ${event}` }, 400);
    }

    // Store the article via service role (bypasses RLS)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      readServiceRoleKey()
    );

    const { data: post, error } = await supabase
      .from('posts')
      .upsert(
        {
          external_id: data.id,
          title: data.title,
          slug: data.slug,
          content: data.content,
          excerpt: data.excerpt || null,
          featured_image_url: data.featured_image_url || null,
          status: 'published',
          source: 'contentflow',
          published_at: new Date().toISOString(),
        },
        { onConflict: 'external_id' }
      )
      .select('slug')
      .single();

    if (error) throw error;

    return respond({
      success: true,
      url: `https://${blogDomain}/blog/${post.slug}`,
    }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[receive-article] Error:', msg);
    return respond({ success: false, error: msg }, 500);
  }
});
