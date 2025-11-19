// ========= SiraIA auto-trámite en register.html =========
// Se ejecuta SOLO en siraia.com/register.html
// - Si vienes de siraia.app con ?from=siraia.app&method=google|facebook
//   intenta hacer el alta automática con el microservicio.
// - Si falla, deja el formulario normal funcionando.

(function () {
  const params = new URLSearchParams(window.location.search);
  const from = params.get("from") || "";
  const method = params.get("method"); // "google" | "facebook" | "phone"

  const bannerEl = document.getElementById("sira-auto-banner");

  function showBanner(msg, kind = "info") {
    if (!bannerEl) return;
    bannerEl.style.display = "block";
    bannerEl.style.position = "fixed";
    bannerEl.style.left = "0";
    bannerEl.style.right = "0";
    bannerEl.style.bottom = "0";
    bannerEl.style.zIndex = "9999";
    bannerEl.style.padding = "10px 14px";
    bannerEl.style.font = "14px system-ui, -apple-system, Segoe UI, sans-serif";
    bannerEl.style.textAlign = "center";
    bannerEl.style.borderTop = "1px solid #d4ddcf";
    bannerEl.style.background = kind === "error" ? "#fee2e2" : "#EDEAE0";
    bannerEl.style.color = kind === "error" ? "#991b1b" : "#3A3D3B";
    bannerEl.textContent = msg;
  }

  // Si no venimos de OAuth, no hacemos nada (se usa flujo normal por teléfono)
  if (method !== "google" && method !== "facebook") {
    if (from === "siraia.app") {
      // Vino desde la landing pero sin método claro: solo mostramos aviso suave
      showBanner(
        "Completa tu registro usando tu número de celular para activar tus créditos.",
        "info"
      );
    }
    return;
  }

  // Leemos datos del querystring
  const firebaseUid = (params.get("firebase_uid") || "").trim();
  const email = (params.get("email") || "").trim();
  const displayNameFromUrl = (params.get("display_name") || "").trim();

  const displayName =
    displayNameFromUrl ||
    // fallback por si algún día Google no manda nombre y el usuario no escribió nada
    "SiraIA";

  if (!firebaseUid && !email) {
    showBanner(
      "No pude recuperar tu perfil de Google. Puedes completar el registro usando tu número de celular.",
      "error"
    );
    return;
  }

  // Cuerpo para el microservicio /signup en modo "google"
  const body = {
    mode: "google", // backend trata esto como flujo OAuth
    display_name: displayName,
    firebase_uid: firebaseUid || null,
    email: email || null,
    accept: true,
  };

  showBanner(
    method === "google"
      ? "Conectando tu cuenta de Google con SiraIA…"
      : "Conectando tu cuenta de Facebook con SiraIA…",
    "info"
  );

  fetch("https://siraia-auth-credits.onrender.com/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
    .then(async (r) => {
      let data = {};
      try {
        data = await r.json();
      } catch (e) {
        data = {};
      }
      return { ok: r.ok, data };
    })
    .then(({ ok, data }) => {
      if (!ok) {
        const code = data && data.error ? data.error : "SIGNUP_FAILED";
        console.error("signup-oauth error:", code, data);

        if (code === "TERMS_NOT_ACCEPTED") {
          showBanner(
            "Debes aceptar los términos para continuar. Usa tu número de celular para registrarte.",
            "error"
          );
        } else if (code === "MISSING_OR_INVALID_DISPLAY_NAME") {
          showBanner(
            "Tu nombre no es válido. Corrígelo en el campo correspondiente y vuelve a intentar.",
            "error"
          );
        } else {
          showBanner(
            "No pude conectar tu cuenta de Google. Puedes registrarte usando tu número de celular.",
            "error"
          );
        }
        return;
      }

      if (!data || !data.jwt || !data.user) {
        console.error("signup-oauth respuesta incompleta:", data);
        showBanner(
          "Ocurrió un problema al conectar tu cuenta. Intenta de nuevo o usa tu número de celular.",
          "error"
        );
        return;
      }

      // Guardar sesión igual que en el registro por teléfono
      try {
        localStorage.setItem("sira_jwt", data.jwt);
        const nameFromApi =
          (data.user && data.user.display_name) || displayName;
        localStorage.setItem("sira_display_name", nameFromApi);
        localStorage.setItem(
          "sira_profile",
          JSON.stringify({
            display_name: nameFromApi,
            phone_e164: data.user ? data.user.phone_e164 || null : null,
            oauth_provider: method,
          })
        );
        if (firebaseUid) {
          localStorage.setItem("sira_oauth_last_uid", firebaseUid);
        }
      } catch (e) {
        console.warn("No pude guardar perfil local:", e);
      }

      showBanner("Cuenta conectada. Entrando al chat…", "info");

      // Redirigir al chat principal en siraia.com
      window.location.href = "/";
    })
    .catch((err) => {
      console.error("signup-oauth fetch error:", err);
      showBanner(
        "Hubo un problema al conectar tu cuenta. Intenta más tarde o usa tu número de celular.",
        "error"
      );
    });
})();
