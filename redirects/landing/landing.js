/* redirects/landing/landing.js — v9
   - i18n ES/EN básico
   - Referidos (?ref) propagados a CTAs
   - Login social (Google/Facebook) -> /signup -> guarda sira_jwt + redirige a chat
   - Fallback a /register.html si el backend no devuelve jwt
*/

const qs = (s, r = document) => r.querySelector(s);
const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));

// ------------------ Config ------------------
const AUTH_BASE = 'https://siraia-auth-credits.onrender.com';
const CHAT_URL = 'https://siraia.com/';
const REGISTER_URL = 'https://siraia.com/register.html';

// Idioma
const LANG_DEFAULT = (navigator.language || 'es').toLowerCase().startsWith('es') ? 'es' : 'en';
let LANG = localStorage.getItem('landing_lang') || LANG_DEFAULT;

// Ref de referidos
const url = new URL(location.href);
const REF = (()=>{
  const v = url.searchParams.get('ref');
  if (!v) return localStorage.getItem('sira_ref') || '';
  // sanea y persiste
  const safe = v.replace(/[^A-Za-z0-9_.\-:=+]/g, '').slice(0,80);
  localStorage.setItem('sira_ref', safe);
  return safe;
})();

// Nombre preferido (input)
const getPreferredName = () => {
  const raw = (qs('#prefName')?.value || '').trim();
  const limited = raw.slice(0,40);
  return limited || (LANG==='es' ? 'amig@' : 'friend');
};

// ------------------ i18n ------------------
const I18N = {
  es: {
    hero_title: 'SiralA: tu compañera digital que entiende, responde y se adapta a ti.',
    hero_desc: 'Más que un buscador que te llena de ligas, es una Inteligencia Artificial pensada para todos los no expertos: fácil, cálida y directa. Da respuestas útiles de todo tipo sin que necesites saber de tecnología.',
    btn_google: 'Continuar con Google',
    btn_facebook: 'Continuar con Facebook',
    btn_phone: 'Usar mi número',
    note_terms: 'Al continuar, aceptas los <a href="https://siraia.com/terminos" target="_blank" rel="noopener">Términos</a> y la <a href="https://siraia.com/privacidad" target="_blank" rel="noopener">Política de Privacidad</a>.',
    placeholder_name: 'Ej: Guille, Ana, Sr. Pérez'
  },
  en: {
    hero_title: 'SiralA: your digital companion that understands, answers and adapts to you.',
    hero_desc: 'More than a search engine that floods you with links, it’s an AI designed for non-experts: simple, warm and direct. It gives useful answers without you needing to know about technology.',
    btn_google: 'Continue with Google',
    btn_facebook: 'Continue with Facebook',
    btn_phone: 'Use my phone number',
    note_terms: 'By continuing, you agree to the <a href="https://siraia.com/terminos" target="_blank" rel="noopener">Terms</a> and <a href="https://siraia.com/privacidad" target="_blank" rel="noopener">Privacy Policy</a>.',
    placeholder_name: 'e.g., Will, Ana, Mr. Perez'
  }
};

function applyI18n() {
  const dict = I18N[LANG] || I18N.es;
  const t = (k)=> dict[k] || I18N.es[k] || '';
  const safeSet = (sel, html)=> { const el = qs(sel); if (el) el.innerHTML = html; };
  safeSet('[data-i18n="hero_title"]', t('hero_title'));
  safeSet('[data-i18n="hero_desc"]', t('hero_desc'));
  safeSet('#btnGoogle span', t('btn_google'));
  safeSet('#btnFacebook span', t('btn_facebook'));
  safeSet('#btnPhone span', t('btn_phone'));
  safeSet('#noteTerms', t('note_terms'));
  const pref = qs('#prefName');
  if (pref) pref.placeholder = t('placeholder_name');
  document.documentElement.lang = LANG;
}

function setLang(lang) {
  LANG = lang;
  localStorage.setItem('landing_lang', lang);
  applyI18n();
}
window.addEventListener('DOMContentLoaded', ()=>{
  qs('#langES')?.addEventListener('click', ()=>setLang('es'));
  qs('#langEN')?.addEventListener('click', ()=>setLang('en'));
});

// ------------------ Propaga ?ref a CTAs ------------------
function withRef(href) {
  if (!REF) return href;
  const u = new URL(href, location.origin);
  u.searchParams.set('ref', REF);
  return u.toString();
}
function wireCTAs() {
  ['btnPhoneLink', 'brandLink'].forEach(id=>{
    const a = qs('#'+id);
    if (a) a.href = withRef(a.href);
  });
}

// ------------------ Firebase (Google/Facebook) ------------------
let fbApp, fbAuth, providers = {};
function initFirebaseIfNeeded() {
  // Requiere que window.firebaseConfig esté definido en <head>
  if (!window.firebaseConfig) return false;
  try {
    // SDK compat (v9 namespaced) o modular (v9+)
    // Usamos compat por simplicidad en esta landing.
    // global firebase proviene de /__/firebase/init.js o script del SDK que tengas cargado.
    if (window.firebase?.apps?.length) {
      fbApp = window.firebase.app();
    } else {
      fbApp = window.firebase.initializeApp(window.firebaseConfig);
    }
    fbAuth = window.firebase.auth();

    // Persistencia local para mantener sesión
    fbAuth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);

    providers.google = new window.firebase.auth.GoogleAuthProvider();
    providers.facebook = new window.firebase.auth.FacebookAuthProvider();
    return true;
  } catch(e){
    console.warn('Firebase init error:', e);
    return false;
  }
}

async function doPopup(providerKey){
  if (!fbAuth || !providers[providerKey]) throw new Error('auth_not_ready');
  const prov = providers[providerKey];
  // Opcional: hint del idioma
  fbAuth.useDeviceLanguage();
  const cred = await fbAuth.signInWithPopup(prov);
  const user = cred?.user;
  if (!user) throw new Error('no_user');
  // Datos básicos
  const profile = user.providerData?.[0] || {};
  return {
    email: profile.email || user.email || '',
    displayName: getPreferredName() || profile.displayName || user.displayName || '',
    provider: providerKey
  };
}

// ------------------ Backend /signup ------------------
async function postSignupSocial({email, displayName, provider}) {
  const payload = {
    email,
    display_name: displayName,
    provider,
    referred_by: REF || null,
    phone_e164: null
  };
  const res = await fetch(`${AUTH_BASE}/signup`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(payload)
  });
  // Aceptamos 200–299; si backend retorna 200 con cuerpo {jwt,...}
  if (!res.ok) throw new Error(`signup_status_${res.status}`);
  const data = await res.json().catch(()=> ({}));
  return data;
}

function persistSession({jwt, displayName, email, provider}) {
  if (jwt) localStorage.setItem('sira_jwt', jwt);
  if (displayName) localStorage.setItem('sira_display_name', displayName);
  const profile = { display_name: displayName || '', email: email || '', provider: provider || '' };
  localStorage.setItem('sira_profile', JSON.stringify(profile));
}

function goChat(displayName){
  const name = displayName || localStorage.getItem('sira_display_name') || '';
  const u = new URL(CHAT_URL);
  if (name) u.searchParams.set('name', name);
  location.href = u.toString();
}

function goRegisterFallback(displayName, email, provider){
  const u = new URL(REGISTER_URL);
  if (displayName) u.searchParams.set('name', displayName);
  if (email) u.searchParams.set('email', email);
  if (provider) u.searchParams.set('from', provider);
  if (REF) u.searchParams.set('ref', REF);
  location.href = u.toString();
}

// ------------------ Handlers de botones ------------------
async function onLogin(providerKey){
  const btn = providerKey === 'google' ? qs('#btnGoogle') : qs('#btnFacebook');
  if (btn) btn.disabled = true;
  try{
    // 1) Firebase popup
    const social = await doPopup(providerKey);
    // 2) Llamar /signup → debe devolver jwt (y activar créditos si es nuevo)
    const data = await postSignupSocial({
      email: social.email,
      displayName: social.displayName,
      provider: social.provider
    });

    // 3) Persistir sesión si backend devolvió jwt
    if (data && data.jwt) {
      persistSession({
        jwt: data.jwt,
        displayName: social.displayName,
        email: social.email,
        provider: social.provider
      });
      // 4) Ir al chat
      goChat(social.displayName);
      return;
    }

    // 5) Fallback si no hay jwt: completar en register.html
    console.warn('Backend no devolvió jwt. Fallback a register.html');
    goRegisterFallback(social.displayName, social.email, social.provider);
  }catch(err){
    console.error('login_social_error', err);
    // Fallback de emergencia
    goRegisterFallback(getPreferredName(), '', providerKey);
  }finally{
    if (btn) btn.disabled = false;
  }
}

// ------------------ Init ------------------
(function init(){
  // Idioma
  applyI18n();

  // Propagar ref a links visibles
  wireCTAs();

  // Idioma load de botones
  qs('#langES')?.setAttribute('aria-pressed', LANG==='es');
  qs('#langEN')?.setAttribute('aria-pressed', LANG==='en');

  // Menú hamburguesa (si existe)
  const menuBtn = qs('#menuBtn'), menu = qs('#menu');
  if (menuBtn && menu){
    menuBtn.addEventListener('click', ()=> menu.classList.toggle('open'));
  }

  // Firebase (si hay config en head)
  const ok = initFirebaseIfNeeded();
  if (!ok){
    console.warn('FirebaseConfig no presente; botones social no funcionarán.');
  }

  // Clicks
  qs('#btnGoogle')?.addEventListener('click', ()=> onLogin('google'));
  qs('#btnFacebook')?.addEventListener('click', ()=> onLogin('facebook'));

  // Botón “Usar mi número” mantiene el ref
  const phoneA = qs('#btnPhoneLink');
  if (phoneA) phoneA.href = withRef(REGISTER_URL);
})();
