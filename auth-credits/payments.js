// auth-credits/payments.js
const express = require('express');
const router = express.Router();
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

const admin = require('firebase-admin');
const db = admin.firestore();
const jwt = require('jsonwebtoken');

// --- Helpers ---
function getCountry(req) {
  const q = (req.query.country || '').toUpperCase();
  if (q === 'MX' || q === 'US') return q;
  const h = (req.headers['cf-ipcountry'] || '').toUpperCase();
  if (h === 'MX' || h === 'US') return h;
  const env = (process.env.DEFAULT_COUNTRY || 'US').toUpperCase();
  return (env === 'MX' || env === 'US') ? env : 'US';
}

function priceIdFor(country, pkg) {
  const p = String(pkg);
  if (country === 'MX') {
    return {
      '25':  process.env.STRIPE_PRICE_MXN_25,
      '50':  process.env.STRIPE_PRICE_MXN_50,
      '100': process.env.STRIPE_PRICE_MXN_100,
      '250': process.env.STRIPE_PRICE_MXN_250,
    }[p];
  }
  return {
    '25':  process.env.STRIPE_PRICE_USD_25,
    '50':  process.env.STRIPE_PRICE_USD_50,
    '100': process.env.STRIPE_PRICE_USD_100,
    '250': process.env.STRIPE_PRICE_USD_250,
  }[p];
}

function currencyFor(country) {
  return country === 'MX' ? 'mxn' : 'usd';
}

function authRequired(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'NO_TOKEN' });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { sub, phone_e164, display_name? }
    next();
  } catch (e) {
    return res.status(401).json({ error: 'INVALID_TOKEN' });
  }
}

// POST /payments/create-checkout-session
router.post('/create-checkout-session', authRequired, async (req, res) => {
  try {
    const sub = req.user.sub;
    const pkg = Number(req.body.package_id);
    if (![25, 50, 100, 250].includes(pkg)) {
      return res.status(400).json({ error: 'INVALID_PACKAGE' });
    }

    const country = getCountry(req);
    const currency = currencyFor(country);
    const priceId = priceIdFor(country, pkg);
    if (!priceId) return res.status(500).json({ error: 'PRICE_NOT_CONFIGURED', country, pkg });

    const successUrl = process.env.FRONT_SUCCESS_URL || 'https://siraia.com/?paid=success';
    const cancelUrl = process.env.FRONT_CANCEL_URL || 'https://siraia.com/?paid=cancel';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: sub,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${successUrl}&sid={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
      metadata: { sub, package_id: String(pkg), country, currency },
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      currency,
    });

    return res.json({ session_url: session.url });
  } catch (e) {
    console.error('create-checkout-session error', e);
    return res.status(500).json({ error: 'SESSION_FAILED' });
  }
});

// Webhook handler
async function stripeWebhookHandler(req, res) {
  let event;
  try {
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const sessionId = session.id;
    const sub = session.client_reference_id || (session.metadata && session.metadata.sub);
    const pkg = Number(session.metadata && session.metadata.package_id || 0);
    const creditsToAdd = [25,50,100,250].includes(pkg) ? pkg : 0;

    try {
      await db.runTransaction(async (tx) => {
        const orderRef = db.collection('orders').doc(sessionId);
        const snap = await tx.get(orderRef);
        if (snap.exists) return; // idempotente

        const userRef = db.collection('users').doc(sub);
        const userSnap = await tx.get(userRef);
        const prev = (userSnap.exists ? (userSnap.data().credits || 0) : 0);
        const next = prev + creditsToAdd;

        tx.set(orderRef, {
          id: sessionId,
          sub,
          package_id: pkg,
          credits_added: creditsToAdd,
          amount_total: (session.amount_total || 0) / 100,
          currency: session.currency,
          status: 'processed',
          created_at: admin.firestore.FieldValue.serverTimestamp(),
        });

        tx.set(userRef, {
          credits: next,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      });

      return res.json({ ok: true });
    } catch (e) {
      console.error('webhook tx error', e);
      return res.status(500).json({ error: 'WEBHOOK_TX_FAILED' });
    }
  }

  return res.json({ received: true });
}

module.exports = { router, stripeWebhookHandler };
