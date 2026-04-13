# Axsuma CMS — Deployment Guide

## Prerequisites

- A Cloudflare account (the same one hosting axsuma.com)
- Node.js 18+ installed locally
- Wrangler CLI installed: `npm install -g wrangler`
- Logged in to Wrangler: `wrangler login`

---

## Step 1 — Create KV Namespaces

Run these two commands from the `server/` directory:

```bash
wrangler kv namespace create CMS_CONTENT
wrangler kv namespace create CMS_USERS
```

Each command will print a namespace ID. Copy them into `wrangler.toml`, replacing the placeholder values:

```toml
[[kv_namespaces]]
binding = "CMS_CONTENT"
id = "paste-the-id-here"

[[kv_namespaces]]
binding = "CMS_USERS"
id = "paste-the-id-here"
```

---

## Step 2 — Set Secrets

These are stored securely in Cloudflare and never appear in code:

```bash
wrangler secret put JWT_SECRET
# Enter a long random string (e.g. 64 hex characters)

wrangler secret put SUPER_ADMIN_EMAIL
# Enter: giacomo.previtali@sdcprevitali.com

wrangler secret put SUPER_ADMIN_PASSWORD
# Enter the password you want for the super-admin account
```

---

## Step 3 — Seed Initial Content

Before the first deploy, upload the current `content.json` into the CMS_CONTENT KV namespace so every page has content from day one.

```bash
# From the project root (one level above server/)
wrangler kv key put --namespace-id="PASTE_CMS_CONTENT_ID" "page:company-formations" "$(cat content.json | python3 -c 'import sys,json; d=json.load(sys.stdin); print(json.dumps({"content":d["company-formations"],"updatedAt":"2026-04-13T00:00:00Z","updatedBy":"system"}))')"

wrangler kv key put --namespace-id="PASTE_CMS_CONTENT_ID" "page:governance" "$(cat content.json | python3 -c 'import sys,json; d=json.load(sys.stdin); print(json.dumps({"content":d["governance"],"updatedAt":"2026-04-13T00:00:00Z","updatedBy":"system"}))')"

wrangler kv key put --namespace-id="PASTE_CMS_CONTENT_ID" "page:ma-transactions" "$(cat content.json | python3 -c 'import sys,json; d=json.load(sys.stdin); print(json.dumps({"content":d["ma-transactions"],"updatedAt":"2026-04-13T00:00:00Z","updatedBy":"system"}))')"

wrangler kv key put --namespace-id="PASTE_CMS_CONTENT_ID" "page:accounting" "$(cat content.json | python3 -c 'import sys,json; d=json.load(sys.stdin); print(json.dumps({"content":d["accounting"],"updatedAt":"2026-04-13T00:00:00Z","updatedBy":"system"}))')"

wrangler kv key put --namespace-id="PASTE_CMS_CONTENT_ID" "page:id-verification" "$(cat content.json | python3 -c 'import sys,json; d=json.load(sys.stdin); print(json.dumps({"content":d["id-verification"],"updatedAt":"2026-04-13T00:00:00Z","updatedBy":"system"}))')"

wrangler kv key put --namespace-id="PASTE_CMS_CONTENT_ID" "page:overseas-entities" "$(cat content.json | python3 -c 'import sys,json; d=json.load(sys.stdin); print(json.dumps({"content":d["overseas-entities"],"updatedAt":"2026-04-13T00:00:00Z","updatedBy":"system"}))')"

wrangler kv key put --namespace-id="PASTE_CMS_CONTENT_ID" "page:process-agent" "$(cat content.json | python3 -c 'import sys,json; d=json.load(sys.stdin); print(json.dumps({"content":d["process-agent"],"updatedAt":"2026-04-13T00:00:00Z","updatedBy":"system"}))')"

wrangler kv key put --namespace-id="PASTE_CMS_CONTENT_ID" "page:home" "$(cat content.json | python3 -c 'import sys,json; d=json.load(sys.stdin); print(json.dumps({"content":d["home"],"updatedAt":"2026-04-13T00:00:00Z","updatedBy":"system"}))')"
```

---

## Step 4 — Deploy the Worker

```bash
cd server
wrangler deploy
```

Wrangler will output the Worker URL, something like:
`https://axsuma-cms.YOUR-SUBDOMAIN.workers.dev`

---

## Step 5 — Custom Domain (Recommended)

To serve the API at `cms.axsuma.com`:

1. Go to Cloudflare Dashboard → Workers & Pages → axsuma-cms → Settings → Triggers
2. Click "Add Custom Domain"
3. Enter `cms.axsuma.com`
4. Cloudflare auto-provisions the DNS record and TLS certificate

Alternatively, uncomment the `routes` section in `wrangler.toml` and redeploy.

---

## Step 6 — Update the Site

Two small changes to connect the live site to the CMS:

### 6a. Set the API URL in content-loader.js

Open `content-loader.js` and set `API_BASE`:

```javascript
var API_BASE = 'https://cms.axsuma.com';  // or your Worker URL
```

### 6b. Set the API URL in admin.html

Open `admin.html` and update the `API_URL` variable near the top of the script:

```javascript
const API_URL = 'https://cms.axsuma.com';
```

### 6c. Deploy the updated site to Cloudflare Pages

Push the changes to your Git repository (or upload via Cloudflare Pages dashboard). The site will now fetch content from the CMS on every page load.

---

## Step 7 — First Login & User Setup

1. Open `https://axsuma.com/admin.html` (or wherever you host the admin panel)
2. Log in with the super-admin email and password you set in Step 2
3. Go to **User Management** (sidebar)
4. Click **Add User** and create accounts for Jason and Charlotte with the **editor** role
5. Share their credentials — they can now edit page content but cannot change site structure

---

## How It Works

```
┌──────────────┐     fetch /api/content-public/:page     ┌──────────────────┐
│  Site Pages   │ ─────────────────────────────────────▶  │  Cloudflare      │
│  (HTML +      │                                         │  Worker          │
│  content-     │ ◀───────────── JSON content ──────────  │  (cms-worker.js) │
│  loader.js)   │                                         │                  │
└──────────────┘                                          │  ┌────────────┐  │
                                                          │  │ KV Store   │  │
┌──────────────┐     fetch /api/content/:page (auth)      │  │ CMS_CONTENT│  │
│  Admin Panel  │ ─────────────────────────────────────▶  │  │ CMS_USERS  │  │
│  (admin.html) │ ◀───────────── JSON + JWT ────────────  │  └────────────┘  │
└──────────────┘                                          └──────────────────┘
```

- **Public readers** (site visitors): `content-loader.js` calls `/api/content-public/:page` (no auth) and injects text into `[data-content]` elements. If the API is down, the static HTML fallback is shown.
- **Editors** (Jason, Charlotte): Log into `admin.html`, edit text fields, save. Changes are written to KV and appear on the live site immediately.
- **Super Admin** (Giacomo): Full access — can also manage users, lock accounts, and view the activity log.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Failed to fetch" in admin panel | Check that `API_URL` in admin.html matches your Worker URL |
| Content not updating on site | Check that `API_BASE` in content-loader.js is set correctly |
| Login fails on first attempt | The Worker auto-creates the super-admin on first `/api/auth/login` call — try again |
| CORS errors in browser console | The Worker includes CORS headers; make sure you're not proxying through another service |
| KV writes are slow to appear | Cloudflare KV is eventually consistent — changes may take up to 60 seconds to propagate globally |
