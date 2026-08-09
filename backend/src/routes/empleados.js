const express = require("express");
const { requiereAutenticacion, requiereRol } = require("../middleware/auth");
const { listar, crear, actualizar, actualizarAutorizacionBodegas, eliminar } = require("../controllers/empleadoController");

const router = express.Router();

// Panel de administracion: login real (JWT) restringido a supervisor/admin,
// igual que el resto de la app. Antes usaba una API key fija compartida.
router.use(requiereAutenticacion, requiereRol("supervisor", "admin"));

router.get("/", listar);
router.post("/", crear);
router.put("/:id", actualizar);
router.put("/:id/autorizacion-bodegas", actualizarAutorizacionBodegas);
router.delete("/:id", eliminar);

module.exports = router;
