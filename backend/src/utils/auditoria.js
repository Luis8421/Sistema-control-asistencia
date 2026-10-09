const { v4: uuidv4 } = require("uuid");
const db = require("../db/connection");

const insertar = db.prepare(
  `INSERT INTO auditoria (id, usuario_id, usuario_email, accion, entidad, entidad_id, detalle)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);

/**
 * Deja constancia de una accion administrativa (crear/actualizar/eliminar
 * sobre empleados o geocercas desde el panel web). Nunca debe tumbar la
 * accion que audita: si falla, se registra en consola y se sigue.
 *
 * @param {object} params
 * @param {{id: string, email: string}} params.usuario - req.usuario (JWT)
 * @param {"crear"|"actualizar"|"eliminar"} params.accion
 * @param {"empleado"|"bodega"} params.entidad
 * @param {string} params.entidadId
 * @param {object} [params.detalle] - campos afectados; nunca incluir contrasenas
 */
async function registrarAuditoria({ usuario, accion, entidad, entidadId, detalle }) {
  try {
    await insertar.run(
      uuidv4(),
      usuario.id,
      usuario.email,
      accion,
      entidad,
      entidadId,
      detalle ? JSON.stringify(detalle) : null
    );
  } catch (err) {
    console.error("No se pudo registrar auditoria:", err);
  }
}

module.exports = { registrarAuditoria };
