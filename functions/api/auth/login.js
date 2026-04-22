// Cloudflare Pages Function — User Login
// POST /api/auth/login

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
}

export async function onRequestPost(context) {
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

  const { email, password } = body;
  if (!email || !password) {
    return new Response(JSON.stringify({ error: 'Email and password are required.' }), { status: 400, headers: corsHeaders });
  }

  const emailLower = email.toLowerCase().trim();

  // Look up user
  const raw = await kv.get(`user:${emailLower}`);
  if (!raw) {
    return new Response(JSON.stringify({ error: 'Invalid email or password.' }), { status: 401, headers: corsHeaders });
  }

  const user = JSON.parse(raw);

  // Check status
  if (user.status === 'pending') {
    return new Response(JSON.stringify({ error: 'Your registration is pending approval. Please wait for an administrator to review your request.' }), { status: 403, headers: corsHeaders });
  }
  if (user.status === 'rejected') {
    return new Response(JSON.stringify({ error: 'Your registration has been declined. Please contact enquiries@axsuma.co.uk for assistance.' }), { status: 403, headers: corsHeaders });
  }

  // Verify password
  const passwordHash = await hashPassword(password, user.salt);
  if (passwordHash !== user.passwordHash) {
    return new Response(JSON.stringify({ error: 'Invalid email or password.' }), { status: 401, headers: corsHeaders });
  }

  // Create session
  const token = crypto.randomUUID();
  const expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days
  const session = {
    email: user.email,
    name: user.name,
    company: user.company,
    role: user.role,
    expiresAt,
  };

  await kv.put(`session:${token}`, JSON.stringify(session), {
    expirationTtl: 7 * 24 * 60 * 60, // 7 days in seconds
  });

  // Set cookie
  const cookie = `portal_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`;

  const redirect = user.role === 'admin' ? '/admin/' : '/portal/';

  return new Response(JSON.stringify({ ok: true, redirect, role: user.role }), {
    status: 200,
    headers: {
      ...corsHeaders,
      'Set-Cookie': cookie,
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders });
}
