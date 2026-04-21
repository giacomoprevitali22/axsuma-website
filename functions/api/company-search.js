// Cloudflare Pages Function — proxy for Companies House search API
// Keeps API key server-side (set CH_API_KEY in Cloudflare Pages environment variables)

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const query = url.searchParams.get('q');

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (!query || query.trim().length === 0) {
    return new Response(JSON.stringify({ error: 'Missing query parameter "q"' }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const apiKey = context.env.CH_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  try {
    const chUrl = `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(query.trim())}&items_per_page=10`;

    const response = await fetch(chUrl, {
      headers: {
        'Authorization': 'Basic ' + btoa(apiKey + ':'),
      },
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: 'Companies House API error', status: response.status }), {
        status: response.status,
        headers: corsHeaders,
      });
    }

    const data = await response.json();

    // Return only the fields we need (company name, number, status)
    const items = (data.items || []).map(item => ({
      title: item.title,
      company_number: item.company_number,
      company_status: item.company_status,
      date_of_creation: item.date_of_creation,
      address_snippet: item.address_snippet,
    }));

    return new Response(JSON.stringify({ items, total_results: data.total_results || 0 }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to reach Companies House' }), {
      status: 502,
      headers: corsHeaders,
    });
  }
}

// Handle CORS preflight
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
