// Informe mensual de analytics -> PDF brandeado.
//
// Existe porque n8n Cloud no puede renderizar PDFs (no tiene navegador). El
// workflow "Bromteck - Informe mensual de analytics" arma los numeros, se los
// manda aca, y adjunta el PDF que vuelve. El diseno vive en lib/informe/
// plantilla.js — este archivo solo es el transporte.
//
//   POST /api/informe-pdf          -> application/pdf
//   POST /api/informe-pdf?formato=html -> el HTML, para diagnosticar sin abrir un PDF
//
// Auth: header  x-informe-token: <INFORME_TOKEN>
"use strict";
const crypto = require("crypto");
const chromium = require("@sparticuz/chromium");
const puppeteer = require("puppeteer-core");

const { html, nombreArchivo } = require("../lib/informe/plantilla");
const { validar } = require("../lib/informe/validar");

// Comparacion de tiempo constante: sin esto el largo de la respuesta filtra
// informacion del token. Va sobre hashes para que timingSafeEqual no tire por
// diferencia de longitud.
function tokenValido(recibido, esperado) {
  if (typeof recibido !== "string" || !recibido) return false;
  const h = (s) => crypto.createHash("sha256").update(String(s)).digest();
  return crypto.timingSafeEqual(h(recibido), h(esperado));
}

async function renderizarPdf(contenido) {
  const navegador = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
  try {
    const pagina = await navegador.newPage();
    // Las fuentes y los logos van embebidos en base64 dentro del propio HTML,
    // asi que no hay ninguna request de red que esperar: con "load" alcanza y
    // "networkidle0" solo agregaria medio segundo de nada.
    await pagina.setContent(contenido, { waitUntil: "load", timeout: 30000 });
    await pagina.evaluateHandle("document.fonts.ready");
    return await pagina.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
  } finally {
    await navegador.close().catch(() => {});
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const esperado = process.env.INFORME_TOKEN;
  if (!esperado) {
    console.error("INFORME_PDF: falta la variable de entorno INFORME_TOKEN");
    return res.status(500).json({ error: "endpoint_sin_configurar" });
  }
  if (!tokenValido(req.headers["x-informe-token"], esperado)) {
    return res.status(401).json({ error: "no_autorizado" });
  }

  const errores = validar(req.body);
  if (errores.length) {
    return res.status(400).json({ error: "payload_invalido", detalle: errores.slice(0, 12) });
  }

  const contenido = html(req.body);
  if (req.query.formato === "html") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(contenido);
  }

  const t0 = Date.now();
  let pdf;
  try {
    pdf = await renderizarPdf(contenido);
  } catch (err) {
    console.error("INFORME_PDF_FALLO", JSON.stringify({
      sitio: req.body.sitio, mes: req.body.mes, error: err && err.message ? err.message : String(err),
    }));
    return res.status(502).json({ error: "fallo_el_render", detalle: err && err.message });
  }

  console.log("INFORME_PDF_OK", JSON.stringify({
    sitio: req.body.sitio, mes: req.body.mes, kb: Math.round(pdf.length / 1024), ms: Date.now() - t0,
  }));

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Length", pdf.length);
  res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo(req.body)}"`);
  return res.end(pdf);
};
