require("dotenv").config();
const fs = require("fs");
const path = require("path");
const db = require("./connection");

if (db.isPostgres) {
  throw new Error("Este script migra SQLite local. Usa `npm run migrate:postgres` para Supabase.");
}

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

if (!columnasEmpleados.some((c) => c.name === "autorizado_todas_bodegas")) {
  db.exec("ALTER TABLE empleados ADD COLUMN autorizado_todas_bodegas INTEGER NOT NULL DEFAULT 0");
  console.log("Columna autorizado_todas_bodegas agregada a empleados (default 0, sin autorizacion global).");
}

// SQLite no soporta "ALTER TABLE ... ALTER COLUMN ... DROP NOT NULL": hay
// que reconstruir la tabla. Se hace solo si la base existente todavia
// tiene email como NOT NULL (bases nuevas ya nacen con el schema.sql de
// arriba, que ya la creo nullable, asi que esto es un no-op para ellas).
// No se toca ninguna fila existente: se copian tal cual, columna por
// columna, dentro de una transaccion.
const columnaEmail = db.prepare("PRAGMA table_info(empleados)").all().find((c) => c.name === "email");
if (columnaEmail && columnaEmail.notnull === 1) {
  // foreign_keys tiene que apagarse ANTES de la transaccion (SQLite ignora
  // el pragma si se cambia dentro de una). Es necesario: con foreign_keys
  // en ON, un DROP TABLE sobre empleados (tabla padre de registros_asistencia,
  // auditoria y empleado_bodegas) dispara un DELETE implicito de sus filas
  // antes de borrar la tabla, que fallaria por violar esas FKs si hay algun
  // registro real. Se reactiva pase lo que pase, incluso si algo falla.
  db.pragma("foreign_keys = OFF");
  try {
    const hacerEmailOpcional = db.transaction(() => {
      db.exec(`
        CREATE TABLE empleados_nueva (
          id                      TEXT PRIMARY KEY,
          nombre_completo         TEXT NOT NULL,
          codigo_empleado         TEXT NOT NULL UNIQUE,
          cargo                   TEXT,
          email                   TEXT UNIQUE,
          password_hash           TEXT NOT NULL,
          rol                     TEXT NOT NULL DEFAULT 'empleado',
          activo                  INTEGER NOT NULL DEFAULT 1,
          bodega_id               TEXT NOT NULL REFERENCES bodegas(id),
          hora_entrada_esperada   TEXT NOT NULL DEFAULT '08:00',
          hora_salida_esperada    TEXT NOT NULL DEFAULT '17:00',
          tolerancia_min          INTEGER NOT NULL DEFAULT 10,
          dias_laborables         TEXT NOT NULL DEFAULT '1,2,3,4,5',
          autorizado_todas_bodegas INTEGER NOT NULL DEFAULT 0,
          creado_en               TEXT NOT NULL DEFAULT (datetime('now', '-5 hours'))
        );
        INSERT INTO empleados_nueva SELECT
          id, nombre_completo, codigo_empleado, cargo, email, password_hash,
          rol, activo, bodega_id, hora_entrada_esperada, hora_salida_esperada,
          tolerancia_min, dias_laborables, autorizado_todas_bodegas, creado_en
        FROM empleados;
        DROP TABLE empleados;
        ALTER TABLE empleados_nueva RENAME TO empleados;
      `);
    });
    hacerEmailOpcional();
    console.log("Columna email de empleados pasada a opcional (se preservaron todas las filas existentes).");
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

// NOTA: la tabla empleado_bodegas y su backfill (usados por el modelo de
// autorizacion anterior, uno-a-muchos por empleado) ya NO se referencian
// desde ningun controller — la autorizacion de marcaje ahora depende
// exclusivamente de empleados.autorizado_todas_bodegas (ver arriba) y,
// para quienes tienen ese campo en 0, de empleados.bodega_id. La tabla
// empleado_bodegas se deja intacta en la base (no se hace DROP aqui ni en
// ningun otro lugar de esta migracion) hasta que una fase separada,
// explicitamente autorizada, decida eliminarla.

console.log("Migracion aplicada correctamente. Tablas creadas/verificadas en:", db.name);
