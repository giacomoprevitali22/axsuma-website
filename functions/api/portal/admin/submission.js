// Cloudflare Pages Function — Admin: get single submission detail
// GET /api/portal/admin/submission?id=xxx

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export async function onRequestGet(context) {
  const kv = context.env.PORTAL_KV;
  if (!kv) {
    return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers: corsHeaders });
  }

  const url = new URL(context.request.url);
  const id = url.searchParams.get('id');
  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing id parameter' }), { status: 400, headers: corsHeaders });
  }

  try {
    const raw = await kv.get(`submission:${id}`);
    if (!raw) {
      return new Response(JSON.stringify({ error: 'Submission not found' }), { status: 404, headers: corsHeaders });
    }
    return new Response(raw, { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders });
}
