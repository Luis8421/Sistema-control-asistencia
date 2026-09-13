// Imprime un inventario resumido de una base de datos SQLite del proyecto,
// para comparar "antes" (esta PC) contra "despues" (el VPS) al migrar
// datos (FASE 3). No modifica nada, solo lee.
//
// Uso:
//   node inventario-bd.js /ruta/a/dev.db
//
// Correrlo sobre el dev.db de origen (esta PC) y sobre el dev.db copiado
// al VPS, y comparar que los dos bloques de salida sean identicos.

const path = require("path");
const Database = require(path.join(__dirname, "..", "backend", "node_modules", "better-sqlite3"));

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("Uso: node inventario-bd.js /ruta/a/dev.db");
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });

console.log(`Inventario de: ${dbPath}`);
console.log("--- Empleados por rol ---");
console.log(JSON.stringify(db.prepare("SELECT rol, COUNT(*) c FROM empleados GROUP BY rol").all()));
console.log("--- Empleados activos/inactivos ---");
console.log(JSON.stringify(db.prepare("SELECT activo, COUNT(*) c FROM empleados GROUP BY activo").all()));
console.log("--- Total empleados ---", db.prepare("SELECT COUNT(*) c FROM empleados").get().c);
console.log("--- Empleados con autorizado_todas_bodegas=1 ---", db.prepare("SELECT COUNT(*) c FROM empleados WHERE autorizado_todas_bodegas=1").get().c);
console.log("--- Bodegas activas ---", db.prepare("SELECT COUNT(*) c FROM bodegas WHERE activo=1").get().c);
console.log("--- Bodegas por radio actual ---");
console.log(JSON.stringify(db.prepare("SELECT radio_metros, COUNT(*) c FROM bodegas GROUP BY radio_metros").all()));
console.log("--- Total marcaciones historicas ---", db.prepare("SELECT COUNT(*) c FROM registros_asistencia").get().c);
console.log("--- Marcaciones validas/invalidas ---");
console.log(JSON.stringify(db.prepare("SELECT valido, COUNT(*) c FROM registros_asistencia GROUP BY valido").all()));
console.log("--- Registros de auditoria ---", db.prepare("SELECT COUNT(*) c FROM auditoria").get().c);
console.log("--- Suma de longitudes de password_hash (detecta corrupcion en la copia) ---");
console.log(db.prepare("SELECT SUM(LENGTH(password_hash)) s FROM empleados").get().s);

db.close();
