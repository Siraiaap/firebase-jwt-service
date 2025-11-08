// redirects/landing/landing.js  v=9
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getAuth, signInWithPopup, GoogleAuthProvider, FacebookAuthProvider,
  RecaptchaVerifier, signInWithPhoneNumber, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

// --- 1) Firebase config (tu real) ---
const firebaseConfig = {
  apiKey: "AIzaSyBT4hTvAWk5lAT_OuJHjPCyKVUQ7jDpEAc",
  authDomain: "siraia.firebaseapp.com",
  projectId: "siraia",
  storageBucket: "siraia.firebasestorage.app",
  messagingSenderId: "264146805016",
  appId: "1:264146805016:web:9ad62adc579ec4c6c43e6d"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Helpers UI
const $ = (s) => document.querySelector(s);
const nickInput = $('#nick');
const phoneBlock = $('#phoneBlock');
const recaptchaHolder = $('#recaptcha-container');
const codeBlock = $('#codeBlock');

let recaptchaInv = null;   // invisible
let recaptchaChk = null;   // visible
let confirmation = null;   // Phone confirmation

// Persistimos (display_name) como haces hoy
function persistDisplayName() {
  const raw = (nickInput.value || '').trim();
  if (!raw) return;
  localStorage.setItem('sira_display_name', raw);
  // si tienes sira_profile, lo reflejamos como hoy
  try {
    const profile = JSON.parse(localStorage.getItem('sira_profile') || '{}');
    profile.display_name = raw;
    localStorage.setItem('sira_profile', JSON.stringify(profile));
  } catch { /* no-op */ }
}

// Redirige a tu registro para que PROVISIONE 10 créditos y emita sira_jwt
function goToProvision() {
  const dname = encodeURIComponent(nickInput.value || '');
  location.href = `/register.html?from=oauth&name=${dname}`;
}

// --- 2) OAuth (Google / Facebook) ---
$('#btnGoogle').addEventListener('click', async () => {
  try {
    persistDisplayName();
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
    goToProvision();
  } catch (e) {
    alert('No pude entrar con Google. Intenta de nuevo.');
    console.error(e);
  }
});

$('#btnFacebook').addEventListener('click', async () => {
  try {
    persistDisplayName();
    const provider = new FacebookAuthProvider();
    await signInWithPopup(auth, provider);
    goToProvision();
  } catch (e) {
    alert('No pude entrar con Facebook. Intenta de nuevo.');
    console.error(e);
  }
});

// --- 3) Teléfono con cascade reCAPTCHA ---
// Intento 1: invisible; si falla al enviar SMS, creo visible (checkbox) automáticamente.
$('#btnPhone').addEventListener('click', () => {
  phoneBlock.hidden = false;
  // Creamos el recaptcha invisible cuando el usuario abre el bloque
  ensureInvisibleRecaptcha();
});

$('#btnSendCode').addEventListener('click', async () => {
  try {
    persistDisplayName();

    const cc = $('#country').value;              // "+52"
    const num = ($('#phone').value || '').replace(/\D+/g, '');
    if (!num) return alert('Escribe tu número.');
    const e164 = `${cc}${num}`;

    // Asegura que tenemos un verifier invisible (o el visible si ya caímos a fallback)
    const verifier = recaptchaInv || recaptchaChk || ensureInvisibleRecaptcha();

    confirmation = await signInWithPhoneNumber(auth, e164, verifier);
    codeBlock.hidden = false;
    alert('Te envié un SMS. Ingresa el código de 6 dígitos.');
  } catch (err) {
    console.warn('SMS con reCAPTCHA invisible falló. Probando reCAPTCHA visible…', err);
    try {
      // Fallback: generamos un widget visible y volvemos a intentar
      ensureVisibleRecaptcha(/*force*/true);
      const cc = $('#country').value;
      const num = ($('#phone').value || '').replace(/\D+/g, '');
      const e164 = `${cc}${num}`;
      confirmation = await signInWithPhoneNumber(auth, e164, recaptchaChk);
      codeBlock.hidden = false;
      alert('Te envié un SMS. Ingresa el código de 6 dígitos.');
    } catch (err2) {
      console.error(err2);
      alert('No pude enviar el SMS. Revisa el número o intenta de nuevo.');
    }
  }
});

$('#btnVerify').addEventListener('click', async () => {
  try {
    const code = ($('#smsCode').value || '').trim();
    if (!code) return alert('Ingresa el código de 6 dígitos.');
    await confirmation.confirm(code);

    // Teléfono validado -> manda a tu registro para PROVISIONAR y emitir sira_jwt
    goToProvision();
  } catch (e) {
    console.error(e);
    alert('Código inválido. Intenta de nuevo.');
  }
});

// --- reCAPTCHA helpers ---
function ensureInvisibleRecaptcha() {
  if (recaptchaInv) return recaptchaInv;
  // El contenedor invisible no necesita estar visible
  recaptchaHolder.hidden = true;
  recaptchaInv = new RecaptchaVerifier(auth, recaptchaHolder, {
    size: 'invisible'
  });
  return recaptchaInv;
}

function ensureVisibleRecaptcha(force = false) {
  if (recaptchaChk && !force) return recaptchaChk;
  // Mostramos el contenedor y montamos un checkbox visible
  recaptchaHolder.hidden = false;
  recaptchaHolder.innerHTML = ''; // limpia si había algo
  recaptchaChk = new RecaptchaVerifier(auth, recaptchaHolder, {
    size: 'normal', // checkbox visible
    callback: () => { /* marcado */ }
  });
  return recaptchaChk;
}

// (Opcional) Si el usuario ya está logueado por alguna razón, puedes llevarlo directo:
onAuthStateChanged(auth, (u) => {
  // no redirijo automáticamente para no confundir; dejamos que elija el método
});
