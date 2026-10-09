const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db/connection");
const asyncHandler = require("../utils/asyncHandler");

// Duracion de la sesion (JWT). Distinta segun el rol a proposito: un
// empleado normal marca desde SU PROPIO celular todos los dias, asi que
// tiene sentido que la sesion dure meses (Portal de Marcaje: entra una
// vez y no se le vuelve a pedir codigo/PIN). supervisor/admin entran al
// panel administrativo, con mas alcance (crear/editar empleados, ver
// reportes) — ahi se mantiene una sesion corta por seguridad, igual que
// antes. Ambas configurables via .env.
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "12h";
const JWT_EXPIRES_IN_EMPLEADO = process.env.JWT_EXPIRES_IN_EMPLEADO || "180d";

/**
 * Login por codigoEmpleado ("usuario"): es el identificador de entrada
 * para TODOS los roles (empleado, supervisor, admin) — el panel de
 * administracion (login.html) tambien entra asi, no por correo. email
 * sigue aceptandose como alternativa (por si algun cliente/script externo
 * todavia lo usa), pero ningun formulario propio del proyecto lo pide ya.
 * Son dos identificadores distintos a proposito, nunca se intenta adivinar
 * cual mando el cliente contra ambas columnas a la vez.
 */
async function login(req, res) {
  const { codigoEmpleado, email, password } = req.body;

  if ((!codigoEmpleado && !email) || !password) {
    return res.status(400).json({ error: "codigoEmpleado (o email) y password son requeridos" });
  }

  const empleado = codigoEmpleado
    ? await db.prepare("SELECT * FROM empleados WHERE codigo_empleado = ?").get(codigoEmpleado)
    : await db.prepare("SELECT * FROM empleados WHERE email = ?").get(email);

  if (!empleado || !empleado.activo) {
    return res.status(401).json({ error: "Credenciales invalidas" });
  }

  const passwordValido = await bcrypt.compare(password, empleado.password_hash);

  if (!passwordValido) {
    return res.status(401).json({ error: "Credenciales invalidas" });
  }

  return res.json(await construirRespuestaLogin(empleado));
}

/**
 * POST /api/auth/login-empleado
 * body: { codigoEmpleado }
 * Ingreso SIN password para el Portal de Marcaje. Es una decision
 * explicita de simplificar el acceso a costa de ya no verificar identidad
 * de forma fuerte: GET /empleados/publico expone los codigos activos y
 * cualquier persona que los conozca puede iniciar sesion como ese empleado.
 * NUNCA se usa para
 * supervisor/admin (esos siguen exigiendo password en login(), arriba,
 * para el panel administrativo) -- por eso el filtro rol = 'empleado'.
 */
async function loginEmpleado(req, res) {
  const { codigoEmpleado } = req.body;

  if (!codigoEmpleado) {
    return res.status(400).json({ error: "codigoEmpleado es requerido" });
  }

  const empleado = await db
    .prepare("SELECT * FROM empleados WHERE codigo_empleado = ? AND rol = 'empleado'")
    .get(codigoEmpleado);

  if (!empleado || !empleado.activo) {
    return res.status(401).json({ error: "Codigo no encontrado o inactivo" });
  }

  return res.json(await construirRespuestaLogin(empleado));
}

async function construirRespuestaLogin(empleado) {
  const expiresIn = empleado.rol === "empleado" ? JWT_EXPIRES_IN_EMPLEADO : JWT_EXPIRES_IN;

  const token = jwt.sign(
    { id: empleado.id, codigoEmpleado: empleado.codigo_empleado, email: empleado.email, rol: empleado.rol },
    process.env.JWT_SECRET,
    { expiresIn }
  );

  return {
    token,
    empleado: {
      id: empleado.id,
      nombreCompleto: empleado.nombre_completo,
      codigoEmpleado: empleado.codigo_empleado,
      cargo: empleado.cargo,
      rol: empleado.rol,
      bodegaId: empleado.bodega_id,
      bodega: await obtenerBodegaParaValidacion(empleado.bodega_id),
      // Autorizacion de marcaje, independiente de rol: si es true, el
      // Portal sabe que debe dejar que el backend decida siempre (no tiene
      // sentido un chequeo local de una sola geocerca) y puede mostrar una
      // etiqueta acorde ("autorizado en cualquier bodega").
      autorizadoTodasBodegas: !!empleado.autorizado_todas_bodegas,
    },
  };
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
async function obtenerBodegaParaValidacion(bodegaId) {
  const bodega = await db.prepare("SELECT id, nombre, latitud, longitud, radio_metros FROM bodegas WHERE id = ?").get(bodegaId);
  if (!bodega) return null;
  return {
    id: bodega.id,
    nombre: bodega.nombre,
    latitud: bodega.latitud,
    longitud: bodega.longitud,
    radioMetros: bodega.radio_metros,
  };
}

module.exports = {
  login: asyncHandler(login),
  loginEmpleado: asyncHandler(loginEmpleado),
};
