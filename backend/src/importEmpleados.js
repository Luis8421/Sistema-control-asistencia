require("dotenv").config();
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const db = require("./db/connection");

const CSV_PATH = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, "..", "data", "empleados_import.csv");

// Parser simple: una fila por linea, columnas separadas por coma, sin
// soporte de comillas/comas dentro de un campo. Alcanza para este CSV;
// si mas adelante el archivo crece o viene de otra fuente con campos que
// puedan contener comas, conviene cambiar a una libreria de CSV.
function parseCsv(contenido) {
  const lineas = contenido.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const [, ...filas] = lineas; // descarta la cabecera
  return filas.map((linea) => {
    const [nombreCompleto, email, password] = linea.split(",").map((c) => (c ?? "").trim());
    return { nombreCompleto, email, password };
  });
}

// Normaliza un nombre para comparar por identidad aunque cambie el orden
// de palabras, mayusculas o tildes (ej. "Segundo Raul Toapanta Coyago" vs
// "TOAPANTA COYAGO SEGUNDO RAUL" deben reconocerse como la misma persona).
function normalizarNombre(nombre) {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

// Si el nombre viene todo en mayusculas, lo pasa a Titulo para que se vea
// bien en el panel. Si ya tiene minusculas (viene bien formateado), lo deja tal cual.
function aTitulo(nombre) {
  if (nombre !== nombre.toUpperCase()) return nombre;
  return nombre
    .toLowerCase()
    .split(" ")
    .map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : p))
    .join(" ");
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`No se encontro el archivo CSV en ${CSV_PATH}`);
    process.exit(1);
  }

  const bodega = db.prepare("SELECT id, nombre FROM bodegas WHERE activo = 1 LIMIT 1").get();
  if (!bodega) {
    console.error("No hay ninguna geocerca activa. Crea una antes de importar empleados.");
    process.exit(1);
  }

  const empleados = parseCsv(fs.readFileSync(CSV_PATH, "utf-8"));

  const buscarPorEmail = db.prepare("SELECT id, email, nombre_completo FROM empleados WHERE email = ?");
  const listarExistentes = db.prepare("SELECT id, email, nombre_completo FROM empleados WHERE rol = 'empleado'");
  const insertar = db.prepare(
    `INSERT INTO empleados (id, nombre_completo, codigo_empleado, email, password_hash, rol, bodega_id, activo)
     VALUES (?, ?, ?, ?, ?, 'empleado', ?, 1)`
  );
  const actualizar = db.prepare("UPDATE empleados SET email = ?, nombre_completo = ? WHERE id = ?");

  console.log(`Importando empleados... (geocerca: ${bodega.nombre})\n`);

  let importados = 0;
  let actualizados = 0;
  let duplicados = 0;
  let errores = 0;

  for (const emp of empleados) {
    try {
      if (!emp.nombreCompleto || !emp.email || !emp.password) {
        console.log(`❌ Error al crear: ${emp.nombreCompleto || "(fila sin nombre)"} - faltan columnas en el CSV`);
        errores++;
        continue;
      }

      const nombreBonito = aTitulo(emp.nombreCompleto);
      const nombreNormalizado = normalizarNombre(emp.nombreCompleto);

      // Primero busca por email exacto; si no aparece, busca por nombre
      // normalizado (misma persona, email distinto - ej. cambio de dominio
      // de correo) antes de asumir que es alguien nuevo.
      let existente = buscarPorEmail.get(emp.email);
      if (!existente) {
        existente = listarExistentes.all().find((c) => normalizarNombre(c.nombre_completo) === nombreNormalizado);
      }

      if (existente) {
        if (existente.email === emp.email && existente.nombre_completo === nombreBonito) {
          console.log(`⚠️ Ya existe sin cambios: ${emp.email} - omitido`);
          duplicados++;
          continue;
        }
        actualizar.run(emp.email, nombreBonito, existente.id);
        console.log(`🔄 Empleado actualizado: ${nombreBonito} (${existente.email} -> ${emp.email})`);
        actualizados++;
        continue;
      }

      const id = uuidv4();
      const codigoEmpleado = `EMP-${id.slice(0, 8).toUpperCase()}`;
      const passwordHash = await bcrypt.hash(emp.password, 10);

      insertar.run(id, nombreBonito, codigoEmpleado, emp.email, passwordHash, bodega.id);

      console.log(`✅ Empleado creado: ${nombreBonito} (${emp.email})`);
      importados++;
    } catch (err) {
      console.log(`❌ Error al crear: ${emp.nombreCompleto} - ${err.message}`);
      errores++;
    }
  }

  console.log(`\nResumen: ${importados} importados, ${actualizados} actualizados, ${duplicados} sin cambios, ${errores} errores`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
