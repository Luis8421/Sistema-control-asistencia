require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const db = require("./db/connection");

const authRoutes = require("./routes/auth");
const asistenciaRoutes = require("./routes/asistencia");
const bodegaRoutes = require("./routes/bodegas");
const empleadoRoutes = require("./routes/empleados");
const marcacionRoutes = require("./routes/marcaciones");
const auditoriaRoutes = require("./routes/auditoria");
const indicadoresRoutes = require("./routes/indicadores");

const app = express();

// Cabeceras HTTP de seguridad basicas (X-Content-Type-Options,
// X-Frame-Options, etc). crossOriginResourcePolicy se relaja a
// "cross-origin" a proposito: el panel web y la app movil ya consumen
// /uploads/fotos/*.jpg desde un origen distinto al backend por diseño
// (ver web/js/marcaciones.js), el valor por defecto de helmet lo
// bloquearia.
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

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

app.get("/health", async (req, res) => {
  try {
    await db.health();
    return res.json({ ok: true });
  } catch (error) {
    console.error("Health check de base de datos fallido:", error.message);
    return res.status(503).json({ ok: false, error: "Base de datos no disponible" });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/asistencia", asistenciaRoutes);
app.use("/api/bodegas", bodegaRoutes);
app.use("/api/empleados", empleadoRoutes);
app.use("/api/marcaciones", marcacionRoutes);
app.use("/api/auditoria", auditoriaRoutes);
app.use("/api/indicadores", indicadoresRoutes);

// Manejo de errores centralizado
app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === "23505" || err.code === "SQLITE_CONSTRAINT_UNIQUE") {
    return res.status(409).json({ error: "El registro entra en conflicto con un dato unico existente" });
  }
  if (err.code === "23503" || err.code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
    return res.status(409).json({ error: "No se puede completar la operacion por registros relacionados" });
  }
  res.status(500).json({ error: "Error interno del servidor" });
});

const PORT = process.env.PORT || 4000;
if (
  process.env.NODE_ENV === "production" &&
  (!process.env.DATABASE_URL ||
    !process.env.JWT_SECRET ||
    process.env.JWT_SECRET === "TU_JWT_SECRET" ||
    process.env.JWT_SECRET.length < 32)
) {
  throw new Error("Produccion requiere DATABASE_URL y un JWT_SECRET aleatorio de al menos 32 caracteres.");
}
app.listen(PORT, () => {
  console.log(`Servidor de asistencia corriendo en http://localhost:${PORT}`);
});
