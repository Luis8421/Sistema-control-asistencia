const db = require("../db/connection");
const { calcularIndicadores } = require("../utils/indicadores");
const { generarPdfIndicadores } = require("../utils/pdfExport");

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const RANGO_MAX_DIAS = 366;

/**
 * Valida permisos/parametros y calcula los indicadores de un empleado.
 * Compartido por el endpoint JSON y el de exportacion a PDF para no
 * duplicar la logica. Lanza { status, error } (no una Error normal) para
 * que el controlador que llama solo tenga que mapearlo a res.status().json().
 */
function resolverIndicadores(req) {
  const { empleadoId } = req.params;

  const esPropio = req.usuario.id === empleadoId;
  const esSupervisorOAdmin = ["supervisor", "admin"].includes(req.usuario.rol);
  if (!esPropio && !esSupervisorOAdmin) {
    throw { status: 403, error: "No autorizado a ver estos indicadores" };
  }

  const empleado = db.prepare("SELECT * FROM empleados WHERE id = ?").get(empleadoId);
  if (!empleado) {
    throw { status: 404, error: "Empleado no encontrado" };
  }

  const hoy = db.prepare("SELECT date('now', '-5 hours') AS hoy").get().hoy;
  const fechaInicio = req.query.desde || `${hoy.slice(0, 7)}-01`;
  const fechaFin = req.query.hasta || hoy;

  if (!FECHA_REGEX.test(fechaInicio) || !FECHA_REGEX.test(fechaFin)) {
    throw { status: 400, error: "desde/hasta deben tener formato YYYY-MM-DD" };
  }
  if (fechaInicio > fechaFin) {
    throw { status: 400, error: "desde no puede ser posterior a hasta" };
  }

  const diasEnRango = Math.round(
    (new Date(`${fechaFin}T00:00:00Z`) - new Date(`${fechaInicio}T00:00:00Z`)) / 86400000
  );
  if (diasEnRango > RANGO_MAX_DIAS) {
    throw { status: 400, error: `El rango maximo es de ${RANGO_MAX_DIAS} dias` };
  }

  const registros = db
    .prepare(
      `SELECT tipo, timestamp_servidor, valido FROM registros_asistencia
       WHERE empleado_id = ? AND date(timestamp_servidor) BETWEEN date(?) AND date(?)
       ORDER BY timestamp_servidor ASC`
    )
    .all(empleadoId, fechaInicio, fechaFin);

  const fechaFinAusencias = fechaFin < hoy ? fechaFin : hoy;

  const indicadores = calcularIndicadores({
    registros,
    empleado,
    fechaInicio,
    fechaFin,
    fechaFinAusencias,
  });

  return {
    empleado: {
      id: empleado.id,
      nombreCompleto: empleado.nombre_completo,
      codigoEmpleado: empleado.codigo_empleado,
    },
    ...indicadores,
  };
}

/**
 * GET /api/indicadores/:empleadoId?desde&hasta
 * Puntualidad, atrasos, ausencias y horas trabajadas en un rango de fechas.
 * Mismo criterio de autorizacion que /asistencia/historial/:empleadoId: un
 * empleado solo puede ver los suyos, supervisor/admin pueden ver cualquiera.
 * Por defecto (sin desde/hasta) calcula el mes en curso.
 */
function obtenerIndicadores(req, res) {
  try {
    return res.json(resolverIndicadores(req));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.error });
    throw err;
  }
}

/**
 * GET /api/indicadores/:empleadoId/exportar?desde&hasta
 * Mismo calculo que el endpoint JSON, servido como PDF descargable.
 */
function exportarPdf(req, res) {
  try {
    const data = resolverIndicadores(req);
    generarPdfIndicadores(data, res);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.error });
    throw err;
  }
}

module.exports = { obtenerIndicadores, exportarPdf };
