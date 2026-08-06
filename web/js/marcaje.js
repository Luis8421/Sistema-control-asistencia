// Ver comentario en js/api.js: con Caddy sirviendo panel + proxy /api en
// el mismo origen, una ruta relativa funciona para cualquier empleado sin
// importar si entro por asistencia.local o por la IP.
const API_URL = location.protocol === "file:" ? "http://localhost:4000/api" : "/api";

// Sesion de empleado (JWT), separada del panel admin (que usa API key y
// no tiene login). Se guarda bajo claves propias para no chocar con nada.
function getToken() {
  return localStorage.getItem("empleado_token");
}

function getEmpleado() {
  const raw = localStorage.getItem("empleado_data");
  return raw ? JSON.parse(raw) : null;
}

function setSesion(token, empleado) {
  localStorage.setItem("empleado_token", token);
  localStorage.setItem("empleado_data", JSON.stringify(empleado));
}

function clearSesion() {
  localStorage.removeItem("empleado_token");
  localStorage.removeItem("empleado_data");
}

async function apiRequest(path, { method = "GET", body } = {}) {
  const token = getToken();

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const error = new Error(data.error || "Error de red");
    error.status = res.status;
    error.data = data;
    throw error;
  }

  return data;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function obtenerUbicacion() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Tu navegador no soporta geolocalizacion."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      (err) => reject(new Error("No se pudo obtener tu ubicacion (revisa el permiso de ubicacion): " + err.message)),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  });
}

// Activa la camara, toma una sola foto (640x480) y libera la camara de
// inmediato. Se usa para verificar que quien marca es quien dice ser,
// ya que compartir email/password no alcanza para "presentarse" con foto.
async function capturarFoto() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("Tu navegador no soporta camara.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "user" }, width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });

  const video = document.createElement("video");
  video.setAttribute("playsinline", "");
  video.muted = true;
  video.style.position = "fixed";
  video.style.left = "-9999px";
  document.body.appendChild(video);
  video.srcObject = stream;

  try {
    await video.play();
    await new Promise((resolve) => {
      if (video.readyState >= 2) return resolve();
      video.onloadeddata = () => resolve();
    });

    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL("image/jpeg", 0.7);
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    video.remove();
  }
}

function mostrarBloqueMarcaje() {
  document.getElementById("bloqueLogin").classList.add("d-none");
  document.getElementById("bloqueMarcaje").classList.remove("d-none");
  document.getElementById("nombreEmpleado").textContent = getEmpleado().nombreCompleto;
  cargarHistorial();
}

function mostrarBloqueLogin() {
  document.getElementById("bloqueMarcaje").classList.add("d-none");
  document.getElementById("bloqueLogin").classList.remove("d-none");
}

function manejarSesionExpirada(err) {
  if (err.status === 401) {
    clearSesion();
    mostrarBloqueLogin();
    document.getElementById("errorLogin").textContent = "Tu sesion expiro, ingresa de nuevo.";
    document.getElementById("errorLogin").classList.remove("d-none");
    return true;
  }
  return false;
}

document.getElementById("formLogin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorBox = document.getElementById("errorLogin");
  const btn = document.getElementById("btnLogin");
  errorBox.classList.add("d-none");
  btn.disabled = true;
  btn.textContent = "Ingresando...";

  try {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const data = await apiRequest("/auth/login", { method: "POST", body: { email, password } });
    setSesion(data.token, data.empleado);
    mostrarBloqueMarcaje();
  } catch (err) {
    errorBox.textContent = err.data?.error || "No se pudo iniciar sesion.";
    errorBox.classList.remove("d-none");
  } finally {
    btn.disabled = false;
    btn.textContent = "Iniciar sesion";
  }
});

document.getElementById("btnLogout").addEventListener("click", () => {
  clearSesion();
  mostrarBloqueLogin();
});

async function marcar(tipo) {
  const resultado = document.getElementById("resultadoMarcaje");
  const botones = [document.getElementById("btnEntrada"), document.getElementById("btnSalida")];
  resultado.classList.add("d-none");
  botones.forEach((b) => (b.disabled = true));

  resultado.textContent = "Activando camara...";
  resultado.className = "alert mt-3 alert-info";
  resultado.classList.remove("d-none");

  let foto;
  try {
    foto = await capturarFoto();
  } catch (err) {
    resultado.textContent = "No se puede marcar sin permiso de camara.";
    resultado.className = "alert mt-3 alert-danger";
    resultado.classList.remove("d-none");
    botones.forEach((b) => (b.disabled = false));
    return;
  }

  try {
    const coords = await obtenerUbicacion();

    const data = await apiRequest("/asistencia/marcar", {
      method: "POST",
      body: {
        tipo,
        latitud: coords.latitude,
        longitud: coords.longitude,
        precisionM: coords.accuracy,
        dispositivoId: "web-" + (getEmpleado()?.id || "anon"),
        foto,
      },
    });

    resultado.textContent = data.mensaje;
    resultado.className = "alert mt-3 alert-success";
    resultado.classList.remove("d-none");
    cargarHistorial();
  } catch (err) {
    if (manejarSesionExpirada(err)) return;

    // El backend guarda igual el marcaje invalido (422) y devuelve el
    // registro + mensaje explicando el motivo (fuera de rango, etc).
    if (err.data?.registro) {
      resultado.textContent = err.data.mensaje;
      resultado.className = "alert mt-3 alert-danger";
      resultado.classList.remove("d-none");
      cargarHistorial();
    } else {
      resultado.textContent = err.data?.error || err.message || "No se pudo registrar el marcaje.";
      resultado.className = "alert mt-3 alert-danger";
      resultado.classList.remove("d-none");
    }
  } finally {
    botones.forEach((b) => (b.disabled = false));
  }
}

document.getElementById("btnEntrada").addEventListener("click", () => marcar("entrada"));
document.getElementById("btnSalida").addEventListener("click", () => marcar("salida"));

async function cargarHistorial() {
  const tbody = document.getElementById("tablaHistorial");
  const empleado = getEmpleado();
  if (!empleado) return;

  try {
    const registros = await apiRequest(`/asistencia/historial/${empleado.id}`);

    if (registros.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted py-3">Sin marcaciones todavia</td></tr>`;
      return;
    }

    tbody.innerHTML = registros
      .slice(0, 20)
      .map(
        (r) => `
      <tr>
        <td>${escapeHtml(r.timestamp_servidor)}</td>
        <td class="text-capitalize">${escapeHtml(r.tipo)}</td>
        <td>${
          r.valido
            ? '<span class="badge badge-valido">Valido</span>'
            : '<span class="badge badge-invalido">Invalido</span>'
        }</td>
      </tr>`
      )
      .join("");
  } catch (err) {
    if (manejarSesionExpirada(err)) return;
    tbody.innerHTML = `<tr><td colspan="3" class="text-center text-danger py-3">${escapeHtml(err.data?.error || err.message)}</td></tr>`;
  }
}

// Si ya hay una sesion guardada de una visita anterior, saltar directo al marcaje.
if (getToken() && getEmpleado()) {
  mostrarBloqueMarcaje();
}
