import { serviceRoleKey as readServiceRoleKey } from "../_shared/supabaseKeys.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const respond = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');

    const { prompt, style, slug } = await req.json();
    if (!prompt) return respond({ error: 'Prompt is required' }, 400);

    const styleMap: Record<string, string> = {
      photo: 'photorealistic, professional photography',
      illustration: 'clean illustration style, vector-like',
      flat: 'flat design, modern minimal',
      '3d': '3D rendered, soft lighting',
      cinematic: 'cinematic, dramatic lighting, widescreen',
    };

    const styleHint = styleMap[style] || styleMap.photo;
    const fullPrompt = `Generate a professional blog header image: ${prompt}. Style: ${styleHint}. Aspect ratio 16:9, clean composition, suitable for a home services website.`;

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-image',
        messages: [{ role: 'user', content: fullPrompt }],
        modalities: ['image', 'text'],
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) return respond({ error: 'Rate limit exceeded.' }, 429);
      if (aiResponse.status === 402) return respond({ error: 'AI credits exhausted.' }, 402);
      const errText = await aiResponse.text();
      console.error('AI image error:', aiResponse.status, errText);
      return respond({ error: 'AI image generation failed' }, 500);
    }

    const data = await aiResponse.json();
    const imageData = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;

    if (!imageData) {
      return respond({ error: 'No image was generated' }, 500);
    }

    // Upload to storage
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      readServiceRoleKey()
    );

    const base64 = imageData.replace(/^data:image\/\w+;base64,/, '');
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const filename = `${slug || 'image'}-${Date.now()}.png`;

    const { error: uploadError } = await supabase.storage
      .from('blog-images')
      .upload(filename, bytes, { contentType: 'image/png', upsert: true });

    if (uploadError) throw uploadError;

    const { data: publicUrl } = supabase.storage.from('blog-images').getPublicUrl(filename);

    // Also save to media_assets
    await supabase.from('media_assets').insert({
      url: publicUrl.publicUrl,
      type: 'image',
      alt_text: prompt.slice(0, 200),
      title: filename,
      metadata: { prompt, style, source: 'ai-generated' },
    });

    return respond({
      success: true,
      url: publicUrl.publicUrl,
      alt_text: prompt.slice(0, 200),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[ai-image]', msg);
    return respond({ error: msg }, 500);
  }
});
