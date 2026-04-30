// Cloudflare Pages Function — Retrieve Stripe Checkout Session status
// Environment variables needed: STRIPE_SECRET_KEY, PORTAL_KV

export async function onRequestGet(context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  try {
    const url = new URL(context.request.url);
    const sessionId = url.searchParams.get('session_id');

    if (!sessionId) {
      return new Response(JSON.stringify({ error: 'Missing session_id' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const stripeKey = context.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return new Response(JSON.stringify({ error: 'Stripe not configured' }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    // Retrieve the Checkout Session from Stripe
    const stripeRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
      },
    });

    const session = await stripeRes.json();

    if (!stripeRes.ok) {
      return new Response(JSON.stringify({ error: 'Failed to retrieve session' }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    // If payment is complete, update submission status in KV
    const kv = context.env.PORTAL_KV;
    if (kv && session.payment_status === 'paid' && session.metadata?.submission_id) {
      try {
        const subId = session.metadata.submission_id;
        const raw = await kv.get(`submission:${subId}`);
        if (raw) {
          const submission = JSON.parse(raw);
          if (submission.status !== 'paid') {
            submission.status = 'paid';
            submission.paidAt = new Date().toISOString();
            submission.stripeSessionId = sessionId;
            await kv.put(`submission:${subId}`, JSON.stringify(submission), {
              metadata: { formType: submission.formType, status: 'paid', submittedAt: submission.submittedAt },
            });
          }
        }
      } catch (e) {
        console.error('KV update error:', e.message);
      }
    }

    return new Response(JSON.stringify({
      status: session.payment_status,
      customerEmail: session.customer_email || session.customer_details?.email || '',
      amountTotal: session.amount_total,
      currency: session.currency,
      submissionId: session.metadata?.submission_id || '',
      individualCount: session.metadata?.individual_count || '',
    }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to retrieve session', detail: err.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
