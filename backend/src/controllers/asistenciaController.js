const { v4: uuidv4 } = require("uuid");
const db = require("../db/connection");
const { validarGeocerca } = require("../utils/geo");
const { parsePaginacion } = require("../utils/paginacion");
const { guardarFotoBase64 } = require("../utils/fotos");

const MAX_GPS_PRECISION_M = Number(process.env.MAX_GPS_PRECISION_M || 50);

/**
 * POST /api/asistencia/marcar
 * body: { tipo: "entrada"|"salida", latitud, longitud, precisionM, ubicacionSimulada, dispositivoId, foto }
 *
 * El empleado se identifica por el token (req.usuario.id), nunca por el body,
 * para que un tercero no pueda marcar en nombre de otro.
 *
 * `foto` es opcional: la app movil no la envia (ya tiene otros controles),
 * el marcaje web si la exige antes de llamar a este endpoint.
 */
function marcar(req, res) {
  const { tipo, latitud, longitud, precisionM, ubicacionSimulada, dispositivoId, foto } = req.body;

  if (!tipo || !["entrada", "salida"].includes(tipo)) {
    return res.status(400).json({ error: "tipo debe ser 'entrada' o 'salida'" });
  }
  if (typeof latitud !== "number" || typeof longitud !== "number") {
    return res.status(400).json({ error: "latitud y longitud son requeridas y deben ser numericas" });
  }

  let fotoUrl = null;
  if (foto) {
    try {
      fotoUrl = guardarFotoBase64(foto);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  const empleado = db.prepare("SELECT * FROM empleados WHERE id = ?").get(req.usuario.id);

  if (!empleado || !empleado.activo) {
    return res.status(404).json({ error: "Empleado no encontrado o inactivo" });
  }

  const bodega = db.prepare("SELECT * FROM bodegas WHERE id = ?").get(empleado.bodega_id);

  const { valido, distanciaM, motivo } = validarGeocerca({
    lat: latitud,
    lon: longitud,
    precisionM,
    bodega: { latitud: bodega.latitud, longitud: bodega.longitud, radioMetros: bodega.radio_metros },
    maxPrecisionAceptadaM: MAX_GPS_PRECISION_M,
    ubicacionSimulada: !!ubicacionSimulada,
  });

  const id = uuidv4();

  // El registro se guarda SIEMPRE, valido o no, para trazabilidad/auditoria.
  db.prepare(
    `INSERT INTO registros_asistencia
      (id, tipo, latitud, longitud, precision_gps_m, distancia_a_bodega_m, valido, motivo_invalido, dispositivo_id, foto_url, empleado_id, bodega_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    tipo,
    latitud,
    longitud,
    precisionM ?? null,
    distanciaM,
    valido ? 1 : 0,
    motivo,
    dispositivoId ?? null,
    fotoUrl,
    empleado.id,
    empleado.bodega_id
  );

  const registro = db.prepare("SELECT * FROM registros_asistencia WHERE id = ?").get(id);

  return res.status(valido ? 201 : 422).json({
    registro,
    mensaje: valido
      ? "Marcaje registrado y validado correctamente."
      : `Marcaje registrado pero NO valido (motivo: ${motivo}). Distancia a la bodega: ${Math.round(distanciaM)} m.`,
  });
}

/**
 * GET /api/asistencia/historial/:empleadoId
 * Un empleado solo puede ver su propio historial, salvo supervisor/admin.
 */
function historial(req, res) {
  const { empleadoId } = req.params;

  const esPropio = req.usuario.id === empleadoId;
  const esSupervisorOAdmin = ["supervisor", "admin"].includes(req.usuario.rol);

  if (!esPropio && !esSupervisorOAdmin) {
    return res.status(403).json({ error: "No autorizado a ver este historial" });
  }

  const registros = db
    .prepare(
      `SELECT r.*, b.nombre AS bodega_nombre
       FROM registros_asistencia r
       JOIN bodegas b ON b.id = r.bodega_id
       WHERE r.empleado_id = ?
       ORDER BY r.timestamp_servidor DESC`
    )
    .all(empleadoId);

  return res.json(registros);
}

/**
 * GET /api/asistencia/en-turno
 * Empleados cuyo ultimo marcaje valido del dia es "entrada".
 * Pensado como base para el panel de supervision (Fase 2).
 */
function enTurno(req, res) {
  const registrosHoy = db
    .prepare(
      `SELECT r.*, e.nombre_completo, b.nombre AS bodega_nombre
       FROM registros_asistencia r
       JOIN empleados e ON e.id = r.empleado_id
       JOIN bodegas b ON b.id = r.bodega_id
       WHERE date(r.timestamp_servidor) = date('now')
         AND r.valido = 1
       ORDER BY r.timestamp_servidor ASC`
    )
    .all();

  const ultimoPorEmpleado = new Map();
  for (const r of registrosHoy) {
    ultimoPorEmpleado.set(r.empleado_id, r);
  }

  const enTurnoAhora = [...ultimoPorEmpleado.values()].filter((r) => r.tipo === "entrada");

  return res.json(enTurnoAhora);
}

/**
 * GET /api/marcaciones?page&limit&fecha&empleadoId&tipo
 * Listado general para el panel de administracion, con filtros opcionales.
 */
function listarTodas(req, res) {
  const { page, limit, offset } = parsePaginacion(req.query);
  const { fecha, empleadoId, tipo } = req.query;

  if (tipo && !["entrada", "salida"].includes(tipo)) {
    return res.status(400).json({ error: "tipo debe ser 'entrada' o 'salida'" });
  }

  const where = [];
  const params = [];

  if (fecha) {
    where.push("date(r.timestamp_servidor) = date(?)");
    params.push(fecha);
  }
  if (empleadoId) {
    where.push("r.empleado_id = ?");
    params.push(empleadoId);
  }
  if (tipo) {
    where.push("r.tipo = ?");
    params.push(tipo);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = db
    .prepare(`SELECT COUNT(*) AS total FROM registros_asistencia r ${whereSql}`)
    .get(...params).total;

  const data = db
    .prepare(
      `SELECT r.*, e.nombre_completo, e.codigo_empleado, b.nombre AS bodega_nombre
       FROM registros_asistencia r
       JOIN empleados e ON e.id = r.empleado_id
       JOIN bodegas b ON b.id = r.bodega_id
       ${whereSql}
       ORDER BY r.timestamp_servidor DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  return res.json({ data, page, limit, total, totalPaginas: Math.ceil(total / limit) || 1 });
}

module.exports = { marcar, historial, enTurno, listarTodas };
