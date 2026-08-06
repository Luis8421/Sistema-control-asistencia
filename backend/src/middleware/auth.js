const jwt = require("jsonwebtoken");

function requiereAutenticacion(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token no proporcionado" });
  }

  const token = header.split(" ")[1];

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.usuario = payload; // { id, email, rol }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token invalido o expirado" });
  }
}

// Middleware adicional para restringir por rol, ej: requiereRol("supervisor", "admin")
function requiereRol(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.usuario || !rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({ error: "No tienes permisos para esta accion" });
    }
    next();
  };
}

module.exports = { requiereAutenticacion, requiereRol };
