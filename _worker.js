/**
 * Axsuma CMS — Cloudflare Pages Worker
 * ──────────────────────────────────────
 * This file integrates the CMS API directly into Cloudflare Pages.
 * Requests to /api/* are handled by the CMS logic.
 * All other requests fall through to the static site assets.
 *
 * KV Bindings required (add in Cloudflare Pages → Settings → Functions → KV namespace bindings):
 *   CMS_CONTENT  →  your KV namespace for content
 *   CMS_USERS    →  your KV namespace for users
 */

// ── Utilities ────────────────────────────────────────────────────

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function hashPassword(password, salt = 'axsuma-cms-salt') {
  const encoder = new TextEncoder();
  const data = encoder.encode(salt + password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function base64UrlEncode(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64UrlDecode(str) {
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
  return atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
}

// ── JWT ──────────────────────────────────────────────────────────

const DEFAULT_JWT_SECRET = 'axsuma-cms-jwt-secret-k8f3m9x2q7w4';

function getSecret(env) {
  return env.JWT_SECRET || DEFAULT_JWT_SECRET;
}

async function createJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const jwtPayload = { ...payload, exp: now + 86400, iat: now };

  const headerEnc = base64UrlEncode(JSON.stringify(header));
  const payloadEnc = base64UrlEncode(JSON.stringify(jwtPayload));

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );

  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${headerEnc}.${payloadEnc}`));
  const sigEnc = base64UrlEncode(String.fromCharCode(...new Uint8Array(sig)));

  return `${headerEnc}.${payloadEnc}.${sigEnc}`;
}

async function verifyJWT(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerEnc, payloadEnc, sigEnc] = parts;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );

    const sigBytes = Uint8Array.from(
      base64UrlDecode(sigEnc), c => c.charCodeAt(0)
    );

    const valid = await crypto.subtle.verify(
      'HMAC', key, sigBytes,
      encoder.encode(`${headerEnc}.${payloadEnc}`)
    );
    if (!valid) return null;

    const payload = JSON.parse(base64UrlDecode(payloadEnc));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch (e) {
    return null;
  }
}

// ── HTTP helpers ─────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
  });
}

function err(message, status = 400) {
  return json({ error: message }, status);
}

// ── Default users ────────────────────────────────────────────────

const DEFAULT_USERS = [
  { name: 'Giacomo Previtali', email: 'giacomo.previtali@sdcprevitali.com', password: '3548Omagreb.g22;', role: 'super_admin' },
  { name: 'Jason Reader', email: 'jason.reader@axsuma.co.uk', password: 'Axsuma2026!!', role: 'editor' },
  { name: 'Charlotte Phipps-Hornby', email: 'charlotte.phippshornby@axsuma.co.uk', password: 'Axsuma2026!!', role: 'editor' },
];

// ── Data access ──────────────────────────────────────────────────

async function initializeIfNeeded(env) {
  const idx = await env.CMS_USERS.get('users:index');
  if (idx) return;

  const ids = [];
  for (const u of DEFAULT_USERS) {
    const id = generateUUID();
    const ph = await hashPassword(u.password);
    const user = { id, name: u.name, email: u.email, role: u.role, passwordHash: ph, locked: false, createdAt: new Date().toISOString() };
    await env.CMS_USERS.put(`user:${id}`, JSON.stringify(user));
    await env.CMS_USERS.put(`email:${u.email}`, id);
    ids.push(id);
  }
  await env.CMS_USERS.put('users:index', JSON.stringify(ids));
}

async function getUserByEmail(env, email) {
  const id = await env.CMS_USERS.get(`email:${email}`);
  if (!id) return null;
  const j = await env.CMS_USERS.get(`user:${id}`);
  return j ? JSON.parse(j) : null;
}

async function getUserById(env, id) {
  const j = await env.CMS_USERS.get(`user:${id}`);
  return j ? JSON.parse(j) : null;
}

async function getAllUsers(env) {
  const idx = await env.CMS_USERS.get('users:index');
  if (!idx) return [];
  const ids = JSON.parse(idx);
  const out = [];
  for (const id of ids) {
    const u = await getUserById(env, id);
    if (u) { const { passwordHash, ...safe } = u; out.push(safe); }
  }
  return out;
}

async function logActivity(env, userId, userName, pageKey) {
  let log = [];
  const j = await env.CMS_USERS.get('activity:log');
  if (j) log = JSON.parse(j);
  log.unshift({ user: userName, page: pageKey, timestamp: new Date().toISOString() });
  log = log.slice(0, 50);
  await env.CMS_USERS.put('activity:log', JSON.stringify(log));
}

async function getAuthUser(request, env) {
  const ah = request.headers.get('Authorization');
  if (!ah || !ah.startsWith('Bearer ')) return null;
  const payload = await verifyJWT(ah.slice(7), getSecret(env));
  if (!payload) return null;
  return getUserById(env, payload.sub);
}

// ── Route handlers ───────────────────────────────────────────────

async function handleLogin(request, env) {
  let body;
  try { body = await request.json(); } catch { return err('Invalid JSON'); }

  const { email, password } = body;
  if (!email || !password) return err('Email and password required');

  await initializeIfNeeded(env);

  const user = await getUserByEmail(env, email);
  if (!user) return err('Invalid credentials', 401);
  if (user.locked) return err('User account is locked', 403);

  const ph = await hashPassword(password);
  if (ph !== user.passwordHash) return err('Invalid credentials', 401);

  const token = await createJWT({ sub: user.id, role: user.role }, getSecret(env));
  return json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}

async function handleGetContent(request, env, pageKey) {
  const user = await getAuthUser(request, env);
  if (!user) return err('Unauthorized', 401);
  const c = await env.CMS_CONTENT.get(`content:${pageKey}`);
  if (!c) return err('Content not found', 404);
  return json(JSON.parse(c));
}

async function handleUpdateContent(request, env, pageKey) {
  const user = await getAuthUser(request, env);
  if (!user) return err('Unauthorized', 401);
  if (!['editor', 'super_admin'].includes(user.role)) return err('Forbidden', 403);

  let data;
  try { data = await request.json(); } catch { return err('Invalid JSON'); }

  await env.CMS_CONTENT.put(`content:${pageKey}`, JSON.stringify(data));
  await logActivity(env, user.id, user.name, pageKey);
  return json({ ok: true });
}

async function handleGetContentPublic(request, env, pageKey) {
  const c = await env.CMS_CONTENT.get(`content:${pageKey}`);
  if (!c) return err('Content not found', 404);
  return json(JSON.parse(c), 200, { 'Cache-Control': 'public, max-age=300' });
}

async function handleGetUsers(request, env) {
  const user = await getAuthUser(request, env);
  if (!user) return err('Unauthorized', 401);
  if (user.role !== 'super_admin') return err('Forbidden', 403);
  return json(await getAllUsers(env));
}

async function handleCreateUser(request, env) {
  const user = await getAuthUser(request, env);
  if (!user) return err('Unauthorized', 401);
  if (user.role !== 'super_admin') return err('Forbidden', 403);

  let body;
  try { body = await request.json(); } catch { return err('Invalid JSON'); }

  const { name, email, password, role } = body;
  if (!name || !email || !password || !role) return err('Missing required fields');
  if (!['editor', 'super_admin'].includes(role)) return err('Invalid role');

  if (await getUserByEmail(env, email)) return err('Email already in use', 400);

  const id = generateUUID();
  const ph = await hashPassword(password);
  const newUser = { id, name, email, role, passwordHash: ph, locked: false, createdAt: new Date().toISOString() };

  await env.CMS_USERS.put(`user:${id}`, JSON.stringify(newUser));
  await env.CMS_USERS.put(`email:${email}`, id);

  const idx = await env.CMS_USERS.get('users:index');
  const ids = idx ? JSON.parse(idx) : [];
  ids.push(id);
  await env.CMS_USERS.put('users:index', JSON.stringify(ids));

  return json({ ok: true, user: { id, name, email, role } }, 201);
}

async function handleUpdateUser(request, env, userId) {
  const user = await getAuthUser(request, env);
  if (!user) return err('Unauthorized', 401);
  if (user.role !== 'super_admin') return err('Forbidden', 403);
  if (user.id === userId) return err('Cannot modify yourself', 400);

  let body;
  try { body = await request.json(); } catch { return err('Invalid JSON'); }

  const target = await getUserById(env, userId);
  if (!target) return err('User not found', 404);

  if (body.locked !== undefined) target.locked = body.locked;
  if (body.name !== undefined) target.name = body.name;
  if (body.role !== undefined && ['editor', 'super_admin'].includes(body.role)) target.role = body.role;

  await env.CMS_USERS.put(`user:${userId}`, JSON.stringify(target));
  return json({ ok: true });
}

async function handleDeleteUser(request, env, userId) {
  const user = await getAuthUser(request, env);
  if (!user) return err('Unauthorized', 401);
  if (user.role !== 'super_admin') return err('Forbidden', 403);
  if (user.id === userId) return err('Cannot delete yourself', 400);

  const target = await getUserById(env, userId);
  if (!target) return err('User not found', 404);

  await env.CMS_USERS.delete(`user:${userId}`);
  await env.CMS_USERS.delete(`email:${target.email}`);

  const idx = await env.CMS_USERS.get('users:index');
  const ids = idx ? JSON.parse(idx) : [];
  await env.CMS_USERS.put('users:index', JSON.stringify(ids.filter(i => i !== userId)));

  return json({ ok: true });
}

async function handleGetActivity(request, env) {
  const user = await getAuthUser(request, env);
  if (!user) return err('Unauthorized', 401);
  const j = await env.CMS_USERS.get('activity:log');
  return json(j ? JSON.parse(j) : []);
}

// ── Main router ──────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Only handle /api/* routes — everything else goes to static assets
    if (!path.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    try {
      // ── Non-CMS routes (no KV needed) ──

      // Company search (proxy to Companies House API)
      if (path === '/api/company-search' && request.method === 'GET') {
        const query = url.searchParams.get('q');
        if (!query || query.trim().length === 0) return err('Missing query parameter "q"');

        const apiKey = env.CH_API_KEY;
        if (!apiKey) return json({ error: 'API key not configured' }, 500);

        const chUrl = `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(query.trim())}&items_per_page=10`;
        const chRes = await fetch(chUrl, {
          headers: { 'Authorization': 'Basic ' + btoa(apiKey + ':') },
        });

        if (!chRes.ok) return json({ error: 'Companies House API error', status: chRes.status }, chRes.status);

        const chData = await chRes.json();
        const items = (chData.items || []).map(item => ({
          title: item.title,
          company_number: item.company_number,
          company_status: item.company_status,
          date_of_creation: item.date_of_creation,
          address_snippet: item.address_snippet,
        }));

        return json({ items, total_results: chData.total_results || 0 });
      }

      // Stripe checkout
      if (path === '/api/stripe/checkout' && request.method === 'POST') {
        const STRIPE_KEY = env.STRIPE_SECRET_KEY;
        if (!STRIPE_KEY) return json({ error: 'Stripe not configured' }, 500);

        let body;
        try { body = await request.json(); } catch { return err('Invalid JSON'); }

        const { items, success_url, cancel_url } = body;
        if (!items || !success_url) return err('Missing required fields');

        const line_items = items.map(i => ({
          price_data: {
            currency: i.currency || 'gbp',
            product_data: { name: i.name },
            unit_amount: i.amount,
          },
          quantity: i.quantity || 1,
        }));

        const params = new URLSearchParams();
        params.append('mode', 'payment');
        params.append('success_url', success_url);
        params.append('cancel_url', cancel_url || success_url);
        line_items.forEach((li, idx) => {
          params.append(`line_items[${idx}][price_data][currency]`, li.price_data.currency);
          params.append(`line_items[${idx}][price_data][product_data][name]`, li.price_data.product_data.name);
          params.append(`line_items[${idx}][price_data][unit_amount]`, li.price_data.unit_amount);
          params.append(`line_items[${idx}][quantity]`, li.quantity);
        });

        const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: {
            'Authorization': 'Basic ' + btoa(STRIPE_KEY + ':'),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });

        const session = await stripeRes.json();
        if (!stripeRes.ok) return json({ error: session.error?.message || 'Stripe error' }, stripeRes.status);
        return json({ url: session.url, id: session.id });
      }

      // Stripe session lookup
      if (path === '/api/stripe/session' && request.method === 'GET') {
        const STRIPE_KEY = env.STRIPE_SECRET_KEY;
        if (!STRIPE_KEY) return json({ error: 'Stripe not configured' }, 500);

        const sessionId = url.searchParams.get('session_id');
        if (!sessionId) return err('Missing session_id');

        const stripeRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
          headers: { 'Authorization': 'Basic ' + btoa(STRIPE_KEY + ':') },
        });

        const session = await stripeRes.json();
        if (!stripeRes.ok) return json({ error: 'Session not found' }, 404);
        return json({ payment_status: session.payment_status, customer_email: session.customer_details?.email });
      }

      // ── CMS routes (KV required) ──

      // Check KV bindings exist
      if (!env.CMS_USERS || !env.CMS_CONTENT) {
        return json({
          error: 'CMS not configured. Add KV namespace bindings (CMS_CONTENT and CMS_USERS) in Cloudflare Pages → Settings → Functions → KV namespace bindings.'
        }, 503);
      }

      // Auth
      if (path === '/api/auth/login' && request.method === 'POST')
        return await handleLogin(request, env);

      // Activity
      if (path === '/api/activity' && request.method === 'GET')
        return await handleGetActivity(request, env);

      // Users collection
      if (path === '/api/users') {
        if (request.method === 'GET') return await handleGetUsers(request, env);
        if (request.method === 'POST') return await handleCreateUser(request, env);
        return err('Method not allowed', 405);
      }

      // Single user
      const userMatch = path.match(/^\/api\/users\/([a-f0-9-]+)$/);
      if (userMatch) {
        if (request.method === 'PUT') return await handleUpdateUser(request, env, userMatch[1]);
        if (request.method === 'DELETE') return await handleDeleteUser(request, env, userMatch[1]);
        return err('Method not allowed', 405);
      }

      // Public content (no auth)
      const pubMatch = path.match(/^\/api\/content-public\/([a-zA-Z0-9_-]+)$/);
      if (pubMatch)
        return await handleGetContentPublic(request, env, pubMatch[1]);

      // Admin content (auth required)
      const cMatch = path.match(/^\/api\/content\/([a-zA-Z0-9_-]+)$/);
      if (cMatch) {
        if (request.method === 'GET') return await handleGetContent(request, env, cMatch[1]);
        if (request.method === 'POST') return await handleUpdateContent(request, env, cMatch[1]);
        return err('Method not allowed', 405);
      }

      return err('Route not found', 404);
    } catch (e) {
      console.error('Worker error:', e);
      return json({ error: 'Internal server error', detail: e.message }, 500);
    }
  },
};
