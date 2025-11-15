// redirects/landing/landing.js — v4 (10 categorías × 3 ejemplos; CORS-safe; ES/EN; videos; referidos)
const qs  = (s, r=document)=>r.querySelector(s);
const qsa = (s, r=document)=>Array.from(r.querySelectorAll(s));

// -------- i18n --------
const LANG_DEFAULT = (navigator.language||'es').toLowerCase().startsWith('es') ? 'es' : 'en';
let LANG = localStorage.getItem('landing_lang') || LANG_DEFAULT;

async function loadI18n(lang){
  try{
    const res = await fetch(`/landing/i18n/${lang}.json?v=3`, { cache:'no-store' });
    if(!res.ok) throw 0;
    return await res.json();
  }catch(_){ return {}; }
}
function applyI18n(dict){
  qsa('[data-i18n]').forEach(el=>{
    const key = el.getAttribute('data-i18n');
    if (dict && dict[key]) el.innerHTML = dict[key];
  });
  document.documentElement.lang = LANG;
  const bES = qs('#langES'); const bEN = qs('#langEN');
  if (bES) bES.setAttribute('aria-pressed', String(LANG==='es'));
  if (bEN) bEN.setAttribute('aria-pressed', String(LANG==='en'));
}
async function setLang(lang){
  LANG = lang;
  localStorage.setItem('landing_lang', lang);
  const dict = await loadI18n(lang);
  applyI18n(dict);
  renderExamples();
  renderVideos();
}
const bES = qs('#langES'); const bEN = qs('#langEN');
if (bES) bES.addEventListener('click', ()=> setLang('es'));
if (bEN) bEN.addEventListener('click', ()=> setLang('en'));

// -------- Referidos en CTA --------
const url = new URL(location.href);
const ref = url.searchParams.get('ref');
function withRef(href){
  if (!ref) return href;
  const u = new URL(href, location.origin);
  u.searchParams.set('ref', ref);
  return u.toString();
}
['ctaHeader','ctaHero','ctaPricing1','ctaPricing2','ctaPricing3','ctaFinal'].forEach(id=>{
  const a = qs('#'+id);
  if (a && a.href) a.href = withRef(a.href);
});

// -------- Sugerencias (10 categorías × 3) --------
// Asegúrate de que tus chips en HTML usen estos data-cat:
// salud, finanzas, legal, entretenimiento, recetas, tecnologia, seguridad, hogar, familia, negocios
const REMOTE_ALLOWED = location.origin.startsWith('https://siraia.com'); // solo desde el dominio del chat
const SUG_BASE = 'https://siraia.com/suggestions/v1';

const FALLBACK = {
  es: {
    salud: [
      "Tengo dolor leve en la rodilla desde hace 3 días. ¿Qué cuidados caseros y cuándo ir al médico?",
      "Explica en sencillo mis análisis: triglicéridos 210 mg/dL.",
      "Quiero empezar a caminar 20 min diarios. ¿Cómo evitar lesiones si soy principiante?"
    ],
    finanzas: [
      "Hazme un presupuesto mensual con $15,000 MXN y sugiere 3 metas de ahorro realistas.",
      "Explícame interés compuesto con un ejemplo claro (ahorro mensual de $1000 por 2 años).",
      "¿Conviene pagar deuda primero o empezar un fondo de emergencia? Dame un plan en pasos."
    ],
    legal: [
      "Redacta una carta de rescisión de contrato de renta (causas y entrega de llaves).",
      "Lista de puntos a revisar antes de firmar un pagaré.",
      "Resume este documento legal en 5 bullets (pegar texto)."
    ],
    entretenimiento: [
      "Recomienda 3 películas familiares (apto para 8–12 años) para ver hoy.",
      "Quiero un plan de fin de semana barato en mi ciudad (ideas de actividades).",
      "Dame un horóscopo breve y un tip motivacional para Aries."
    ],
    recetas: [
      "Tengo 20 minutos y pollo. Dame 3 ideas de cena ligera.",
      "Menú económico de 5 días con lista de compra básica.",
      "Galletas crujientes sin lácteos: receta sencilla para 12 piezas."
    ],
    tecnologia: [
      "Explícame qué es el almacenamiento en la nube y cómo elegir un plan gratuito.",
      "Guíame para migrar fotos del teléfono a Google Fotos sin perder calidad.",
      "Cómo reconocer correos falsos (phishing) en 5 señales simples."
    ],
    seguridad: [
      "Checklist para asegurar mi WhatsApp (verificación en 2 pasos, PIN, etc.).",
      "Cómo crear contraseñas seguras y recordar 3 sin apuntarlas.",
      "Pasos para reportar y bloquear un intento de fraude por SMS."
    ],
    hogar: [
      "Tutorial básico para cambiar anticongelante del auto de forma segura.",
      "Quitar manchas difíciles en ropa blanca sin cloro fuerte.",
      "Guía rápida para destapar una tarja con herramientas caseras."
    ],
    familia: [
      "Cómo explicar fracciones a un niño de 9 años con ejemplos cotidianos.",
      "Ideas de actividades sin pantallas para 4 personas, 1 hora.",
      "Consejos para hablar de ciberseguridad con adolescentes."
    ],
    negocios: [
      "Valida una idea de negocio local con 5 entrevistas: dame guion de preguntas.",
      "Dame un pitch de 90 segundos para vender forraje de nopal a ganaderos.",
      "Cómo calcular precio de venta con margen del 35% (ejemplo numérico)."
    ]
  },
  en: {
    salud: [
      "Mild knee pain for 3 days — home care tips and when to see a doctor?",
      "Explain my labs simply: triglycerides 210 mg/dL.",
      "I want to start walking 20 minutes daily. How to avoid injuries as a beginner?"
    ],
    finanzas: [
      "Make a monthly budget with $900 and suggest 3 realistic saving goals.",
      "Explain compound interest with a clear example ($50/month for 2 years).",
      "Should I pay debt first or start an emergency fund? Give me a step-by-step plan."
    ],
    legal: [
      "Draft a rental lease termination letter (causes and key clauses).",
      "Checklist of points to review before signing a promissory note.",
      "Summarize this legal document in 5 bullets (paste text)."
    ],
    entretenimiento: [
      "Recommend 3 family movies (ages 8–12) for tonight.",
      "Low-cost weekend plan ideas in my city (activities).",
      "Give me a short horoscope and a motivational tip for Aries."
    ],
    recetas: [
      "I have 20 minutes and chicken. Give 3 light dinner ideas.",
      "5-day budget menu with a simple shopping list.",
      "Crunchy cookies without dairy: easy recipe for 12 pieces."
    ],
    tecnologia: [
      "Explain cloud storage and how to choose a free plan.",
      "Guide me to move phone photos to Google Photos safely.",
      "How to spot phishing emails — 5 simple signs."
    ],
    seguridad: [
      "Checklist to secure my WhatsApp (2-step verification, PIN, etc.).",
      "Create strong passwords and remember 3 without writing them down.",
      "Steps to report and block an SMS fraud attempt."
    ],
    hogar: [
      "Basic tutorial to replace car coolant safely.",
      "Remove tough stains from white clothes without harsh bleach.",
      "Quick guide to unclog a kitchen sink with household tools."
    ],
    familia: [
      "Explain fractions to a 9-year-old with daily examples.",
      "Screen-free activities for 4 people, 1 hour.",
      "Tips to talk about cybersecurity with teenagers."
    ],
    negocios: [
      "Validate a local business idea with 5 interviews: give me the script.",
      "90-second pitch to sell fermented cactus forage to ranchers.",
      "How to set a sale price with a 35% margin (numeric example)."
    ]
  }
};

// mapping chips → claves
const CAT_MAP = {
  salud:'salud', finanzas:'finanzas', legal:'legal', entretenimiento:'entretenimiento',
  recetas:'recetas', tecnologia:'tecnologia', seguridad:'seguridad', hogar:'hogar',
  familia:'familia', negocios:'negocios'
};

async function fetchCat(catKey){
  const lang = LANG==='es' ? 'es' : 'en';
  if (!REMOTE_ALLOWED){
    return (FALLBACK[lang] && FALLBACK[lang][catKey]) ? FALLBACK[lang][catKey] : [];
  }
  try{
    const res = await fetch(`${SUG_BASE}/${lang}/${catKey}.json?v=1`, { mode:'cors', cache:'no-store' });
    if (!res.ok) throw 0;
    const data = await res.json();
    const arr = Array.isArray(data.prompts) ? data.prompts : [];
    return arr.slice(0,3); // siempre 3
  }catch(_){
    return (FALLBACK[lang] && FALLBACK[lang][catKey]) ? FALLBACK[lang][catKey] : [];
  }
}

let currentCat = 'salud';
async function renderExamples(){
  qsa('.categories .chip').forEach(ch=>{
    ch.classList.toggle('active', ch.dataset.cat === currentCat);
  });
  const wrap = qs('#exampleList'); if (!wrap) return;
  wrap.innerHTML = '<div class="notice">...</div>';
  const items = await fetchCat(CAT_MAP[currentCat]);
  wrap.innerHTML = '';
  items.slice(0,3).forEach(text=>{
    const card = document.createElement('div');
    card.className = 'example';
    const p = document.createElement('p');
    p.textContent = text; // sin innerHTML → evita XSS
    card.appendChild(p);
    wrap.appendChild(card);
  });
}
qsa('.categories .chip').forEach(btn=>{
  btn.addEventListener('click', ()=>{ currentCat = btn.dataset.cat; renderExamples(); });
});

// -------- Videos --------
let videos = [];
async function loadVideos(){
  try{
    const res = await fetch('/landing/videos.json?v=3', { cache:'no-store' });
    if(!res.ok) throw 0;
    videos = await res.json();
  }catch(_){ videos = []; }
}
function renderVideos(filter='all'){
  const grid = document.querySelector('#videoGrid'); if (!grid) return;
  grid.innerHTML = '';
  const list = videos.filter(v => filter==='all' || v.segment===filter);
  if (!list.length){
    const empty = document.createElement('div');
    empty.className = 'notice';
    empty.textContent = LANG==='es'
      ? 'Pronto subiremos historias en video. ¡Vuelve más tarde!'
      : 'We will upload stories soon. Check back later!';
    grid.appendChild(empty);
    return;
  }
  list.forEach(v=>{
    const card = document.createElement('div');
    card.className = 'video-card';
    const title = (LANG==='es' ? v.title_es : (v.title_en || v.title_es));
    card.innerHTML = `
      <div class="video-thumb">
        <button aria-label="${title}">▶</button>
      </div>
      <div class="video-info"><strong>${title}</strong></div>
    `;
    card.querySelector('button').addEventListener('click', ()=>{
      card.querySelector('.video-thumb').innerHTML =
        `<iframe width="100%" height="100%" src="${v.src}" title="${title}" frameborder="0"
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen loading="lazy"></iframe>`;
    });
    grid.appendChild(card);
  });
});

// -------- Año + Menú --------
const y = document.querySelector('#y'); if (y) y.textContent = new Date().getFullYear();
const menuBtn = document.getElementById('menuBtn');
const menu = document.getElementById('menu');
if (menuBtn && menu){ menuBtn.addEventListener('click', ()=> menu.classList.toggle('open')); }

// -------- Init --------
(async function init(){
  await setLang(LANG);
  await loadVideos();
  renderVideos();
  renderExamples();
})();
