/**
 * Axsuma CMS Admin Backend Worker
 * Cloudflare Worker serving as the API backend for the Axsuma CMS admin panel
 *
 * KV Bindings required:
 * - CMS_CONTENT: stores website content JSON
 * - CMS_USERS: stores user data and sessions
 *
 * Environment variables required:
 * - JWT_SECRET: secret key for JWT signing
 * - SUPER_ADMIN_EMAIL: initial super admin email
 * - SUPER_ADMIN_PASSWORD: initial super admin password
 */

// Utility: Generate UUID v4
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Utility: SHA-256 hash with salt
async function hashPassword(password, salt = 'axsuma-cms-salt') {
  const encoder = new TextEncoder();
  const data = encoder.encode(salt + password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Utility: Base64 encoding/decoding (for JWT)
function base64UrlEncode(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64UrlDecode(str) {
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
  return atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
}

// JWT: Create token
async function createJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 86400; // 24 hours

  const jwtPayload = {
    ...payload,
    exp,
    iat: now,
  };

  const headerEncoded = base64UrlEncode(JSON.stringify(header));
  const payloadEncoded = base64UrlEncode(JSON.stringify(jwtPayload));

  const encoder = new TextEncoder();
  const secretKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureArray = await crypto.subtle.sign(
    'HMAC',
    secretKey,
    encoder.encode(`${headerEncoded}.${payloadEncoded}`)
  );
  const signatureEncoded = base64UrlEncode(
    String.fromCharCode(...new Uint8Array(signatureArray))
  );

  return `${headerEncoded}.${payloadEncoded}.${signatureEncoded}`;
}

// JWT: Verify and decode token
async function verifyJWT(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerEncoded, payloadEncoded, signatureEncoded] = parts;
    const encoder = new TextEncoder();
    const secretKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const signatureArray = Uint8Array.from(
      atob(base64UrlDecode(signatureEncoded).split('').map((c) => c.charCodeAt(0)))
    );
    const message = encoder.encode(`${headerEncoded}.${payloadEncoded}`);

    const isValid = await crypto.subtle.verify('HMAC', secretKey, signatureArray, message);
    if (!isValid) return null;

    const payload = JSON.parse(base64UrlDecode(payloadEncoded));

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;

    return payload;
  } catch (e) {
    return null;
  }
}

// Utility: JSON response with CORS headers
function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      ...headers,
    },
  });
}

// Utility: Error response
function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

// Default credentials (used if env vars are not set)
const DEFAULT_USERS = [
  {
    name: 'Giacomo Previtali',
    email: 'giacomo.previtali@sdcprevitali.com',
    password: '3548Omagreb.g22;',
    role: 'super_admin',
  },
  {
    name: 'Jason Reader',
    email: 'jason.reader@axsuma.co.uk',
    password: 'Axsuma2026!!',
    role: 'editor',
  },
  {
    name: 'Charlotte Phipps-Hornby',
    email: 'charlotte.phippshornby@axsuma.co.uk',
    password: 'Axsuma2026!!',
    role: 'editor',
  },
];

const DEFAULT_JWT_SECRET = 'axsuma-cms-jwt-secret-k8f3m9x2q7w4';

// Initialize all users on first run
async function initializeIfNeeded(env) {
  const usersIndex = await env.CMS_USERS.get('users:index');
  if (usersIndex) {
    return; // Already initialized
  }

  const userIds = [];

  for (const userData of DEFAULT_USERS) {
    const userId = generateUUID();
    const passwordHash = await hashPassword(userData.password);

    const user = {
      id: userId,
      name: userData.name,
      email: userData.email,
      role: userData.role,
      passwordHash,
      locked: false,
      createdAt: new Date().toISOString(),
    };

    await env.CMS_USERS.put(`user:${userId}`, JSON.stringify(user));
    await env.CMS_USERS.put(`email:${userData.email}`, userId);
    userIds.push(userId);

    console.log(`User initialized: ${userData.email} (${userData.role})`);
  }

  await env.CMS_USERS.put('users:index', JSON.stringify(userIds));
  console.log('All users initialized successfully');
}

// Get user by email
async function getUserByEmail(env, email) {
  const userId = await env.CMS_USERS.get(`email:${email}`);
  if (!userId) return null;
  const userJson = await env.CMS_USERS.get(`user:${userId}`);
  return userJson ? JSON.parse(userJson) : null;
}

// Get user by ID
async function getUserById(env, id) {
  const userJson = await env.CMS_USERS.get(`user:${id}`);
  return userJson ? JSON.parse(userJson) : null;
}

// Get all users
async function getAllUsers(env) {
  const indexJson = await env.CMS_USERS.get('users:index');
  if (!indexJson) return [];

  const userIds = JSON.parse(indexJson);
  const users = [];

  for (const id of userIds) {
    const user = await getUserById(env, id);
    if (user) {
      const { passwordHash, ...safeUser } = user;
      users.push(safeUser);
    }
  }

  return users;
}

// Log activity
async function logActivity(env, userId, userName, pageKey) {
  let logArray = [];
  const logJson = await env.CMS_USERS.get('activity:log');
  if (logJson) {
    logArray = JSON.parse(logJson);
  }

  const entry = {
    user: userName,
    page: pageKey,
    timestamp: new Date().toISOString(),
  };

  logArray.unshift(entry);
  logArray = logArray.slice(0, 50); // Keep only last 50 entries

  await env.CMS_USERS.put('activity:log', JSON.stringify(logArray));
}

// Middleware: Extract and verify JWT
async function getAuthUser(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7);
  const payload = await verifyJWT(token, env.JWT_SECRET || DEFAULT_JWT_SECRET);
  if (!payload) return null;

  const user = await getUserById(env, payload.sub);
  return user || null;
}

// Route handlers

// POST /api/auth/login
async function handleLogin(request, env) {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON');
  }

  const { email, password } = body;
  if (!email || !password) {
    return errorResponse('Email and password required');
  }

  // Initialize on first run
  await initializeIfNeeded(env);

  const user = await getUserByEmail(env, email);
  if (!user) {
    return errorResponse('Invalid credentials', 401);
  }

  if (user.locked) {
    return errorResponse('User account is locked', 403);
  }

  const passwordHash = await hashPassword(password);
  if (passwordHash !== user.passwordHash) {
    return errorResponse('Invalid credentials', 401);
  }

  // Create JWT
  const token = await createJWT({ sub: user.id, role: user.role }, env.JWT_SECRET || DEFAULT_JWT_SECRET);

  const responseUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  return jsonResponse({ token, user: responseUser });
}

// GET /api/content/:pageKey
async function handleGetContent(request, env, pageKey) {
  const user = await getAuthUser(request, env);
  if (!user) {
    return errorResponse('Unauthorized', 401);
  }

  const content = await env.CMS_CONTENT.get(`content:${pageKey}`);
  if (!content) {
    // Try defaults
    const defaults = await env.CMS_CONTENT.get('content:defaults');
    if (!defaults) {
      return errorResponse('Content not found', 404);
    }
    return jsonResponse(JSON.parse(defaults));
  }

  return jsonResponse(JSON.parse(content));
}

// POST /api/content/:pageKey
async function handleUpdateContent(request, env, pageKey) {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  const user = await getAuthUser(request, env);
  if (!user) {
    return errorResponse('Unauthorized', 401);
  }

  if (!['editor', 'super_admin'].includes(user.role)) {
    return errorResponse('Forbidden', 403);
  }

  let contentData;
  try {
    contentData = await request.json();
  } catch {
    return errorResponse('Invalid JSON');
  }

  // Save content
  await env.CMS_CONTENT.put(`content:${pageKey}`, JSON.stringify(contentData));

  // Log activity
  await logActivity(env, user.id, user.name, pageKey);

  return jsonResponse({ ok: true });
}

// GET /api/content-public/:pageKey
async function handleGetContentPublic(request, env, pageKey) {
  const content = await env.CMS_CONTENT.get(`content:${pageKey}`);
  if (!content) {
    return errorResponse('Content not found', 404);
  }

  return jsonResponse(JSON.parse(content), 200, {
    'Cache-Control': 'public, max-age=300',
  });
}

// GET /api/users
async function handleGetUsers(request, env) {
  const user = await getAuthUser(request, env);
  if (!user) {
    return errorResponse('Unauthorized', 401);
  }

  if (user.role !== 'super_admin') {
    return errorResponse('Forbidden', 403);
  }

  const users = await getAllUsers(env);
  return jsonResponse(users);
}

// POST /api/users
async function handleCreateUser(request, env) {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  const user = await getAuthUser(request, env);
  if (!user) {
    return errorResponse('Unauthorized', 401);
  }

  if (user.role !== 'super_admin') {
    return errorResponse('Forbidden', 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON');
  }

  const { name, email, password, role } = body;
  if (!name || !email || !password || !role) {
    return errorResponse('Missing required fields: name, email, password, role');
  }

  if (!['editor', 'super_admin'].includes(role)) {
    return errorResponse('Invalid role');
  }

  // Check if email already exists
  const existingUser = await getUserByEmail(env, email);
  if (existingUser) {
    return errorResponse('Email already in use', 400);
  }

  const newUserId = generateUUID();
  const passwordHash = await hashPassword(password);

  const newUser = {
    id: newUserId,
    name,
    email,
    role,
    passwordHash,
    locked: false,
    createdAt: new Date().toISOString(),
  };

  // Store user
  await env.CMS_USERS.put(`user:${newUserId}`, JSON.stringify(newUser));
  await env.CMS_USERS.put(`email:${email}`, newUserId);

  // Add to index
  let indexJson = await env.CMS_USERS.get('users:index');
  const userIds = indexJson ? JSON.parse(indexJson) : [];
  userIds.push(newUserId);
  await env.CMS_USERS.put('users:index', JSON.stringify(userIds));

  const responseUser = {
    id: newUserId,
    name,
    email,
    role,
  };

  return jsonResponse({ ok: true, user: responseUser }, 201);
}

// PUT /api/users/:id
async function handleUpdateUser(request, env, userId) {
  if (request.method !== 'PUT') {
    return errorResponse('Method not allowed', 405);
  }

  const user = await getAuthUser(request, env);
  if (!user) {
    return errorResponse('Unauthorized', 401);
  }

  if (user.role !== 'super_admin') {
    return errorResponse('Forbidden', 403);
  }

  if (user.id === userId) {
    return errorResponse('Cannot lock/unlock yourself', 400);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON');
  }

  const targetUser = await getUserById(env, userId);
  if (!targetUser) {
    return errorResponse('User not found', 404);
  }

  // Update allowed fields
  if (body.locked !== undefined) {
    targetUser.locked = body.locked;
  }
  if (body.name !== undefined) {
    targetUser.name = body.name;
  }
  if (body.role !== undefined && ['editor', 'super_admin'].includes(body.role)) {
    targetUser.role = body.role;
  }

  await env.CMS_USERS.put(`user:${userId}`, JSON.stringify(targetUser));

  return jsonResponse({ ok: true });
}

// DELETE /api/users/:id
async function handleDeleteUser(request, env, userId) {
  if (request.method !== 'DELETE') {
    return errorResponse('Method not allowed', 405);
  }

  const user = await getAuthUser(request, env);
  if (!user) {
    return errorResponse('Unauthorized', 401);
  }

  if (user.role !== 'super_admin') {
    return errorResponse('Forbidden', 403);
  }

  if (user.id === userId) {
    return errorResponse('Cannot delete yourself', 400);
  }

  const targetUser = await getUserById(env, userId);
  if (!targetUser) {
    return errorResponse('User not found', 404);
  }

  // Remove user
  await env.CMS_USERS.delete(`user:${userId}`);
  await env.CMS_USERS.delete(`email:${targetUser.email}`);

  // Remove from index
  let indexJson = await env.CMS_USERS.get('users:index');
  const userIds = indexJson ? JSON.parse(indexJson) : [];
  const updatedIds = userIds.filter((id) => id !== userId);
  await env.CMS_USERS.put('users:index', JSON.stringify(updatedIds));

  return jsonResponse({ ok: true });
}

// GET /api/activity
async function handleGetActivity(request, env) {
  const user = await getAuthUser(request, env);
  if (!user) {
    return errorResponse('Unauthorized', 401);
  }

  const logJson = await env.CMS_USERS.get('activity:log');
  const log = logJson ? JSON.parse(logJson) : [];

  return jsonResponse(log);
}

// Handle OPTIONS preflight
function handleOptions(request) {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

// Main fetch handler
export default {
  async fetch(request, env) {
    // Handle preflight
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Auth routes
      if (path === '/api/auth/login') {
        return await handleLogin(request, env);
      }

      // Activity routes
      if (path === '/api/activity') {
        return await handleGetActivity(request, env);
      }

      // User management routes
      if (path === '/api/users') {
        if (request.method === 'GET') {
          return await handleGetUsers(request, env);
        } else if (request.method === 'POST') {
          return await handleCreateUser(request, env);
        }
        return errorResponse('Method not allowed', 405);
      }

      // PUT/DELETE specific user
      const userMatch = path.match(/^\/api\/users\/([a-f0-9\-]+)$/);
      if (userMatch) {
        const userId = userMatch[1];
        if (request.method === 'PUT') {
          return await handleUpdateUser(request, env, userId);
        } else if (request.method === 'DELETE') {
          return await handleDeleteUser(request, env, userId);
        }
        return errorResponse('Method not allowed', 405);
      }

      // Public content route (no auth)
      const publicMatch = path.match(/^\/api\/content-public\/([a-zA-Z0-9_\-]+)$/);
      if (publicMatch) {
        const pageKey = publicMatch[1];
        return await handleGetContentPublic(request, env, pageKey);
      }

      // Admin content routes (auth required)
      const contentMatch = path.match(/^\/api\/content\/([a-zA-Z0-9_\-]+)$/);
      if (contentMatch) {
        const pageKey = contentMatch[1];
        if (request.method === 'GET') {
          return await handleGetContent(request, env, pageKey);
        } else if (request.method === 'POST') {
          return await handleUpdateContent(request, env, pageKey);
        }
        return errorResponse('Method not allowed', 405);
      }

      // 404 for unknown routes
      return errorResponse('Route not found', 404);
    } catch (e) {
      console.error('Worker error:', e);
      return errorResponse('Internal server error', 500);
    }
  },
};
