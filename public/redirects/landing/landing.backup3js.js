/* SiraIA Landing v17
   - ES/EN i18n
   - Google & Facebook (popup)
   - Phone -> https://siraia.com/register.html
   - localStorage: sira_display_name, sira_profile
*/

(function () {
  const $ = (sel) => document.querySelector(sel);
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn);

  // ---------- UI refs ----------
  const elName = $('#displayName');
  const btnGoogle = $('#btnGoogle');
  const btnFacebook = $('#btnFacebook');
  const btnPhone = $('#btnPhone');
  const btnES = $('#btnES');
  const btnEN = $('#btnEN');
  const statusEl = $('#status');

  // ---------- i18n ----------
  const I18N = {
    es: {
      choose: 'Elige cómo quieres entrar',
      howToCallYou: 'Ingresa aquí el nombre o diminutivo con el que deseas que SiraIA se dirija a ti.',
      btnGoogle: 'Continuar con Google',
      btnFacebook: 'Continuar con Facebook',
      btnPhone: 'Usar mi número',
      accept: 'Al continuar, aceptas los',
      and: 'y la',
      errorPopup: 'No se pudo abrir el inicio de sesión. Intenta de nuevo.',
      errorGeneric: 'Ocurrió un error. Intenta más tarde.'
    },
    en: {
      choose: 'Choose how you want to sign in',
      howToCallYou: 'Type the name or nickname you want SiralA to use for you.',
      btnGoogle: 'Continue with Google',
      btnFacebook: 'Continue with Facebook',
      btnPhone: 'Use my phone number',
      accept: 'By continuing, you agree to the',
      and: 'and the',
      errorPopup: 'Couldn’t open the sign-in popup. Try again.',
      errorGeneric: 'Something went wrong. Please try later.'
    }
  };

  function getLang() {
    const fromLS = localStorage.getItem('sira_lang');
    if (fromLS) return fromLS;
    const nav = (navigator.language || 'es').toLowerCase();
    // ES por defecto para ES/LatAm; EN en el resto
    return nav.startsWith('es') ? 'es' : 'en';
  }

  function applyLang(lang) {
    const dict = I18N[lang] || I18N.es;
    document.querySelectorAll('[data-i18n]').forEach((n) => {
      const key = n.getAttribute('data-i18n');
      if (dict[key]) n.textContent = dict[key];
    });
    localStorage.setItem('sira_lang', lang);
    // Placeholder del input
    if (elName) {
      elName.placeholder = lang === 'es'
        ? 'Ej: Guille, Ana, Sr. Pérez'
        : 'e.g., Guille, Ana, Mr. Pérez';
    }
  }

  // ---------- Helpers ----------
  function setStatus(msg, show = true) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.hidden = !show;
  }

  function getDisplayName() {
    return (elName?.value || '').trim();
  }

  function rememberDisplayName() {
    const dn = getDisplayName();
    if (dn) localStorage.setItem('sira_display_name', dn);
    return dn;
  }

  function saveProfile({ provider, email, displayName }) {
    const dn = rememberDisplayName() || displayName || '';
    localStorage.setItem('sira_profile',
      JSON.stringify({ provider, email: email || '', display_name: dn }));
    if (dn) localStorage.setItem('sira_display_name', dn);
  }

  // ---------- Firebase (compat) ----------
  // Requiere que el index.html tenga los <script> de firebase *compat* cargados.
  function ensureFirebase() {
    if (window.firebase?.apps?.length) return window.firebase.app();
    try {
      const app = window.firebase?.initializeApp(window.firebaseConfig || {});
      return app;
    } catch (e) {
      console.warn('Firebase init error:', e);
      return null;
    }
  }

  function doGooglePopup() {
    const app = ensureFirebase();
    if (!app) throw new Error('firebase-not-initialized');
    const auth = window.firebase.auth();
    const provider = new window.firebase.auth.GoogleAuthProvider();
    provider.addScope('email');
    return auth.signInWithPopup(provider);
  }

  function doFacebookPopup() {
    const app = ensureFirebase();
    if (!app) throw new Error('firebase-not-initialized');
    const auth = window.firebase.auth();
    const provider = new window.firebase.auth.FacebookAuthProvider();
    provider.addScope('email'); // requiere testers o app Live en Meta
    return auth.signInWithPopup(provider);
  }

  function afterOAuth(result, providerName) {
    try {
      const user = result?.user;
      const email = user?.email || '';
      const displayName = user?.displayName || '';
      saveProfile({ provider: providerName, email, displayName });
    } catch (e) {
      console.warn('Save profile error:', e);
    }
    // Enviamos al register (otorga 10 créditos si es primera vez)
    const q = new URLSearchParams({ from: 'oauth' });
    window.location.href = `https://siraia.com/register.html?${q.toString()}`;
  }

  // ---------- Eventos ----------
  on(btnES, 'click', () => applyLang('es'));
  on(btnEN, 'click', () => applyLang('en'));

  on(btnGoogle, 'click', async () => {
    try {
      setStatus('', false);
      rememberDisplayName();
      const res = await doGooglePopup();
      afterOAuth(res, 'google');
    } catch (e) {
      console.warn('Google popup error:', e);
      const lang = getLang();
      const msg = (e && (e.code === 'auth/popup-closed-by-user' || e.message?.includes('popup')))
        ? I18N[lang].errorPopup
        : I18N[lang].errorGeneric;
      setStatus(msg, true);
    }
  });

  on(btnFacebook, 'click', async () => {
    try {
      setStatus('', false);
      rememberDisplayName();
      const res = await doFacebookPopup();
      afterOAuth(res, 'facebook');
    } catch (e) {
      console.warn('Facebook popup error:', e);
      const lang = getLang();
      const msg = (e && (e.code === 'auth/popup-closed-by-user' || e.message?.includes('popup')))
        ? I18N[lang].errorPopup
        : I18N[lang].errorGeneric;
      setStatus(msg, true);
    }
  });

  on(btnPhone, 'click', () => {
    const name = getDisplayName();
    const q = new URLSearchParams({
      method: 'phone',
      from: 'siraia.app',
      display_name: name
    });
    window.location.href = `https://siraia.com/register.html?${q.toString()}`;
  });

  // ---------- Init ----------
  (function init() {
    // Nombre guardado previamente
    const prev = localStorage.getItem('sira_display_name');
    if (prev && elName && !elName.value) elName.value = prev;
    applyLang(getLang());
    // Build tag para caché
    console.log('SiraIA landing build v17');
  })();
})();
