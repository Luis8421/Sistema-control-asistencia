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

console.log("Migracion aplicada correctamente. Tablas creadas/verificadas en:", db.name);
