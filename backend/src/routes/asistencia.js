const express = require("express");
const { requiereAutenticacion, requiereRol } = require("../middleware/auth");
const { marcar, historial, enTurno } = require("../controllers/asistenciaController");

const router = express.Router();

router.use(requiereAutenticacion);

router.post("/marcar", marcar);
router.get("/historial/:empleadoId", historial);
router.get("/en-turno", requiereRol("supervisor", "admin"), enTurno);

module.exports = router;
