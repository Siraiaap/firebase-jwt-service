/* SiraIA — Referidos front (captura ?ref, anti-auto, propagación a checkout y registro)
   - Captura ?ref al cargar y lo guarda en localStorage('sira_ref') con saneo básico.
   - Expone window.SiraReferral { get,set,clear,isSelf,getJwtSub }.
   - Inyecta referrer en POST /checkout/session (header X-Referral + body.referrer).
   - No rompe nada de lo existente.
*/
(function () {
  var KEY = 'sira_ref';
  var MAXLEN = 80;

  function sanitizeRef(v) {
    if (!v || typeof v !== 'string') return null;
    v = v.trim();
    // permitir letras, números, guion, guion_bajo, punto y dos puntos
    v = v.replace(/[^a-zA-Z0-9_\-:\.]/g, '');
    if (!v) return null;
    if (v.length > MAXLEN) v = v.slice(0, MAXLEN);
    return v;
  }

  function getParam(name) {
    try {
      var sp = new URLSearchParams(window.location.search);
      var val = sp.get(name);
      return val;
    } catch (e) { return null; }
  }

  function decodeJwtSubFromLocalStorage() {
    var keys = ['sira_jwt', 'jwt', 'token', 'id_token']; // prueba múltiples por compatibilidad
    for (var i = 0; i < keys.length; i++) {
      var t = null;
      try { t = localStorage.getItem(keys[i]); } catch (e) {}
      if (!t) continue;
      var parts = t.split('.');
      if (parts.length < 2) continue;
      try {
        var payload = JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')));
        if (payload && payload.sub) return String(payload.sub);
      } catch (e) {}
    }
    return null;
  }

  function getRef() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function setRef(v) { var s = sanitizeRef(v); if (!s) return false; try { localStorage.setItem(KEY, s); return true; } catch (e) { return false; } }
  function clearRef() { try { localStorage.removeItem(KEY); } catch (e) {} }

  // Captura temprana de ?ref
  var qref = getParam('ref');
  if (qref) setRef(qref);

  // API pública
  var api = {
    get: getRef,
    set: setRef,
    clear: clearRef,
    getJwtSub: decodeJwtSubFromLocalStorage,
    isSelf: function () {
      var sub = decodeJwtSubFromLocalStorage();
      var r = getRef();
      return !!(sub && r && sub === r);
    }
  };
  try { window.SiraReferral = api; } catch (e) {}

  // Parche de fetch para /checkout/session
  var ofetch = window.fetch;
  if (typeof ofetch === 'function') {
    window.fetch = function(input, init) {
      try {
        var url = (typeof input === 'string') ? input : (input && input.url);
        var method = (init && init.method) ? String(init.method).toUpperCase() : 'GET';
        if (url && /\/checkout\/session(\?|$|\/)/.test(url) && method === 'POST') {
          var ref = getRef();
          var sub = decodeJwtSubFromLocalStorage();
          if (ref && (!sub || ref !== sub)) {
            // Headers
            var headers = init && init.headers ? init.headers : {};
            var H;
            if (typeof Headers !== 'undefined') {
              H = new Headers(headers);
            } else {
              H = headers;
            }
            // set X-Referral
            if (H.set) H.set('X-Referral', ref);
            else H['X-Referral'] = ref;

            // Body
            var body = init && init.body;
            var ct = (H.get && (H.get('Content-Type') || H.get('content-type'))) || (headers['Content-Type'] || headers['content-type']);
            function ensureJsonCT() {
              if (H.set) {
                if (!H.get('Content-Type')) H.set('Content-Type', 'application/json');
              } else {
                if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
              }
            }
            if (!body) {
              ensureJsonCT();
              body = JSON.stringify({ referrer: ref });
            } else if (typeof body === 'string' && body.trim().charAt(0) === '{') {
              try {
                var obj = JSON.parse(body);
                if (!obj.referrer) obj.referrer = ref;
                body = JSON.stringify(obj);
                ensureJsonCT();
              } catch (e) { /* deja body como está */ }
            } // si es FormData/URLSearchParams, lo dejamos (backend puede leer header)

            // Reconstruye init con headers/body nuevos
            init = init || {};
            init.headers = H || headers;
            init.body = body;
          }
        }
      } catch (e) { /* no-op */ }
      return ofetch.call(this, input, init);
    };
  }
})();
