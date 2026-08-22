#!/usr/bin/env node
// Empaqueta fuentes y logos del informe mensual en lib/informe/assets.json.
//
// Por que en un JSON commiteado y no leyendo los .ttf en runtime: la funcion
// serverless solo incluye lo que el bundler puede rastrear estaticamente. Un
// fs.readFileSync con path armado se le escapa y el archivo no viaja al lambda
// (falla recien en produccion). Un require('./assets.json') siempre viaja.
//
// Solo se corre a mano cuando cambia una fuente o un logo:
//   node scripts/informe-assets.js
"use strict";
const fs = require("fs");
const path = require("path");

// Origen de las fuentes: Google Fonts, mismas familias y pesos que las webs.
// La lista es EXACTAMENTE lo que la plantilla usa (ver plantilla.js): cada peso
// de mas son ~55 KB en el bundle, y un peso de menos lo sustituye el navegador
// en silencio, que es peor porque no se nota hasta que lo ves impreso.
const FUENTES = [
  // bromteck.com — layout.tsx: Host_Grotesk + Geist_Mono
  ["HostGrotesk-400.ttf", "Host Grotesk", 400],
  ["HostGrotesk-600.ttf", "Host Grotesk", 600],
  ["HostGrotesk-800.ttf", "Host Grotesk", 800],
  ["GeistMono-400.ttf", "Geist Mono", 400],
  // bromteck.tv — index.html: Unbounded + Hanken Grotesk + Martian Mono
  ["HankenGrotesk-400.ttf", "Hanken Grotesk", 400],
  ["HankenGrotesk-600.ttf", "Hanken Grotesk", 600],
  ["Unbounded-700.ttf", "Unbounded", 700],
  ["MartianMono-400.ttf", "Martian Mono", 400],
];

// El wordmark es el PNG real de cada header, no una reconstruccion.
// Los dos sitios usan el mismo archivo, con el mismo nombre, en repos distintos.
const LOGOS = {
  "bromteck.com": "bromteck-site/public/brand/wordmark_header_white.png",
  "bromteck.tv": "bromteck-tv/design-v2/assets/wordmark_header_white.png",
};

const ORIGEN_FUENTES = process.env.INFORME_FUENTES ||
  path.join(__dirname, "..", "..", "informe-analytics", "fuentes");
const ORIGEN_SITIOS = process.env.INFORME_SITIOS ||
  path.join(__dirname, "..", "..");

function leer(p, que) {
  if (!fs.existsSync(p)) {
    console.error(`falta ${que}: ${p}`);
    process.exit(1);
  }
  return fs.readFileSync(p).toString("base64");
}

const salida = { fuentes: [], logos: {} };

for (const [archivo, familia, peso] of FUENTES) {
  const b64 = leer(path.join(ORIGEN_FUENTES, archivo), "la fuente");
  salida.fuentes.push({ familia, peso, b64 });
  console.log(`  fuente  ${familia} ${peso}`.padEnd(38) + `${Math.round(b64.length / 1024)} KB`);
}
for (const [sitio, rel] of Object.entries(LOGOS)) {
  salida.logos[sitio] = leer(path.join(ORIGEN_SITIOS, rel), "el logo");
  console.log(`  logo    ${sitio}`.padEnd(38) + `${Math.round(salida.logos[sitio].length / 1024)} KB`);
}

const destino = path.join(__dirname, "..", "lib", "informe", "assets.json");
fs.writeFileSync(destino, JSON.stringify(salida));
console.log(`\nOK -> lib/informe/assets.json (${Math.round(fs.statSync(destino).size / 1024)} KB)`);
