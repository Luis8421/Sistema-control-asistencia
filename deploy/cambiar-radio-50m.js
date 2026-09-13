// FASE 9 — cambio de radio de geocerca 10m -> 50m para las 8 bodegas
// activas. PREPARADO PERO NO SE EJECUTA SOLO: hay que correrlo a mano,
// y unicamente despues de autorizacion explicita, tras validar todo el
// despliegue con un celular real (ver FASE 8).
//
// Uso (en el VPS, dentro de backend/):
//   npm run backup              # backup fresco primero, siempre
//   node ../deploy/cambiar-radio-50m.js
//
// Es reversible: para volver a 10m, cambiar el valor 50 por 10 abajo y
// volver a correr (o restaurar el backup).

const db = require(require("path").join(__dirname, "..", "backend", "src", "db", "connection"));

const NUEVO_RADIO_M = 50;

console.log("--- ANTES ---");
console.log(JSON.stringify(db.prepare("SELECT codigo, nombre, radio_metros FROM bodegas WHERE activo=1 ORDER BY codigo").all(), null, 2));

const resultado = db.prepare("UPDATE bodegas SET radio_metros = ? WHERE activo = 1").run(NUEVO_RADIO_M);
console.log(`\nFilas actualizadas: ${resultado.changes}`);

console.log("\n--- DESPUES ---");
console.log(JSON.stringify(db.prepare("SELECT codigo, nombre, radio_metros FROM bodegas WHERE activo=1 ORDER BY codigo").all(), null, 2));
