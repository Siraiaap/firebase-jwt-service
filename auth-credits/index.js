const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { parsePhoneNumberFromString } = require('libphonenumber-js');

// ===== Inicialización de Firebase =====
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// ===== Configuración (leída desde las variables de entorno de Render) =====
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_TTL = process.env.JWT_TTL || '7d';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const DEFAULT_COUNTRY = process.env.DEFAULT_COUNTRY || 'MX';
const INITIAL_CREDITS = Number(process.env.INITIAL_CREDITS || 10);

// ===== App Express =====
const app = express();
app.use(helmet());
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '10mb' }));

// ===== Middleware de Autenticación (El "guardia de seguridad") =====
function auth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'NO_TOKEN' });

  try {
    // Verificamos que el token sea válido con nuestra llave secreta
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // Inyectamos los datos del usuario en la petición
    next(); // Damos paso a la siguiente función
  } catch (e) {
    return res.status(401).json({ error: 'TOKEN_INVALID' });
  }
}

// ===== Funciones de Ayuda =====
function toE164(raw, defaultCountry = DEFAULT_COUNTRY) {
  const p = parsePhoneNumberFromString(String(raw || ''), defaultCountry);
  if (!p || !p.isValid()) throw new Error('PHONE_INVALID');
  return p.number; // Devuelve formato E.164 (ej. +525512345678)
}

function phoneHash(e164) {
  // Crea un ID de usuario único y anónimo a partir del teléfono
  return crypto.createHash('sha256').update(e164).digest('hex');
}

// ===== Rutas de la API =====

// Ruta para verificar que el servicio está vivo
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// --- RUTA SIGNUP (CORREGIDA CON FIRESTORE) ---
app.post('/signup', async (req, res) => {
  try {
    const { display_name, phone, accept } = req.body || {};
    if (!accept) return res.status(409).json({ error: 'TERMS_NOT_ACCEPTED' });
    if (!display_name || !phone) return res.status(400).json({ error: 'MISSING_FIELDS' });

    const phone_e164 = toE164(phone, DEFAULT_COUNTRY);
    const userId = phoneHash(phone_e164); // Usamos el hash del teléfono como ID

    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    let userData;

    if (!userDoc.exists) {
      // El usuario es nuevo, lo creamos
      userData = {
        display_name,
        phone_e164,
        credits_remaining: INITIAL_CREDITS,
        credits_total: INITIAL_CREDITS,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      };
      await userRef.set(userData);
    } else {
      // El usuario ya existe, solo obtenemos sus datos
      userData = userDoc.data();
    }

    const token = jwt.sign({ sub: userId, phone_e164, display_name }, JWT_SECRET, { expiresIn: JWT_TTL });
    
    res.json({
      user: {
        id: userId,
        display_name: userData.display_name,
        phone_e164: userData.phone_e164,
        credits_remaining: userData.credits_remaining
      },
      jwt: token
    });

  } catch (e) {
    if (e.message === 'PHONE_INVALID') return res.status(400).json({ error: 'PHONE_INVALID' });
    console.error("Signup Error:", e);
    res.status(500).json({ error: 'SIGNUP_FAILED' });
  }
});

// --- RUTA /ME (CORREGIDA CON FIRESTORE) ---
app.get('/me', auth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: 'USER_NOT_FOUND' });
    }
    
    const userData = userDoc.data();
    res.json({
      user: {
        id: userId,
        display_name: userData.display_name,
        phone_e164: userData.phone_e164,
        credits_remaining: userData.credits_remaining,
        credits_total: userData.credits_total
      }
    });
  } catch (e) {
    console.error("Me Error:", e);
    res.status(500).json({ error: 'ME_FAILED' });
  }
});

// --- RUTA /CREDITS/DEBIT (YA ESTABA BIEN) ---
app.post('/credits/debit', auth, async (req, res) => {
  const userId = req.user.sub;
  const amount = Number(req.body?.amount || 1);

  if (!userId || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'BAD_REQUEST' });
  }

  const userRef = db.collection('users').doc(userId);

  try {
    const transactionResult = await db.runTransaction(async (tx) => {
      const userDoc = await tx.get(userRef);
      if (!userDoc.exists) throw new Error('USER_NOT_FOUND');

      const userData = userDoc.data();
      const currentCredits = Number(userData.credits_remaining || 0);

      if (currentCredits < amount) {
        return {
          status: 402,
          body: { ok: false, error: 'NO_CREDITS', credits_remaining: currentCredits, credits_total: userData.credits_total },
        };
      }
      
      const newRemaining = currentCredits - amount;
      tx.update(userRef, { credits_remaining: newRemaining });

      return {
        status: 200,
        body: { ok: true, credits_remaining: newRemaining, credits_total: userData.credits_total },
      };
    });

    return res.status(transactionResult.status).json(transactionResult.body);

  } catch (err) {
    if (err.message === 'USER_NOT_FOUND') return res.status(404).json({ error: 'USER_NOT_FOUND' });
    console.error('DEBIT_ERROR', err);
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
  }
});

// ===== Iniciar Servidor =====
app.listen(PORT, () => {
  console.log(`Auth service running on port ${PORT}`);
});