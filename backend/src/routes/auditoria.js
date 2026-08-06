const express = require("express");
const { requiereAutenticacion, requiereRol } = require("../middleware/auth");
const { listar } = require("../controllers/auditoriaController");

const router = express.Router();

// Solo admin: ni siquiera un supervisor debe poder ver el rastro de
// auditoria (incluye acciones de otros supervisores/admins).
router.use(requiereAutenticacion, requiereRol("admin"));

router.get("/", listar);

module.exports = router;
