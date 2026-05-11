# Axsuma — Stripe Payment Setup Guide

## 1. Create Stripe Account
Go to https://dashboard.stripe.com/register and create your account.

## 2. Get API Keys (Test Mode)
1. Go to https://dashboard.stripe.com/test/apikeys
2. Copy your **Publishable key** (starts with `pk_test_`)
3. Copy your **Secret key** (starts with `sk_test_`)

## 3. Create Products & Prices
In Stripe Dashboard > Products, create:

### Product 1: ID Verification — Individual
- Name: `ID Verification - Individual`
- Price: £90.00 (£75 + VAT) — One-time
- Copy the Price ID (starts with `price_`)

### Product 2: ID Verification — Corporate Bundle
- Name: `ID Verification - Corporate Bundle`
- Price: £300.00 (£250 + VAT) — One-time
- Copy the Price ID (starts with `price_`)

## 4. Configure Environment
1. Copy `.env.example` to `.env`
2. Fill in your keys:
```
STRIPE_SECRET_KEY=sk_test_YOUR_KEY
STRIPE_PUBLISHABLE_KEY=pk_test_YOUR_KEY
STRIPE_PRICE_INDIVIDUAL=price_YOUR_INDIVIDUAL_PRICE_ID
STRIPE_PRICE_CORPORATE=price_YOUR_CORPORATE_PRICE_ID
FRONTEND_URL=https://www.axsuma.co.uk
```

## 5. Update Frontend
In `id-verification.html`, replace the `STRIPE_PK` variable:
```js
const STRIPE_PK = 'pk_test_YOUR_PUBLISHABLE_KEY';
```

## 6. Install & Run
```bash
cd server
npm install
npm start
```

## 7. Set Up Webhooks
1. Go to https://dashboard.stripe.com/test/webhooks
2. Add endpoint: `https://your-domain.com/api/webhook`
3. Select events: `checkout.session.completed`, `payment_intent.payment_failed`
4. Copy the Webhook Secret to your `.env`

## 8. Go Live
When ready for production:
1. Switch to Live mode in Stripe Dashboard
2. Replace all `sk_test_` / `pk_test_` keys with `sk_live_` / `pk_live_`
3. Create Live products/prices (same as test)
4. Update webhook endpoint to production URL
5. Enable `automatic_tax` in server.js if using Stripe Tax

## Testing
Use these test card numbers:
- **Success**: 4242 4242 4242 4242
- **Declined**: 4000 0000 0000 0002
- **3D Secure**: 4000 0025 0000 3155

Any future date, any CVC, any postcode.
