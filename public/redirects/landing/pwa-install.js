// pwa-install.js
(function(){
  let deferredPrompt = null;
  const btn = document.getElementById('btn-a2hs');
  const tip = document.getElementById('a2hs-tip');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (btn) btn.hidden = false;
    if (tip) tip.hidden = true;
  });

  async function promptInstall(){
    if (deferredPrompt){
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
    }else{
      // iOS o no disponible → mostramos instrucciones
      alert(
        /iPhone|iPad|iPod/i.test(navigator.userAgent)
        ? 'Para añadir acceso rápido en iPhone: 1) toca el botón Compartir ▢↑  2) “Añadir a pantalla de inicio”.'
        : 'Si no ves el aviso, abre el menú ⋮ del navegador y elige “Añadir a pantalla principal”.'
      );
    }
  }

  if (btn) btn.addEventListener('click', promptInstall);

  // registra un SW sencillo (requisito para Android)
  if ('serviceWorker' in navigator){
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }
})();
