// auth-credits/payments.js
'use strict';

const express = require('express');
const router = express.Router();
const Stripe = require('stripe');
const admin = require('firebase-admin');
const jwt = require('jsonwebtoken');

const db = admin.firestore();

// =============================
// Stripe
// =============================
const {
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,

  // Front URLs
  FRONTEND_URL = 'https://siraia.com',
  FRONT_SUCCESS_URL, // opcional (si lo defines, tiene prioridad)
  FRONT_CANCEL_URL,  // opcional

  // === NUEVO esquema (recomendado): paquetes 10 / 30 ===
  PRICE_ID_MX_10,
  PRICE_ID_INTL_10,
  PRICE_ID_MX_30,
  PRICE_ID_INTL_30,

  // === LEGACY (compat): 25 / 50 / 100 / 250 ===
  STRIPE_PRICE_MXN_25,
  STRIPE_PRICE_MXN_50,
  STRIPE_PRICE_MXN_100,
  STRIPE_PRICE_MXN_250,
  STRIPE_PRICE_USD_25,
  STRIPE_PRICE_USD_50,
  STRIPE_PRICE_USD_100,
  STRIPE_PRICE_USD_250,

  DEFAULT_COUNTRY = 'MX'
} = process.env;

if (!STRIPE_SECRET_KEY) {
  console.warn('⚠️ Falta STRIPE_SECRET_KEY');
}
if (!STRIPE_WEBHOOK_SECRET) {
  console.warn('⚠️ Falta STRIPE_WEBHOOK_SECRET (necesario para validar el webhook)');
}

// Mantengo tu versión Stripe para no romper compatibilidad con lib v14
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

// =============================
// Helpers (auth, región, prices)
// =============================
function requireAuth(req, res, next) {
  try {
    const hdr = req.headers.authorization || '';
    const token = hdr.replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'NO_TOKEN' });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { sub, phone_e164, display_name? }
    next();
  } catch (e) {
    return res.status(401).json({ error: 'INVALID_TOKEN' });
  }
}

// Región: MX si phone_e164 empieza con +52 o si headers/DEFAULT apuntan a MX; else INTL
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
  return ['10', '30', '25', '50', '100', '250'].includes(s);
}

function creditsForPackage(pkg) {
  const n = Number(pkg);
  if ([10, 30, 25, 50, 100, 250].includes(n)) return n;
  return 0;
}

function getPriceId({ region, pkg }) {
  const key = `${region}_${String(pkg)}`;

  // Nuevo esquema (10 / 30)
  const newMap = {
    'MX_10': PRICE_ID_MX_10,
    'INTL_10': PRICE_ID_INTL_10,
    'MX_30': PRICE_ID_MX_30,
    'INTL_30': PRICE_ID_INTL_30
  };
  if (newMap[key]) return newMap[key];

  // Legacy (25 / 50 / 100 / 250)
  if (region === 'MX') {
    const legacyMX = {
      '25': STRIPE_PRICE_MXN_25,
      '50': STRIPE_PRICE_MXN_50,
      '100': STRIPE_PRICE_MXN_100,
      '250': STRIPE_PRICE_MXN_250
    };
    return legacyMX[String(pkg)] || null;
  } else {
    const legacyUS = {
      '25': STRIPE_PRICE_USD_25,
      '50': STRIPE_PRICE_USD_50,
      '100': STRIPE_PRICE_USD_100,
      '250': STRIPE_PRICE_USD_250
    };
    return legacyUS[String(pkg)] || null;
  }
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

// =============================
// CHECKOUT (Opción B, API)
// =============================

// Handler compartido para crear la sesión (lo usamos en 2 rutas)
async function createCheckoutSession(req, res) {
  try {
    const user = req.user || {};
    const sub = user.sub;
    const pkg = String(req.body?.package_id || req.body?.pkg || ''); // soporta {package_id} o {pkg}

    if (!allowedPackage(pkg)) {
      return res.status(400).json({ error: 'INVALID_PACKAGE', allowed: ['10','30','25','50','100','250'] });
    }

    const region = resolveRegion(req);
    const priceId = getPriceId({ region, pkg });
    if (!priceId) {
      return res.status(500).json({ error: 'PRICE_NOT_CONFIGURED', region, pkg });
    }

    const successBase = FRONT_SUCCESS_URL || `${FRONTEND_URL}/?status=success`;
    const cancelUrl   = FRONT_CANCEL_URL  || `${FRONTEND_URL}/?status=cancel`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: sub, // útil para fallback en webhook
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${successBase}&pkg=${encodeURIComponent(pkg)}&sid={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      // currency NO se envía cuando usamos line_items con price
      metadata: {
        user_id: sub || '',
        phone_e164: user.phone_e164 || '',
        region,
        package: String(pkg),
        request_id: req.header('X-Request-ID') || ''
      }
    });

    // Respuesta simple
    return res.json({ url: session.url });
  } catch (e) {
    console.error('checkout/session error:', e?.message || e);
    return res.status(500).json({ error: 'SESSION_FAILED' });
  }
}

// Nuevo canónico
router.post('/checkout/session', requireAuth, createCheckoutSession);
// Alias legacy (mantiene compatibilidad con tu front si apuntaba aquí)
router.post('/payments/create-checkout-session', requireAuth, createCheckoutSession);

// =============================
// WEBHOOK
// =============================
async function stripeWebhookHandler(req, res) {
  // req.rawBody fue puesto por index.js (express.raw)
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
      const pkg = md.package || md.package_id || '';
      const region = md.region || 'INTL';

      const creditsToAdd = creditsForPackage(pkg);

      if (!sub) {
        console.warn('[WEBHOOK] checkout.session.completed SIN sub -> ignorado (200 OK)');
        await evRef.set({ type: event.type, session_id: sessionId, processed_at: new Date(), ignored: true, reason: 'missing_sub' });
        return res.json({ ok: true, ignored: true });
      }

      // Idempotencia por orden (sesión)
      const orderRef = db.collection('orders').doc(sessionId);
      const orderSnap = await orderRef.get();
      if (orderSnap.exists && orderSnap.data()?.status === 'paid') {
        await evRef.set({ type: event.type, session_id: sessionId, processed_at: new Date(), duplicate_order: true });
        return res.json({ received: true, duplicate_order: true });
      }

      // ¿Es primera compra del usuario?
      const prevPaid = await db.collection('orders')
        .where('user_id', '==', sub)
        .where('status', '==', 'paid')
        .limit(1)
        .get();
      const first_purchase = prevPaid.empty;

      // Acreditar créditos (transacción atómica)
      const grant = await grantCreditsAtomic({
        sub,
        amount: creditsToAdd,
        reason: 'stripe_checkout',
        meta: { pkg: String(pkg), region, session_id: sessionId, event_id: event.id }
      });

      // Guardar orden
      await orderRef.set({
        user_id: sub,
        package: String(pkg),
        region,
        status: 'paid',
        reward_given: false,      // para Referidos (Bloque C)
        first_purchase,
        // Datos útiles de auditoría (no PII)
        amount_total: session.amount_total ? session.amount_total / 100 : null,
        currency: session.currency || null,
        created_at: new Date(),
        updated_at: new Date()
      }, { merge: true });

      // Guardar evento como procesado
      await evRef.set({
        type: event.type,
        session_id: sessionId,
        processed_at: new Date()
      });

      return res.json({ received: true, credited: grant.ok, new_balance: grant.new_balance });
    }

    // Otros eventos: solo registrar
    await evRef.set({
      type: event.type,
      processed_at: new Date()
    });
    return res.json({ received: true });
  } catch (e) {
    console.error('webhook processing error:', e?.message || e);
    // No marcamos el evento como procesado para permitir reintento
    return res.status(500).json({ error: 'WEBHOOK_TX_FAILED' });
  }
}

module.exports = { router, stripeWebhookHandler };
