const express = require("express");
const { requiereApiKey } = require("../middleware/apiKey");
const { listarTodas } = require("../controllers/asistenciaController");

const router = express.Router();

router.use(requiereApiKey);

router.get("/", listarTodas);

module.exports = router;
