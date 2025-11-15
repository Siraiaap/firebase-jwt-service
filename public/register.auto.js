// ========= SiraIA auto-trámite en register.html =========
// Se ejecuta SOLO en siraia.com/register.html
// - Si vienes de siraia.app con ?from=siraia.app&method=google|facebook
//   intenta hacer el alta automática con el microservicio.
// - Si falla, deja el formulario normal funcionando.

(function () {
  const params = new URLSearchParams(window.location.search);
  const from = params.get("from");
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

  // Si no venimos de siraia.app, no hacer nada
  if (from !== "siraia.app") return;

  // Si el método es "phone", solo mostramos ayuda suave
  if (method === "phone") {
    showBanner(
      "Completa tu registro con tu número de celular para activar tus créditos.",
      "info"
    );
    return;
  }

  // Solo auto-tramitamos para google/facebook
  if (method !== "google" && method !== "facebook") return;

  // Leemos el perfil que guardó la landing (sira_oauth_profile)
  let profileRaw = null;
  try {
    profileRaw = localStorage.getItem("sira_oauth_profile");
  } catch (e) {
    /* ignore */
  }

  if (!profileRaw) {
    // Sin perfil no podemos hacer auto-signup; dejamos formulario normal
    showBanner(
      "Revisa tus datos y completa el registro. No pude recuperar tu perfil.",
      "error"
    );
    return;
  }

  let profile;
  try {
    profile = JSON.parse(profileRaw);
  } catch (e) {
    showBanner(
      "Ocurrió un problema con los datos de acceso. Puedes continuar usando tu número.",
      "error"
    );
    return;
  }

  // Evitar re-ejecutar si ya lo hicimos con el mismo usuario
  try {
    const done = localStorage.getItem("sira_oauth_done");
    if (done && done === String(profile.uid || "")) {
      return;
    }
  } catch (e) {
    /* ignore */
  }

  const displayName =
    (profile.displayName || profile.name || "").trim() || "SiraIA";

  const body = {
    provider: method, // "google" o "facebook"
    provider_uid: profile.uid || profile.userId || null,
    display_name: displayName,
    email: profile.email || null,
  };

  showBanner(
    method === "google"
      ? "Conectando tu cuenta de Google con SiraIA…"
      : "Conectando tu cuenta de Facebook con SiraIA…",
    "info"
  );

  fetch("https://siraia-auth-credits.onrender.com/signup-oauth", {
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
      if (!ok || !data || !data.jwt) {
        console.error("signup-oauth error:", data);
        showBanner(
          "No pude crear tu cuenta automáticamente. Puedes continuar usando tu número de celular.",
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
        if (profile.uid) {
          localStorage.setItem("sira_oauth_done", String(profile.uid));
        }
      } catch (e) {
        console.error("Error guardando sesión OAuth:", e);
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
