const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const db = require("../db/connection");
const { parsePaginacion } = require("../utils/paginacion");
const { registrarAuditoria } = require("../utils/auditoria");

// Nunca se selecciona password_hash hacia el panel de administracion.
const CAMPOS_PUBLICOS = `
  id, nombre_completo, codigo_empleado, cargo, email, rol, activo, bodega_id,
  hora_entrada_esperada, hora_salida_esperada, tolerancia_min, dias_laborables, creado_en
`;

/**
 * Valida y normaliza diasLaborables ([1,2,3,4,5], 1=lunes...7=domingo) a
 * la representacion CSV que se guarda en la columna. Devuelve undefined
 * si no vino en el body (no se debe tocar el valor existente), o lanza
 * si vino pero es invalido.
 */
function normalizarDiasLaborables(valor) {
  if (valor === undefined) return undefined;
  if (!Array.isArray(valor) || valor.length === 0) {
    throw new Error("diasLaborables debe ser un arreglo no vacio de numeros del 1 (lunes) al 7 (domingo)");
  }
  const dias = [...new Set(valor.map(Number))].sort((a, b) => a - b);
  if (dias.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
    throw new Error("diasLaborables solo admite numeros enteros del 1 (lunes) al 7 (domingo)");
  }
  return dias.join(",");
}

/**
 * GET /api/empleados?page&limit&busqueda&activo
 * Solo lista empleados con rol 'empleado' (el CRUD de este panel no
 * gestiona cuentas de supervisor/admin). `activo=true|false` es opcional
 * (sin el filtro, trae activos e inactivos, igual que antes) — lo usa el
 * dashboard para contar empleados activos con una sola consulta COUNT.
 */
function listar(req, res) {
  const { page, limit, offset } = parsePaginacion(req.query);
  const busqueda = (req.query.busqueda || "").trim();

  const where = ["rol = 'empleado'"];
  const params = [];
  if (busqueda) {
    where.push("nombre_completo LIKE ?");
    params.push(`%${busqueda}%`);
  }
  if (req.query.activo === "true" || req.query.activo === "false") {
    where.push("activo = ?");
    params.push(req.query.activo === "true" ? 1 : 0);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;

  const total = db
    .prepare(`SELECT COUNT(*) AS total FROM empleados ${whereSql}`)
    .get(...params).total;

  const data = db
    .prepare(
      `SELECT ${CAMPOS_PUBLICOS} FROM empleados ${whereSql}
       ORDER BY nombre_completo ASC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  return res.json({ data, page, limit, total, totalPaginas: Math.ceil(total / limit) || 1 });
}

/**
 * POST /api/empleados
 * body: { nombreCompleto, codigoEmpleado, email, password, cargo, bodegaId,
 *         horaEntradaEsperada, horaSalidaEsperada, toleranciaMin,
 *         diasLaborables }
 * El rol siempre se crea como 'empleado'. diasLaborables es opcional
 * (default lunes-viernes): arreglo de numeros 1 (lunes) a 7 (domingo).
 */
function crear(req, res) {
  const {
    nombreCompleto,
    codigoEmpleado,
    email,
    password,
    cargo,
    bodegaId,
    horaEntradaEsperada,
    horaSalidaEsperada,
    toleranciaMin,
    diasLaborables,
  } = req.body;

  if (!nombreCompleto || !codigoEmpleado || !email || !password || !bodegaId) {
    return res.status(400).json({
      error: "nombreCompleto, codigoEmpleado, email, password y bodegaId son requeridos",
    });
  }

  let diasLaborablesCsv;
  try {
    diasLaborablesCsv = normalizarDiasLaborables(diasLaborables);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const bodega = db.prepare("SELECT id FROM bodegas WHERE id = ?").get(bodegaId);
  if (!bodega) {
    return res.status(400).json({ error: "bodegaId no corresponde a una geocerca existente" });
  }

  const yaExiste = db
    .prepare("SELECT id FROM empleados WHERE email = ? OR codigo_empleado = ?")
    .get(email, codigoEmpleado);
  if (yaExiste) {
    return res.status(409).json({ error: "Ya existe un empleado con ese email o codigo" });
  }

  const id = uuidv4();
  const passwordHash = bcrypt.hashSync(password, 10);

  db.prepare(
    `INSERT INTO empleados
      (id, nombre_completo, codigo_empleado, cargo, email, password_hash, rol, bodega_id, hora_entrada_esperada, hora_salida_esperada, tolerancia_min, dias_laborables)
     VALUES (?, ?, ?, ?, ?, ?, 'empleado', ?, ?, ?, ?, COALESCE(?, '1,2,3,4,5'))`
  ).run(
    id,
    nombreCompleto,
    codigoEmpleado,
    cargo ?? null,
    email,
    passwordHash,
    bodegaId,
    horaEntradaEsperada ?? "08:00",
    horaSalidaEsperada ?? "17:00",
    toleranciaMin ?? 10,
    diasLaborablesCsv ?? null
  );

  const empleado = db.prepare(`SELECT ${CAMPOS_PUBLICOS} FROM empleados WHERE id = ?`).get(id);

  registrarAuditoria({
    usuario: req.usuario,
    accion: "crear",
    entidad: "empleado",
    entidadId: id,
    detalle: { nombreCompleto, codigoEmpleado, email, bodegaId },
  });

  return res.status(201).json(empleado);
}

/**
 * PUT /api/empleados/:id
 * Edita datos del empleado. El password solo se actualiza si se envia.
 * El rol y codigoEmpleado no son editables desde este endpoint.
 */
function actualizar(req, res) {
  const { id } = req.params;
  const existente = db.prepare("SELECT * FROM empleados WHERE id = ?").get(id);
  if (!existente) {
    return res.status(404).json({ error: "Empleado no encontrado" });
  }

  const {
    nombreCompleto,
    cargo,
    email,
    bodegaId,
    activo,
    horaEntradaEsperada,
    horaSalidaEsperada,
    toleranciaMin,
    password,
    diasLaborables,
  } = req.body;

  let diasLaborablesCsv;
  try {
    diasLaborablesCsv = normalizarDiasLaborables(diasLaborables);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (bodegaId) {
    const bodega = db.prepare("SELECT id FROM bodegas WHERE id = ?").get(bodegaId);
    if (!bodega) {
      return res.status(400).json({ error: "bodegaId no corresponde a una geocerca existente" });
    }
  }

  if (email && email !== existente.email) {
    const emailEnUso = db
      .prepare("SELECT id FROM empleados WHERE email = ? AND id != ?")
      .get(email, id);
    if (emailEnUso) {
      return res.status(409).json({ error: "Ese email ya esta en uso por otro empleado" });
    }
  }

  const passwordHash = password ? bcrypt.hashSync(password, 10) : existente.password_hash;

  db.prepare(
    `UPDATE empleados SET
      nombre_completo = ?, cargo = ?, email = ?, bodega_id = ?, activo = ?,
      hora_entrada_esperada = ?, hora_salida_esperada = ?, tolerancia_min = ?,
      dias_laborables = ?, password_hash = ?
     WHERE id = ?`
  ).run(
    nombreCompleto ?? existente.nombre_completo,
    cargo !== undefined ? cargo : existente.cargo,
    email ?? existente.email,
    bodegaId ?? existente.bodega_id,
    activo !== undefined ? (activo ? 1 : 0) : existente.activo,
    horaEntradaEsperada ?? existente.hora_entrada_esperada,
    horaSalidaEsperada ?? existente.hora_salida_esperada,
    toleranciaMin ?? existente.tolerancia_min,
    diasLaborablesCsv ?? existente.dias_laborables,
    passwordHash,
    id
  );

  const actualizado = db.prepare(`SELECT ${CAMPOS_PUBLICOS} FROM empleados WHERE id = ?`).get(id);

  registrarAuditoria({
    usuario: req.usuario,
    accion: "actualizar",
    entidad: "empleado",
    entidadId: id,
    // Solo se registran los nombres de los campos que llegaron en el body
    // (no sus valores, y nunca la contrasena) para saber que se toco sin
    // duplicar datos sensibles en el log de auditoria.
    detalle: { camposModificados: Object.keys(req.body) },
  });

  return res.json(actualizado);
}

/**
 * DELETE /api/empleados/:id
 * Soft delete: desactiva al empleado, no borra el historial de marcaciones.
 */
function eliminar(req, res) {
  const { id } = req.params;
  const existente = db.prepare("SELECT id FROM empleados WHERE id = ?").get(id);
  if (!existente) {
    return res.status(404).json({ error: "Empleado no encontrado" });
  }

  db.prepare("UPDATE empleados SET activo = 0 WHERE id = ?").run(id);

  registrarAuditoria({
    usuario: req.usuario,
    accion: "eliminar",
    entidad: "empleado",
    entidadId: id,
  });

  return res.status(204).send();
}

module.exports = { listar, crear, actualizar, eliminar };
