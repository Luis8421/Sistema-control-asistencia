require("dotenv").config();
const fs = require("fs");
const path = require("path");
const db = require("./connection");

const schemaPath = path.join(__dirname, "schema.sql");
const schemaSql = fs.readFileSync(schemaPath, "utf-8");

db.exec(schemaSql);

// CREATE TABLE IF NOT EXISTS no agrega columnas nuevas a tablas que ya
// existian antes de este cambio. Estas migraciones incrementales cubren
// esos casos sin necesidad de borrar la base de datos.
const columnasRegistros = db.prepare("PRAGMA table_info(registros_asistencia)").all();
if (!columnasRegistros.some((c) => c.name === "foto_url")) {
  db.exec("ALTER TABLE registros_asistencia ADD COLUMN foto_url TEXT");
  console.log("Columna foto_url agregada a registros_asistencia.");
}

const columnasEmpleados = db.prepare("PRAGMA table_info(empleados)").all();
if (!columnasEmpleados.some((c) => c.name === "dias_laborables")) {
  db.exec("ALTER TABLE empleados ADD COLUMN dias_laborables TEXT NOT NULL DEFAULT '1,2,3,4,5'");
  console.log("Columna dias_laborables agregada a empleados (default lunes-viernes).");
}

const columnasBodegas = db.prepare("PRAGMA table_info(bodegas)").all();
if (!columnasBodegas.some((c) => c.name === "codigo")) {
  db.exec("ALTER TABLE bodegas ADD COLUMN codigo TEXT");
  console.log("Columna codigo agregada a bodegas.");
}
// Se crea DESPUES de garantizar que la columna existe (arriba), tanto en
// bases nuevas (donde ya vino en el CREATE TABLE) como en bases
// existentes (recien agregada por el ALTER TABLE de este mismo bloque).
// IF NOT EXISTS lo hace seguro de correr en cada `npm run migrate`.
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_bodegas_codigo ON bodegas(codigo) WHERE codigo IS NOT NULL");

console.log("Migracion aplicada correctamente. Tablas creadas/verificadas en:", db.name);
