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

async function legacyHash(password, salt = 'axsuma-cms-salt') {
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

// PBKDF2 with a random per-user salt. Stored as "pbkdf2$<iterations>$<salt b64>$<hash b64>".
const PBKDF2_ITER = 100000;
function b64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))); }
async function pbkdf2(password, saltBytes, iter) {
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations: iter, hash: 'SHA-256' }, km, 256);
}
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITER}$${b64(salt)}$${b64(await pbkdf2(password, salt, PBKDF2_ITER))}`;
}
async function verifyPassword(password, stored) {
  if (!stored) return false;
  if (stored.startsWith('pbkdf2$')) {
    const [, iter, saltB64, hashB64] = stored.split('$');
    const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
    return b64(await pbkdf2(password, salt, parseInt(iter, 10))) === hashB64;
  }
  return (await legacyHash(password)) === stored; // old format, upgraded on next login
}

// ── JWT ──────────────────────────────────────────────────────────

// Signing secret for logins. Uses the JWT_SECRET variable if set in Cloudflare; otherwise a random
// secret is generated once and kept in the private CMS_USERS KV store. Never written in the repository.
let SECRET_CACHE = null;
async function loadSecret(env) {
  if (env.JWT_SECRET && env.JWT_SECRET.length >= 32) { SECRET_CACHE = env.JWT_SECRET; return; }
  if (SECRET_CACHE) return;
  if (!env.CMS_USERS) return;
  let s = await env.CMS_USERS.get('config:jwt_secret');
  if (!s) {
    s = b64(crypto.getRandomValues(new Uint8Array(48)));
    await env.CMS_USERS.put('config:jwt_secret', s);
  }
  SECRET_CACHE = s;
}
function getSecret(env) {
  if (!SECRET_CACHE) throw new Error('Signing secret not available');
  return SECRET_CACHE;
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

// ── Roles ────────────────────────────────────────────────────────

// client = self-registered portal user; editor = CMS editor; super_admin = full admin (users, content).
const ROLES = ['client', 'editor', 'super_admin'];
// Axsuma partners: existing staff accounts with these emails are upgraded to super_admin on login.
const OWNER_EMAILS = ['giacomo.previtali@sdcprevitali.com', 'jason.reader@axsuma.co.uk', 'charlotte.phippshornby@axsuma.co.uk'];

// ── Data access ──────────────────────────────────────────────────

async function initializeIfNeeded(env) {
  // Users are no longer seeded from code (passwords must never live in the repository).
}

async function getUserByEmail(env, email) {
  const e = String(email || '').trim();
  const id = (await env.CMS_USERS.get(`email:${e.toLowerCase()}`)) || (await env.CMS_USERS.get(`email:${e}`));
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

function getToken(request) {
  const ah = request.headers.get('Authorization');
  if (ah && ah.startsWith('Bearer ')) return ah.slice(7);
  const m = (request.headers.get('Cookie') || '').match(/portal_token=([^;]+)/);
  return m ? m[1] : null;
}

async function getAuthUser(request, env) {
  const t = getToken(request);
  if (!t) return null;
  const payload = await verifyJWT(t, getSecret(env));
  if (!payload) return null;
  const u = await getUserById(env, payload.sub);
  if (!u || u.locked) return null;
  return u;
}

function safeNext(next) {
  return (typeof next === 'string' && /^\/(?!\/)[\w\-./?=&%]*$/.test(next)) ? next : '/portal/';
}

function sessionResponse(user, token, next) {
  return new Response(JSON.stringify({
    token,
    redirect: safeNext(next),
    user: { id: user.id, name: user.name, email: user.email, role: user.role }
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...CORS,
      'Set-Cookie': `portal_token=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`,
    },
  });
}

// ── Route handlers ───────────────────────────────────────────────

async function handleLogin(request, env) {
  let body;
  try { body = await request.json(); } catch { return err('Invalid JSON'); }

  const { email, password, next } = body;
  if (!email || !password) return err('Email and password required');

  const user = await getUserByEmail(env, email);
  if (!user) return err('Invalid email or password', 401);
  if (user.locked) return err('This account has been suspended. Please contact Axsuma.', 403);
  if (!(await verifyPassword(password, user.passwordHash))) return err('Invalid email or password', 401);

  let changed = false;
  if (!String(user.passwordHash).startsWith('pbkdf2$')) { user.passwordHash = await hashPassword(password); changed = true; }
  if (OWNER_EMAILS.includes(String(user.email).toLowerCase()) && user.role === 'editor') { user.role = 'super_admin'; changed = true; }
  user.lastLoginAt = new Date().toISOString(); changed = true;
  if (changed) await env.CMS_USERS.put(`user:${user.id}`, JSON.stringify(user));

  const token = await createJWT({ sub: user.id, role: user.role }, getSecret(env));
  return sessionResponse(user, token, next);
}

async function handleRegister(request, env) {
  let body;
  try { body = await request.json(); } catch { return err('Invalid JSON'); }

  const firstName = String(body.firstName || '').trim().slice(0, 60);
  const lastName = String(body.lastName || '').trim().slice(0, 60);
  const name = (firstName || lastName) ? `${firstName} ${lastName}`.trim() : String(body.name || '').trim().slice(0, 120);
  const company = String(body.company || '').trim().slice(0, 160);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!firstName || !lastName || !company || !email || !password) return err('First name, last name, company, email and password are required.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return err('Please enter a valid email address.');
  if (password.length < 8) return err('Password must be at least 8 characters.');
  if (await getUserByEmail(env, email)) return err('An account with this email already exists. Please sign in.', 409);

  const id = generateUUID();
  const user = {
    id, firstName, lastName, name, company, email, role: 'client', locked: false,
    passwordHash: await hashPassword(password),
    createdAt: new Date().toISOString(), source: 'self-registration',
  };
  await env.CMS_USERS.put(`user:${id}`, JSON.stringify(user));
  await env.CMS_USERS.put(`email:${email}`, id);
  const idx = await env.CMS_USERS.get('users:index');
  const ids = idx ? JSON.parse(idx) : [];
  ids.push(id);
  await env.CMS_USERS.put('users:index', JSON.stringify(ids));

  const token = await createJWT({ sub: id, role: 'client' }, getSecret(env));
  return sessionResponse(user, token, body.next);
}

async function handleMe(request, env) {
  const user = await getAuthUser(request, env);
  if (!user) return err('Unauthorized', 401);
  const { passwordHash, ...safe } = user;
  return json(safe);
}

async function handleChangePassword(request, env) {
  const user = await getAuthUser(request, env);
  if (!user) return err('Unauthorized', 401);
  let body;
  try { body = await request.json(); } catch { return err('Invalid JSON'); }
  const { currentPassword, newPassword } = body;
  if (!(await verifyPassword(currentPassword || '', user.passwordHash))) return err('Current password is incorrect.', 401);
  if (!newPassword || newPassword.length < 8) return err('New password must be at least 8 characters.');
  user.passwordHash = await hashPassword(newPassword);
  user.passwordChangedAt = new Date().toISOString();
  await env.CMS_USERS.put(`user:${user.id}`, JSON.stringify(user));
  return json({ ok: true });
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

  const firstName = String(body.firstName || '').trim();
  const lastName = String(body.lastName || '').trim();
  const name = (firstName || lastName) ? `${firstName} ${lastName}`.trim() : String(body.name || '').trim();
  const { email, password, role } = body;
  if (!name || !email || !password || !role) return err('Missing required fields');
  if (!ROLES.includes(role)) return err('Invalid role');
  if (password.length < 8) return err('Password must be at least 8 characters.');

  if (await getUserByEmail(env, email)) return err('Email already in use', 400);

  const id = generateUUID();
  const ph = await hashPassword(password);
  const em = String(email).trim().toLowerCase();
  const newUser = { id, firstName, lastName, name, email: em, company: String(body.company || '').trim(), role, passwordHash: ph, locked: false, createdAt: new Date().toISOString(), source: `created by ${user.name}` };

  await env.CMS_USERS.put(`user:${id}`, JSON.stringify(newUser));
  await env.CMS_USERS.put(`email:${em}`, id);

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
  if (body.firstName !== undefined || body.lastName !== undefined) {
    target.firstName = String(body.firstName ?? target.firstName ?? '').trim();
    target.lastName = String(body.lastName ?? target.lastName ?? '').trim();
    target.name = `${target.firstName} ${target.lastName}`.trim();
  }
  if (body.company !== undefined) target.company = String(body.company).trim();
  if (body.role !== undefined && ROLES.includes(body.role)) target.role = body.role;

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
  await env.CMS_USERS.delete(`email:${String(target.email).toLowerCase()}`);

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
    try { await loadSecret(env); } catch (e) { /* KV not reachable: auth stays disabled */ }

    // Only handle /api/* routes — everything else goes to static assets
    if (!path.startsWith('/api/')) {
      // ── Portal authentication gate ──
      if (path.startsWith('/portal') ) {
        // Allow login page, register page, and static assets without auth
        const portalPublic = ['/portal/login.html', '/portal/login', '/portal/register.html', '/portal/register'];
        const isAsset = path.endsWith('.css') || path.endsWith('.js') || path.endsWith('.svg') || path.endsWith('.png') || path.endsWith('.jpg') || path.endsWith('.ico');
        if (!portalPublic.includes(path) && !isAsset) {
          // Check for auth cookie
          let authenticated = false;
          try { authenticated = !!(env.CMS_USERS && await getAuthUser(request, env)); } catch (e) { authenticated = false; }
          if (!authenticated) {
            const login = new URL('/portal/login.html', url.origin);
            login.searchParams.set('next', path + url.search);
            return Response.redirect(login.toString(), 302);
          }
        }
      }
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

      // Portal form submission (stores data, returns submission ID)
      if (path === '/api/portal/submit' && request.method === 'POST') {
        let body;
        try { body = await request.json(); } catch { return err('Invalid JSON'); }

        const submissionId = generateUUID();
        body._id = submissionId;

        // Store in CMS_CONTENT KV if available
        if (env.CMS_CONTENT) {
          try {
            await env.CMS_CONTENT.put(`submission:${submissionId}`, JSON.stringify(body));
            // Maintain submissions index
            const idx = await env.CMS_CONTENT.get('submissions:index');
            const ids = idx ? JSON.parse(idx) : [];
            ids.unshift({ id: submissionId, formType: body._formType || 'unknown', submittedAt: body._submittedAt || new Date().toISOString() });
            await env.CMS_CONTENT.put('submissions:index', JSON.stringify(ids.slice(0, 500)));
          } catch (e) {
            console.error('KV storage error:', e);
            // Continue anyway — ID is still valid for Stripe flow
          }
        }

        return json({ id: submissionId });
      }

      // Stripe checkout
      if (path === '/api/stripe/checkout' && request.method === 'POST') {
        const STRIPE_KEY = env.STRIPE_SECRET_KEY;
        if (!STRIPE_KEY) return json({ error: 'Stripe not configured' }, 500);

        let body;
        try { body = await request.json(); } catch { return err('Invalid JSON'); }

        const { items, success_url, cancel_url, metadata } = body;
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
        // Pass customer email if provided
        if (metadata && metadata.customerEmail) {
          params.append('customer_email', metadata.customerEmail);
        }
        // Pass metadata (submissionId etc.) to Stripe
        if (metadata) {
          Object.entries(metadata).forEach(([k, v]) => {
            if (v) params.append(`metadata[${k}]`, v);
          });
        }
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

      if (path === '/api/auth/register' && request.method === 'POST')
        return await handleRegister(request, env);

      if (path === '/api/auth/me' && request.method === 'GET')
        return await handleMe(request, env);

      if (path === '/api/auth/password' && request.method === 'POST')
        return await handleChangePassword(request, env);

      if (path === '/api/auth/logout' && request.method === 'POST') {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...CORS,
            'Set-Cookie': 'portal_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
          },
        });
      }

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
