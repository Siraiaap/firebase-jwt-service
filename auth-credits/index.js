// auth-credits/index.js
'use strict';

const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { parsePhoneNumberFromString } = require('libphonenumber-js');

/* ================================
   CONFIG (Render env)
================================ */
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET;               // OBLIGATORIO
const JWT_TTL = process.env.JWT_TTL || '365d';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const DEFAULT_COUNTRY = process.env.DEFAULT_COUNTRY || 'MX';
const INITIAL_CREDITS = Number(process.env.INITIAL_CREDITS || 10);

// Ruta del Secret File (Render “Secret Files”)
const SA_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS || '/etc/secrets/google-credentials.json';

/* ================================
   FIREBASE ADMIN (Render)
================================ */
let serviceAccount = null;
try {
  serviceAccount = require(SA_PATH);
} catch (e) {
  console.error('❌ No pude leer el Service Account:', SA_PATH, e?.message);
}

if (!admin.apps.length) {
  if (!serviceAccount) {
    console.error('❌ No hay Service Account. Define un Secret File en Render y/o GOOGLE_APPLICATION_CREDENTIALS.');
  } else {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });
    console.log('✅ Firebase Admin inicializado con projectId:', serviceAccount.project_id);
  }
}

const db = admin.firestore();
// Forzar REST en Firestore (Render a veces falla con gRPC)
try {
  db.settings({ ignoreUndefinedProperties: true, preferRest: true });
  console.log('✅ Firestore settings: preferRest=true, ignoreUndefinedProperties=true');
} catch (e) {
  console.warn('⚠️ No pude aplicar preferRest (versión SDK):', e?.message);
}

/* ================================
   APP + middlewares
================================ */
const app = express();
app.use(helmet());
app.use(cors({ origin: CORS_ORIGIN }));

// ⬇️ IMPORTAR pagos **DESPUÉS** de initializeApp (¡clave!)
const { router: paymentsRouter, stripeWebhookHandler } = require('./payments');

/* ================================
   WEBHOOKS STRIPE (RAW BODY)
   — Registramos **dos** rutas para evitar 404 por confusiones:
     /webhooks/stripe   y   /stripe/webhook
   — DEBEN ir antes de express.json()
================================ */
function rawStripe(req, res, next) {
  return express.raw({ type: 'application/json' })(req, res, () => {
    req.rawBody = req.body; // Buffer para verificar firma
    next();
  });
}
app.post('/webhooks/stripe', rawStripe, (req, res) => stripeWebhookHandler(req, res));
app.post('/stripe/webhook', rawStripe, (req, res) => stripeWebhookHandler(req, res));

/* ================================
   JSON middleware (después del webhook)
================================ */
app.use(express.json({ limit: '10mb' }));

// Sonda de diagnóstico (saber qué archivo corre)
app.get('/__whoami', (_req, res) => {
  res.json({ from: __filename, marker: 'auth-credits-index', now: Date.now() });
});

// Health (con sello de versión)
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    ts: Date.now(),
    adminApps: admin.apps.length,
    project: serviceAccount?.project_id || null,
    marker: 'signup_v3_google'
  });
});

// Diagnóstico Firestore
app.get('/diag/firestore', async (_req, res) => {
  const t0 = Date.now();
  try {
    const ref = db.collection('_diag').doc(`ping-${Date.now()}`);
    await ref.set({ at: admin.firestore.Timestamp.now(), ok: true });
    const snap = await ref.get();
    return res.json({
      ok: true,
      wrote: true,
      read: snap.exists,
      elapsed_ms: Date.now() - t0,
      project: serviceAccount?.project_id || null,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e), elapsed_ms: Date.now() - t0 });
  }
});

// Rutas disponibles (ayuda para verificar webhooks)
app.get('/diag/webhooks', (_req, res) => {
  res.json({
    ok: true,
    stripe_webhook_paths: ['/webhooks/stripe', '/stripe/webhook'],
    note: 'Ambas rutas aceptan el webhook de Stripe con body RAW.',
  });
});

/* ================================
   HELPERS
================================ */
if (!JWT_SECRET) {
  console.warn('⚠️ JWT_SECRET no está definido. Firma/verificación de JWT fallará.');
}

function toE164(raw, defaultCountry = DEFAULT_COUNTRY) {
  const p = parsePhoneNumberFromString(String(raw || ''), defaultCountry);
  if (!p || !p.isValid()) throw new Error('PHONE_INVALID');
  return p.number;
}

function phoneHash(e164) {
  return crypto.createHash('sha256').update(e164).digest('hex');
}

function googleHash(key) {
  return 'g_' + crypto.createHash('sha256').update(String(key || '')).digest('hex');
}

function normalizeDisplayName(raw) {
  const txt = String(raw || '').trim();
  if (!txt) return '';
  if (txt.length < 2 || txt.length > 32) return '';
  const ok = /^[\p{L}\p{N}\s\-\.’]+$/u.test(txt);
  if (!ok) return '';
  return txt.replace(/\s+/g, ' ');
}

function auth(req, res, next) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'NO_TOKEN' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { sub, phone_e164, display_name?, iat, exp }
    next();
  } catch (_e) {
    return res.status(401).json({ error: 'TOKEN_INVALID' });
  }
}

/* ================================
   API
================================ */

app.post('/signup', async (req, res) => {
  try {
    const body = req.body || {};

    // mode: "phone" (default) | "google"
    const modeRaw = body.mode || 'phone';
    const mode = typeof modeRaw === 'string' ? modeRaw.toLowerCase() : 'phone';

    const {
      display_name: rawDisplayName,
      phone,
      phone_e164: phoneE164Raw,
      accept,
      firebase_uid,
      email
    } = body;

    if (!accept) {
      return res.status(409).json({ error: 'TERMS_NOT_ACCEPTED' });
    }

    // Normalizar display_name (intento extra a partir de email en modo google)
    let display_name = normalizeDisplayName(rawDisplayName);
    if (!display_name && mode === 'google' && email) {
      const local = email.split('@')[0].replace(/[._]+/g, ' ');
      display_name = normalizeDisplayName(local);
    }
    if (!display_name) {
      return res.status(400).json({ error: 'MISSING_OR_INVALID_DISPLAY_NAME' });
    }

    let userId;
    let phone_e164 = null;
    let userRef;
    let snap;
    let userData;
    let is_new = false;

    if (mode === 'google') {
      // ============ MODO GOOGLE ============
      const googleKey = firebase_uid || email;
      if (!googleKey) {
        return res.status(400).json({ error: 'MISSING_GOOGLE_IDENTIFIER' });
      }

      // phone opcional en modo google
      if (phoneE164Raw || phone) {
        try {
          phone_e164 = phoneE164Raw ? String(phoneE164Raw) : toE164(phone, DEFAULT_COUNTRY);
        } catch (e) {
          if (e?.message === 'PHONE_INVALID') {
            return res.status(400).json({ error: 'PHONE_INVALID' });
          }
          throw e;
        }
      }

      userId = googleHash(googleKey);
      console.log(`[SIGNUP][GOOGLE] project=${serviceAccount?.project_id} userId=${userId}`);

      userRef = db.collection('users').doc(userId);
      snap = await userRef.get();

      if (!snap.exists) {
        is_new = true;
        userData = {
          display_name,
          phone_e164: phone_e164 || null,
          firebase_uid: firebase_uid || null,
          email: email || null,
          provider: 'google',
          credits_remaining: INITIAL_CREDITS,
          credits_total: INITIAL_CREDITS,
          created_at: admin.firestore.FieldValue.serverTimestamp(),
        };
        await userRef.set(userData);
      } else {
        userData = snap.data() || {};

        if (display_name && display_name !== userData.display_name) {
          await userRef.update({ display_name });
          userData.display_name = display_name;
        }

        if (phone_e164 && phone_e164 !== userData.phone_e164) {
          await userRef.update({ phone_e164 });
          userData.phone_e164 = phone_e164;
        }

        if (firebase_uid && firebase_uid !== userData.firebase_uid) {
          await userRef.update({ firebase_uid });
          userData.firebase_uid = firebase_uid;
        }

        if (email && email !== userData.email) {
          await userRef.update({ email });
          userData.email = email;
        }

        if (!userData.provider) {
          await userRef.update({ provider: 'google' });
          userData.provider = 'google';
        }

        if (userData.credits_total == null) userData.credits_total = INITIAL_CREDITS;
        if (userData.credits_remaining == null) userData.credits_remaining = INITIAL_CREDITS;
      }
    } else {
      // ============ MODO PHONE (POR DEFECTO) ============
      const inputPhone = phoneE164Raw || phone;
      if (!inputPhone) {
        return res.status(400).json({ error: 'MISSING_PHONE' });
      }

      phone_e164 = phoneE164Raw ? String(phoneE164Raw) : toE164(inputPhone, DEFAULT_COUNTRY);
      userId = phoneHash(phone_e164);

      console.log(`[SIGNUP][PHONE] project=${serviceAccount?.project_id} userId=${userId}`);

      userRef = db.collection('users').doc(userId);
      snap = await userRef.get();

      if (!snap.exists) {
        is_new = true;
        userData = {
          display_name,
          phone_e164,
          credits_remaining: INITIAL_CREDITS,
          credits_total: INITIAL_CREDITS,
          created_at: admin.firestore.FieldValue.serverTimestamp(),
        };
        await userRef.set(userData);
      } else {
        userData = snap.data() || {};

        if (display_name && display_name !== userData.display_name) {
          await userRef.update({ display_name });
          userData.display_name = display_name;
        }
        if (!userData.phone_e164) {
          await userRef.set({ phone_e164 }, { merge: true });
          userData.phone_e164 = phone_e164;
        }
        if (userData.credits_total == null) userData.credits_total = INITIAL_CREDITS;
        if (userData.credits_remaining == null) userData.credits_remaining = INITIAL_CREDITS;
      }
    }

    const tokenPayload = {
      sub: userId,
      phone_e164: userData.phone_e164 || phone_e164 || null,
      display_name: userData.display_name
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_TTL });

    return res.json({
      user: {
        id: userId,
        display_name: userData.display_name,
        phone_e164: userData.phone_e164 || phone_e164 || '',
        credits_remaining: Number(userData.credits_remaining ?? INITIAL_CREDITS),
        credits_total: Number(userData.credits_total ?? INITIAL_CREDITS),
      },
      jwt: token,
      is_new,
      credits_awarded: is_new ? INITIAL_CREDITS : 0,
      mode
    });

  } catch (e) {
    if (e?.message === 'PHONE_INVALID') {
      return res.status(400).json({ error: 'PHONE_INVALID' });
    }
    console.error('Signup Error:', e);
    return res.status(500).json({ error: 'SIGNUP_FAILED' });
  }
});

app.get('/me', auth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const ref = db.collection('users').doc(userId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'USER_NOT_FOUND' });

    const d = snap.data() || {};
    return res.json({
      user: {
        id: userId,
        display_name: d.display_name,
        phone_e164: d.phone_e164 || req.user.phone_e164 || '',
        credits_remaining: Number(d.credits_remaining ?? INITIAL_CREDITS),
        credits_total: Number(d.credits_total ?? INITIAL_CREDITS),
      },
    });
  } catch (e) {
    console.error('Me Error:', e);
    return res.status(500).json({ error: 'ME_FAILED' });
  }
});

app.post('/credits/debit', auth, async (req, res) => {
  const userId = req.user.sub;
  const amount = Number(req.body?.amount || 1);
  const flow = String(req.body?.flow || 'audio');
  const device = String(req.body?.device || 'web');

  if (!userId || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'BAD_REQUEST' });
  }

  const ref = db.collection('users').doc(userId);
  try {
    const out = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { status: 404, body: { error: 'USER_NOT_FOUND' } };

      const d = snap.data() || {};
      const current = Number(d.credits_remaining || 0);
      const total = Number(d.credits_total || 0);

      if (current < amount) {
        return { status: 402, body: { ok: false, error: 'NO_CREDITS', credits_remaining: current, credits_total: total } };
      }

      const newRemaining = current - amount;
      tx.update(ref, {
        credits_remaining: newRemaining,
        last_debit_at: admin.firestore.FieldValue.serverTimestamp(),
        last_debit_flow: flow,
        last_debit_device: device,
      });

      return { status: 200, body: { ok: true, credits_remaining: newRemaining, credits_total: total } };
    });

    return res.status(out.status).json(out.body);
  } catch (e) {
    console.error('DEBIT_ERROR', e);
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
  }
});

function sanitizeRole(raw) {
  const r = String(raw || '').toLowerCase().trim();
  return (r === 'user' || r === 'assistant') ? r : '';
}
function sanitizeContent(raw) {
  let s = String(raw ?? '');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > 4000) s = s.slice(0, 4000);
  return s;
}

app.post('/messages', auth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const role = sanitizeRole(req.body?.role);
    const content = sanitizeContent(req.body?.content || '');
    const request_id = (req.body?.request_id || '').toString().slice(0, 120) || undefined;

    if (!role) return res.status(400).json({ error: 'INVALID_ROLE' });
    if (!content) return res.status(400).json({ error: 'MISSING_CONTENT' });

    const col = db.collection('users').doc(userId).collection('messages');
    const docRef = await col.add({
      role,
      content,
      request_id: request_id || null,
      ts: admin.firestore.FieldValue.serverTimestamp()
    });

    try {
      const olderSnap = await col.orderBy('ts', 'desc').offset(100).limit(50).get();
      const batch = db.batch();
      olderSnap.forEach(d => batch.delete(d.ref));
      if (!olderSnap.empty) await batch.commit();
    } catch (_) {}

    return res.json({ ok: true, id: docRef.id });
  } catch (e) {
    console.error('POST /messages error:', e);
    return res.status(500).json({ error: 'STORE_FAILED' });
  }
});

app.get('/messages', auth, async (req, res) => {
  try {
    const userId = req.user.sub;
    let limit = Number(req.query?.limit || 100);
    if (!Number.isFinite(limit) || limit <= 0) limit = 100;
    if (limit > 100) limit = 100;

    const col = db.collection('users').doc(userId).collection('messages');
    const snap = await col.orderBy('ts', 'desc').limit(limit).get();

    const items = snap.docs.map(d => {
      const x = d.data() || {};
      let ts = null;
      if (x.ts?.toMillis) ts = x.ts.toMillis();
      return { id: d.id, role: x.role || '', content: x.content || '', ts };
    });

    return res.json({ items, count: items.length });
  } catch (e) {
    console.error('GET /messages error:', e);
    return res.status(500).json({ error: 'LIST_FAILED' });
  }
});

/* ================================
   PAGOS
================================ */
// 👉 Mantén ambas monturas para compatibilidad con el front actual:
app.use('/payments', paymentsRouter); // /payments/checkout/session
app.use('/', paymentsRouter);         // /checkout/session (alias)

/* ================================
   START
================================ */
app.listen(PORT, () => {
  console.log(`Auth service running on port ${PORT}`);
});
