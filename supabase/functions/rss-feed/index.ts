import { serviceRoleKey as readServiceRoleKey } from "../_shared/supabaseKeys.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      readServiceRoleKey()
    );

    const { data: posts, error } = await supabase
      .from('posts')
      .select('title, slug, excerpt, published_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    const blogDomain = Deno.env.get('BLOG_DOMAIN') || 'homequote-link-buddy.lovable.app';
    const siteUrl = `https://${blogDomain}`;

    const items = (posts || []).map(p => `
    <item>
      <title><![CDATA[${p.title}]]></title>
      <link>${siteUrl}/blog/${p.slug}</link>
      <guid isPermaLink="true">${siteUrl}/blog/${p.slug}</guid>
      <description><![CDATA[${p.excerpt || ''}]]></description>
      <pubDate>${new Date(p.published_at).toUTCString()}</pubDate>
    </item>`).join('');

    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>HomeQuoteLink Blog</title>
    <link>${siteUrl}/blog</link>
    <description>Expert plumbing tips, home maintenance guides, and industry insights.</description>
    <language>en-us</language>
    <atom:link href="${siteUrl}/feed.xml" rel="self" type="application/rss+xml"/>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>${items}
  </channel>
</rss>`;

    return new Response(rss, {
      headers: { ...corsHeaders, 'Content-Type': 'application/rss+xml; charset=utf-8' },
    });
  } catch (err) {
    console.error('[rss-feed]', err);
    return new Response('Internal Server Error', { status: 500, headers: corsHeaders });
  }
});
