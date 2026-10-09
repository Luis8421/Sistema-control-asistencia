const express = require("express");
const rateLimit = require("express-rate-limit");
const { login, loginEmpleado } = require("../controllers/authController");

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos de inicio de sesion. Intenta de nuevo en un minuto." },
});

// No hay autoregistro: un empleado solo puede marcar si un admin lo dio de
// alta primero (POST /api/empleados). Esta ruta existio antes; se quito a
// proposito para que "activo por el administrador" sea la unica puerta de
// entrada.
router.post("/login", loginLimiter, login);

// Ingreso simplificado del Portal de Marcaje: solo codigoEmpleado, sin
// password (ver authController.loginEmpleado). Comparte el mismo limitador
// que /login.
router.post("/login-empleado", loginLimiter, loginEmpleado);

module.exports = router;
