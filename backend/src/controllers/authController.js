const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const db = require("../db/connection");

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
    { expiresIn: "12h" }
  );

  return res.json({
    token,
    empleado: {
      id: empleado.id,
      nombreCompleto: empleado.nombre_completo,
      codigoEmpleado: empleado.codigo_empleado,
      rol: empleado.rol,
      bodegaId: empleado.bodega_id,
    },
  });
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

  const token = jwt.sign(
    { id, email, rol: "empleado" },
    process.env.JWT_SECRET,
    { expiresIn: "12h" }
  );

  return res.status(201).json({
    token,
    empleado: {
      id,
      nombreCompleto,
      codigoEmpleado,
      rol: "empleado",
      bodegaId: bodega.id,
    },
  });
}

module.exports = { login, registro };
