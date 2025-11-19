// ========== SiraIA Landing v14 (OAuth → register.html en siraia.com) ==========
(function () {
  // --- Config ---
  const firebaseConfig = window.firebaseConfig || {
    apiKey: "AIzaSyBT4hTvAWk5lAT_OuJHjPCyKVUQ7jDpEAc",
    authDomain: "siraia.firebaseapp.com",
    projectId: "siraia",
    storageBucket: "siraia.firebasestorage.app",
    messagingSenderId: "264146805016",
    appId: "1:264146805016:web:9ad62adc579ec4c6c43e6d",
  };

  const REGISTER_URL = "https://siraia.com/register.html";

  // --- utilidades ---
  const qs = (obj) => new URLSearchParams(obj).toString();

  // --- i18n básico ---
  const LOCALE_KEY = "sira_locale";
  const STR = {
    es: {
      heroTitle: "Tu compañera digital que entiende, responde y se adapta a ti.",
      heroText:
        "Más que un buscador que te llena de ligas, es una Inteligencia Artificial pensada para todos los no expertos: fácil, cálida y directa. Da respuestas útiles de todo tipo sin que necesites saber de tecnología.",
      headerRemember: "Recuerda:",
      headerAppSuffix: "Página de registro y acceso",
      headerComSuffix: "Tu chat con SiraIA",

      choose: "Elige cómo quieres entrar",
      howToCallYou:
        "Ingresa aquí el nombre o diminutivo con el que deseas que SiraIA se dirija a ti.",
      btnGoogle: "Continuar con Google",
      btnFacebook: "Continuar con Facebook",
      btnPhone: "Usar mi número",
      terms: "Términos",
      privacy: "Política de Privacidad",
      accept: "Al continuar, aceptas los",
      and: "y la",
    },
    en: {
      heroTitle:
        "Your digital companion that understands, responds, and adapts to you.",
      heroText:
        "More than a search engine that throws links at you, it’s an AI designed for non-experts: simple, warm, and direct. It gives you useful answers of all kinds without needing to know about technology.",
      headerRemember: "Remember:",
      headerAppSuffix: "Sign-up and access page",
      headerComSuffix: "Your chat with SiraIA",

      choose: "Choose how you want to sign in",
      howToCallYou:
        "Type the name or nickname you want SiraIA to use for you.",
      btnGoogle: "Continue with Google",
      btnFacebook: "Continue with Facebook",
      btnPhone: "Use my phone number",
      terms: "Terms",
      privacy: "Privacy Policy",
      accept: "By continuing, you agree to the",
      and: "and the",
    },
  };

  function getLocale() {
    const saved = localStorage.getItem(LOCALE_KEY);
    if (saved) return saved;

    const lang = (navigator.language || "es").toLowerCase();
    const isES =
      lang.startsWith("es") ||
      [
        "mx",
        "es",
        "ar",
        "co",
        "pe",
        "cl",
        "uy",
        "py",
        "bo",
        "gt",
        "hn",
        "sv",
        "ni",
        "cr",
        "do",
      ].some((cc) => lang.endsWith("-" + cc));

    const loc = isES ? "es" : "en";
    localStorage.setItem(LOCALE_KEY, loc);
    return loc;
  }

  function applyLang(loc) {
    const dict = STR[loc] || STR.es;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (dict[key]) el.textContent = dict[key];
    });
  }

  function updateLangButtons(loc) {
    const btnES = document.getElementById("btnES");
    const btnEN = document.getElementById("btnEN");
    if (!btnES || !btnEN) return;

    btnES.classList.toggle("is-active", loc === "es");
    btnEN.classList.toggle("is-active", loc === "en");
  }

  function showStatus(msg, kind = "info") {
    const el = document.getElementById("status");
    if (!el) return;
    el.hidden = false;
    el.textContent = msg;
    el.className = "status " + kind;
  }

  function initFirebase() {
    if (window.firebaseAppInstance) return window.firebaseAppInstance;
    const app = firebase.initializeApp(firebaseConfig);
    window.firebaseAppInstance = app;
    return app;
  }

  function getName() {
    const input = document.getElementById("displayName");
    const raw = (input?.value || "").trim();
    if (!raw) return "";
    return raw.slice(0, 40);
  }

  function buildQuery(extra = {}) {
    const name = getName();
    const base = { from: "siraia.app", ...extra };
    if (name) base.display_name = name;
    return qs(base);
  }

  async function onGoogle() {
    try {
      showStatus("Abriendo Google…", "info");
      initFirebase();

      const auth = firebase.auth();
      const provider = new firebase.auth.GoogleAuthProvider();

      const result = await auth.signInWithPopup(provider);
      if (!result.user) throw new Error("No user in result");

      const u = result.user;
      const q = buildQuery({
        method: "google",
        firebase_uid: u.uid || "",
        email: u.email || "",
      });

      window.location.href = `${REGISTER_URL}?${q}`;
    } catch (err) {
      console.error("Google error", err);
      if (err.code === "auth/popup-closed-by-user") {
        showStatus(
          "No se pudo abrir el inicio de sesión. Intenta de nuevo.",
          "error"
        );
      } else {
        showStatus("Ocurrió un error al iniciar sesión con Google.", "error");
      }
    }
  }

  // Facebook se deja preparado, aunque la app siga en modo desarrollo.
  async function onFacebook() {
    try {
      showStatus("Abriendo Facebook…", "info");
      initFirebase();

      const auth = firebase.auth();
      const provider = new firebase.auth.FacebookAuthProvider();

      const result = await auth.signInWithPopup(provider);
      if (!result.user) throw new Error("No user in result");

      const u = result.user;
      const q = buildQuery({
        method: "facebook",
        firebase_uid: u.uid || "",
        email: u.email || "",
      });

      window.location.href = `${REGISTER_URL}?${q}`;
    } catch (err) {
      console.error("Facebook error", err);
      if (err.code === "auth/popup-closed-by-user") {
        showStatus(
          "No se pudo abrir el inicio de sesión. Intenta de nuevo.",
          "error"
        );
      } else {
        showStatus(
          "Ocurrió un error al iniciar sesión con Facebook.",
          "error"
        );
      }
    }
  }

  function onPhone() {
    const q = buildQuery({ method: "phone" });
    window.location.href = `${REGISTER_URL}?${q}`;
  }

  // --- boot ---
  document.addEventListener("DOMContentLoaded", () => {
    const loc = getLocale();
    applyLang(loc);
    updateLangButtons(loc);

    const btnES = document.getElementById("btnES");
    const btnEN = document.getElementById("btnEN");

    btnES?.addEventListener("click", () => {
      const loc = "es";
      localStorage.setItem(LOCALE_KEY, loc);
      applyLang(loc);
      updateLangButtons(loc);
    });

    btnEN?.addEventListener("click", () => {
      const loc = "en";
      localStorage.setItem(LOCALE_KEY, loc);
      applyLang(loc);
      updateLangButtons(loc);
    });

    try {
      initFirebase();
    } catch (e) {
      console.error("Firebase init error", e);
      showStatus("Error iniciando Firebase", "error");
    }

    document.getElementById("btnGoogle")?.addEventListener("click", onGoogle);
    document.getElementById("btnFacebook")?.addEventListener("click", onFacebook);
    document.getElementById("btnPhone")?.addEventListener("click", onPhone);
  });
})();
