// Cloudflare Pages Function — Admin: user management
// GET  /api/portal/admin/users         — list all users
// PATCH /api/portal/admin/users        — update user status/role

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export async function onRequestGet(context) {
  const kv = context.env.PORTAL_KV;
  if (!kv) {
    return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers: corsHeaders });
  }

  try {
    const raw = await kv.get('users_index');
    const index = raw ? JSON.parse(raw) : [];

    const users = [];
    for (const email of index) {
      const userData = await kv.get(`user:${email}`);
      if (userData) {
        const user = JSON.parse(userData);
        // Don't expose password hash
        users.push({
          email: user.email,
          name: user.name,
          company: user.company,
          role: user.role,
          status: user.status,
          createdAt: user.createdAt,
        });
      }
    }

    // Sort: pending first, then by date descending
    users.sort(function(a, b) {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (a.status !== 'pending' && b.status === 'pending') return 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    return new Response(JSON.stringify({ users }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}

export async function onRequestPatch(context) {
  const kv = context.env.PORTAL_KV;
  if (!kv) {
    return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers: corsHeaders });
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: corsHeaders });
  }

  const { email, status, role } = body;
  if (!email) {
    return new Response(JSON.stringify({ error: 'Email is required.' }), { status: 400, headers: corsHeaders });
  }

  try {
    const raw = await kv.get(`user:${email}`);
    if (!raw) {
      return new Response(JSON.stringify({ error: 'User not found.' }), { status: 404, headers: corsHeaders });
    }

    const user = JSON.parse(raw);

    if (status && ['approved', 'pending', 'rejected'].includes(status)) {
      user.status = status;
    }
    if (role && ['user', 'admin'].includes(role)) {
      user.role = role;
    }

    user.updatedAt = new Date().toISOString();
    await kv.put(`user:${email}`, JSON.stringify(user));

    // If approved and Resend is configured, notify the user
    if (status === 'approved' && context.env.RESEND_API_KEY) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${context.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Axsuma Portal <portal@axsuma.co.uk>',
            to: [user.email],
            subject: 'Your Axsuma Portal Access Has Been Approved',
            html: `
              <h2>Access Approved</h2>
              <p>Dear ${user.name},</p>
              <p>Your registration for the Axsuma Client Portal has been approved. You can now log in at:</p>
              <p><a href="https://axsuma.co.uk/portal/login.html">https://axsuma.co.uk/portal/login.html</a></p>
              <p>Kind regards,<br>Axsuma Team</p>
            `,
          }),
        });
      } catch {}
    }

    return new Response(JSON.stringify({ ok: true, user: { email: user.email, name: user.name, status: user.status, role: user.role } }), {
      status: 200, headers: corsHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders });
}
