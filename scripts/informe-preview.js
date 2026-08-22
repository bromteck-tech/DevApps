#!/usr/bin/env node
// Vista previa local del informe, con el Chrome de la maquina.
//
// Usa EXACTAMENTE la misma plantilla que produccion (lib/informe/plantilla.js),
// asi que lo que se ve aca es lo que va a mandar el endpoint. Es la unica forma
// de iterar el diseno sin deployar.
//
//   node scripts/informe-preview.js datos/2026-08-com.json [...]
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const { html, nombreArchivo } = require("../lib/informe/plantilla");
const { validar } = require("../lib/informe/validar");

const CHROME = process.env.CHROME_BIN ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SALIDA = process.env.INFORME_SALIDA || path.join(process.cwd(), "salida-informes");

if (process.argv.length < 3) {
  console.error("uso: node scripts/informe-preview.js <datos.json> [...]");
  process.exit(1);
}
fs.mkdirSync(SALIDA, { recursive: true });

for (const archivo of process.argv.slice(2)) {
  const datos = JSON.parse(fs.readFileSync(archivo, "utf8"));
  const errores = validar(datos);
  if (errores.length) {
    console.error(`${archivo}: payload invalido\n  ` + errores.join("\n  "));
    process.exit(1);
  }
  // El HTML va a un temporal: en la carpeta de salida solo queda el PDF, que es
  // lo unico que se manda. Con DEJAR_HTML=1 se conserva para inspeccionarlo.
  const tmp = path.join(os.tmpdir(), `informe-${Date.now()}-${path.basename(archivo)}.html`);
  fs.writeFileSync(tmp, html(datos));
  const pdf = path.join(SALIDA, nombreArchivo(datos));
  execFileSync(CHROME, ["--headless", "--disable-gpu", "--no-pdf-header-footer",
    "--virtual-time-budget=3000", "--print-to-pdf=" + pdf, "file://" + tmp], { stdio: "pipe" });
  if (process.env.DEJAR_HTML === "1") console.log("  html:", tmp); else fs.unlinkSync(tmp);
  console.log(`  ${pdf}  ${Math.round(fs.statSync(pdf).size / 1024)} KB`);
}
