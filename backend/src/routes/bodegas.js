const express = require("express");
const { requiereApiKey } = require("../middleware/apiKey");
const { listar, crear, actualizar, eliminar } = require("../controllers/bodegaController");

const router = express.Router();

router.use(requiereApiKey);

router.get("/", listar);
router.post("/", crear);
router.put("/:id", actualizar);
router.delete("/:id", eliminar);

module.exports = router;
