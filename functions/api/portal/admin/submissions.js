// Cloudflare Pages Function — Admin: list and manage submissions
// Protected by Cloudflare Access (admin policy)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// GET: List all submissions (with optional ?type= filter)
export async function onRequestGet(context) {
  const kv = context.env.PORTAL_KV;
  if (!kv) {
    return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers: corsHeaders });
  }

  const url = new URL(context.request.url);
  const filterType = url.searchParams.get('type');
  const filterStatus = url.searchParams.get('status');
  const limit = parseInt(url.searchParams.get('limit') || '100', 10);

  try {
    // Get index
    let index = [];
    const raw = await kv.get('submissions:index');
    if (raw) index = JSON.parse(raw);

    // Fetch submissions
    const submissions = [];
    for (const id of index.slice(0, limit)) {
      const data = await kv.get(`submission:${id}`);
      if (!data) continue;
      const sub = JSON.parse(data);

      // Apply filters
      if (filterType && sub.formType !== filterType) continue;
      if (filterStatus && sub.status !== filterStatus) continue;

      // Return summary (not full form data for list view)
      submissions.push({
        id: sub.id,
        formType: sub.formType,
        status: sub.status,
        submittedAt: sub.submittedAt,
        contactName: sub.data.contact_name || sub.data.appointor_name || '',
        organisation: sub.data.practice_name || sub.data.organisation || sub.data.company_name || '',
        email: sub.data.email || sub.data.contact_email || sub.data.appointor_email || '',
      });
    }

    return new Response(JSON.stringify({ submissions, total: submissions.length }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}

// PATCH: Update submission status
export async function onRequestPatch(context) {
  const kv = context.env.PORTAL_KV;
  if (!kv) {
    return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers: corsHeaders });
  }

  try {
    const body = await context.request.json();
    const { id, status } = body;
    if (!id || !status) {
      return new Response(JSON.stringify({ error: 'Missing id or status' }), { status: 400, headers: corsHeaders });
    }

    const raw = await kv.get(`submission:${id}`);
    if (!raw) {
      return new Response(JSON.stringify({ error: 'Submission not found' }), { status: 404, headers: corsHeaders });
    }

    const sub = JSON.parse(raw);
    sub.status = status;
    sub.updatedAt = new Date().toISOString();

    await kv.put(`submission:${id}`, JSON.stringify(sub), {
      metadata: { formType: sub.formType, status, submittedAt: sub.submittedAt },
    });

    return new Response(JSON.stringify({ success: true, id, status }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders });
}
