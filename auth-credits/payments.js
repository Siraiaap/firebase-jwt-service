// auth-credits/payments.js
'use strict';

const express = require('express');
const router = express.Router();
const Stripe = require('stripe');
const admin = require('firebase-admin');
const jwt = require('jsonwebtoken');

const db = admin.firestore();

/* =============================
   ENV / Stripe
============================= */
const {
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,

  // Front URLs
  FRONTEND_URL = 'https://siraia.com',
  FRONT_SUCCESS_URL, // opcional (si existe, tiene prioridad)
  FRONT_CANCEL_URL,  // opcional

  // Precios MXN (25/50/100/250)
  STRIPE_PRICE_MXN_25,
  STRIPE_PRICE_MXN_50,
  STRIPE_PRICE_MXN_100,
  STRIPE_PRICE_MXN_250,

  // Precios USD (25/50/100/250)
  STRIPE_PRICE_USD_25,
  STRIPE_PRICE_USD_50,
  STRIPE_PRICE_USD_100,
  STRIPE_PRICE_USD_250,

  // Región por defecto si no detectamos nada
  DEFAULT_COUNTRY = 'MX',

  // Ajustable: si no llega pkg, usamos base 25 con qty (1..10)
  CHECKOUT_DEFAULT_PKG = '25',     // se usa si llega pkg vacío/ausente
  CHECKOUT_ADJUSTABLE_MIN = '1',
  CHECKOUT_ADJUSTABLE_MAX = '10'
} = process.env;

if (!STRIPE_SECRET_KEY) console.warn('⚠️ Falta STRIPE_SECRET_KEY');
if (!STRIPE_WEBHOOK_SECRET) console.warn('⚠️ Falta STRIPE_WEBHOOK_SECRET');

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

/* =============================
   Helpers
============================= */
function requireAuth(req, res, next) {
  try {
    const hdr = req.headers.authorization || '';
    const token = hdr.replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'NO_TOKEN' });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { sub, phone_e164, display_name? }
    next();
  } catch (_e) {
    return res.status(401).json({ error: 'INVALID_TOKEN' });
  }
}

// Región: MX si phone_e164 empieza con +52; fallback CF/AL/DEFAULT; otro => INTL (USD)
function resolveRegion(req) {
  const phone = req.user?.phone_e164 || '';
  if (String(phone).startsWith('+52')) return 'MX';
  const cf = String(req.headers['cf-ipcountry'] || '').toUpperCase();
  if (cf === 'MX') return 'MX';
  const al = String(req.headers['accept-language'] || '');
  if (/es-MX/i.test(al)) return 'MX';
  const env = String(DEFAULT_COUNTRY || 'US').toUpperCase();
  return env === 'MX' ? 'MX' : 'INTL';
}

function allowedPackage(pkg) {
  const s = String(pkg);
  return ['25', '50', '100', '250'].includes(s);
}
function creditsForPackage(pkg) {
  const n = Number(pkg);
  return [25, 50, 100, 250].includes(n) ? n : 0;
}
function getPriceId({ region, pkg }) {
  const p = String(pkg);
  if (region === 'MX') {
    const map = {
      '25': STRIPE_PRICE_MXN_25,
      '50': STRIPE_PRICE_MXN_50,
      '100': STRIPE_PRICE_MXN_100,
      '250': STRIPE_PRICE_MXN_250
    };
    return map[p] || null;
  }
  const map = {
    '25': STRIPE_PRICE_USD_25,
    '50': STRIPE_PRICE_USD_50,
    '100': STRIPE_PRICE_USD_100,
    '250': STRIPE_PRICE_USD_250
  };
  return map[p] || null;
}

async function grantCreditsAtomic({ sub, amount, reason = 'stripe_checkout', meta = {} }) {
  if (!sub) throw new Error('grantCreditsAtomic: missing sub');
  const inc = Number(amount || 0);
  if (!Number.isFinite(inc) || inc <= 0) return { ok: true, new_balance: NaN };

  const ref = db.collection('users').doc(sub);
  let newBal = 0;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    const current = Number(data.credits_remaining || 0);
    const total = Number(data.credits_total || 0);
    newBal = current + inc;
    tx.set(ref, {
      credits_remaining: newBal,
      credits_total: total + inc,
      updated_at: new Date(),
      last_credit_reason: reason,
      last_credit_meta: meta
    }, { merge: true });
  });
  return { ok: true, new_balance: newBal };
}

/* =============================
   Middleware de LOG (sin PII)
============================= */
router.use(express.json({ limit: '2mb' })); // defensa si el router se monta aparte
router.use((req, _res, next) => {
  if (req.method === 'POST') {
    const url = req.originalUrl || req.url || '';
    const isCheckout = url.includes('/checkout/session') || url.includes('/create-checkout-session');
    if (isCheckout) {
      const hasAuth = Boolean((req.headers.authorization || '').startsWith('Bearer '));
      const pkgBody = req.body?.pkg ?? req.body?.package_id ?? null;
      const pkgQuery = req.query?.pkg ?? req.query?.package_id ?? null;
      console.log(
        `[CHECKOUT] hit url=${url} auth=${hasAuth} pkgBody=${pkgBody} pkgQuery=${pkgQuery} origin=${req.headers.origin || 'n/a'}`
      );
    }
  }
  next();
});

/* =============================
   CHECKOUT (creación de sesión)
============================= */
async function createCheckoutSession(req, res) {
  try {
    const user = req.user || {};
    const sub = user.sub;
    const region = resolveRegion(req);

    // 1) lee pkg (body -> query), 2) si no viene, usamos flujo AJUSTABLE con base 25
    let pkg =
      req.body?.package_id ?? req.body?.pkg ??
      req.query?.package_id ?? req.query?.pkg ?? null;

    const successBase = FRONT_SUCCESS_URL || `${FRONTEND_URL}/?status=success`;
    const cancelUrl   = FRONT_CANCEL_URL  || `${FRONTEND_URL}/?status=cancel`;

    if (pkg && allowedPackage(pkg)) {
      // === Flujo normal (paquete explícito) ===
      const priceId = getPriceId({ region, pkg });
      if (!priceId) {
        console.warn('[CHECKOUT] price not configured', { region, pkg });
        return res.status(500).json({ error: 'PRICE_NOT_CONFIGURED', region, pkg });
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        client_reference_id: sub,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${successBase}&pkg=${encodeURIComponent(String(pkg))}&sid={CHECKOUT_SESSION_ID}`,
        cancel_url: cancelUrl,
        allow_promotion_codes: true,
        billing_address_collection: 'auto',
        metadata: {
          user_id: sub || '',
          phone_e164: user.phone_e164 || '',
          region,
          package: String(pkg),           // ← paquete explícito
          adjustable: '0',
          request_id: req.header('X-Request-ID') || ''
        }
      });

      return res.json({ url: session.url, session_url: session.url, region, pkg: String(pkg) });
    }

    // === Flujo AJUSTABLE (sin pkg) ===
    // Usamos SIEMPRE el price de 25 y habilitamos quantity en Checkout.
    const basePriceId = region === 'MX' ? STRIPE_PRICE_MXN_25 : STRIPE_PRICE_USD_25;
    if (!basePriceId) {
      console.warn('[CHECKOUT] missing base 25 price for region', region);
      return res.status(500).json({ error: 'PRICE_NOT_CONFIGURED_BASE_25', region });
    }

    const minQ = Math.max(1, parseInt(CHECKOUT_ADJUSTABLE_MIN || '1', 10));
    const maxQ = Math.max(minQ, parseInt(CHECKOUT_ADJUSTABLE_MAX || '10', 10));

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: sub,
      line_items: [{
        price: basePriceId,
        quantity: 1,
        adjustable_quantity: { enabled: true, minimum: minQ, maximum: maxQ }
      }],
      success_url: `${successBase}&pkg=adjustable&sid={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      metadata: {
        user_id: sub || '',
        phone_e164: user.phone_e164 || '',
        region,
        // base de cálculo: 25 créditos por unidad
        adjustable: '1',
        base_unit_credits: '25',
        request_id: req.header('X-Request-ID') || ''
      }
    });

    return res.json({ url: session.url, session_url: session.url, region, pkg: 'adjustable' });
  } catch (e) {
    console.error('checkout/session error:', e?.message || e);
    return res.status(500).json({ error: 'SESSION_FAILED' });
  }
}

// Nueva y legacy
router.post('/checkout/session', requireAuth, createCheckoutSession);
router.post('/payments/create-checkout-session', requireAuth, createCheckoutSession);

/* =============================
   WEBHOOK
============================= */
async function stripeWebhookHandler(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Idempotencia por evento
  const evRef = db.collection('stripe_events').doc(event.id);
  const evSnap = await evRef.get();
  if (evSnap.exists) {
    return res.json({ received: true, duplicate: true });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const sessionId = session.id;
      const md = session.metadata || {};
      const sub = session.client_reference_id || md.user_id || md.sub || '';
      const region = md.region || 'INTL';
      let creditsToAdd = 0;
      let pkg = md.package || md.package_id || null;

      // Si fue flujo ajustable, obtenemos la cantidad final desde Stripe
      if (md.adjustable === '1' || md.base_unit_credits) {
        const baseUnit = parseInt(md.base_unit_credits || '25', 10);
        // Recupera line_items para conocer la quantity elegida por el usuario
        const full = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['line_items'] });
        const qty = (full.line_items?.data || []).reduce((s, li) => s + (li.quantity || 0), 0) || 1;
        creditsToAdd = baseUnit * qty;
        pkg = String(creditsToAdd); // para registrar en orden (25/50/100/250)
      } else {
        // Paquete explícito
        creditsToAdd = creditsForPackage(pkg);
      }

      if (!sub) {
        console.warn('[WEBHOOK] checkout.session.completed SIN sub -> ignorado');
        await evRef.set({ type: event.type, session_id: sessionId, processed_at: new Date(), ignored: true, reason: 'missing_sub' });
        return res.json({ ok: true, ignored: true });
      }

      // Idempotencia por orden / sesión
      const orderRef = db.collection('orders').doc(sessionId);
      const orderSnap = await orderRef.get();
      if (orderSnap.exists && orderSnap.data()?.status === 'paid') {
        await evRef.set({ type: event.type, session_id: sessionId, processed_at: new Date(), duplicate_order: true });
        return res.json({ received: true, duplicate_order: true });
      }

      // ¿primera compra?
      const prevPaid = await db.collection('orders')
        .where('user_id', '==', sub)
        .where('status', '==', 'paid')
        .limit(1)
        .get();
      const first_purchase = prevPaid.empty;

      // Acreditar
      const grant = await grantCreditsAtomic({
        sub,
        amount: creditsToAdd,
        reason: 'stripe_checkout',
        meta: { pkg: String(pkg), region, session_id: sessionId, event_id: event.id }
      });

      // Guardar orden
      await orderRef.set({
        user_id: sub,
        package: String(pkg),            // 25/50/100/250 resultante
        region,
        status: 'paid',
        reward_given: false,
        first_purchase,
        amount_total: session.amount_total ? session.amount_total / 100 : null,
        currency: session.currency || null,
        adjustable: md.adjustable === '1',
        base_unit_credits: md.base_unit_credits ? Number(md.base_unit_credits) : null,
        created_at: new Date(),
        updated_at: new Date()
      }, { merge: true });

      // Guardar evento
      await evRef.set({
        type: event.type,
        session_id: sessionId,
        processed_at: new Date()
      });

      return res.json({ received: true, credited: grant.ok, new_balance: grant.new_balance });
    }

    // Otros eventos
    await evRef.set({
      type: event.type,
      processed_at: new Date()
    });
    return res.json({ received: true });
  } catch (e) {
    console.error('webhook processing error:', e?.message || e);
    return res.status(500).json({ error: 'WEBHOOK_TX_FAILED' });
  }
}

/* =============================
   Diagnóstico seguro (sin secretos)
============================= */
function hasPrice(k) {
  const v = process.env[k] || '';
  return Boolean(v && v.startsWith('price_'));
}
router.get('/diag/payments', (_req, res) => {
  res.json({
    ok: true,
    present: {
      STRIPE_SECRET_KEY: Boolean(STRIPE_SECRET_KEY),
      STRIPE_WEBHOOK_SECRET: Boolean(STRIPE_WEBHOOK_SECRET),
      MXN: {
        '25': hasPrice('STRIPE_PRICE_MXN_25'),
        '50': hasPrice('STRIPE_PRICE_MXN_50'),
        '100': hasPrice('STRIPE_PRICE_MXN_100'),
        '250': hasPrice('STRIPE_PRICE_MXN_250'),
      },
      USD: {
        '25': hasPrice('STRIPE_PRICE_USD_25'),
        '50': hasPrice('STRIPE_PRICE_USD_50'),
        '100': hasPrice('STRIPE_PRICE_USD_100'),
        '250': hasPrice('STRIPE_PRICE_USD_250'),
      }
    },
    adjustable_fallback: {
      enabled_when_pkg_missing: true,
      base_unit_credits: 25,
      min: Number(CHECKOUT_ADJUSTABLE_MIN || '1'),
      max: Number(CHECKOUT_ADJUSTABLE_MAX || '10'),
    }
  });
});

module.exports = { router, stripeWebhookHandler };
