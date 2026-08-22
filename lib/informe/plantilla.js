// Informe mensual de analytics de Bromteck: HTML de una pagina A4, listo para
// imprimir a PDF. UNICA fuente de verdad del diseno — la usan tanto el endpoint
// (api/informe-pdf.js) como la vista previa local (scripts/informe-preview.js).
// Si hay que tocar el diseno, se toca aca y nada mas.
//
// Es UNA plantilla con DOS pieles. Las pieles no son "una paleta linda": son los
// tokens reales de cada web, copiados de su fuente.
//   bromteck.com -> bromteck-site/app/globals.css + app/[locale]/layout.tsx
//   bromteck.tv  -> bromteck-tv/design-v2/assets/css/site.css + index.html
"use strict";
const assets = require("./assets.json");

// ---------- helpers ----------
const num = (n) => Number(n || 0).toLocaleString("es-AR");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

const CARA_FUENTES = assets.fuentes
  .map((f) => `@font-face{font-family:'${f.familia}';font-weight:${f.peso};font-style:normal;` +
              `src:url(data:font/ttf;base64,${f.b64}) format('truetype')}`)
  .join("\n");

// Etiquetas legibles. Vercel devuelve codigos ISO y hostnames crudos; un informe
// a gerencia no puede decir "GT" ni "com.linkedin.android".
const PAISES = { AR:"Argentina", US:"EE. UU.", MX:"México", BR:"Brasil", CL:"Chile",
  CO:"Colombia", PE:"Perú", UY:"Uruguay", PY:"Paraguay", EC:"Ecuador", VE:"Venezuela",
  BO:"Bolivia", ES:"España", DE:"Alemania", GB:"Reino Unido", FR:"Francia", IT:"Italia",
  NL:"Países Bajos", CR:"Costa Rica", PA:"Panamá", GT:"Guatemala", SV:"El Salvador",
  HN:"Honduras", NI:"Nicaragua", DO:"Rep. Dominicana", CU:"Cuba", PT:"Portugal",
  CH:"Suiza", AT:"Austria", BE:"Bélgica", SE:"Suecia", NO:"Noruega", DK:"Dinamarca",
  FI:"Finlandia", PL:"Polonia", CZ:"Chequia", RO:"Rumania", GR:"Grecia", IE:"Irlanda",
  IL:"Israel", AE:"Emiratos Árabes", SA:"Arabia Saudita", TR:"Turquía", RU:"Rusia",
  UA:"Ucrania", KR:"Corea del Sur", TW:"Taiwán", HK:"Hong Kong", SG:"Singapur",
  MY:"Malasia", TH:"Tailandia", VN:"Vietnam", PH:"Filipinas", ID:"Indonesia",
  NZ:"Nueva Zelanda", ZA:"Sudáfrica", EG:"Egipto", MA:"Marruecos", IN:"India",
  CN:"China", JP:"Japón", CA:"Canadá", AU:"Australia" };

const ORIGENES = { "":"Directo", "google.com":"Google", "bing.com":"Bing",
  "duckduckgo.com":"DuckDuckGo", "linkedin.com":"LinkedIn",
  "com.linkedin.android":"LinkedIn (app)", "chatgpt.com":"ChatGPT",
  "perplexity.ai":"Perplexity", "claude.ai":"Claude", "vercel.com":"Vercel",
  "facebook.com":"Facebook", "instagram.com":"Instagram", "t.co":"X (Twitter)",
  "youtube.com":"YouTube", "github.com":"GitHub" };

const DISPOSITIVOS = { desktop:"Escritorio", mobile:"Móvil", tablet:"Tablet", "":"Sin dato" };

// Comparacion contra el mes previo.
//
// El guard mira los VISITANTES del mes previo y aplica a las DOS metricas: si el
// mes entero fue chico, cualquier porcentaje es ruido. Julio 2026 tuvo 10
// visitantes (Analytics se activo el 29-jul) y paginas vistas daba "1655%", que
// arriba de un mail a gerencia no informa nada.
function delta(actual, previo, mesCorto, baseChica) {
  const d = actual - previo;
  if (baseChica || previo < 20)
    return { cls: "neutro", txt: `${d >= 0 ? "+" : "−"}${num(Math.abs(d))} vs. ${mesCorto}`, nota: true };
  if (d === 0) return { cls: "neutro", txt: `sin cambio vs. ${mesCorto}`, nota: false };
  const pct = Math.round((d / previo) * 100);
  return d > 0 ? { cls: "sube", txt: `▲ ${pct}% vs. ${mesCorto}`, nota: false }
               : { cls: "baja", txt: `▼ ${Math.abs(pct)}% vs. ${mesCorto}`, nota: false };
}

// Filas con barra proporcional al maximo de su propia tabla. "Otros" al final.
//
// `total` activa el modo porcentaje, y SOLO es legitimo cuando la dimension
// particiona la base de visitantes: cada visitante tiene exactamente un pais y
// un dispositivo, asi que esas suman 100%. Referrers y rutas NO particionan (un
// visitante entra varias veces desde origenes distintos y ve varias paginas):
// medidos en agosto sumaban 116% y 132%, o sea que ahi el porcentaje mentiria.
// Por eso el modo se verifica contra los datos en vez de confiar en la llamada:
// si algun mes la API cambia el agrupamiento, cae solo a numeros absolutos.
const TOLERANCIA_PARTICION = 0.02;

function filas(data, campoLabel, mapa, total) {
  const rows = (data || []).map((r) => ({
    label: r[campoLabel] === "Others" ? "Otros"
      : (mapa && mapa[r[campoLabel]] !== undefined) ? mapa[r[campoLabel]] : (r[campoLabel] || "—"),
    esOtros: r[campoLabel] === "Others",
    v: r.visitors || 0,
  })).sort((a, b) => (a.esOtros - b.esOtros) || (b.v - a.v));

  if (!rows.length) return `<div class="vacio">Sin datos este mes</div>`;

  const suma = rows.reduce((a, r) => a + r.v, 0);
  const enPorcentaje = Boolean(total) && suma > 0 &&
    Math.abs(suma - total) / total <= TOLERANCIA_PARTICION;

  // Enteros a proposito: con bases chicas (61 visitantes) un decimal es
  // precision falsa, porque atras hay una sola persona. El piso "<1%" evita
  // que una fila real aparezca como 0%.
  const valor = (v) => {
    if (!enPorcentaje) return num(v);
    const p = (v / suma) * 100;
    return p > 0 && p < 0.5 ? "&lt;1%" : `${Math.round(p)}%`;
  };

  const max = Math.max(1, ...rows.map((r) => r.v));
  return rows.map((r) => `
    <div class="fila">
      <div class="fl">${esc(r.label)}</div>
      <div class="ft"><div class="fb" style="width:${Math.max(2, (r.v / max) * 100)}%"></div></div>
      <div class="fv">${valor(r.v)}</div>
    </div>`).join("");
}

// ---------- pieles ----------
const MARCAS = {
  "bromteck.com": {
    dominio: "bromteck.com",
    css: `
      :root{
        --bg:#ffffff; --header:#0a0a0a; --header-ink:#ffffff;
        --ink:#0a0a0a; --muted:#5c5c5c; --faint:#9a9a9a; --line:#e9e9e9;
        --ac:#ee4a26; --track:#efefef;
        --chip-sube-bg:rgba(70,211,154,.16); --chip-sube:#177a54;
        --chip-baja-bg:rgba(200,58,24,.10);  --chip-baja:#c83a18;
        --chip-neutro-bg:#f2f2f2;            --chip-neutro:#5c5c5c;
        --font-body:'Host Grotesk',sans-serif; --font-display:'Host Grotesk',sans-serif;
        --font-mono:'Geist Mono',monospace;
        --peso-display:800; --kpi-size:46pt; --mes-size:20pt;
        --panel-bg:transparent; --panel-border:none; --panel-pad:0;
        --panel-top:1px solid var(--line); --fnote:6.4pt; --rutas-col:41mm;
      }
      .rule{height:3px;background:linear-gradient(90deg,#ff7e1f,#ee4a26 45%,#c83a18)}
      .kicker::before{content:'';display:inline-block;width:7px;height:7px;background:var(--ac);margin-right:7px;vertical-align:0}
    `,
  },
  "bromteck.tv": {
    dominio: "bromteck.tv",
    css: `
      :root{
        --bg:#050611; --header:#060714; --header-ink:#F1F2FC;
        --ink:#F1F2FC; --muted:#A8ACD9; --faint:#6B70A0; --line:rgba(168,172,217,.16);
        --ac:#6E76FF; --track:rgba(168,172,255,.13);
        --chip-sube-bg:rgba(127,224,180,.13); --chip-sube:#7FE0B4;
        --chip-baja-bg:rgba(217,165,165,.13); --chip-baja:#D9A5A5;
        --chip-neutro-bg:rgba(168,172,217,.12); --chip-neutro:#A8ACD9;
        --font-body:'Hanken Grotesk',sans-serif; --font-display:'Unbounded',sans-serif;
        --font-mono:'Martian Mono',monospace;
        --peso-display:700; --kpi-size:33pt; --mes-size:15.5pt;
        --panel-bg:#0A0C22; --panel-border:1px solid rgba(168,172,217,.14);
        --panel-pad:5mm 5.5mm; --panel-top:none; --fnote:5.9pt; --rutas-col:47mm;
      }
      .panel{border-radius:10px}
      .rule{height:1px;background:linear-gradient(90deg,transparent,rgba(168,172,217,.38),transparent)}
    `,
  },
};

const SITIOS = Object.keys(MARCAS);

// ---------- plantilla ----------
function html(datos) {
  const m = MARCAS[datos.sitio];
  if (!m) throw new Error(`sitio desconocido: ${datos.sitio} (esperaba ${SITIOS.join(" o ")})`);

  const mesCorto = String(datos.mes_previo || "").split(" ")[0] || "el mes previo";
  const baseChica = (datos.previo.visitors || 0) < 20;
  const dv = delta(datos.actual.visitors, datos.previo.visitors, mesCorto, baseChica);
  const dp = delta(datos.actual.pageviews, datos.previo.pageviews, mesCorto, baseChica);
  const conNota = dv.nota || dp.nota;

  // Ruido de desarrollo: localhost no es un origen real de trafico.
  const origenes = (datos.origenes || []).filter(
    (r) => !/^(127\.|localhost|0\.0\.0\.0)/.test(r.referrerHostname || ""));

  const pctConv  = datos.actual.visitors ? (datos.conversaciones / datos.actual.visitors) * 100 : 0;
  const pctLeads = datos.actual.visitors ? (datos.leads / datos.actual.visitors) * 100 : 0;
  const fmtPct = (p) => p.toLocaleString("es-AR", { maximumFractionDigits: 1 });
  const maxF = Math.max(1, datos.actual.visitors);
  const barra = (v) => Math.max(v > 0 ? 1.6 : 0, (v / maxF) * 100);
  const chip = (x) => `<span class="chip ${x.cls}">${x.txt}${x.nota ? "&thinsp;*" : ""}</span>`;

  const generado = new Date(datos.generado_el || Date.now())
    .toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" });

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
  ${CARA_FUENTES}
  ${m.css}
  *{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  @page{size:A4;margin:0}
  html,body{background:var(--bg)}
  body{font-family:var(--font-body);color:var(--ink);font-size:9.5pt;line-height:1.45}
  .page{width:210mm;height:296.6mm;overflow:hidden;display:flex;flex-direction:column;background:var(--bg)}

  header{background:var(--header);color:var(--header-ink);padding:11mm 16mm 9mm;
    display:flex;justify-content:space-between;align-items:flex-end}
  .wordmark{height:6.2mm;display:block}
  .dominio{font-family:var(--font-mono);font-size:8pt;letter-spacing:.14em;color:var(--ac);margin-top:3.4mm}
  .meta{text-align:right}
  .kicker-top{font-family:var(--font-mono);font-size:6.6pt;letter-spacing:.2em;text-transform:uppercase;opacity:.55}
  .mes{font-family:var(--font-display);font-weight:var(--peso-display);font-size:var(--mes-size);letter-spacing:-.01em;margin-top:1.6mm}
  .vs{font-size:8pt;opacity:.5;margin-top:1mm}

  main{flex:1;padding:10mm 16mm 0}
  .kicker{font-family:var(--font-mono);font-size:7pt;letter-spacing:.18em;text-transform:uppercase;color:var(--faint)}
  .panel .kicker, .funnel .kicker{color:var(--ac)}
  .unidad{color:var(--faint);letter-spacing:.1em}
  .unidad::before{content:'·';margin:0 1.4mm 0 .8mm;opacity:.55}

  .kpis{display:grid;grid-template-columns:1fr 1fr;gap:10mm;margin-bottom:9.5mm}
  .kpi .n{font-family:var(--font-display);font-weight:var(--peso-display);font-size:var(--kpi-size);
    letter-spacing:-.02em;line-height:1.04;margin:2.6mm 0 2.2mm;font-variant-numeric:tabular-nums}
  .chip{display:inline-block;font-family:var(--font-mono);font-size:6.8pt;letter-spacing:.02em;
    padding:1.2mm 2.6mm;border-radius:99px}
  .chip.sube{background:var(--chip-sube-bg);color:var(--chip-sube)}
  .chip.baja{background:var(--chip-baja-bg);color:var(--chip-baja)}
  .chip.neutro{background:var(--chip-neutro-bg);color:var(--chip-neutro)}

  .funnel{margin-bottom:9.5mm}
  .frow{display:grid;grid-template-columns:56mm 1fr 16mm;gap:4mm;align-items:center;margin-top:3.6mm}
  .frow .fl{font-weight:600;font-size:9.5pt}
  .frow .fsub{font-size:7.4pt;color:var(--faint);font-weight:400;margin-top:.4mm}
  .frow .ft{height:4.2mm;background:var(--track);border-radius:99px;overflow:hidden}
  .frow .fb{height:100%;background:var(--ac);border-radius:99px}
  .frow .fv{font-family:var(--font-mono);font-size:10pt;text-align:right;font-variant-numeric:tabular-nums}

  .grid{display:grid;grid-template-columns:1fr 1fr;gap:7mm 10mm}
  .panel{background:var(--panel-bg);border:var(--panel-border);padding:var(--panel-pad);
    border-top:var(--panel-top);padding-top:4.5mm}
  .fila{display:grid;grid-template-columns:34mm 1fr 12mm;gap:3mm;align-items:center;margin-top:2.9mm}
  .fila .fl{font-size:8.6pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .fila .ft{height:1.6mm;background:var(--track);border-radius:99px;overflow:hidden}
  .fila .fb{height:100%;background:var(--ac);border-radius:99px}
  .fila .fv{font-family:var(--font-mono);font-size:8.2pt;text-align:right;color:var(--muted);font-variant-numeric:tabular-nums}
  .rutas .fila{grid-template-columns:var(--rutas-col) 1fr 9mm}
  .rutas .fl{font-family:var(--font-mono);font-size:7.4pt}
  .vacio{font-size:8.4pt;color:var(--faint);margin-top:3mm}

  footer{padding:5mm 16mm 8mm;display:flex;justify-content:space-between;align-items:flex-end;gap:8mm}
  .fnote{font-family:var(--font-mono);font-size:var(--fnote);color:var(--faint);line-height:1.7}
  .ftag{font-family:var(--font-mono);font-size:6.4pt;letter-spacing:.16em;text-transform:uppercase;
    color:var(--faint);border:1px solid var(--line);border-radius:99px;padding:1.1mm 2.8mm;white-space:nowrap}
  .sep{border-top:1px solid var(--line);margin:0 16mm}
  </style></head><body><div class="page">

  <header>
    <div>
      <img class="wordmark" src="data:image/png;base64,${assets.logos[datos.sitio]}" alt="Bromteck">
      <div class="dominio">${m.dominio}</div>
    </div>
    <div class="meta">
      <div class="kicker-top">Informe mensual de analytics</div>
      <div class="mes">${esc(datos.mes.charAt(0).toUpperCase() + datos.mes.slice(1))}</div>
      <div class="vs">comparado con ${esc(datos.mes_previo)}</div>
    </div>
  </header>
  <div class="rule"></div>

  <main>
    <section class="kpis">
      <div class="kpi">
        <div class="kicker">Visitantes</div>
        <div class="n">${num(datos.actual.visitors)}</div>
        ${chip(dv)}
      </div>
      <div class="kpi">
        <div class="kicker">Páginas vistas</div>
        <div class="n">${num(datos.actual.pageviews)}</div>
        ${chip(dp)}
      </div>
    </section>

    <section class="funnel">
      <div class="kicker">Del tráfico a los contactos</div>
      <div class="frow">
        <div><div class="fl">Visitantes</div></div>
        <div class="ft"><div class="fb" style="width:100%"></div></div>
        <div class="fv">${num(datos.actual.visitors)}</div>
      </div>
      <div class="frow">
        <div><div class="fl">Conversaciones con el asistente</div>
             <div class="fsub">${fmtPct(pctConv)}% de los visitantes</div></div>
        <div class="ft"><div class="fb" style="width:${barra(datos.conversaciones)}%"></div></div>
        <div class="fv">${num(datos.conversaciones)}</div>
      </div>
      <div class="frow">
        <div><div class="fl">Leads cargados en el CRM</div>
             <div class="fsub">${datos.leads > 0 ? fmtPct(pctLeads) + "% de los visitantes" : "sin leads este mes"}</div></div>
        <div class="ft"><div class="fb" style="width:${barra(datos.leads)}%"></div></div>
        <div class="fv">${num(datos.leads)}</div>
      </div>
    </section>

    <section class="grid">
      <div class="panel"><div class="kicker">Países <span class="unidad">% de visitantes</span></div>${filas(datos.paises, "country", PAISES, datos.actual.visitors)}</div>
      <div class="panel rutas"><div class="kicker">Páginas más vistas <span class="unidad">visitantes</span></div>${filas(datos.paginas, "requestPath", null)}</div>
      <div class="panel"><div class="kicker">Cómo llegaron <span class="unidad">visitantes</span></div>${filas(origenes, "referrerHostname", ORIGENES)}</div>
      <div class="panel"><div class="kicker">Dispositivos <span class="unidad">% de visitantes</span></div>${filas(datos.dispositivos, "deviceType", DISPOSITIVOS, datos.actual.visitors)}</div>
    </section>
  </main>

  <div class="sep"></div>
  <footer>
    <div class="fnote">
      Generado automáticamente · ${generado} · Vercel Web Analytics · Supabase · Insightly CRM${conNota
        ? `<br>* ${mesCorto} tuvo menos de 20 visitantes: se muestra el cambio absoluto, no un porcentaje.`
        : ""}
    </div>
    <div class="ftag">Uso interno</div>
  </footer>
  </div></body></html>`;
}

// Nombre del archivo adjunto: "informe-bromteck-com-agosto-2026.pdf".
function nombreArchivo(datos) {
  const mes = String(datos.mes).toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-");
  return `informe-${datos.sitio.replace(/\./g, "-")}-${mes}.pdf`;
}

module.exports = { html, nombreArchivo, SITIOS };
