// Middleware — Require admin role for /api/portal/admin/* endpoints
// Note: session is already validated by parent /api/portal/_middleware.js

export async function onRequest(context) {
  // Allow OPTIONS (CORS preflight)
  if (context.request.method === 'OPTIONS') {
    return context.next();
  }

  const user = context.data.user;
  if (!user || user.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Admin access required.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return context.next();
}
