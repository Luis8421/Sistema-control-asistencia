const { v4: uuidv4 } = require("uuid");
const db = require("../db/connection");
const { validarGeocerca } = require("../utils/geo");
const { parsePaginacion } = require("../utils/paginacion");
const { guardarFotoBase64 } = require("../utils/fotos");
const { generarExcelMarcaciones } = require("../utils/excelExport");

const MAX_FILAS_EXPORTACION = 5000;

const MAX_GPS_PRECISION_M = Number(process.env.MAX_GPS_PRECISION_M || 50);

/**
 * Mensaje que ve el empleado cuando el marcaje se rechaza. El texto de
 * "fuera_de_rango" es literal, pedido explicitamente: cualquier cambio de
 * redaccion ahi debe ser intencional.
 */
function mensajeRechazo(motivo, distanciaM, radioMetros) {
  switch (motivo) {
    case "fuera_de_rango":
      return `No se encuentra dentro del área autorizada para registrar asistencia. Estás a ${Math.round(distanciaM)} m (radio permitido: ${radioMetros} m).`;
    case "precision_insuficiente":
      return "La precisión de tu GPS no es suficiente para validar el marcaje. Intenta nuevamente en un lugar con mejor señal.";
    case "gps_simulado":
      return "No se puede registrar el marcaje: se detectó una ubicación simulada (mock location).";
    case "precision_invalida":
    default:
      return "No se recibió una precisión de GPS válida. Verifica que la ubicación esté activada e intenta de nuevo.";
  }
}

/**
 * POST /api/asistencia/marcar
 * body: { tipo: "entrada"|"salida", latitud, longitud, precisionM, ubicacionSimulada, dispositivoId, foto }
 *
 * El empleado se identifica por el token (req.usuario.id), nunca por el body,
 * para que un tercero no pueda marcar en nombre de otro.
 *
 * `foto` es opcional: la app movil no la envia (ya tiene otros controles),
 * el marcaje web si la exige antes de llamar a este endpoint.
 *
 * Validacion de geocerca OBLIGATORIA: un marcaje fuera del radio
 * autorizado (o con GPS invalido/simulado/impreciso) se RECHAZA y no se
 * guarda ningun registro — el backend es la unica fuente de verdad, la
 * app movil/web solo hacen un chequeo local previo como optimizacion de
 * UX (ver mobile/utils/geo.js y web/js/marcaje.js), nunca se confia en el.
 */
function marcar(req, res) {
  const { tipo, latitud, longitud, precisionM, ubicacionSimulada, dispositivoId, foto } = req.body;

  if (!tipo || !["entrada", "salida"].includes(tipo)) {
    return res.status(400).json({ error: "tipo debe ser 'entrada' o 'salida'" });
  }
  if (typeof latitud !== "number" || typeof longitud !== "number") {
    return res.status(400).json({ error: "latitud y longitud son requeridas y deben ser numericas" });
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

  if (!valido) {
    return res.status(422).json({
      error: mensajeRechazo(motivo, distanciaM, bodega.radio_metros),
      motivo,
      distanciaM: Math.round(distanciaM),
    });
  }

  // La foto solo se decodifica/guarda si el marcaje va a quedar registrado
  // (evita dejar archivos huerfanos en uploads/fotos/ por marcajes que se
  // terminan rechazando por geocerca).
  let fotoUrl = null;
  if (foto) {
    try {
      fotoUrl = guardarFotoBase64(foto);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  const id = uuidv4();

  db.prepare(
    `INSERT INTO registros_asistencia
      (id, tipo, latitud, longitud, precision_gps_m, distancia_a_bodega_m, valido, motivo_invalido, dispositivo_id, foto_url, empleado_id, bodega_id)
     VALUES (?, ?, ?, ?, ?, ?, 1, NULL, ?, ?, ?, ?)`
  ).run(
    id,
    tipo,
    latitud,
    longitud,
    precisionM ?? null,
    distanciaM,
    dispositivoId ?? null,
    fotoUrl,
    empleado.id,
    empleado.bodega_id
  );

  const registro = db.prepare("SELECT * FROM registros_asistencia WHERE id = ?").get(id);

  return res.status(201).json({
    registro,
    mensaje: "Marcaje registrado y validado correctamente.",
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
 * Filtros compartidos por /api/marcaciones (listado paginado) y su
 * exportacion a Excel: fecha exacta, empleado, tipo (entrada/salida) y
 * validez. `valido=true|false` es opcional (sin el filtro, trae ambos) —
 * lo usa el dashboard para contar marcaciones validas/invalidas del dia
 * con una sola consulta COUNT cada una.
 * Devuelve null y ya escribe la respuesta de error si `tipo` es invalido.
 */
function construirFiltrosMarcaciones(query, res) {
  const { fecha, empleadoId, tipo, valido } = query;

  if (tipo && !["entrada", "salida"].includes(tipo)) {
    res.status(400).json({ error: "tipo debe ser 'entrada' o 'salida'" });
    return null;
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
  if (valido === "true" || valido === "false") {
    where.push("r.valido = ?");
    params.push(valido === "true" ? 1 : 0);
  }

  return { whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

/**
 * GET /api/marcaciones?page&limit&fecha&empleadoId&tipo
 * Listado general para el panel de administracion, con filtros opcionales.
 */
function listarTodas(req, res) {
  const { page, limit, offset } = parsePaginacion(req.query);

  const filtros = construirFiltrosMarcaciones(req.query, res);
  if (!filtros) return;
  const { whereSql, params } = filtros;

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

/**
 * GET /api/marcaciones/exportar?fecha&empleadoId&tipo
 * Mismos filtros que el listado, sin paginar (tope MAX_FILAS_EXPORTACION
 * para no generar un Excel gigante por error). Descarga un .xlsx.
 */
async function exportarExcel(req, res) {
  const filtros = construirFiltrosMarcaciones(req.query, res);
  if (!filtros) return;
  const { whereSql, params } = filtros;

  const registros = db
    .prepare(
      `SELECT r.*, e.nombre_completo, e.codigo_empleado, b.nombre AS bodega_nombre
       FROM registros_asistencia r
       JOIN empleados e ON e.id = r.empleado_id
       JOIN bodegas b ON b.id = r.bodega_id
       ${whereSql}
       ORDER BY r.timestamp_servidor DESC
       LIMIT ?`
    )
    .all(...params, MAX_FILAS_EXPORTACION);

  try {
    await generarExcelMarcaciones(registros, res);
  } catch (err) {
    console.error("Error generando Excel de marcaciones:", err);
    if (!res.headersSent) res.status(500).json({ error: "No se pudo generar el archivo" });
  }
}

module.exports = { marcar, historial, enTurno, listarTodas, exportarExcel };
