// Validacion del payload del informe. Vale la pena que sea estricta y con
// mensajes concretos: del otro lado hay un workflow de n8n que corre una vez por
// mes sin nadie mirando, asi que un 400 que diga "falta actual.pageviews" se
// arregla en minutos y un "Bad Request" pelado cuesta una tarde.
"use strict";
const { SITIOS } = require("./plantilla");

const esNum = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

// Cada desglose es una lista de {<<campo>>: string, visitors: number}, tal cual
// la devuelve /v1/query/web-analytics/visits/aggregate?by=<<campo>>.
const DESGLOSES = [
  ["paises", "country"],
  ["paginas", "requestPath"],
  ["origenes", "referrerHostname"],
  ["dispositivos", "deviceType"],
];

function validar(cuerpo) {
  const e = [];
  const d = cuerpo && typeof cuerpo === "object" ? cuerpo : {};

  if (!SITIOS.includes(d.sitio)) e.push(`sitio debe ser ${SITIOS.join(" o ")}`);
  for (const k of ["mes", "mes_previo"]) {
    if (typeof d[k] !== "string" || !d[k].trim()) e.push(`${k} debe ser un texto no vacio`);
  }
  for (const per of ["actual", "previo"]) {
    const p = d[per];
    if (!p || typeof p !== "object") { e.push(`${per} debe ser un objeto`); continue; }
    for (const k of ["visitors", "pageviews"]) {
      if (!esNum(p[k])) e.push(`${per}.${k} debe ser un numero >= 0`);
    }
  }
  for (const k of ["conversaciones", "leads"]) {
    if (!esNum(d[k])) e.push(`${k} debe ser un numero >= 0`);
  }
  // Opcional. En false el informe dice "no se pudo leer el CRM" en vez de un 0,
  // que se leeria como "no hubo leads" y no es lo mismo.
  if (d.leads_ok !== undefined && typeof d.leads_ok !== "boolean") {
    e.push("leads_ok, si viene, debe ser true o false");
  }
  for (const [k, campo] of DESGLOSES) {
    if (!Array.isArray(d[k])) { e.push(`${k} debe ser una lista`); continue; }
    d[k].forEach((f, i) => {
      if (!f || typeof f !== "object") { e.push(`${k}[${i}] debe ser un objeto`); return; }
      if (typeof f[campo] !== "string") e.push(`${k}[${i}].${campo} debe ser un texto`);
      if (!esNum(f.visitors)) e.push(`${k}[${i}].visitors debe ser un numero >= 0`);
    });
  }
  return e;
}

module.exports = { validar };
