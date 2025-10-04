// pwa-install.js — funciona en landing (siraia.app) y app (siraia.com)
(function(){
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

  // FAB
  const fab = document.createElement('button');
  fab.id = 'pwaFab';
  fab.className = 'btn primary';
  fab.textContent = (navigator.language||'es').toLowerCase().startsWith('es') ? 'Añadir acceso rápido' : 'Add quick access';
  document.body.appendChild(fab);

  // Modal iOS
  const modal = document.createElement('div');
  modal.className = 'pwa-modal';
  modal.setAttribute('hidden','');
  modal.innerHTML = `
    <div class="pwa-card">
      <h3>${(navigator.language||'es').toLowerCase().startsWith('es') ? 'Añadir a pantalla de inicio' : 'Add to Home Screen'}</h3>
      <p>${(navigator.language||'es').toLowerCase().startsWith('es')
        ? 'En iPhone o iPad: toca el icono Compartir y luego “Añadir a pantalla de inicio”.'
        : 'On iPhone or iPad: tap the Share icon, then “Add to Home Screen”.'}</p>
      <ol class="pwa-steps">
        <li>${(navigator.language||'es').toLowerCase().startsWith('es') ? 'Abre el menú “Compartir”.' : 'Open the “Share” menu.'}</li>
        <li>${(navigator.language||'es').toLowerCase().startsWith('es') ? 'Elige “Añadir a pantalla de inicio”.' : 'Choose “Add to Home Screen”.'}</li>
        <li>${(navigator.language||'es').toLowerCase().startsWith('es') ? 'Confirma el nombre y agrega.' : 'Confirm the name and add.'}</li>
      </ol>
      <div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end">
        <button class="btn" id="pwaClose">${(navigator.language||'es').toLowerCase().startsWith('es') ? 'Cerrar' : 'Close'}</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector('#pwaClose').addEventListener('click',()=>modal.setAttribute('hidden',''));

  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e)=>{
    e.preventDefault();
    deferredPrompt = e;
    fab.removeAttribute('hidden');
  });

  function goToAppForInstall(){
    const u = new URL('https://siraia.com/', location.origin);
    const ref = new URL(location.href).searchParams.get('ref');
    if (ref) u.searchParams.set('ref', ref);
    u.searchParams.set('install','1');
    location.href = u.toString();
  }

  fab.addEventListener('click', async ()=>{
    if (isStandalone) return;
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      return;
    }
    if (isIOS) { modal.removeAttribute('hidden'); return; }
    goToAppForInstall();
  });

  // Estado inicial del FAB
  if (isStandalone) fab.setAttribute('hidden','');
  if (!isIOS) fab.setAttribute('hidden','');
  if (isIOS && !isStandalone) fab.removeAttribute('hidden');
})();
