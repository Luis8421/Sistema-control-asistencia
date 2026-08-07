const { v4: uuidv4 } = require("uuid");
const db = require("../db/connection");
const { registrarAuditoria } = require("../utils/auditoria");

/**
 * Normaliza el codigo de bodega antes de guardar: sin espacios al
 * inicio/final, en mayusculas. Cadena vacia (o solo espacios) se trata
 * como "sin codigo" (NULL), no como un error de validacion.
 */
function normalizarCodigo(codigo) {
  if (codigo === undefined || codigo === null) return null;
  const limpio = String(codigo).trim().toUpperCase();
  return limpio === "" ? null : limpio;
}

/**
 * Si `codigo` no es null, verifica que ninguna OTRA bodega ya lo use.
 * `idPropio` se excluye de la busqueda para que editar una bodega sin
 * cambiar su propio codigo (o volviendo a enviar el mismo) nunca choque
 * contra si misma; tambien evita que la busqueda pueda tocar o
 * confundirse con el codigo de otra bodega — es de solo lectura.
 */
function verificarCodigoDisponible(codigo, idPropio) {
  if (codigo === null) return null;
  const enUso = idPropio
    ? db.prepare("SELECT id FROM bodegas WHERE codigo = ? AND id != ?").get(codigo, idPropio)
    : db.prepare("SELECT id FROM bodegas WHERE codigo = ?").get(codigo);
  return enUso ? `Ya existe otra bodega con el código "${codigo}"` : null;
}

/**
 * GET /api/bodegas?incluirInactivas=true
 * Por defecto solo trae activas (usado por el marcaje movil). El panel de
 * administracion de geocercas pide incluirInactivas=true para poder
 * reactivarlas.
 */
function listar(req, res) {
  const incluirInactivas = req.query.incluirInactivas === "true";
  const bodegas = incluirInactivas
    ? db.prepare("SELECT * FROM bodegas ORDER BY nombre ASC").all()
    : db.prepare("SELECT * FROM bodegas WHERE activo = 1 ORDER BY nombre ASC").all();
  return res.json(bodegas);
}

function crear(req, res) {
  const { nombre, direccion, latitud, longitud, radioMetros } = req.body;

  if (!nombre || typeof latitud !== "number" || typeof longitud !== "number") {
    return res.status(400).json({ error: "nombre, latitud y longitud son requeridos" });
  }

  if (
    radioMetros !== undefined &&
    (typeof radioMetros !== "number" || Number.isNaN(radioMetros) || radioMetros <= 0)
  ) {
    return res.status(400).json({ error: "radioMetros debe ser un numero positivo" });
  }

  const codigo = normalizarCodigo(req.body.codigo);
  const errorCodigo = verificarCodigoDisponible(codigo, null);
  if (errorCodigo) {
    return res.status(409).json({ error: errorCodigo });
  }

  const id = uuidv4();

  db.prepare(
    `INSERT INTO bodegas (id, nombre, direccion, latitud, longitud, radio_metros, codigo)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, nombre, direccion ?? null, latitud, longitud, radioMetros ?? 100, codigo);

  const bodega = db.prepare("SELECT * FROM bodegas WHERE id = ?").get(id);

  registrarAuditoria({
    usuario: req.usuario,
    accion: "crear",
    entidad: "bodega",
    entidadId: id,
    detalle: { nombre, codigo, latitud, longitud, radioMetros: radioMetros ?? 100 },
  });

  return res.status(201).json(bodega);
}

/**
 * PUT /api/bodegas/:id
 * Edita una geocerca (nombre, direccion, coordenadas, radio, activo).
 */
function actualizar(req, res) {
  const { id } = req.params;
  const existente = db.prepare("SELECT * FROM bodegas WHERE id = ?").get(id);
  if (!existente) {
    return res.status(404).json({ error: "Geocerca no encontrada" });
  }

  const { nombre, direccion, latitud, longitud, radioMetros, activo } = req.body;

  if (latitud !== undefined && typeof latitud !== "number") {
    return res.status(400).json({ error: "latitud debe ser numerica" });
  }
  if (longitud !== undefined && typeof longitud !== "number") {
    return res.status(400).json({ error: "longitud debe ser numerica" });
  }
  if (
    radioMetros !== undefined &&
    (typeof radioMetros !== "number" || Number.isNaN(radioMetros) || radioMetros <= 0)
  ) {
    return res.status(400).json({ error: "radioMetros debe ser un numero positivo" });
  }

  // Solo se toca el codigo si vino en el body (mismo criterio que el
  // resto de los campos); si no vino, se conserva el existente tal cual.
  const codigo = req.body.codigo !== undefined ? normalizarCodigo(req.body.codigo) : existente.codigo;
  const errorCodigo = verificarCodigoDisponible(codigo, id);
  if (errorCodigo) {
    return res.status(409).json({ error: errorCodigo });
  }

  db.prepare(
    `UPDATE bodegas SET nombre = ?, direccion = ?, latitud = ?, longitud = ?, radio_metros = ?, codigo = ?, activo = ?
     WHERE id = ?`
  ).run(
    nombre ?? existente.nombre,
    direccion !== undefined ? direccion : existente.direccion,
    latitud ?? existente.latitud,
    longitud ?? existente.longitud,
    radioMetros ?? existente.radio_metros,
    codigo,
    activo !== undefined ? (activo ? 1 : 0) : existente.activo,
    id
  );

  const actualizada = db.prepare("SELECT * FROM bodegas WHERE id = ?").get(id);

  registrarAuditoria({
    usuario: req.usuario,
    accion: "actualizar",
    entidad: "bodega",
    entidadId: id,
    detalle: { camposModificados: Object.keys(req.body) },
  });

  return res.json(actualizada);
}

/**
 * DELETE /api/bodegas/:id
 * Elimina la geocerca solo si no tiene empleados ni marcaciones asociadas
 * (por las foreign keys); si las tiene, se sugiere desactivarla en vez de
 * borrarla (PUT con activo=false).
 */
function eliminar(req, res) {
  const { id } = req.params;
  const existente = db.prepare("SELECT id FROM bodegas WHERE id = ?").get(id);
  if (!existente) {
    return res.status(404).json({ error: "Geocerca no encontrada" });
  }

  const empleadosAsignados = db
    .prepare("SELECT COUNT(*) AS total FROM empleados WHERE bodega_id = ?")
    .get(id).total;
  const registrosAsociados = db
    .prepare("SELECT COUNT(*) AS total FROM registros_asistencia WHERE bodega_id = ?")
    .get(id).total;

  if (empleadosAsignados > 0 || registrosAsociados > 0) {
    return res.status(409).json({
      error:
        "No se puede eliminar: la geocerca tiene empleados o marcaciones asociadas. Desactivala en su lugar.",
    });
  }

  db.prepare("DELETE FROM bodegas WHERE id = ?").run(id);

  registrarAuditoria({
    usuario: req.usuario,
    accion: "eliminar",
    entidad: "bodega",
    entidadId: id,
  });

  return res.status(204).send();
}

module.exports = { listar, crear, actualizar, eliminar };
