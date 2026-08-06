// Auth simple para el panel de administracion: una API key fija compartida,
// sin login ni JWT. Pensada para uso interno/confianza baja (MVP).
function requiereApiKey(req, res, next) {
  const apiKey = req.headers["x-api-key"];

  if (!apiKey || apiKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: "API key invalida o no proporcionada" });
  }

  next();
}

module.exports = { requiereApiKey };
