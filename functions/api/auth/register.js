// Cloudflare Pages Function — User Registration
// POST /api/auth/register

const ADMIN_EMAILS = [
  'giacomo.previtali@sdcprevitali.com',
  'jason.reader@axsuma.co.uk',
  'charlotte.phippshornby@axsuma.co.uk',
];

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

  const { name, company, email, password } = body;

  // Validate
  if (!name || !email || !password) {
    return new Response(JSON.stringify({ error: 'Name, email and password are required.' }), { status: 400, headers: corsHeaders });
  }
  if (password.length < 8) {
    return new Response(JSON.stringify({ error: 'Password must be at least 8 characters.' }), { status: 400, headers: corsHeaders });
  }

  const emailLower = email.toLowerCase().trim();

  // Check if user already exists
  const existing = await kv.get(`user:${emailLower}`);
  if (existing) {
    return new Response(JSON.stringify({ error: 'An account with this email already exists.' }), { status: 409, headers: corsHeaders });
  }

  // Hash password
  const salt = crypto.randomUUID();
  const passwordHash = await hashPassword(password, salt);

  // Determine role and status
  const isAdmin = ADMIN_EMAILS.includes(emailLower);
  const user = {
    email: emailLower,
    name: name.trim(),
    company: (company || '').trim(),
    passwordHash,
    salt,
    role: isAdmin ? 'admin' : 'user',
    status: isAdmin ? 'approved' : 'pending',
    createdAt: new Date().toISOString(),
  };

  // Store user
  await kv.put(`user:${emailLower}`, JSON.stringify(user));

  // Update users index
  let index = [];
  try {
    const raw = await kv.get('users_index');
    if (raw) index = JSON.parse(raw);
  } catch {}
  if (!index.includes(emailLower)) {
    index.push(emailLower);
    await kv.put('users_index', JSON.stringify(index));
  }

  // Send notification email to admins (if Resend is configured and user is not admin)
  if (!isAdmin && context.env.RESEND_API_KEY) {
    try {
      const adminEmails = ADMIN_EMAILS.filter(e => e !== emailLower);
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${context.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Axsuma Portal <portal@axsuma.co.uk>',
          to: adminEmails,
          subject: `New Portal Registration: ${user.name}`,
          html: `
            <h2>New Portal Registration</h2>
            <p><strong>Name:</strong> ${user.name}</p>
            <p><strong>Company:</strong> ${user.company || '—'}</p>
            <p><strong>Email:</strong> ${user.email}</p>
            <p><strong>Date:</strong> ${user.createdAt}</p>
            <p>Log in to the <a href="https://axsuma.co.uk/admin/">Admin Dashboard</a> to approve or reject this registration.</p>
          `,
        }),
      });
    } catch {}
  }

  const message = isAdmin
    ? 'Registration successful. You can log in now.'
    : 'Registration submitted. An administrator will review your request shortly.';

  return new Response(JSON.stringify({ ok: true, message }), { status: 201, headers: corsHeaders });
}

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders });
}
