/**
 * ══════════════════════════════════════════════════════════
 *  CumbreGear — Integración Supabase
 *  Archivo: supabase-cumbregear.js
 *  Incluir ANTES del cierre </body> en index.html
 *
 *  CONFIGURACIÓN NECESARIA:
 *    1. Crea un proyecto en https://supabase.com
 *    2. Sustituye SUPABASE_URL y SUPABASE_ANON_KEY abajo
 *    3. Ejecuta el SQL de /sql/schema.sql en el editor SQL de Supabase
 *    4. Activa Row Level Security con las políticas del schema
 * ══════════════════════════════════════════════════════════
 */

// ── CONFIGURACIÓN ──────────────────────────────────────────
const SUPABASE_URL  = 'https://kartoonberg-cumbregear.supabase.co';   // ← cambia esto
const SUPABASE_ANON = 'pfnzvbslhpfvzkuojrrq';                       // ← cambia esto
const AFFILIATE_TAG = 'TU-TAG-AFILIADO';                    // ← cambia esto

// ── CLIENTE SUPABASE (sin SDK, fetch nativo) ───────────────
const sb = {
  async query(table, options = {}) {
    let url = `${SUPABASE_URL}/rest/v1/${table}?`;
    if (options.select)  url += `select=${options.select}&`;
    if (options.filter)  url += `${options.filter}&`;
    if (options.order)   url += `order=${options.order}&`;
    if (options.limit)   url += `limit=${options.limit}&`;
    const res = await fetch(url.replace(/&$/, ''), {
      headers: {
        'apikey': SUPABASE_ANON,
        'Authorization': `Bearer ${SUPABASE_ANON}`,
        'Content-Type': 'application/json',
      }
    });
    if (!res.ok) throw new Error(`Supabase error: ${res.status}`);
    return res.json();
  },

  async insert(table, data) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON,
        'Authorization': `Bearer ${SUPABASE_ANON}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || `Insert error: ${res.status}`);
    }
    return res.json();
  },

  async rpc(fn, params = {}) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON,
        'Authorization': `Bearer ${SUPABASE_ANON}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error(`RPC error: ${res.status}`);
    return res.json();
  }
};


// ══════════════════════════════════════════════════════════
//  1. NEWSLETTER — Guarda emails en Supabase
// ══════════════════════════════════════════════════════════

async function suscribirNewsletter() {
  const input  = document.getElementById('nlEmail');
  const btn    = document.getElementById('nlBtn');
  const msg    = document.getElementById('nlMsg');
  const email  = input?.value?.trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showNlMsg('⚠️ Introduce un email válido.', 'warn');
    return;
  }

  btn.disabled  = true;
  btn.textContent = 'Enviando…';

  try {
    await sb.insert('suscriptores', {
      email,
      fuente: 'newsletter_web',
      fecha_registro: new Date().toISOString(),
    });
    input.value = '';
    showNlMsg('✅ ¡Apuntado! Revisa tu bandeja de entrada.', 'ok');
    // Evento analytics opcional
    if (typeof gtag !== 'undefined') gtag('event', 'newsletter_signup');
  } catch (err) {
    // Código 23505 = email duplicado en Postgres
    if (err.message?.includes('duplicate') || err.message?.includes('23505')) {
      showNlMsg('📧 Ya estás suscrito con ese email.', 'info');
    } else {
      showNlMsg('❌ Error al suscribirse. Inténtalo de nuevo.', 'error');
      console.error('[Newsletter]', err);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Suscribirme gratis';
  }
}

function showNlMsg(text, type) {
  const msg = document.getElementById('nlMsg');
  if (!msg) return;
  const colors = { ok: '#2D6A4F', warn: '#E07B39', info: '#185FA5', error: '#c0392b' };
  msg.textContent = text;
  msg.style.color = colors[type] || '#fff';
  msg.style.display = 'block';
  setTimeout(() => { msg.style.display = 'none'; }, 5000);
}


// ══════════════════════════════════════════════════════════
//  2. CONTADOR DE VISITAS — Registra cada apertura de artículo
// ══════════════════════════════════════════════════════════

async function registrarVisita(articuloKey) {
  try {
    // Llama a una función RPC de Postgres que hace UPSERT atómico
    await sb.rpc('incrementar_visitas', { p_slug: articuloKey });
  } catch (err) {
    // Silencioso: no interrumpir la UX si falla el tracking
    console.warn('[Visitas]', err);
  }
}

// Hook: inyectar en la función openArticle existente
const _openArticleOriginal = window.openArticle;
window.openArticle = function(key) {
  _openArticleOriginal(key);
  registrarVisita(key);
};


// ══════════════════════════════════════════════════════════
//  3. SISTEMA DE VALORACIONES
//  Inyecta un widget de estrellas al final de cada artículo
// ══════════════════════════════════════════════════════════

// Llamado desde openArticle tras insertar el template
function inyectarWidgetValoracion(articuloKey) {
  const body = document.getElementById('modalContent');
  if (!body) return;
  const existing = body.querySelector('.cg-rating-widget');
  if (existing) existing.remove();

  const widget = document.createElement('div');
  widget.className = 'cg-rating-widget';
  widget.innerHTML = `
    <div class="cg-rating-inner">
      <p class="cg-rating-label">¿Te ha sido útil este artículo?</p>
      <div class="cg-stars" id="cgStars_${articuloKey}">
        ${[1,2,3,4,5].map(n =>
          `<button class="cg-star" data-val="${n}" title="${n} estrella${n>1?'s':''}" onclick="enviarValoracion('${articuloKey}',${n},this.closest('.cg-stars'))">★</button>`
        ).join('')}
      </div>
      <p class="cg-rating-avg" id="cgAvg_${articuloKey}"></p>
    </div>`;
  body.appendChild(widget);
  cargarMediaValoracion(articuloKey);
}

async function enviarValoracion(slug, puntuacion, starsEl) {
  // Evitar doble voto en la misma sesión
  const key = `rated_${slug}`;
  if (sessionStorage.getItem(key)) {
    mostrarAvgMsg(slug, '¡Ya has valorado este artículo!');
    return;
  }

  // Pintar estrellas optimistamente
  starsEl.querySelectorAll('.cg-star').forEach((s, i) => {
    s.classList.toggle('active', i < puntuacion);
  });

  try {
    await sb.insert('valoraciones', {
      articulo_slug: slug,
      puntuacion,
      creado_en: new Date().toISOString(),
    });
    sessionStorage.setItem(key, '1');
    mostrarAvgMsg(slug, '¡Gracias por tu valoración! ⭐');
    cargarMediaValoracion(slug);
  } catch (err) {
    mostrarAvgMsg(slug, 'Error al enviar. Inténtalo de nuevo.');
    console.error('[Valoración]', err);
  }
}

async function cargarMediaValoracion(slug) {
  try {
    const data = await sb.rpc('media_valoraciones', { p_slug: slug });
    if (data?.media) {
      const avg   = parseFloat(data.media).toFixed(1);
      const total = data.total || 0;
      mostrarAvgMsg(slug, `Valoración media: ${avg}/5 (${total} voto${total !== 1 ? 's' : ''})`);
    }
  } catch (err) {
    console.warn('[Media valoración]', err);
  }
}

function mostrarAvgMsg(slug, texto) {
  const el = document.getElementById(`cgAvg_${slug}`);
  if (el) el.textContent = texto;
}

// Hook en openArticle para inyectar widget después del template
const _openArticle2 = window.openArticle;
window.openArticle = function(key) {
  _openArticle2(key);
  // Esperar al siguiente tick para que el innerHTML ya esté insertado
  requestAnimationFrame(() => inyectarWidgetValoracion(key));
};


// ══════════════════════════════════════════════════════════
//  4. TAG DE AFILIADO CENTRALIZADO
//  Reemplaza "TU-TAG-AFILIADO" en todos los enlaces Amazon
// ══════════════════════════════════════════════════════════

function normalizarTagsAfiliado() {
  document.querySelectorAll('a[href*="amazon.es"]').forEach(a => {
    if (a.href.includes('TU-TAG-AFILIADO') || !a.href.includes('tag=')) {
      // Si no tiene tag o tiene el placeholder, añadir/reemplazar
      const url = new URL(a.href);
      url.searchParams.set('tag', AFFILIATE_TAG);
      a.href = url.toString();
    }
  });
}

// Ejecutar en cada apertura de modal (los templates cargan dinámicamente)
const _openArticle3 = window.openArticle;
window.openArticle = function(key) {
  _openArticle3(key);
  requestAnimationFrame(normalizarTagsAfiliado);
};


// ══════════════════════════════════════════════════════════
//  5. BUSCADOR MEJORADO — busca sobre estructura de datos real
// ══════════════════════════════════════════════════════════

// Datos estructurados extraídos del HTML original
const DB_ARTICULOS = [
  { key:'botas',                cats:['guia','calzado'],         titulo:'Las 10 mejores botas de trekking de 2026', keywords:['bota','botas','calzado','salomon','scarpa','merrell','trekking'] },
  { key:'mochilas',             cats:['comparativa','mochilas'], titulo:'Osprey Atmos vs Deuter Aircontact',        keywords:['mochila','mochilas','osprey','deuter','atmos','aircontact','trekking'] },
  { key:'gps',                  cats:['comparativa','gps'],      titulo:'Garmin Fenix 8 vs Suunto Race',           keywords:['gps','garmin','suunto','reloj','fenix','race','navegacion'] },
  { key:'calzado_principiantes',cats:['longtail','calzado'],     titulo:'Mejor bota para principiantes -100€',     keywords:['principiante','principiantes','barato','economico','100','merrell','moab'] },
  { key:'longtail_camino',      cats:['longtail'],               titulo:'Qué llevar al Camino de Santiago',        keywords:['camino','santiago','peregrino','equipamiento','lista'] },
  { key:'botiquin',             cats:['guia','seguridad'],       titulo:'Botiquín de primeros auxilios',           keywords:['botiquin','primeros auxilios','seguridad','emergencia','compeed'] },
  { key:'elegir_botas',         cats:['guia','calzado'],         titulo:'Cómo elegir botas de montaña',            keywords:['elegir','elegir botas','guia','como','membranas','gore-tex'] },
  { key:'que_llevar',           cats:['guia'],                   titulo:'Qué llevar en la mochila — lista',        keywords:['que llevar','lista','mochila','imprescindible','checklist'] },
  { key:'ruta_aneto',           cats:['ruta'],                   titulo:'Pico Aneto — Pirineo',                    keywords:['aneto','pirineo','cumbre','3000','alta montaña'] },
  { key:'ruta_europa',          cats:['ruta'],                   titulo:'Picos de Europa',                         keywords:['picos','europa','picos de europa','asturias','cantabria'] },
  { key:'ruta_mulhacen',        cats:['ruta'],                   titulo:'Mulhacén — Sierra Nevada',                keywords:['mulhacen','sierra nevada','granada','iberia','cumbre'] },
  { key:'ruta_montserrat',      cats:['ruta'],                   titulo:'Montserrat — Sant Joan',                  keywords:['montserrat','cataluña','barcelona','cremallera','monasterio'] },
  { key:'ruta_ordesa',          cats:['ruta'],                   titulo:'Ordesa — Faja de Pelay',                  keywords:['ordesa','faja de pelay','pirineo','cañon','huesca'] },
];

function buscarArticulos(q) {
  if (!q) return [];
  const qLow = q.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return DB_ARTICULOS.filter(art => {
    const haystack = [...art.keywords, art.titulo.toLowerCase()].join(' ')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return haystack.includes(qLow) || art.cats.some(c => qLow.includes(c));
  });
}

// Sobreescribir el handleSearch original con la versión mejorada
window.handleSearch = function(e) {
  if (e.key !== 'Enter') return;
  const q = e.target.value.trim();
  if (!q) return;

  const resultados = buscarArticulos(q);

  if (resultados.length === 1) {
    // Un solo resultado → abrir directamente
    openArticle(resultados[0].key);
  } else if (resultados.length > 1) {
    // Varios resultados → mostrar listado en modal
    mostrarResultadosBusqueda(q, resultados);
  } else {
    // Sin resultados → ir a sección productos como fallback
    const sections = ['guias','productos','rutas'];
    const seccion = sections.find(s => q.toLowerCase().includes(s)) || 'productos';
    navScroll(seccion);
  }

  e.target.value = '';
  e.target.blur();
};

function mostrarResultadosBusqueda(q, resultados) {
  const html = `
    <div style="padding:1.5rem">
      <h2 style="font-family:var(--serif);font-size:1.2rem;margin-bottom:1rem">
        Resultados para "<em>${q}</em>"
      </h2>
      <div style="display:flex;flex-direction:column;gap:.6rem">
        ${resultados.map(art => `
          <button onclick="openArticle('${art.key}')"
            style="background:var(--white);border:1px solid var(--border);border-radius:var(--radius);
                   padding:.75rem 1rem;text-align:left;cursor:pointer;transition:var(--trans);font-family:var(--sans);"
            onmouseover="this.style.borderColor='var(--green)'"
            onmouseout="this.style.borderColor='var(--border)'">
            <span style="font-weight:600;font-size:.85rem;color:var(--text)">${art.titulo}</span>
            <br><span style="font-size:.72rem;color:var(--muted)">${art.cats.join(' · ')}</span>
          </button>`).join('')}
      </div>
    </div>`;

  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}


// ══════════════════════════════════════════════════════════
//  ESTILOS DEL WIDGET DE VALORACIÓN (inyectados en <head>)
// ══════════════════════════════════════════════════════════

const ratingStyles = document.createElement('style');
ratingStyles.textContent = `
  .cg-rating-widget {
    border-top: 1px solid var(--border);
    margin: 1.5rem 1.75rem 0;
    padding: 1.25rem 0 2rem;
  }
  .cg-rating-inner { text-align: center; }
  .cg-rating-label {
    font-size: .8rem;
    color: var(--muted);
    margin-bottom: .65rem;
    font-weight: 500;
  }
  .cg-stars {
    display: flex;
    justify-content: center;
    gap: .3rem;
    margin-bottom: .5rem;
  }
  .cg-star {
    font-size: 1.75rem;
    background: none;
    border: none;
    cursor: pointer;
    color: #ddd;
    transition: color .15s, transform .1s;
    line-height: 1;
    padding: 0 2px;
  }
  .cg-star:hover,
  .cg-star.active { color: var(--orange); }
  .cg-stars:hover .cg-star { color: var(--orange); opacity: .5; }
  .cg-stars:hover .cg-star:hover ~ .cg-star { color: #ddd; opacity: 1; }
  .cg-star:hover { transform: scale(1.15); opacity: 1 !important; }
  .cg-rating-avg {
    font-size: .76rem;
    color: var(--muted);
    min-height: 1.2rem;
  }

  /* Estilos feedback newsletter */
  #nlMsg {
    display: none;
    font-size: .78rem;
    margin-top: .65rem;
    font-weight: 500;
  }
`;
document.head.appendChild(ratingStyles);


// ══════════════════════════════════════════════════════════
//  INIT — Ejecutar al cargar la página
// ══════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  // 1. Normalizar tags de afiliado en los enlaces estáticos ya visibles
  normalizarTagsAfiliado();

  // 2. Actualizar footer con año dinámico
  const yearEl = document.getElementById('footerYear');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // 3. Conectar botón del newsletter
  const nlBtn = document.getElementById('nlBtn');
  if (nlBtn) nlBtn.addEventListener('click', suscribirNewsletter);

  // Permitir Enter en el input
  const nlInput = document.getElementById('nlEmail');
  if (nlInput) nlInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') suscribirNewsletter();
  });
});
