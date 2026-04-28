// Middleware — Protect /portal/* pages (redirect to login if unauthenticated)
// Skips login.html and register.html so users can access them

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
  const path = url.pathname;

  // Allow access to login and register pages without auth
  // Check both with and without .html (Cloudflare Pages strips .html via 308 redirects)
  if (path === '/portal/login.html' || path === '/portal/login' ||
      path === '/portal/register.html' || path === '/portal/register') {
    return context.next();
  }

  // Also allow portal CSS/JS assets
  if (path.endsWith('.css') || path.endsWith('.js')) {
    return context.next();
  }

  const kv = context.env.PORTAL_KV;
  if (!kv) {
    // KV not configured yet — allow access without auth
    return context.next();
  }

  const session = await getSession(context.request, kv);
  if (!session) {
    return Response.redirect(new URL('/portal/login', url.origin), 302);
  }

  // Store user info for downstream use
  context.data.user = session;

  return context.next();
}
