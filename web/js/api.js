// Caddy sirve este panel y hace reverse proxy de /api y /uploads hacia el
// backend bajo el MISMO origen (https://asistencia.local o la IP), asi
// que una ruta relativa alcanza y funciona igual sin importar el
// host/dominio que se use para entrar. Si abres el archivo directo
// (doble clic, file://) no hay Caddy de por medio, asi que ahi si apunta
// directo al backend en localhost:4000.
const API_URL = location.protocol === "file:" ? "http://localhost:4000/api" : "/api";

// Debe coincidir con ADMIN_API_KEY en backend/.env. El panel no tiene
// login: esta clave fija es lo unico que autentica cada peticion.
const API_KEY = "a2eee0e50ff77dea9bd79e94e547534d6b2ce6ef99aa7b1a2186d8698194eeac";

async function apiRequest(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": API_KEY,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const error = new Error(data.error || "Error de red");
    error.status = res.status;
    error.data = data;
    throw error;
  }

  return data;
}
