// landing.js (ES/EN, ejemplos, videos, referidos, CTA, PWA redirección) — v3 (consola limpia)
const qs = (s, r=document)=>r.querySelector(s);
const qsa = (s, r=document)=>Array.from(r.querySelectorAll(s));

// -------- i18n --------
const LANG_DEFAULT = (navigator.language||'es').toLowerCase().startsWith('es') ? 'es' : 'en';
let LANG = localStorage.getItem('landing_lang') || LANG_DEFAULT;

async function loadI18n(lang){
  try{
    const res = await fetch(`/landing/i18n/${lang}.json?v=3`, { cache: 'no-store' });
    if (!res.ok) throw new Error('i18n not found');
    return await res.json();
  }catch{ return {}; }
}
function applyI18n(dict){
  qsa('[data-i18n]').forEach(el=>{
    const key = el.getAttribute('data-i18n');
    if (dict && dict[key]) el.innerHTML = dict[key];
  });
  document.documentElement.lang = LANG;
  const btnES = qs('#langES');
  const btnEN = qs('#langEN');
  if (btnES) btnES.setAttribute('aria-pressed', String(LANG==='es'));
  if (btnEN) btnEN.setAttribute('aria-pressed', String(LANG==='en'));
}
async function setLang(lang){
  LANG = lang;
  localStorage.setItem('landing_lang', lang);
  const dict = await loadI18n(lang);
  applyI18n(dict);
  renderExamples();
  renderVideos();
}
const btnES = qs('#langES');
const btnEN = qs('#langEN');
if (btnES) btnES.addEventListener('click', ()=>setLang('es'));
if (btnEN) btnEN.addEventListener('click', ()=>setLang('en'));

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

// -------- Ejemplos (JSON remoto con fallback) --------
const SUG_BASE = 'https://siraia.com/suggestions/v1';
const CAT_MAP = { salud:'salud', cocina:'cocina', legal:'legal', ocio:'ocio', fin:'fin', familia:'familia' };

const FALLBACK_EXAMPLES = {
  es: {
    salud: [
      "Tengo dolor de garganta leve desde ayer, sin fiebre. ¿Qué cuidados caseros puedo seguir y cuándo debería ir al médico?",
      "Quiero empezar una rutina de ejercicio para principiantes de 15 minutos al día. Dame 3 opciones."
    ],
    cocina: [
      "Tengo pollo, jitomate y tortillas. Dame 3 ideas de cena en 20 minutos.",
      "Haz una receta de pasta para 2 personas sin lácteos y en menos de 25 minutos."
    ],
    legal: [
      "Explícame en palabras simples qué significa esta cláusula de mi contrato de renta: [pega el texto].",
      "¿Qué pasos básicos necesito para registrar una marca en mi país?"
    ],
    ocio: [
      "Recomiéndame 5 películas familiares para un niño de 8 años, tono alegre.",
      "Quiero ideas para un plan barato el fin de semana con amigos (4 personas)."
    ],
    fin: [
      "Dame un plan de presupuesto mensual para ingresos de $15,000 MXN con 3 metas de ahorro.",
      "Explícame en sencillo qué es un fondo indexado y cómo empiezo con poco dinero."
    ],
    familia: [
      "Explícame la fotosíntesis como si tuviera 12 años con un ejemplo cotidiano.",
      "Dame 3 ejercicios cortos para estudiar fracciones con un niño de 10 años."
    ]
  },
  en: {
    salud: [
      "I have a mild sore throat since yesterday, no fever. Home care tips and when to see a doctor?",
      "Beginner 15-minute daily workout: give me 3 options."
    ],
    cocina: [
      "I have chicken, tomatoes and tortillas. 3 dinner ideas in 20 minutes.",
      "A pasta recipe for 2, dairy-free, under 25 minutes."
    ],
    legal: [
      "Explain in simple terms this clause from my rental contract: [paste text].",
      "What are the basic steps to register a trademark in my country?"
    ],
    ocio: [
      "Recommend 5 family movies for an 8-year-old, upbeat tone.",
      "Cheap weekend plan ideas with friends (4 people)."
    ],
    fin: [
      "Monthly budget for $1,000 income with 3 saving goals.",
      "Explain index funds in simple words and how to start with little money."
    ],
    familia: [
      "Explain photosynthesis to a 12-year-old with a daily life example.",
      "Give me 3 short exercises to study fractions with a 10-year-old."
    ]
  }
};

async function fetchCat(cat){
  const lang = LANG === 'es' ? 'es' : 'en';
  try{
    const res = await fetch(`${SUG_BASE}/${lang}/${cat}.json?v=1`, { mode: 'cors', cache: 'no-store' });
    if (!res.ok) throw new Error('bad status');
    const data = await res.json();
    const items = Array.isArray(data.prompts) ? data.prompts : [];
    return items.slice(0, 6);
  }catch(e){
    return (FALLBACK_EXAMPLES[lang] && FALLBACK_EXAMPLES[lang][cat]) ? FALLBACK_EXAMPLES[lang][cat] : [];
  }
}

let currentCat = 'salud';
async function renderExamples(){
  // activar chip
  qsa('.categories .chip').forEach(ch=>{
    ch.classList.toggle('active', ch.dataset.cat === currentCat);
  });
  const wrap = qs('#exampleList');
  if (!wrap) return;
  wrap.innerHTML = '<div class="notice">...</div>';

  const items = await fetchCat(CAT_MAP[currentCat]);
  wrap.innerHTML = '';

  // Mostrar sólo 3 ejemplos, SIN botones de copiar/usar
  items.slice(0, 3).forEach(text => {
    const card = document.createElement('div');
    card.className = 'example';
    const p = document.createElement('p');
    p.textContent = text; // sin innerHTML para evitar XSS
    card.appendChild(p);
    wrap.appendChild(card);
  });
}

// listeners de categorías
qsa('.categories .chip').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    currentCat = btn.dataset.cat;
    renderExamples();
  });
});

// -------- Videos --------
let videos = [];
async function loadVideos(){
  try{
    const res = await fetch('/landing/videos.json?v=3', { cache: 'no-store' });
    if (!res.ok) throw new Error('no videos');
    videos = await res.json();
  }catch{ videos = []; }
}
function renderVideos(filter='all'){
  const grid = document.querySelector('#videoGrid');
  if (!grid) return;
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
      <div class="video-info">
        <strong>${title}</strong>
      </div>
    `;
    card.querySelector('button').addEventListener('click', ()=>{
      card.querySelector('.video-thumb').innerHTML =
        `<iframe width="100%" height="100%" src="${v.src}" title="${title}" frameborder="0" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>`;
    });
    grid.appendChild(card);
  });
}
qsa('.filters .chip').forEach(ch=>{
  ch.addEventListener('click', ()=>{
    qsa('.filters .chip').forEach(x=>x.classList.remove('active'));
    ch.classList.add('active');
    renderVideos(ch.dataset.filter || 'all');
  });
});

// -------- Footer año --------
const y = document.querySelector('#y');
if (y) y.textContent = new Date().getFullYear();

// -------- Init --------
(async function init(){
  await setLang(LANG);
  await loadVideos();
  renderVideos();
  renderExamples();
})();

// Menú hamburguesa
const menuBtn = document.getElementById('menuBtn');
const menu = document.getElementById('menu');
if (menuBtn && menu){
  menuBtn.addEventListener('click', ()=> menu.classList.toggle('open'));
}
