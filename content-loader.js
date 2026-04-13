/**
 * Axsuma CMS Content Loader
 * ──────────────────────────
 * Include this script on every page that should pull live content
 * from the CMS. It reads [data-content] attributes and replaces
 * the element's text with the value stored in the CMS (Cloudflare KV).
 *
 * Usage:
 *   <h1 data-content="header.title">Fallback title</h1>
 *   <p  data-content="overview.paragraphs.0">Fallback paragraph</p>
 *   <script src="content-loader.js" data-page="governance"></script>
 *
 * The `data-page` attribute on the <script> tag tells the loader
 * which page key to fetch (must match a key in content.json / KV).
 *
 * If the API is unreachable the page keeps its static HTML — so the
 * site always works even without the CMS backend.
 */
(function () {
  'use strict';

  // ── Configuration ──────────────────────────────────────────────
  // Change API_BASE to your Cloudflare Worker URL once deployed.
  // During local development you can point it at localhost:8787.
  var API_BASE = '';  // e.g. 'https://cms.axsuma.com'

  // ── Detect page key from the script tag ────────────────────────
  var scripts  = document.querySelectorAll('script[data-page]');
  var scriptEl = scripts[scripts.length - 1];          // last one wins
  var pageKey  = scriptEl && scriptEl.getAttribute('data-page');

  if (!pageKey) {
    console.warn('[CMS] No data-page attribute found on content-loader script tag.');
    return;
  }

  // ── Resolve a dotted path inside an object ─────────────────────
  function resolve(obj, path) {
    return path.split('.').reduce(function (cur, key) {
      return cur && cur[key] !== undefined ? cur[key] : undefined;
    }, obj);
  }

  // ── Inject content into the DOM ────────────────────────────────
  function applyContent(data) {
    var els = document.querySelectorAll('[data-content]');
    els.forEach(function (el) {
      var path  = el.getAttribute('data-content');
      var value = resolve(data, path);

      if (value === undefined) return;           // path not in CMS → keep static

      if (Array.isArray(value)) {
        // Array of strings → join as HTML paragraphs or list items
        el.innerHTML = value.map(function (v) { return '<p>' + v + '</p>'; }).join('');
      } else {
        el.textContent = String(value);
      }
    });
  }

  // ── Fetch content from CMS API ─────────────────────────────────
  var url = API_BASE + '/api/content-public/' + encodeURIComponent(pageKey);

  fetch(url)
    .then(function (res) {
      if (!res.ok) throw new Error('CMS returned ' + res.status);
      return res.json();
    })
    .then(function (json) {
      // The worker returns { pageKey, content, updatedAt }
      var content = json.content || json;
      applyContent(content);
    })
    .catch(function (err) {
      // Silent fail — the static HTML stays in place
      console.info('[CMS] Content not loaded (using static fallback):', err.message);
    });
})();
