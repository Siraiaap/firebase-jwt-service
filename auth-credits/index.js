// index.js
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
const JWT_TTL = process.env.JWT_TTL || '7d';
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
    marker: 'signup_v2'
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
    return res.status(500).json({
      ok: false,
      error: String(e?.message || e),
      elapsed_ms: Date.now() - t0,
    });
  }
});

/* ================================
   HELPERS
================================ */
if (!JWT_SECRET) {
  console.warn('⚠️ JWT_SECRET no está definido. Firma/verificación de JWT fallará.');
}

// A E.164 (+52…)
function toE164(raw, defaultCountry = DEFAULT_COUNTRY) {
  const p = parsePhoneNumberFromString(String(raw || ''), defaultCountry);
  if (!p || !p.isValid()) throw new Error('PHONE_INVALID');
  return p.number;
}

// Hash anónimo por teléfono (ID)
function phoneHash(e164) {
  return crypto.createHash('sha256').update(e164).digest('hex');
}

// Normaliza/valida apodo (2–32; letras con acentos/números/espacio/-/.’)
function normalizeDisplayName(raw) {
  const txt = String(raw || '').trim();
  if (!txt) return '';
  if (txt.length < 2 || txt.length > 32) return '';
  const ok = /^[\p{L}\p{N}\s\-\.’]+$/u.test(txt);
  if (!ok) return '';
  return txt.replace(/\s+/g, ' ');
}

// Auth middleware: valida Bearer JWT
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

// /signup: alta o relogin (sin regalar créditos en relogin, pero actualiza apodo)
app.post('/signup', async (req, res) => {
  try {
    // Aceptamos phone (cualquier formato) o phone_e164
    const {
      display_name: rawDisplayName,
      phone,
      phone_e164: phoneE164Raw,
      accept
    } = req.body || {};

    if (!accept) return res.status(409).json({ error: 'TERMS_NOT_ACCEPTED' });

    const display_name = normalizeDisplayName(rawDisplayName);
    if (!display_name) return res.status(400).json({ error: 'MISSING_OR_INVALID_DISPLAY_NAME' });

    const inputPhone = phoneE164Raw || phone;
    if (!inputPhone) return res.status(400).json({ error: 'MISSING_PHONE' });

    const phone_e164 = phoneE164Raw ? String(phoneE164Raw) : toE164(inputPhone, DEFAULT_COUNTRY);
    const userId = phoneHash(phone_e164);

    console.log(`[SIGNUP] project=${serviceAccount?.project_id} userId=${userId} phone=${phone_e164}`);

    const userRef = db.collection('users').doc(userId);
    const snap = await userRef.get();

    let userData;
    let is_new = false;

    if (!snap.exists) {
      // Alta nueva → regalar créditos iniciales
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
      // Relogin → no regalar créditos; actualizar apodo si cambió
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

    // JWT (mantenemos display_name por compatibilidad con tu front)
    const token = jwt.sign(
      { sub: userId, phone_e164, display_name: userData.display_name },
      JWT_SECRET,
      { expiresIn: JWT_TTL }
    );

    return res.json({
      user: {
        id: userId,
        display_name: userData.display_name,
        phone_e164: userData.phone_e164,
        credits_remaining: Number(userData.credits_remaining ?? INITIAL_CREDITS),
        credits_total: Number(userData.credits_total ?? INITIAL_CREDITS),
      },
      jwt: token,
      is_new,
      credits_awarded: is_new ? INITIAL_CREDITS : 0
    });

  } catch (e) {
    if (e?.message === 'PHONE_INVALID') {
      return res.status(400).json({ error: 'PHONE_INVALID' });
    }
    console.error('Signup Error:', e);
    return res.status(500).json({ error: 'SIGNUP_FAILED' });
  }
});

// /me: devuelve datos del usuario (JWT requerido)
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

// /credits/debit: descuenta créditos con transacción (guarda flow/device)
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

// --- Helpers de mensajes (sanitiza y limita) ---
function sanitizeRole(raw) {
  const r = String(raw || '').toLowerCase().trim();
  return (r === 'user' || r === 'assistant') ? r : '';
}
function sanitizeContent(raw) {
  let s = String(raw ?? '');
  s = s.replace(/\s+/g, ' ').trim();         // compacta espacios
  if (s.length > 4000) s = s.slice(0, 4000); // tope 4000 chars
  return s;
}

// --- POST /messages: guarda un turno ---
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

    // Limpieza: mantener solo 100 más recientes (borrado best-effort)
    try {
      const olderSnap = await col.orderBy('ts', 'desc').offset(100).limit(50).get();
      const batch = db.batch();
      olderSnap.forEach(d => batch.delete(d.ref));
      if (!olderSnap.empty) await batch.commit();
    } catch (_) { /* opcional, ignoramos errores de limpieza */ }

    return res.json({ ok: true, id: docRef.id });
  } catch (e) {
    console.error('POST /messages error:', e);
    return res.status(500).json({ error: 'STORE_FAILED' });
  }
});

// --- GET /messages?limit=100: lista turnos (más nuevos primero) ---
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
      return {
        id: d.id,
        role: x.role || '',
        content: x.content || '',
        ts
      };
    });

    return res.json({ items, count: items.length });
  } catch (e) {
    console.error('GET /messages error:', e);
    return res.status(500).json({ error: 'LIST_FAILED' });
  }
});

/* ================================
   START
================================ */
app.listen(PORT, () => {
  console.log(`Auth service running on port ${PORT}`);
});
