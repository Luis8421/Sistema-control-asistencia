// Caddy sirve este panel y hace reverse proxy de /api y /uploads hacia el
// backend bajo el MISMO origen (https://asistencia.local o la IP), asi
// que una ruta relativa alcanza y funciona igual sin importar el
// host/dominio que se use para entrar. Si abres el archivo directo
// (doble clic, file://) no hay Caddy de por medio, asi que ahi si apunta
// directo al backend en localhost:4000.
const apiUrlConfigurada = window.ASISTENCIA_API_URL && window.ASISTENCIA_API_URL.trim();
const API_URL = apiUrlConfigurada
  ? apiUrlConfigurada.replace(/\/+$/, "")
  : location.protocol === "file:" || location.hostname === "localhost"
    ? "http://localhost:4000/api"
    : "/api";

// Sesion del panel de administracion: login real con JWT (supervisor o
// admin), igual que usa la app movil. Se guarda bajo claves propias para
// no chocar con la sesion de empleado que usa marcaje.html
// (empleado_token / empleado_data).
function getToken() {
  return localStorage.getItem("panel_token");
}

function getUsuario() {
  const raw = localStorage.getItem("panel_usuario");
  return raw ? JSON.parse(raw) : null;
}

function clearSesion() {
  localStorage.removeItem("panel_token");
  localStorage.removeItem("panel_usuario");
}

// Sin sesion no tiene caso intentar cargar nada: al login de una vez.
if (!getToken()) {
  location.href = "login.html";
}

async function apiRequest(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));

  // Token ausente/expirado (401) o sin permiso de supervisor/admin (403):
  // no tiene sentido seguir en el panel, se manda a login. La promesa que
  // nunca resuelve corta la cadena para que el codigo que llamo no alcance
  // a pintar un mensaje de error justo antes de navegar afuera.
  if (res.status === 401 || res.status === 403) {
    clearSesion();
    location.href = "login.html";
    return new Promise(() => {});
  }

  if (!res.ok) {
    const error = new Error(data.error || "Error de red");
    error.status = res.status;
    error.data = data;
    throw error;
  }

  return data;
}

function extraerNombreArchivo(contentDisposition) {
  const match = /filename="(.+?)"/.exec(contentDisposition || "");
  return match ? match[1] : "descarga";
}

// Descarga un archivo (Excel/PDF) que requiere la misma sesion JWT del
// panel. No se puede usar un <a href> plano porque no hay forma de
// mandarle el header Authorization a una navegacion normal del navegador.
async function descargarArchivo(path) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (res.status === 401 || res.status === 403) {
    clearSesion();
    location.href = "login.html";
    return;
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "No se pudo generar el archivo");
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = extraerNombreArchivo(res.headers.get("Content-Disposition"));
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
