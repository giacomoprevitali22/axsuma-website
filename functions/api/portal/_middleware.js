// Middleware — Protect /api/portal/* endpoints (return 401 if unauthenticated)

async function getSession(request, kv) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/portal_session=([^;]+)/);
  if (!match) return null;

  const token = match[1];
  const raw = await kv.get(`session:${token}`);
  if (!raw) return null;

  const session = JSON.parse(raw);
  if (Date.now() > session.expiresAt) {
    await kv.delete(`session:${token}`);
    return null;
  }

  return session;
}

export async function onRequest(context) {
  // Allow OPTIONS (CORS preflight)
  if (context.request.method === 'OPTIONS') {
    return context.next();
  }

  const kv = context.env.PORTAL_KV;
  if (!kv) {
    return context.next();
  }

  const session = await getSession(context.request, kv);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized. Please log in.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  context.data.user = session;

  return context.next();
}
