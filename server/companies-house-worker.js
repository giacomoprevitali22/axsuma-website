/**
 * Cloudflare Worker — Companies House API Proxy
 *
 * SETUP:
 * 1. Create a free account at https://dash.cloudflare.com
 * 2. Go to Workers & Pages → Create Worker
 * 3. Paste this code
 * 4. Add your API key as a secret:
 *    - Go to Settings → Variables → Environment Variables
 *    - Add: CH_API_KEY = your_companies_house_api_key
 *    - (Get your key at https://developer.company-information.service.gov.uk/)
 * 5. Deploy and note the worker URL (e.g. https://ch-proxy.your-subdomain.workers.dev)
 * 6. Update WORKER_URL in company-formations.html
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const query = url.searchParams.get('q');

    if (!query) {
      return new Response(JSON.stringify({ error: 'Missing ?q= parameter' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    try {
      const chResponse = await fetch(
        `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(query)}&items_per_page=6`,
        {
          headers: {
            'Authorization': 'Basic ' + btoa(env.CH_API_KEY + ':'),
          },
        }
      );

      const data = await chResponse.json();

      return new Response(JSON.stringify(data), {
        status: chResponse.status,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300',
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Upstream error' }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
  },
};
