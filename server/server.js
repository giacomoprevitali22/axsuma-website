require('dotenv').config();
const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const PORT = process.env.PORT || 3001;

// CORS - allow frontend origin
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));

// Webhook endpoint needs raw body (before JSON parser)
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      console.log('Payment successful!', {
        id: session.id,
        email: session.customer_email,
        amount: session.amount_total,
        metadata: session.metadata
      });

      // TODO: Send confirmation email to client
      // TODO: Create verification task in your system
      // TODO: Notify the Axsuma team

      break;
    }
    case 'payment_intent.payment_failed': {
      const intent = event.data.object;
      console.log('Payment failed:', intent.id);
      break;
    }
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
});

// JSON parser for all other routes
app.use(express.json());

// Create Stripe Checkout Session
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const { package: pkg, numPersons, clientName, clientEmail, companyName, phone, persons, notes } = req.body;

    // Validate
    if (!pkg || !clientName || !clientEmail || !persons) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Select price ID
    const priceId = pkg === 'corporate'
      ? process.env.STRIPE_PRICE_CORPORATE
      : process.env.STRIPE_PRICE_INDIVIDUAL;

    if (!priceId) {
      return res.status(500).json({ error: 'Price not configured' });
    }

    // Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: clientEmail,
      line_items: [{
        price: priceId,
        quantity: 1,
      }],
      metadata: {
        package: pkg,
        num_persons: numPersons,
        client_name: clientName,
        company_name: companyName || '',
        phone: phone || '',
        persons_to_verify: persons.substring(0, 500), // Stripe metadata limit
        notes: (notes || '').substring(0, 500),
      },
      success_url: `${process.env.FRONTEND_URL}/payment-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/id-verification.html?cancelled=true`,
      // Automatically calculate tax (UK VAT)
      automatic_tax: { enabled: false }, // Enable when you have Stripe Tax configured
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Error creating checkout session:', err);
    res.status(500).json({ error: err.message });
  }
});

// Verify payment status (for success page)
app.get('/api/session-status', async (req, res) => {
  try {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: 'Missing session_id' });

    const session = await stripe.checkout.sessions.retrieve(session_id);
    res.json({
      status: session.payment_status,
      customer_email: session.customer_email,
      amount_total: session.amount_total,
      currency: session.currency,
      metadata: session.metadata,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', stripe: !!process.env.STRIPE_SECRET_KEY });
});

app.listen(PORT, () => {
  console.log(`Axsuma payment server running on port ${PORT}`);
  console.log(`Stripe mode: ${process.env.STRIPE_SECRET_KEY?.startsWith('sk_live') ? 'LIVE' : 'TEST'}`);
});
