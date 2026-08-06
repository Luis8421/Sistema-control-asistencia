const db = require("../db/connection");
const { calcularIndicadores } = require("../utils/indicadores");

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const RANGO_MAX_DIAS = 366;

/**
 * GET /api/indicadores/:empleadoId?desde&hasta
 * Puntualidad, atrasos, ausencias y horas trabajadas en un rango de fechas.
 * Mismo criterio de autorizacion que /asistencia/historial/:empleadoId: un
 * empleado solo puede ver los suyos, supervisor/admin pueden ver cualquiera.
 * Por defecto (sin desde/hasta) calcula el mes en curso.
 */
function obtenerIndicadores(req, res) {
  const { empleadoId } = req.params;

  const esPropio = req.usuario.id === empleadoId;
  const esSupervisorOAdmin = ["supervisor", "admin"].includes(req.usuario.rol);
  if (!esPropio && !esSupervisorOAdmin) {
    return res.status(403).json({ error: "No autorizado a ver estos indicadores" });
  }

  const empleado = db.prepare("SELECT * FROM empleados WHERE id = ?").get(empleadoId);
  if (!empleado) {
    return res.status(404).json({ error: "Empleado no encontrado" });
  }

  const hoy = db.prepare("SELECT date('now', '-5 hours') AS hoy").get().hoy;
  const fechaInicio = req.query.desde || `${hoy.slice(0, 7)}-01`;
  const fechaFin = req.query.hasta || hoy;

  if (!FECHA_REGEX.test(fechaInicio) || !FECHA_REGEX.test(fechaFin)) {
    return res.status(400).json({ error: "desde/hasta deben tener formato YYYY-MM-DD" });
  }
  if (fechaInicio > fechaFin) {
    return res.status(400).json({ error: "desde no puede ser posterior a hasta" });
  }

  const diasEnRango = Math.round(
    (new Date(`${fechaFin}T00:00:00Z`) - new Date(`${fechaInicio}T00:00:00Z`)) / 86400000
  );
  if (diasEnRango > RANGO_MAX_DIAS) {
    return res.status(400).json({ error: `El rango maximo es de ${RANGO_MAX_DIAS} dias` });
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

  return res.json({
    empleado: {
      id: empleado.id,
      nombreCompleto: empleado.nombre_completo,
      codigoEmpleado: empleado.codigo_empleado,
    },
    ...indicadores,
  });
}

module.exports = { obtenerIndicadores };
