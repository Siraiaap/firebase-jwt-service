const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { parsePhoneNumberFromString } = require('libphonenumber-js');

// ===== Config =====
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const JWT_TTL = process.env.JWT_TTL || '7d';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const DEFAULT_COUNTRY = process.env.DEFAULT_COUNTRY || 'MX';
const INITIAL_CREDITS = Number(process.env.INITIAL_CREDITS || 10);

// ===== App =====
const app = express();
app.use(helmet());
app.use(cors({
  origin: (origin, cb) => {
    // permite lista separada por comas o '*'
    if (!origin || CORS_ORIGIN === '*') return cb(null, true);
    const allowed = CORS_ORIGIN.split(',').map(s => s.trim());
    return cb(null, allowed.includes(origin));
  },
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// ===== In-memory store (Paso 1: temporal; Paso 2: Firestore) =====
const users = new Map();   // userId -> { display_name, phone_e164, email }
const credits = new Map(); // userId -> number
const ledger = new Map();  // requestId -> { userId, amount }

// ===== Helpers =====
function toE164(raw, defaultCountry = DEFAULT_COUNTRY) {
  const p = parsePhoneNumberFromString(String(raw || ''), defaultCountry);
  if (!p || !p.isValid()) throw new Error('PHONE_INVALID');
  return p.number; // formato E.164
}

function phoneHash(e164) {
  return crypto.createHash('sha256').update(e164).digest('hex');
}

function signJWT(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_TTL });
}

function verifyJWTFromHeader(req) {
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) throw new Error('NO_TOKEN');
  try { return jwt.verify(token, JWT_SECRET); }
  catch { throw new Error('TOKEN_INVALID'); }
}

function ensureRequestId(req) {
  const hdr = req.header('x-request-id') || req.header('X-Request-ID');
  const fromBody = req.body && req.body.requestId;
  const id = String(hdr || fromBody || '');
  const isUuid = /^[a-f0-9-]{36}$/i.test(id);
  return isUuid ? id : crypto.randomUUID();
}

// ===== Routes =====
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// Registro / upsert → devuelve JWT
app.post('/signup', (req, res) => {
  try {
    const { display_name, phone, email, accept } = req.body || {};
    if (!accept) return res.status(409).json({ error: 'TERMS_NOT_ACCEPTED' });
    if (!display_name || !phone) return res.status(400).json({ error: 'MISSING_FIELDS' });

    const phone_e164 = toE164(phone, DEFAULT_COUNTRY);
    const id = phoneHash(phone_e164);

    users.set(id, { display_name, phone_e164, email: email || null });
    if (!credits.has(id)) credits.set(id, INITIAL_CREDITS);

    const token = signJWT({ sub: id, phone_e164, display_name });
    res.json({ user: { id, display_name, phone_e164, credits_remaining: credits.get(id) }, jwt: token });
  } catch (e) {
    if (e.message === 'PHONE_INVALID') return res.status(400).json({ error: 'PHONE_INVALID' });
    res.status(500).json({ error: 'SIGNUP_FAILED' });
  }
});

// Perfil
app.get('/me', (req, res) => {
  try {
    const decoded = verifyJWTFromHeader(req);
    const id = decoded.sub;
    const u = users.get(id);
    if (!u) return res.status(404).json({ error: 'USER_NOT_FOUND' });
    res.json({ user: { ...u, id, credits_remaining: credits.get(id) ?? 0 } });
  } catch (e) {
    const code = e.message === 'NO_TOKEN' || e.message === 'TOKEN_INVALID' ? 401 : 500;
    res.status(code).json({ error: e.message });
  }
});

// Descuento idempotente (1 crédito por request)
app.post('/credits/debit', (req, res) => {
  try {
    const decoded = verifyJWTFromHeader(req);
    const id = decoded.sub;
    if (!users.get(id)) return res.status(404).json({ error: 'USER_NOT_FOUND' });

    const requestId = ensureRequestId(req);
    if (ledger.has(requestId)) {
      return res.json({ ok: true, requestId, idempotent: true, credits_remaining: credits.get(id) ?? 0 });
    }

    const current = credits.get(id) ?? 0;
    if (current <= 0) return res.status(402).json({ error: 'NO_CREDITS' });

    credits.set(id, current - 1);
    ledger.set(requestId, { userId: id, amount: 1, createdAt: Date.now() });

    res.json({ ok: true, requestId, credits_remaining: credits.get(id) ?? 0 });
  } catch (e) {
    const code = e.message === 'NO_TOKEN' || e.message === 'TOKEN_INVALID' ? 401 : 500;
    res.status(code).json({ error: e.message === 'NO_TOKEN' ? 'NO_TOKEN' : e.message === 'TOKEN_INVALID' ? 'TOKEN_INVALID' : 'DEBIT_FAILED' });
  }
});

app.listen(PORT, () => {
  console.log(`SiraIA auth/credits running on :${PORT}`);
});
