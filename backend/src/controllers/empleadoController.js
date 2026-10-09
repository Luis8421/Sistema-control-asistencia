const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const db = require("../db/connection");
const { parsePaginacion } = require("../utils/paginacion");
const { registrarAuditoria } = require("../utils/auditoria");
const asyncHandler = require("../utils/asyncHandler");

// Nunca se selecciona password_hash hacia el panel de administracion.
const CAMPOS_PUBLICOS = `
  id, nombre_completo, codigo_empleado, cargo, email, rol, activo, bodega_id,
  hora_entrada_esperada, hora_salida_esperada, tolerancia_min, dias_laborables,
  autorizado_todas_bodegas, creado_en
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
async function listar(req, res) {
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
    params.push(req.query.activo === "true");
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;

  const total = await db
    .prepare(`SELECT COUNT(*) AS total FROM empleados ${whereSql}`)
    .get(...params);

  const data = await db
    .prepare(
      `SELECT ${CAMPOS_PUBLICOS} FROM empleados ${whereSql}
       ORDER BY nombre_completo ASC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  return res.json({ data, page, limit, total: Number(total.total), totalPaginas: Math.ceil(Number(total.total) / limit) || 1 });
}

// Minimo aceptado para los PIN/contraseñas de empleados asignados por un
// administrador.
const PIN_LONGITUD_MINIMA = 4;

/**
 * POST /api/empleados
 * body: { nombreCompleto, codigoEmpleado, bodegaId, password, email?,
 *         cargo, horaEntradaEsperada, horaSalidaEsperada, toleranciaMin,
 *         diasLaborables }
 * El rol siempre se crea como 'empleado'. El administrador asigna el PIN
 * requerido para iniciar sesion. email es opcional. diasLaborables es opcional (default
 * lunes-viernes): arreglo de numeros 1 (lunes) a 7 (domingo).
 */
async function crear(req, res) {
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

  if (!nombreCompleto || !codigoEmpleado || !bodegaId || typeof password !== "string" || !password) {
    return res.status(400).json({
      error: "nombreCompleto, codigoEmpleado, password/PIN y bodegaId son requeridos",
    });
  }

  if (password.length < PIN_LONGITUD_MINIMA) {
    return res.status(400).json({ error: `El password/PIN debe tener al menos ${PIN_LONGITUD_MINIMA} caracteres` });
  }

  let diasLaborablesCsv;
  try {
    diasLaborablesCsv = normalizarDiasLaborables(diasLaborables);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const bodega = await db.prepare("SELECT id FROM bodegas WHERE id = ?").get(bodegaId);
  if (!bodega) {
    return res.status(400).json({ error: "bodegaId no corresponde a una geocerca existente" });
  }

  // Chequeados por separado (en vez de un solo "email = ? OR codigo = ?")
  // para no bindear un email ausente como undefined en la consulta, y para
  // poder decir exactamente cual de los dos esta duplicado.
  const codigoEnUso = await db.prepare("SELECT id FROM empleados WHERE codigo_empleado = ?").get(codigoEmpleado);
  if (codigoEnUso) {
    return res.status(409).json({ error: "Ya existe un empleado con ese codigo" });
  }
  if (email) {
    const emailEnUso = await db.prepare("SELECT id FROM empleados WHERE email = ?").get(email);
    if (emailEnUso) {
      return res.status(409).json({ error: "Ya existe un empleado con ese email" });
    }
  }

  const id = uuidv4();
  const passwordHash = bcrypt.hashSync(password, 10);

  await db.prepare(
    `INSERT INTO empleados
      (id, nombre_completo, codigo_empleado, cargo, email, password_hash, rol, bodega_id, hora_entrada_esperada, hora_salida_esperada, tolerancia_min, dias_laborables)
     VALUES (?, ?, ?, ?, ?, ?, 'empleado', ?, ?, ?, ?, COALESCE(?, '1,2,3,4,5'))`
  ).run(
    id,
    nombreCompleto,
    codigoEmpleado,
    cargo ?? null,
    email ?? null,
    passwordHash,
    bodegaId,
    horaEntradaEsperada ?? "08:00",
    horaSalidaEsperada ?? "17:00",
    toleranciaMin ?? 10,
    diasLaborablesCsv ?? null
  );

  // autorizado_todas_bodegas nace en 0 (DEFAULT de la columna): un
  // empleado nuevo NUNCA recibe autorizacion global automaticamente, sin
  // importar como se haya creado. Queda restringido a bodegaId hasta que
  // un admin se la conceda explicitamente via PUT /:id/autorizacion-bodegas.
  const empleado = await db.prepare(`SELECT ${CAMPOS_PUBLICOS} FROM empleados WHERE id = ?`).get(id);

  await registrarAuditoria({
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
 * Edita datos del empleado. El password/PIN solo se actualiza si se envia.
 * El rol no es editable desde este endpoint. codigoEmpleado SI es editable
 * para que el administrador pueda corregir codigos autogenerados.
 */
async function actualizar(req, res) {
  const { id } = req.params;
  const existente = await db.prepare("SELECT * FROM empleados WHERE id = ?").get(id);
  if (!existente) {
    return res.status(404).json({ error: "Empleado no encontrado" });
  }

  const {
    nombreCompleto,
    codigoEmpleado,
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

  if (codigoEmpleado !== undefined && !codigoEmpleado) {
    return res.status(400).json({ error: "codigoEmpleado no puede quedar vacio" });
  }

  if (password !== undefined && (typeof password !== "string" || (password && password.length < PIN_LONGITUD_MINIMA))) {
    return res.status(400).json({ error: `El password/PIN debe tener al menos ${PIN_LONGITUD_MINIMA} caracteres` });
  }

  let diasLaborablesCsv;
  try {
    diasLaborablesCsv = normalizarDiasLaborables(diasLaborables);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (bodegaId) {
    const bodega = await db.prepare("SELECT id FROM bodegas WHERE id = ?").get(bodegaId);
    if (!bodega) {
      return res.status(400).json({ error: "bodegaId no corresponde a una geocerca existente" });
    }
  }

  if (email && email !== existente.email) {
    const emailEnUso = await db
      .prepare("SELECT id FROM empleados WHERE email = ? AND id != ?")
      .get(email, id);
    if (emailEnUso) {
      return res.status(409).json({ error: "Ese email ya esta en uso por otro empleado" });
    }
  }

  if (codigoEmpleado && codigoEmpleado !== existente.codigo_empleado) {
    const codigoEnUso = await db
      .prepare("SELECT id FROM empleados WHERE codigo_empleado = ? AND id != ?")
      .get(codigoEmpleado, id);
    if (codigoEnUso) {
      return res.status(409).json({ error: "Ese codigo ya esta en uso por otro empleado" });
    }
  }

  const passwordHash = password ? bcrypt.hashSync(password, 10) : existente.password_hash;

  await db.prepare(
    `UPDATE empleados SET
      nombre_completo = ?, codigo_empleado = ?, cargo = ?, email = ?, bodega_id = ?, activo = ?,
      hora_entrada_esperada = ?, hora_salida_esperada = ?, tolerancia_min = ?,
      dias_laborables = ?, password_hash = ?
     WHERE id = ?`
  ).run(
    nombreCompleto ?? existente.nombre_completo,
    codigoEmpleado ?? existente.codigo_empleado,
    cargo !== undefined ? cargo : existente.cargo,
    email ?? existente.email,
    bodegaId ?? existente.bodega_id,
    activo !== undefined ? activo : existente.activo,
    horaEntradaEsperada ?? existente.hora_entrada_esperada,
    horaSalidaEsperada ?? existente.hora_salida_esperada,
    toleranciaMin ?? existente.tolerancia_min,
    diasLaborablesCsv ?? existente.dias_laborables,
    passwordHash,
    id
  );

  const actualizado = await db.prepare(`SELECT ${CAMPOS_PUBLICOS} FROM empleados WHERE id = ?`).get(id);

  await registrarAuditoria({
    usuario: req.usuario,
    accion: "actualizar",
    entidad: "empleado",
    entidadId: id,
    // Solo se registran los nombres de los campos que llegaron en el body
    // (no sus valores, y nunca la contrasena) para saber que se toco sin
    // duplicar datos sensibles en el log de auditoria. autorizado_todas_bodegas
    // NUNCA se lee ni se escribe desde este endpoint (ver mas abajo el
    // destructuring del body, que deliberadamente no lo incluye) — solo se
    // modifica via el endpoint dedicado actualizarAutorizacionBodegas().
    detalle: { camposModificados: Object.keys(req.body) },
  });

  return res.json(actualizado);
}

/**
 * PUT /api/empleados/:id/autorizacion-bodegas
 * body: { autorizadoTodasBodegas: true|false }
 * Unico endpoint que puede modificar autorizado_todas_bodegas. Separado a
 * proposito de actualizar() (arriba): esa funcion edita nombre, cargo,
 * horario, bodegaId, etc., y NUNCA debe tocar esta autorizacion como
 * efecto secundario de un formulario general. La auditoria registra el
 * valor anterior y el nuevo explicitamente (no solo el nombre del campo),
 * porque es una decision de acceso, no un dato administrativo mas.
 */
async function actualizarAutorizacionBodegas(req, res) {
  const { id } = req.params;
  const existente = await db.prepare("SELECT id, autorizado_todas_bodegas FROM empleados WHERE id = ?").get(id);
  if (!existente) {
    return res.status(404).json({ error: "Empleado no encontrado" });
  }

  const { autorizadoTodasBodegas } = req.body;
  if (typeof autorizadoTodasBodegas !== "boolean") {
    return res.status(400).json({ error: "autorizadoTodasBodegas debe ser true o false" });
  }

  const valorAnterior = !!existente.autorizado_todas_bodegas;
  const valorNuevo = autorizadoTodasBodegas;

  await db.prepare("UPDATE empleados SET autorizado_todas_bodegas = ? WHERE id = ?").run(valorNuevo, id);

  await registrarAuditoria({
    usuario: req.usuario,
    accion: "actualizar",
    entidad: "empleado",
    entidadId: id,
    detalle: { campo: "autorizado_todas_bodegas", valorAnterior, valorNuevo },
  });

  return res.json({ empleadoId: id, autorizadoTodasBodegas: valorNuevo });
}

/**
 * DELETE /api/empleados/:id
 * Soft delete: desactiva al empleado, no borra el historial de marcaciones.
 */
async function eliminar(req, res) {
  const { id } = req.params;
  const existente = await db.prepare("SELECT id FROM empleados WHERE id = ?").get(id);
  if (!existente) {
    return res.status(404).json({ error: "Empleado no encontrado" });
  }

  await db.prepare("UPDATE empleados SET activo = FALSE WHERE id = ?").run(id);

  await registrarAuditoria({
    usuario: req.usuario,
    accion: "eliminar",
    entidad: "empleado",
    entidadId: id,
  });

  return res.status(204).send();
}

module.exports = {
  listar: asyncHandler(listar),
  crear: asyncHandler(crear),
  actualizar: asyncHandler(actualizar),
  actualizarAutorizacionBodegas: asyncHandler(actualizarAutorizacionBodegas),
  eliminar: asyncHandler(eliminar),
};
