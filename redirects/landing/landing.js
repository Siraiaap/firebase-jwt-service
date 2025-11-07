// redirects/landing/landing.js  (v=7)
// Acceso con Google/Facebook + i18n + shortname + ref

/* Helpers */
const qs  = (s, r=document) => r.querySelector(s);
const qsa = (s, r=document) => Array.from(r.querySelectorAll(s));
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));

/* Estado */
const url = new URL(location.href);
const ref = url.searchParams.get('ref');
if (ref) localStorage.setItem('sira_ref', ref);

let LANG = (localStorage.getItem('landing_lang') ||
  ((navigator.language||'es').toLowerCase().startsWith('es')?'es':'en'));

/* i18n inlined (solo strings que mostramos aquí) */
const I18N = {
  es: {
    slogan: 'SiraIA: tu compañera digital que entiende, responde y se adapta a ti.',
    sub: 'Más que un buscador que te llena de ligas, es una Inteligencia Artificial pensada para todos los no expertos: fácil, cálida y directa. Da respuestas útiles de todo tipo sin que necesites saber de tecnología.',
    access_title: 'Elige cómo quieres entrar',
    label_short: 'Ingresa aquí el nombre o diminutivo con el que deseas que SiraIA se dirija a ti.',
    ph_short: 'Ej: Guille, Ana, Sr. Pérez',
    btn_google: 'Continuar con Google',
    btn_fb: 'Continuar con Facebook',
    or: 'o',
    btn_phone: 'Usar mi número',
    legal: 'Al continuar, aceptas los <a href="https://siraia.com/terminos" target="_blank" rel="noopener">Términos</a> y la <a href="https://siraia.com/privacidad" target="_blank" rel="noopener">Política de Privacidad</a>.',
    status_init_missing: 'Nota: falta la configuración de Firebase en esta página. Google/Facebook podrían no funcionar aún.',
    status_auth: 'Autenticando…',
    status_ok: '¡Listo! Redirigiendo al chat…',
    status_fail_popup: 'No se pudo abrir la ventana de acceso. Intenta de nuevo.',
    status_fail_generic: 'No se pudo completar el acceso. Intenta nuevamente.',
  },
  en: {
    slogan: 'SiraIA: your digital companion that understands, answers and adapts to you.',
    sub: 'More than a search engine full of links, it’s an AI designed for non-experts: friendly and direct. It gives useful answers of all kinds with no tech skills required.',
    access_title: 'Choose how you want to sign in',
    label_short: 'Type the name or nickname you want SiraIA to use for you.',
    ph_short: 'e.g., Will, Ana, Mr. Pérez',
    btn_google: 'Continue with Google',
    btn_fb: 'Continue with Facebook',
    or: 'or',
    btn_phone: 'Use my phone number',
    legal: 'By continuing, you accept the <a href="https://siraia.com/terminos" target="_blank" rel="noopener">Terms</a> and <a href="https://siraia.com/privacidad" target="_blank" rel="noopener">Privacy Policy</a>.',
    status_init_missing: 'Note: Firebase configuration is missing on this page. Google/Facebook may not work yet.',
    status_auth: 'Signing in…',
    status_ok: 'Done! Taking you to the chat…',
    status_fail_popup: 'Could not open the sign-in window. Try again.',
    status_fail_generic: 'Sign-in failed. Please try again.',
  }
};

function applyI18n() {
  const t = I18N[LANG];
  document.documentElement.lang = LANG;
  qs('#t-slogan').textContent = t.slogan;
  qs('#t-sub').textContent = t.sub;
  qs('#accessTitle').textContent = t.access_title;
  qs('#t-label').textContent = t.label_short;
  qs('#shortName').placeholder = t.ph_short;
  qs('#btnGoogle').lastChild.textContent = ' ' + t.btn_google;
  qs('#btnFacebook').lastChild.textContent = ' ' + t.btn_fb;
  qs('#t-or').textContent = t.or;
  qs('#btnPhone').textContent = t.btn_phone;
  qs('#t-legal').innerHTML = t.legal;
  qs('#langES').setAttribute('aria-pressed', LANG==='es');
  qs('#langEN').setAttribute('aria-pressed', LANG==='en');
}
function setLang(lang){
  LANG = lang;
  localStorage.setItem('landing_lang', lang);
  applyI18n();
}

/* Idioma UI */
qsa('.lang-switch .chip').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    setLang(btn.id === 'langES' ? 'es':'en');
  });
});
applyI18n();

/* Firebase */
const statusBox = qs('#status');
function showStatus(msg, tone='info'){
  if (!msg) { statusBox.style.display='none'; statusBox.textContent=''; return; }
  statusBox.style.display='block';
  statusBox.innerHTML = msg;
  statusBox.setAttribute('data-tone', tone);
}

let firebaseReady = false;
try {
  if (!window.firebaseConfig) {
    showStatus(I18N[LANG].status_init_missing, 'warn');
  } else {
    // Compat SDK (firebase-app-compat / firebase-auth-compat cargados en index.html)
    const app = firebase.initializeApp(window.firebaseConfig);
    window._siraAuth = firebase.auth(app);
    firebaseReady = true;
  }
} catch (e) {
  console.error('Firebase init error:', e);
  showStatus(I18N[LANG].status_init_missing, 'warn');
}

/* Util: guarda shortname y ref */
function persistUserPrefs(){
  const short = (qs('#shortName').value || '').trim();
  if (short) localStorage.setItem('sira_short_name', short);
  if (ref) localStorage.setItem('sira_ref', ref);
}

/* Llama a /signup con el ID token de Firebase (best-effort) */
async function hitSignup(idToken, provider, profile){
  // Ajusta BASE si tu backend usa otro dominio.
  const BASE = 'https://siraia-auth-credits.onrender.com';
  const body = {
    provider,
    id_token: idToken,
    email: profile?.email || null,
    display_name: profile?.displayName || null,
    short_name: localStorage.getItem('sira_short_name') || null,
    referred_by: localStorage.getItem('sira_ref') || null,
  };
  try{
    const res = await fetch(`${BASE}/signup`, {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify(body),
      credentials: 'omit',
    });
    // No bloqueamos el flujo si no es 200 (solo log)
    console.log('/signup status', res.status);
  }catch(err){
    console.warn('signup call skipped/error', err);
  }
}

/* Flujo OAuth (común) */
async function signInWith(providerName){
  if (!firebaseReady) { showStatus(I18N[LANG].status_init_missing, 'warn'); return; }
  try{
    showStatus(I18N[LANG].status_auth);
    persistUserPrefs();

    let provider;
    if (providerName==='google') {
      provider = new firebase.auth.GoogleAuthProvider();
      provider.addScope('email');
      provider.addScope('profile');
    } else if (providerName==='facebook') {
      provider = new firebase.auth.FacebookAuthProvider();
      provider.addScope('email');
      provider.addScope('public_profile');
    } else {
      throw new Error('unknown provider');
    }

    const result = await window._siraAuth.signInWithPopup(provider);
    const user = result.user;
    const idToken = await user.getIdToken(/* forceRefresh */ true);

    // best-effort: avisamos a backend
    await hitSignup(idToken, providerName, user);

    // guardamos por si el chat lo quiere leer (no es sensible, expira)
    try{ localStorage.setItem('sira_id_token', idToken); }catch{}

    showStatus(I18N[LANG].status_ok, 'ok');
    await sleep(350);
    // Redirige al chat
    const go = new URL('https://siraia.com/', location.origin);
    if (localStorage.getItem('sira_short_name')) {
      go.searchParams.set('name', localStorage.getItem('sira_short_name'));
    }
    location.href = go.toString();
  } catch(err){
    console.error('OAuth error', err);
    if (err && (''+err).toLowerCase().includes('popup')) {
      showStatus(I18N[LANG].status_fail_popup, 'warn');
    } else {
      showStatus(I18N[LANG].status_fail_generic, 'warn');
    }
  }
}

/* Listeners de botones */
qs('#btnGoogle')?.addEventListener('click', ()=>signInWith('google'));
qs('#btnFacebook')?.addEventListener('click', ()=>signInWith('facebook'));

/* Año footer */
const y = qs('#y'); if (y) y.textContent = new Date().getFullYear();
