const express = require("express");
const { requiereAutenticacion, requiereRol } = require("../middleware/auth");
const { listarTodas } = require("../controllers/asistenciaController");

const router = express.Router();

// Panel de administracion: login real (JWT) restringido a supervisor/admin,
// igual que el resto de la app. Antes usaba una API key fija compartida.
router.use(requiereAutenticacion, requiereRol("supervisor", "admin"));

router.get("/", listarTodas);

module.exports = router;
