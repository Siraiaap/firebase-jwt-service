const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { parsePhoneNumberFromString } = require('libphonenumber-js');

let serviceAccount = null;
try {
  // Carga las credenciales desde el Secret File de Render
  serviceAccount = require('/etc/secrets/google-credentials.json');
} catch (e) {
  console.error('❌ No pude leer /etc/secrets/google-credentials.json:', e?.message);
}

// ✅ **INICIO: BLOQUE DE INICIALIZACIÓN DE FIREBASE CORREGIDO**
const admin = require('firebase-admin');

let serviceAccount;
try {
  // Lee las credenciales desde el Secret File de Render
  serviceAccount = require('/etc/secrets/google-credentials.json');
} catch(e) {
  console.error("Error crítico: No se pudo cargar el archivo de credenciales.", e.message);
}

// Inicializa la app de Firebase con las credenciales Y el ID del proyecto
if (!admin.apps.length) {
  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      // AÑADIMOS ESTA LÍNEA PARA EVITAR AMBIGÜEDAD
      projectId: serviceAccount.project_id, 
    });
    console.log(`Firebase Admin inicializado para el proyecto: ${serviceAccount.project_id}`);
  } else {
    console.error("No se inicializó Firebase Admin porque faltan las credenciales.");
  }
}
const db = admin.firestore();
// ✅ **FIN: BLOQUE DE INICIALIZACIÓN DE FIREBASE CORREGIDO**

// ⚠️ Parche para problemas de conexión en Render (gRPC vs REST)
try {
  db.settings({ ignoreUndefinedProperties: true, preferRest: true });
  console.log('🔥 Configuración de Firestore: preferRest=true aplicada.');
} catch (e) {
  console.warn('⚠️ No se pudo aplicar preferRest (esto puede ser normal en versiones antiguas del SDK):', e?.message);
}


// ===== Configuración (leída desde las variables de entorno de Render) =====
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_TTL = process.env.JWT_TTL || '7d';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const DEFAULT_COUNTRY = process.env.DEFAULT_COUNTRY || 'MX';
const INITIAL_CREDITS = Number(process.env.INITIAL_CREDITS || 10);

// ===== App Express y Middlewares =====
const app = express();
app.use(helmet());
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '10mb' }));

function auth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'NO_TOKEN' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'TOKEN_INVALID' });
  }
}

// ===== Funciones de Ayuda =====
function toE164(raw, defaultCountry = DEFAULT_COUNTRY) {
  const p = parsePhoneNumberFromString(String(raw || ''), defaultCountry);
  if (!p || !p.isValid()) throw new Error('PHONE_INVALID');
  return p.number;
}

function phoneHash(e164) {
  return crypto.createHash('sha256').update(e164).digest('hex');
}


// ===== Rutas de la API =====

// --- RUTA DE DIAGNÓSTICO PARA VERIFICAR LA CONEXIÓN ---
app.get('/diag/firestore', async (_req, res) => {
  const ref = db.collection('_diag').doc(`ping-${Date.now()}`);
  const t0 = Date.now();
  try {
    await ref.set({ at: admin.firestore.Timestamp.now(), ok: true });
    const snap = await ref.get();
    const t1 = Date.now();
    console.log(`[DIAG] Conexión con Firestore exitosa en ${t1 - t0}ms`);
    return res.json({
      ok: true,
      wrote: true,
      read: snap.exists,
      elapsed_ms: t1 - t0,
      project: serviceAccount?.project_id || null,
    });
  } catch (e) {
    console.error(`[DIAG] Falló la conexión con Firestore en ${Date.now() - t0}ms:`, e);
    return res.status(500).json({ ok: false, error: String(e), elapsed_ms: Date.now() - t0 });
  }
});

// --- RUTA SIGNUP (CON LOGS ADICIONALES) ---
app.post('/signup', async (req, res) => {
  try {
    const { display_name, phone, accept } = req.body || {};
    if (!accept) return res.status(409).json({ error: 'TERMS_NOT_ACCEPTED' });
    if (!display_name || !phone) return res.status(400).json({ error: 'MISSING_FIELDS' });

    const phone_e164 = toE164(phone, DEFAULT_COUNTRY);
    const userId = phoneHash(phone_e164);

    console.log(`[SIGNUP] Iniciando para proyecto=${serviceAccount?.project_id}, userId=${userId}`);

    const userRef = db.collection('users').doc(userId);
    const t0 = Date.now();
    console.log(`[SIGNUP] Consultando Firestore para el usuario...`);
    const userDoc = await userRef.get();
    const tGet = Date.now() - t0;
    console.log(`[SIGNUP] Consulta a Firestore tomó ${tGet}ms.`);

    let userData;
    if (!userDoc.exists) {
      console.log(`[SIGNUP] Usuario no existe. Creando nuevo documento...`);
      userData = {
        display_name,
        phone_e164,
        credits_remaining: INITIAL_CREDITS,
        credits_total: INITIAL_CREDITS,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      };
      await userRef.set(userData);
      console.log(`[SIGNUP] Documento creado.`);
    } else {
      console.log(`[SIGNUP] Usuario encontrado.`);
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

// --- RUTA /ME ---
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

// --- RUTA /CREDITS/DEBIT ---
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