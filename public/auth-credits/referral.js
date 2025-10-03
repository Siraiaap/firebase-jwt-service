/*! SiraIA referral helper — capture ?ref, anti-self, and inject to checkout session */
/* global atob */
(function(){
  'use strict';
  var LS_KEY = 'sira_ref';
  var JWT_KEY = 'sira_jwt';

  function safeLog(){ try { if (location.search.includes('refdebug=1')) console.log.apply(console, arguments); } catch(_){} }

  function sanitizeRef(raw){
    if (!raw || typeof raw !== 'string') return '';
    var v = raw.trim();
    // allow letters, numbers, _, -, :, ., @ (so we can carry UUID/phone masked/etc.)
    v = v.replace(/[^A-Za-z0-9_\-:.@]/g, '');
    if (v.length > 80) v = v.slice(0,80);
    return v;
  }

  function getRefFromURL(){
    try{
      var q = new URLSearchParams(location.search);
      var ref = q.get('ref');
      return sanitizeRef(ref||'');
    }catch(e){ return ''; }
  }

  function storeRef(ref){
    try{
      if (ref) localStorage.setItem(LS_KEY, ref);
    }catch(_){}
  }
  function getStoredRef(){
    try{ return localStorage.getItem(LS_KEY) || ''; }catch(_){ return ''; }
  }
  function clearRef(){
    try{ localStorage.removeItem(LS_KEY); }catch(_){}
  }

  function decodeSubFromJWT(){
    try{
      var jwt = localStorage.getItem(JWT_KEY);
      if (!jwt || jwt.indexOf('.') === -1) return '';
      var parts = jwt.split('.');
      var payload = JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')));
      return (payload && (payload.sub || payload.user_id || payload.uid)) || '';
    }catch(_){ return ''; }
  }

  // Capture ?ref on load (first hit wins)
  try{
    var incoming = getRefFromURL();
    if (incoming) {
      storeRef(incoming);
      safeLog('[referral] captured from URL =', incoming);
    }
  }catch(_){}

  function isSelf(){
    var ref = getStoredRef();
    var sub = decodeSubFromJWT();
    return ref && sub && (ref === sub);
  }

  // Patch fetch to inject referral into /checkout/session calls
  var _fetch = window.fetch;
  window.fetch = function(input, init){
    try{
      var url = (typeof input === 'string') ? input : (input && input.url) || '';
      var method = (init && init.method) || (input && input.method) || 'GET';
      var isCheckout = url.indexOf('/checkout/session') !== -1;
      var ref = getStoredRef();
      var sub = decodeSubFromJWT();

      if (isCheckout && ref && ref !== sub){
        // Prepare headers
        init = init || {};
        var hdrs = new Headers(init.headers || (input && input.headers) || {});
        hdrs.set('X-Referral', ref);

        // If JSON body, append referrer field
        if (method.toUpperCase() === 'POST' && init.body && !(init.body instanceof FormData)) {
          var ct = hdrs.get('Content-Type') || '';
          var bodyStr = init.body;
          if (typeof bodyStr === 'string' && ct.indexOf('application/json') !== -1){
            try{
              var obj = JSON.parse(bodyStr);
              if (obj && typeof obj === 'object' && !obj.referrer){
                obj.referrer = ref;
                init.body = JSON.stringify(obj);
              }
            }catch(_){}
          }
        }

        init.headers = hdrs;
        safeLog('[referral] injected into checkout', {url:url, ref:ref});
      } else if (isCheckout && ref && sub && ref === sub){
        // prevent self-referral leaking downstream
        init = init || {};
        var hdrs2 = new Headers(init.headers || (input && input.headers) || {});
        hdrs2.delete('X-Referral');
        init.headers = hdrs2;
        // leave body untouched
        safeLog('[referral] self-referral detected; not sending');
      }
    }catch(e){
      // don't break the app if something goes wrong
      safeLog('[referral] fetch patch error', e);
    }
    return _fetch.call(this, input, init);
  };

  // Expose small API
  window.SiraReferral = {
    get: getStoredRef,
    set: function(v){ var s = sanitizeRef(v); if (s) storeRef(s); return s; },
    clear: clearRef,
    isSelf: isSelf,
    sub: decodeSubFromJWT
  };
})();
