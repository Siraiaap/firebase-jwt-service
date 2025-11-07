// redirects/landing/landing.js — v5 (Acceso: Google/Facebook + Teléfono; nombre preferido; ?ref; redirección al chat)

(function(){
  const qs  = (s, r=document)=>r.querySelector(s);
  const qsa = (s, r=document)=>Array.from(r.querySelectorAll(s));

  // Año en footer
  const y = qs('#y'); if (y) y.textContent = new Date().getFullYear();

  // Idioma (simple)
  const LANG_DEFAULT = (navigator.language||'es').toLowerCase().startsWith('es') ? 'es' : 'en';
  let LANG = localStorage.getItem('landing_lang') || LANG_DEFAULT;
  const setLang = (lang)=>{
    LANG = lang; localStorage.setItem('landing_lang', lang);
    qs('#langES')?.setAttribute('aria-pressed', String(LANG==='es'));
    qs('#langEN')?.setAttribute('aria-pressed', String(LANG==='en'));
    // Texto clave del label (ES/EN)
    const label = qs('label[for="shortName"]');
    if (label){
      label.textContent = (LANG==='es')
        ? 'Ingresa aquí el nombre o diminutivo con el que deseas que SiraIA se dirija a ti.'
        : 'Type the name or nickname you want SiraIA to use for you.';
    }
    const btnPhone = qs('#btnPhone');
    if (btnPhone){
      btnPhone.textContent = (LANG==='es') ? 'Usar mi número' : 'Use my phone number';
    }
    const g = qs('#btnGoogle'); const f = qs('#btnFacebook');
    if (g) g.innerHTML = `<img class="btn-icon" alt="" src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" /> ${(LANG==='es')?'Continuar con Google':'Continue with Google'}`;
    if (f) f.innerHTML = `<img class="btn-icon" alt="" src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/facebook.svg" /> ${(LANG==='es')?'Continuar con Facebook':'Continue with Facebook'}`;
  };
  qs('#langES')?.addEventListener('click', ()=>setLang('es'));
  qs('#langEN')?.addEventListener('click', ()=>setLang('en'));
  setLang(LANG);

  // Captura de ?ref y persistencia
  const url = new URL(location.href);
  const ref = url.searchParams.get('ref');
  if (ref) {
    try { localStorage.setItem('sira_ref', ref); } catch {}
  }
  const referred_by = localStorage.getItem('sira_ref') || '';

  // Nombre preferido
  const $short = qs('#shortName');
  const savedName = localStorage.getItem('sira_display_name');
  if ($short && savedName) $short.value = savedName;

  // UI helpers
  const $status = qs('#status');
  function showStatus(msg, ok=false){
    if (!$status) return;
    $status.style.display = 'block';
    $status.style.borderColor = ok ? '#b7d8c3' : '#e2b4b4';
    $status.style.background = ok ? '#eaf6ef' : '#fff0f0';
    $status.textContent = msg;
  }
  function hideStatus(){ if($status){ $status.style.display='none'; } }

  // Firebase init (usa window.firebaseConfig si existe)
  let app, auth;
  try{
    // eslint-disable-next-line no-undef
    if (window.firebase && window.firebase.initializeApp && window.firebaseConfig){
      // eslint-disable-next-line no-undef
      app = firebase.initializeApp(window.firebaseConfig);
      // eslint-disable-next-line no-undef
      auth = firebase.auth();
    }else{
      showStatus((LANG==='es')
        ? 'Nota: falta la configuración de Firebase en esta página. Google/Facebook podrían no funcionar aún.'
        : 'Note: Firebase config is missing on this page. Google/Facebook may not work yet.'
      );
    }
  }catch(e){
    showStatus((LANG==='es')?'No fue posible inicializar servicios.':'Could not initialize services.');
  }

  // Guardar nombre preferido
  function persistShortName(){
    if (!$short) return '';
    const v = ($short.value||'').trim().slice(0,40);
    try { localStorage.setItem('sira_display_name', v); } catch {}
    return v;
  }

  // Llamada a /signup tras OAuth
  async function completeSignup(providerIdToken, providerName, profile){
    const short_name = persistShortName();
    const payload = {
      provider: providerName,                 // "google" | "facebook"
      id_token: providerIdToken,             // Firebase ID Token
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
      if (!res.ok){
        const txt = await res.text().catch(()=> '');
        throw new Error('signup failed: '+txt);
      }
      // OK → al chat
      location.href = 'https://siraia.com/';
    }catch(e){
      showStatus((LANG==='es')
        ? 'No fue posible crear tu cuenta en este momento. Intenta de nuevo o usa tu número.'
        : 'We could not create your account now. Try again or use your phone number.'
      );
    }
  }

  async function signIn(provider){
    if (!auth){
      showStatus((LANG==='es')
        ? 'Falta la configuración de Firebase. No es posible continuar con Google/Facebook.'
        : 'Firebase config missing. Cannot continue with Google/Facebook.'
      ); return;
    }
    hideStatus();
    try{
      const result = await auth.signInWithPopup(provider);
      const user = result.user;
      if (!user) throw new Error('no-user');
      const token = await user.getIdToken(/* forceRefresh */ true);
      await completeSignup(token, provider.providerId.includes('google')?'google':'facebook', { email:user.email, displayName:user.displayName });
    }catch(e){
      // Mensajes amigables
      let msg = (LANG==='es') ? 'Se canceló o falló el acceso.' : 'Sign-in was canceled or failed.';
      if (e && e.code === 'auth/popup-closed-by-user'){
        msg = (LANG==='es') ? 'Cerraste la ventana antes de terminar.' : 'You closed the popup before finishing.';
      }
      showStatus(msg);
    }
  }

  // Botones
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
