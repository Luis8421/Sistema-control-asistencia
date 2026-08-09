const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const db = require("../db/connection");

// Duracion de la sesion (JWT), configurable via .env. Mismo valor para
// los 3 clientes (app movil, portal de marcaje, panel admin) porque es
// literalmente el mismo mecanismo de auth para todos — no hay una
// duracion especial por cliente. Default identico al valor previo
// (hardcodeado a "12h") para que no cambie nada si no se configura.
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "12h";

async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "email y password son requeridos" });
  }

  const empleado = db
    .prepare("SELECT * FROM empleados WHERE email = ?")
    .get(email);

  if (!empleado || !empleado.activo) {
    return res.status(401).json({ error: "Credenciales invalidas" });
  }

  const passwordValido = await bcrypt.compare(password, empleado.password_hash);

  if (!passwordValido) {
    return res.status(401).json({ error: "Credenciales invalidas" });
  }

  const token = jwt.sign(
    { id: empleado.id, email: empleado.email, rol: empleado.rol },
    process.env.JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  return res.json({
    token,
    empleado: {
      id: empleado.id,
      nombreCompleto: empleado.nombre_completo,
      codigoEmpleado: empleado.codigo_empleado,
      cargo: empleado.cargo,
      rol: empleado.rol,
      bodegaId: empleado.bodega_id,
      bodega: obtenerBodegaParaValidacion(empleado.bodega_id),
      // Autorizacion de marcaje, independiente de rol: si es true, el
      // Portal sabe que debe dejar que el backend decida siempre (no tiene
      // sentido un chequeo local de una sola geocerca) y puede mostrar una
      // etiqueta acorde ("autorizado en cualquier bodega").
      autorizadoTodasBodegas: !!empleado.autorizado_todas_bodegas,
    },
  });
}

/**
 * Geocerca de la bodega PRINCIPAL (empleados.bodega_id), en la forma que
 * necesitan los clientes para el chequeo local de UX. Esto es solo una
 * optimizacion: el backend (utils/geo.js) vuelve a validar la distancia
 * de forma autoritativa en cada POST /asistencia/marcar sin importar lo
 * que diga el cliente.
 *
 * Los empleados no tienen acceso a GET /api/bodegas (esta reservado a
 * supervisor/admin), asi que la unica forma de que un empleado conozca
 * la geocerca de SU PROPIA bodega es que viaje aqui, en el login.
 */
function obtenerBodegaParaValidacion(bodegaId) {
  const bodega = db.prepare("SELECT id, nombre, latitud, longitud, radio_metros FROM bodegas WHERE id = ?").get(bodegaId);
  if (!bodega) return null;
  return {
    id: bodega.id,
    nombre: bodega.nombre,
    latitud: bodega.latitud,
    longitud: bodega.longitud,
    radioMetros: bodega.radio_metros,
  };
}

/**
 * POST /api/auth/registro
 * body: { nombreCompleto, email, password }
 * Autoregistro desde la app movil. Siempre crea rol 'empleado' y lo asigna
 * a la primera geocerca activa (el MVP asume una sola bodega/oficina; si
 * hay varias, un admin puede reasignar despues desde el panel).
 */
async function registro(req, res) {
  const { nombreCompleto, email, password } = req.body;

  if (!nombreCompleto || !email || !password) {
    return res.status(400).json({ error: "nombreCompleto, email y password son requeridos" });
  }

  const yaExiste = db.prepare("SELECT id FROM empleados WHERE email = ?").get(email);
  if (yaExiste) {
    return res.status(409).json({ error: "Ya existe una cuenta con ese email" });
  }

  const bodega = db.prepare("SELECT id FROM bodegas WHERE activo = 1 LIMIT 1").get();
  if (!bodega) {
    return res.status(400).json({ error: "No hay ninguna geocerca configurada todavia. Contacta al administrador." });
  }

  const id = uuidv4();
  const codigoEmpleado = `EMP-${id.slice(0, 8).toUpperCase()}`;
  const passwordHash = await bcrypt.hash(password, 10);

  db.prepare(
    `INSERT INTO empleados (id, nombre_completo, codigo_empleado, email, password_hash, rol, bodega_id)
     VALUES (?, ?, ?, ?, ?, 'empleado', ?)`
  ).run(id, nombreCompleto, codigoEmpleado, email, passwordHash, bodega.id);

  // autorizado_todas_bodegas nace en 0 (DEFAULT de la columna): el
  // autoregistro NUNCA otorga autorizacion global. El empleado queda
  // restringido a bodega.id (su bodega principal) hasta que un admin se
  // la conceda explicitamente via PUT /:id/autorizacion-bodegas.
  const token = jwt.sign(
    { id, email, rol: "empleado" },
    process.env.JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  return res.status(201).json({
    token,
    empleado: {
      id,
      nombreCompleto,
      codigoEmpleado,
      cargo: null,
      rol: "empleado",
      bodegaId: bodega.id,
      bodega: obtenerBodegaParaValidacion(bodega.id),
      autorizadoTodasBodegas: false,
    },
  });
}

module.exports = { login, registro };
