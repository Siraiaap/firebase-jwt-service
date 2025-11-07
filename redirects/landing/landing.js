// redirects/landing/landing.js — v6
(function(){
  const qs  = (s, r=document)=>r.querySelector(s);
  const qsa = (s, r=document)=>Array.from(r.querySelectorAll(s));

  // Año
  qs('#y')?.textContent = new Date().getFullYear();

  // Idioma
  const DICT = {
    es: {
      slogan: 'SiraIA: tu compañera digital que entiende, responde y se adapta a ti.',
      sub: 'Más que un buscador que te llena de ligas, es una Inteligencia Artificial pensada para todos los no expertos: fácil, cálida y directa. Da respuestas útiles de todo tipo sin que necesites saber de tecnología.',
      accessTitle: 'Elige cómo quieres entrar',
      label: 'Ingresa aquí el nombre o diminutivo con el que deseas que SiraIA se dirija a ti.',
      ph: 'Ej: Guille, Ana, Sr. Pérez',
      g: 'Continuar con Google',
      f: 'Continuar con Facebook',
      or: 'o',
      phone: 'Usar mi número',
      statusNoConfig: 'Nota: falta la configuración de Firebase en esta página. Google/Facebook podrían no funcionar aún.',
      statusInitFail: 'No fue posible inicializar servicios.',
      statusNoAuth: 'Falta la configuración de Firebase. No es posible continuar con Google/Facebook.',
      statusCanceled: 'Se canceló o falló el acceso.',
      statusClosed: 'Cerraste la ventana antes de terminar.',
      legal: 'Al continuar, aceptas los <a href="https://siraia.com/terminos" target="_blank" rel="noopener">Términos</a> y la <a href="https://siraia.com/privacidad" target="_blank" rel="noopener">Política de Privacidad</a>.'
    },
    en: {
      slogan: 'SiraIA: your digital companion that understands, answers, and adapts to you.',
      sub: 'More than a search engine that fills the page with links, it’s an AI designed for non-experts: simple, warm, and direct. It gives useful answers without you needing to know about technology.',
      accessTitle: 'Choose how you want to sign in',
      label: 'Type the name or nickname you want SiraIA to use for you.',
      ph: 'e.g., Will, Ana, Mr. Pérez',
      g: 'Continue with Google',
      f: 'Continue with Facebook',
      or: 'or',
      phone: 'Use my phone number',
      statusNoConfig: 'Note: Firebase config is missing on this page. Google/Facebook may not work yet.',
      statusInitFail: 'Could not initialize services.',
      statusNoAuth: 'Firebase config missing. Cannot continue with Google/Facebook.',
      statusCanceled: 'Sign-in was canceled or failed.',
      statusClosed: 'You closed the popup before finishing.',
      legal: 'By continuing, you agree to the <a href="https://siraia.com/terminos" target="_blank" rel="noopener">Terms</a> and <a href="https://siraia.com/privacidad" target="_blank" rel="noopener">Privacy Policy</a>.'
    }
  };

  const LANG_DEFAULT = (navigator.language||'es').toLowerCase().startsWith('es') ? 'es' : 'en';
  let LANG = localStorage.getItem('landing_lang') || LANG_DEFAULT;

  function applyI18n(){
    const d = DICT[LANG];
    qs('#t-slogan') && (qs('#t-slogan').textContent = d.slogan);
    qs('#t-sub') && (qs('#t-sub').textContent = d.sub);
    qs('#accessTitle') && (qs('#accessTitle').textContent = d.accessTitle);
    const label = qs('#t-label'); if (label) label.textContent = d.label;
    const input = qs('#shortName'); if (input) input.placeholder = d.ph;
    const g = qs('#btnGoogle'); const f = qs('#btnFacebook'); const p = qs('#btnPhone');
    if (g) g.innerHTML = `<img class="btn-icon" alt="" src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" /> ${d.g}`;
    if (f) f.innerHTML = `<img class="btn-icon" alt="" src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/facebook.svg" /> ${d.f}`;
    if (qs('#t-or')) qs('#t-or').textContent = d.or;
    if (p) p.textContent = d.phone;
    const legal = qs('#t-legal'); if (legal) legal.innerHTML = d.legal;
    document.documentElement.lang = LANG;
    qs('#langES')?.setAttribute('aria-pressed', String(LANG==='es'));
    qs('#langEN')?.setAttribute('aria-pressed', String(LANG==='en'));
  }

  function setLang(lang){ LANG = lang; localStorage.setItem('landing_lang', lang); applyI18n(); }
  qs('#langES')?.addEventListener('click', ()=>setLang('es'));
  qs('#langEN')?.addEventListener('click', ()=>setLang('en'));
  applyI18n();

  // Captura de ?ref
  const url = new URL(location.href);
  const ref = url.searchParams.get('ref');
  if (ref) { try { localStorage.setItem('sira_ref', ref); } catch {} }
  const referred_by = localStorage.getItem('sira_ref') || '';

  // Nombre preferido
  const $short = qs('#shortName');
  const savedName = localStorage.getItem('sira_display_name');
  if ($short && savedName) $short.value = savedName;

  // Status UI
  const $status = qs('#status');
  function showStatus(msg){
    if (!$status) return;
    $status.style.display = 'block';
    $status.style.borderColor = '#e2b4b4';
    $status.style.background = '#fff0f0';
    $status.innerHTML = msg;
  }
  function okStatus(msg){
    if (!$status) return;
    $status.style.display = 'block';
    $status.style.borderColor = '#b7d8c3';
    $status.style.background = '#eaf6ef';
    $status.textContent = msg;
  }
  function hideStatus(){ if($status){ $status.style.display='none'; } }

  // Firebase init
  let auth;
  try{
    // eslint-disable-next-line no-undef
    if (window.firebase && window.firebase.initializeApp && window.firebaseConfig){
      // eslint-disable-next-line no-undef
      firebase.initializeApp(window.firebaseConfig);
      // eslint-disable-next-line no-undef
      auth = firebase.auth();
    }else{
      showStatus(DICT[LANG].statusNoConfig);
    }
  }catch{ showStatus(DICT[LANG].statusInitFail); }

  function persistShortName(){
    if (!$short) return '';
    const v = ($short.value||'').trim().slice(0,40);
    try { localStorage.setItem('sira_display_name', v); } catch {}
    return v;
  }

  async function completeSignup(providerIdToken, providerName, profile){
    const short_name = persistShortName();
    const payload = {
      provider: providerName,
      id_token: providerIdToken,
      email: profile?.email || '',
      display_name: profile?.displayName || '',
      short_name,
      referred_by
    };
    try{
      const res = await fetch('/signup', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include'
      });
      if (!res.ok){ throw new Error(await res.text()); }
      okStatus(LANG==='es' ? '¡Listo! Entrando…' : 'Done! Redirecting…');
      location.href = 'https://siraia.com/';
    }catch{
      showStatus(LANG==='es'
        ? 'No fue posible crear tu cuenta en este momento. Intenta de nuevo o usa tu número.'
        : 'We could not create your account now. Try again or use your phone number.'
      );
    }
  }

  async function signIn(provider){
    if (!auth){ showStatus(DICT[LANG].statusNoAuth); return; }
    hideStatus();
    try{
      const result = await auth.signInWithPopup(provider);
      const user = result.user;
      if (!user) throw new Error('no-user');
      const token = await user.getIdToken(true);
      await completeSignup(token, provider.providerId.includes('google')?'google':'facebook', { email:user.email, displayName:user.displayName });
    }catch(e){
      showStatus(e && e.code==='auth/popup-closed-by-user' ? DICT[LANG].statusClosed : DICT[LANG].statusCanceled);
    }
  }

  qs('#btnGoogle')?.addEventListener('click', ()=>{
    // eslint-disable-next-line no-undef
    const provider = new firebase.auth.GoogleAuthProvider();
    signIn(provider);
  });
  qs('#btnFacebook')?.addEventListener('click', ()=>{
    // eslint-disable-next-line no-undef
    const provider = new firebase.auth.FacebookAuthProvider();
    signIn(provider);
  });
})();
