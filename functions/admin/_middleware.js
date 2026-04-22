// Middleware — Protect /admin/* pages (admin role required)

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
  const url = new URL(context.request.url);

  const kv = context.env.PORTAL_KV;
  if (!kv) {
    return context.next();
  }

  const session = await getSession(context.request, kv);
  if (!session) {
    return Response.redirect(new URL('/portal/login.html', url.origin), 302);
  }

  // Require admin role
  if (session.role !== 'admin') {
    return Response.redirect(new URL('/portal/index.html', url.origin), 302);
  }

  context.data.user = session;

  return context.next();
}
