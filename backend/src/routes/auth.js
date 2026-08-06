const express = require("express");
const rateLimit = require("express-rate-limit");
const { login, registro } = require("../controllers/authController");

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos de inicio de sesion. Intenta de nuevo en un minuto." },
});

const registroLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos de registro. Intenta de nuevo en un minuto." },
});

router.post("/login", loginLimiter, login);
router.post("/registro", registroLimiter, registro);

module.exports = router;
