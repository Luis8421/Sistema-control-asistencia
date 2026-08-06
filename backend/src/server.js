require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const authRoutes = require("./routes/auth");
const asistenciaRoutes = require("./routes/asistencia");
const bodegaRoutes = require("./routes/bodegas");
const empleadoRoutes = require("./routes/empleados");
const marcacionRoutes = require("./routes/marcaciones");
const auditoriaRoutes = require("./routes/auditoria");

const app = express();

// Solo se permiten peticiones desde navegador con origen en CORS_ORIGIN
// (lista separada por comas en .env). Peticiones sin header Origin
// (curl, apps moviles, servidor a servidor) se permiten igual, ya que no
// aplica la politica de mismo origen del navegador.
const origenesPermitidos = (process.env.CORS_ORIGIN || "http://localhost")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || origenesPermitidos.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Origen no permitido por CORS"));
    },
  })
);
// Limite subido de 100kb (default) a 2mb para poder recibir la foto del
// marcaje web como base64 en el mismo body JSON.
app.use(express.json({ limit: "2mb" }));

// Sirve las fotos de marcaje guardadas por utils/fotos.js
// (backend/uploads/fotos/*.jpg) para que el panel admin pueda mostrarlas.
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/asistencia", asistenciaRoutes);
app.use("/api/bodegas", bodegaRoutes);
app.use("/api/empleados", empleadoRoutes);
app.use("/api/marcaciones", marcacionRoutes);
app.use("/api/auditoria", auditoriaRoutes);

// Manejo de errores centralizado
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Servidor de asistencia corriendo en http://localhost:${PORT}`);
});
