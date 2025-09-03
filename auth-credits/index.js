// index.js
'use strict';

const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { parsePhoneNumberFromString } = require('libphonenumber-js');

// ===============================
// Config (Render env)
// ===============================
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET;               // <-- OBLIGATORIO
const JWT_TTL = process.env.JWT_TTL || '7d';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const DEFAULT_COUNTRY = process.env.DEFAULT_COUNTRY || 'MX';
const INITIAL_CREDITS = Number(process.env.INITIAL_CREDITS || 10);

// Ruta del Secret File en Render (asegúrate de configurarlo así)
const SA_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS || '/etc/secrets/google-credentials.json';

// ===============================
// Firebase Admin inicialización
// ===============================
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
      // Fuerza el proyecto correcto (evita "Unable to detect Project Id")
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

// ===============================
// App Express + middlewares
// ===============================
const app = express();
app.use(helmet());
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '10mb' }));

// --- Sonda de diagnóstico (auth-credits) ---
app.get('/__whoami', (_req, res) => {
  res.json({
    from: __filename,
    marker: 'auth-credits-index',
    now: Date.now()
  });
});

// ===============================
// Helpers
// ===============================
if (!JWT_SECRET) {
  console.warn('⚠️ JWT_SECRET no está definido. Firma/verificación de JWT fallará.');
}

function toE164(raw, defaultCountry = DEFAULT_COUNTRY) {
  const p = parsePhoneNumberFromString(String(raw || ''), defaultCountry);
  if (!p || !p.isValid()) throw new Error('PHONE_INVALID');
  return p.number; // +5255...
}

function phoneHash(e164) {
  return crypto.createHash('sha256').update(e164).digest('hex');
}

// Auth middleware: valida Bearer JWT firmado con JWT_SECRET
function auth(req, res, next) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'NO_TOKEN' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { sub, phone_e164, display_name, iat, exp }
    next();
  } catch (e) {
    return res.status(401).json({ error: 'TOKEN_INVALID' });
  }
}

// ===============================
// Endpoints de diagnóstico
// ===============================
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    ts: Date.now(),
    adminApps: admin.apps.length,
    project: serviceAccount?.project_id || null,
  });
});

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
    return res.status(500).json({
      ok: false,
      error: String(e?.message || e),
      elapsed_ms: Date.now() - t0,
    });
  }
});

// ===============================
// API
// ===============================

// /signup: crea usuario si no existe y devuelve jwt
app.post('/signup', async (req, res) => {
  try {
    const { display_name, phone, accept } = req.body || {};
    if (!accept) return res.status(409).json({ error: 'TERMS_NOT_ACCEPTED' });
    if (!display_name || !phone) return res.status(400).json({ error: 'MISSING_FIELDS' });

    const phone_e164 = toE164(phone, DEFAULT_COUNTRY);
    const userId = phoneHash(phone_e164);

    console.log(`[SIGNUP] project=${serviceAccount?.project_id} userId=${userId} phone=${phone_e164}`);

    const userRef = db.collection('users').doc(userId);
    const snap = await userRef.get();

    let userData;
    if (!snap.exists) {
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
    }

    const token = jwt.sign(
      { sub: userId, phone_e164, display_name },
      JWT_SECRET,
      { expiresIn: JWT_TTL }
    );

    return res.json({
      user: {
        id: userId,
        display_name: userData.display_name,
        phone_e164: userData.phone_e164,
        credits_remaining: userData.credits_remaining,
        credits_total: userData.credits_total,
      },
      jwt: token,
    });
  } catch (e) {
    if (e?.message === 'PHONE_INVALID') {
      return res.status(400).json({ error: 'PHONE_INVALID' });
    }
    console.error('Signup Error:', e);
    return res.status(500).json({ error: 'SIGNUP_FAILED' });
  }
});

// /me: devuelve datos del usuario basados en JWT
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
        phone_e164: d.phone_e164,
        credits_remaining: d.credits_remaining,
        credits_total: d.credits_total,
      },
    });
  } catch (e) {
    console.error('Me Error:', e);
    return res.status(500).json({ error: 'ME_FAILED' });
  }
});

// /credits/debit: descuenta créditos con transacción
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
        return {
          status: 402,
          body: { ok: false, error: 'NO_CREDITS', credits_remaining: current, credits_total: total },
        };
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

// ===============================
// Start
// ===============================
app.listen(PORT, () => {
  console.log(`Auth service running on port ${PORT}`);
});
