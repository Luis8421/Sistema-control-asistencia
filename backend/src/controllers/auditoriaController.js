const db = require("../db/connection");
const { parsePaginacion } = require("../utils/paginacion");
const asyncHandler = require("../utils/asyncHandler");

/**
 * GET /api/auditoria?page&limit&entidad&usuarioId&fecha
 * Solo admin (mas estricto que el resto del panel: un supervisor no debe
 * poder ver ni borrar rastro de sus propias acciones ni las de otros).
 */
async function listar(req, res) {
  const { page, limit, offset } = parsePaginacion(req.query);
  const { entidad, usuarioId, fecha } = req.query;

  if (entidad && !["empleado", "bodega"].includes(entidad)) {
    return res.status(400).json({ error: "entidad debe ser 'empleado' o 'bodega'" });
  }

  const where = [];
  const params = [];

  if (entidad) {
    where.push("a.entidad = ?");
    params.push(entidad);
  }
  if (usuarioId) {
    where.push("a.usuario_id = ?");
    params.push(usuarioId);
  }
  if (fecha) {
    where.push("date(a.creado_en) = date(?)");
    params.push(fecha);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = await db
    .prepare(`SELECT COUNT(*) AS total FROM auditoria a ${whereSql}`)
    .get(...params);

  const data = await db
    .prepare(
      `SELECT a.* FROM auditoria a
       ${whereSql}
       ORDER BY a.creado_en DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  return res.json({ data, page, limit, total: Number(total.total), totalPaginas: Math.ceil(Number(total.total) / limit) || 1 });
}

module.exports = { listar: asyncHandler(listar) };
