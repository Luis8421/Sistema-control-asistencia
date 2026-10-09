const express = require("express");
const { requiereAutenticacion, requiereRol } = require("../middleware/auth");
const {
  listar,
  listarPublico,
  crear,
  actualizar,
  actualizarAutorizacionBodegas,
  eliminar,
} = require("../controllers/empleadoController");

const router = express.Router();

// Sin autenticacion para alimentar el selector del Portal de Marcaje. Esta
// ruta expone los codigos de empleado; el login de ese portal los acepta
// como unica credencial, asi que no debe considerarse verificacion fuerte
// de identidad. Va antes del middleware administrativo de abajo.
router.get("/publico", listarPublico);

// Panel de administracion: login real (JWT) restringido a supervisor/admin,
// igual que el resto de la app. Antes usaba una API key fija compartida.
router.use(requiereAutenticacion, requiereRol("supervisor", "admin"));

router.get("/", listar);
router.post("/", crear);
router.put("/:id", actualizar);
router.put("/:id/autorizacion-bodegas", actualizarAutorizacionBodegas);
router.delete("/:id", eliminar);

module.exports = router;
