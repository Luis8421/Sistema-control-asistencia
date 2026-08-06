const express = require("express");
const rateLimit = require("express-rate-limit");
const { requiereAutenticacion, requiereRol } = require("../middleware/auth");
const { marcar, historial, enTurno } = require("../controllers/asistenciaController");

const router = express.Router();

router.use(requiereAutenticacion);

// No hay motivo legitimo para marcar mas de un puñado de veces seguidas
// (reintentos por mal GPS, por ejemplo). Limita abuso/spam sin estorbar el
// uso normal: entrada + salida + un par de reintentos por dia.
const marcarLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos de marcaje. Espera unos minutos e intenta de nuevo." },
});

router.post("/marcar", marcarLimiter, marcar);
router.get("/historial/:empleadoId", historial);
router.get("/en-turno", requiereRol("supervisor", "admin"), enTurno);

module.exports = router;
