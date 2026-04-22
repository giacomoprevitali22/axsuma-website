// Cloudflare Pages Function — User Logout
// POST /api/auth/logout

export async function onRequestPost(context) {
  const kv = context.env.PORTAL_KV;

  // Get session token from cookie
  const cookie = context.request.headers.get('Cookie') || '';
  const match = cookie.match(/portal_session=([^;]+)/);

  if (match && kv) {
    try {
      await kv.delete(`session:${match[1]}`);
    } catch {}
  }

  // Clear cookie
  const clearCookie = 'portal_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearCookie,
    },
  });
}

export async function onRequestGet(context) {
  // Allow GET for simple logout links
  return onRequestPost(context);
}
