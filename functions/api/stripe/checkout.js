// Cloudflare Pages Function — Create Stripe Checkout Session for IDV payments
// Environment variables needed: STRIPE_SECRET_KEY, PORTAL_KV (KV namespace binding)

export async function onRequestPost(context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  try {
    const body = await context.request.json();
    const { submissionId, individualCount, customerEmail } = body;

    if (!submissionId || !individualCount || individualCount < 1) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
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

    // Build the origin URL for success/cancel redirects
    const url = new URL(context.request.url);
    const origin = url.origin;

    // Create Stripe Checkout Session using the Stripe API directly
    const params = new URLSearchParams();
    params.append('mode', 'payment');
    params.append('payment_method_types[0]', 'card');
    params.append('line_items[0][price_data][currency]', 'gbp');
    params.append('line_items[0][price_data][product_data][name]', 'Identity Verification (IDV)');
    params.append('line_items[0][price_data][product_data][description]', 'Companies House authorised identity verification — per individual');
    // £150.00 inc VAT per individual (= 15000 pence)
    params.append('line_items[0][price_data][unit_amount]', '15000');
    params.append('line_items[0][quantity]', String(individualCount));
    params.append('success_url', `${origin}/payment-success.html?session_id={CHECKOUT_SESSION_ID}`);
    params.append('cancel_url', `${origin}/id-verification.html?cancelled=1`);
    params.append('metadata[submission_id]', submissionId);
    params.append('metadata[individual_count]', String(individualCount));

    if (customerEmail) {
      params.append('customer_email', customerEmail);
    }

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const session = await stripeRes.json();

    if (!stripeRes.ok) {
      console.error('Stripe error:', JSON.stringify(session));
      return new Response(JSON.stringify({ error: 'Failed to create checkout session', detail: session.error?.message }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    // Update submission in KV with Stripe session ID
    const kv = context.env.PORTAL_KV;
    if (kv && submissionId) {
      try {
        const raw = await kv.get(`submission:${submissionId}`);
        if (raw) {
          const submission = JSON.parse(raw);
          submission.stripeSessionId = session.id;
          submission.status = 'pending_payment';
          await kv.put(`submission:${submissionId}`, JSON.stringify(submission), {
            metadata: { formType: submission.formType, status: 'pending_payment', submittedAt: submission.submittedAt },
          });
        }
      } catch (e) {
        // Non-critical — continue even if KV update fails
        console.error('KV update error:', e.message);
      }
    }

    return new Response(JSON.stringify({ url: session.url, sessionId: session.id }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to create checkout session', detail: err.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
