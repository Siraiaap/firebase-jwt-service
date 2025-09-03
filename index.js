const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { parsePhoneNumberFromString } = require('libphonenumber-js');

/* =========================
   FIREBASE ADMIN (Render)
   ========================= */
try {
  const serviceAccount = require('/etc/secrets/google-credentials.json');
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
} catch (e) {
  console.error('Error al inicializar Firebase Admin SDK:', e);
  console.log('Asegúrate de que el Secret File "google-credentials.json" esté configurado en Render.');
}
const db = admin.firestore();

/* =========================
   CONFIG (ENV Render)
   ========================= */
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_TTL = process.env.JWT_TTL || '7d';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const DEFAULT_COUNTRY = process.env.DEFAULT_COUNTRY || 'MX';
const INITIAL_CREDITS = Number(process.env.INITIAL_CREDITS || 10);

/* =========================
   APP
   ========================= */
const app = express();
app.use(helmet());
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '10mb' }));

/* =========================
   AUTH MIDDLEWARE
   ========================= */
function auth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'NO_TOKEN' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'TOKEN_INVALID' });
  }
}

/* =========================
   HELPERS
   ========================= */
function toE164(raw, defaultCountry = DEFAULT_COUNTRY) {
  const p = parsePhoneNumberFromString(String(raw || ''), defaultCountry);
  if (!p || !p.isValid()) throw new Error('PHONE_INVALID');
  return p.number; // ej. +525511223344
}
function phoneHash(e164) {
  return crypto.createHash('sha256').update(e164).digest('hex');
}
// Normaliza y valida nombre corto (2–32, letras con acentos/números/espacio/-/./’)
function normalizeDisplayName(raw) {
  const txt = String(raw || '').trim();
  if (!txt) return '';
  if (txt.length < 2 || txt.length > 32) return '';
  const ok = /^[\p{L}\p{N}\s\-\.’]+$/u.test(txt);
  if (!ok) return '';
  return txt.replace(/\s+/g, ' ');
}

/* =========================
   RUTAS
   ========================= */

// Health con sello para verificar despliegue
app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now(), marker: 'signup_v2', project: 'siraia' });
});

/* --- SIGNUP (alta o re-login, con actualización de apodo) --- */
app.post('/signup', async (req, res) => {
  try {
    // Soportar phone o phone_e164 desde el front
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

    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    let userData;
    let isNew = false;

    if (!userDoc.exists) {
      // Alta nueva → crear doc y otorgar créditos iniciales
      isNew = true;
      userData = {
        display_name,
        phone_e164,
        credits_remaining: INITIAL_CREDITS,
        credits_total: INITIAL_CREDITS,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      };
      await userRef.set(userData);
    } else {
      // Re-login → no regalar créditos; actualizar apodo si cambió
      userData = userDoc.data() || {};

      // Asegura que se guarde phone_e164 si faltara (compat)
      if (!userData.phone_e164) {
        await userRef.set({ phone_e164 }, { merge: true });
        userData.phone_e164 = phone_e164;
      }

      // Defaults de créditos si faltan (compat)
      if (userData.credits_total == null) userData.credits_total = INITIAL_CREDITS;
      if (userData.credits_remaining == null) userData.credits_remaining = INITIAL_CREDITS;

      if (display_name && display_name !== userData.display_name) {
        await userRef.update({ display_name });
        userData.display_name = display_name;
      }
    }

    // JWT – mantenemos display_name por compatibilidad con front existentes
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
        credits_remaining: Number(userData.credits_remaining),
        credits_total: Number(userData.credits_total)
      },
      jwt: token,
      is_new: isNew,
      credits_awarded: isNew ? INITIAL_CREDITS : 0
    });

  } catch (e) {
    if (e.message === 'PHONE_INVALID') return res.status(400).json({ error: 'PHONE_INVALID' });
    console.error('Signup Error:', e);
    return res.status(500).json({ error: 'SIGNUP_FAILED' });
  }
});

/* --- ME (perfil + créditos) --- */
app.get('/me', auth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) return res.status(404).json({ error: 'USER_NOT_FOUND' });

    const u = userDoc.data() || {};
    return res.json({
      user: {
        id: userId,
        display_name: u.display_name,
        phone_e164: u.phone_e164,
        credits_remaining: Number(u.credits_remaining),
        credits_total: Number(u.credits_total)
      }
    });
  } catch (e) {
    console.error('Me Error:', e);
    return res.status(500).json({ error: 'ME_FAILED' });
  }
});

/* --- CREDITS / DEBIT --- */
app.post('/credits/debit', auth, async (req, res) => {
  const userId = req.user.sub;
  const amount = Number(req.body?.amount || 1);

  if (!userId || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'BAD_REQUEST' });
  }

  const userRef = db.collection('users').doc(userId);

  try {
    const result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(userRef);
      if (!doc.exists) throw new Error('USER_NOT_FOUND');

      const data = doc.data() || {};
      const current = Number(data.credits_remaining || 0);

      if (current < amount) {
        return {
          status: 402,
          body: { ok: false, error: 'NO_CREDITS', credits_remaining: current, credits_total: data.credits_total }
        };
      }

      const newRemaining = current - amount;
      tx.update(userRef, { credits_remaining: newRemaining });

      return {
        status: 200,
        body: { ok: true, credits_remaining: newRemaining, credits_total: data.credits_total }
      };
    });

    return res.status(result.status).json(result.body);

  } catch (err) {
    if (err.message === 'USER_NOT_FOUND') return res.status(404).json({ error: 'USER_NOT_FOUND' });
    console.error('DEBIT_ERROR', err);
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
  }
});

/* --- START --- */
app.listen(PORT, () => {
  console.log(`Auth service running on port ${PORT}`);
});
