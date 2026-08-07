/**
 * Genera los iconos PNG que necesita web/manifest.json (y el
 * apple-touch-icon para iOS) para que el portal de marcaje sea instalable
 * como PWA. Un cuadrado de color solido con un circulo blanco al centro —
 * son PLACEHOLDERS funcionales, no branding real. Reemplazar con el logo
 * real de la empresa cuando este disponible (misma ruta/nombre de
 * archivo, no hace falta tocar el manifest).
 *
 * Deliberadamente sin dependencias de imagenes (sharp/canvas): construye
 * el PNG a mano (IHDR + IDAT + IEND) usando solo el modulo zlib nativo de
 * Node (deflate para el IDAT, crc32 para el checksum de cada chunk).
 *
 * Uso: node scripts/generar-iconos-pwa.js
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const COLOR_FONDO = [46, 134, 171]; // #2E86AB — mismo azul que ya usa mobile/screens
const COLOR_MARCA = [255, 255, 255];
const FIRMA_PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function chunkPng(tipo, datos) {
  const tipoBuf = Buffer.from(tipo, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(datos.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(zlib.crc32(Buffer.concat([tipoBuf, datos])) >>> 0, 0);
  return Buffer.concat([lenBuf, tipoBuf, datos, crcBuf]);
}

/** Cuadrado solido con un circulo centrado (icono PWA minimalista). */
function generarPng(size) {
  const bytesPorFila = size * 4 + 1; // +1 por el byte de filtro al inicio de cada fila
  const raw = Buffer.alloc(bytesPorFila * size);
  const radio = size * 0.32;
  const cx = size / 2;
  const cy = size / 2;

  for (let y = 0; y < size; y++) {
    const inicioFila = y * bytesPorFila;
    raw[inicioFila] = 0; // sin filtro
    for (let x = 0; x < size; x++) {
      const dx = x - cx + 0.5;
      const dy = y - cy + 0.5;
      const dentroDelCirculo = dx * dx + dy * dy <= radio * radio;
      const [r, g, b] = dentroDelCirculo ? COLOR_MARCA : COLOR_FONDO;
      const offset = inicioFila + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // profundidad de bits
  ihdr[9] = 6; // tipo de color: RGBA
  ihdr[10] = 0; // compresion
  ihdr[11] = 0; // filtro
  ihdr[12] = 0; // entrelazado

  return Buffer.concat([
    FIRMA_PNG,
    chunkPng("IHDR", ihdr),
    chunkPng("IDAT", zlib.deflateSync(raw)),
    chunkPng("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, "..", "web", "icons");
fs.mkdirSync(outDir, { recursive: true });

const archivos = [
  { size: 512, name: "icon-512.png" },
  { size: 192, name: "icon-192.png" },
  { size: 180, name: "apple-touch-icon.png" },
  { size: 32, name: "favicon-32.png" },
];

for (const { size, name } of archivos) {
  fs.writeFileSync(path.join(outDir, name), generarPng(size));
  console.log(`Generado: web/icons/${name} (${size}x${size})`);
}
