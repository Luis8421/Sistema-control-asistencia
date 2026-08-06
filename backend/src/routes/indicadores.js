const express = require("express");
const { requiereAutenticacion } = require("../middleware/auth");
const { obtenerIndicadores, exportarPdf } = require("../controllers/indicadoresController");

const router = express.Router();

router.use(requiereAutenticacion);

router.get("/:empleadoId/exportar", exportarPdf);
router.get("/:empleadoId", obtenerIndicadores);

module.exports = router;
