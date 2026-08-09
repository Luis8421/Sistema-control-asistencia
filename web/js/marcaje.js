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

// Formula de Haversine, identica a backend/src/utils/geo.js y
// mobile/utils/geo.js. Se usa para un chequeo LOCAL de distancia antes de
// llamar a /asistencia/marcar (evita un viaje redondo cuando el empleado
// claramente esta fuera de rango). El backend siempre vuelve a calcular
// esto de forma autoritativa — nunca se confia unicamente en este chequeo.
function calcularDistanciaMetros(lat1, lon1, lat2, lon2) {
  const RADIO_TIERRA_M = 6371000;
  const rad = (grados) => (grados * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return RADIO_TIERRA_M * c;
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

  const empleado = getEmpleado();
  document.getElementById("nombreEmpleado").textContent = empleado.nombreCompleto;
  document.getElementById("cargoEmpleado").textContent = empleado.cargo || "";

  // autorizadoTodasBodegas es un campo del login, independiente de
  // "bodega" (singular, que sigue siendo la bodega principal para
  // compatibilidad). Para la enorme mayoria de empleados es false — para
  // esos se muestra su sucursal; los autorizados globalmente ven una
  // etiqueta acorde (su "bodega" principal ya no restringe donde marcan).
  let textoBodega = "";
  if (empleado.autorizadoTodasBodegas) {
    textoBodega = "Autorizado en cualquier bodega activa";
  } else if (empleado.bodega?.nombre) {
    textoBodega = `Sucursal: ${empleado.bodega.nombre}`;
  }
  document.getElementById("bodegaEmpleado").textContent = textoBodega;

  iniciarReloj();
  cargarHistorial();
}

// Fecha/hora en vivo, visible mientras el empleado tiene la pantalla
// abierta para decidir si marca entrada o salida.
let intervaloReloj = null;
function iniciarReloj() {
  const el = document.getElementById("fechaHoraActual");
  const pintar = () => {
    el.textContent = new Date().toLocaleString("es-EC", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
  };
  pintar();
  clearInterval(intervaloReloj);
  intervaloReloj = setInterval(pintar, 30000);
}

function fechaHoyLocal() {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
}

// "En turno" / "fuera de turno" segun el ultimo marcaje VALIDO de hoy —
// mismo criterio que GET /api/asistencia/en-turno (reservado a
// supervisor/admin), pero calculado aqui con el historial que el
// empleado ya tiene permiso de ver (el suyo propio), sin pedir nada
// nuevo al backend.
function pintarEstadoTurno(registrosHoy) {
  const el = document.getElementById("estadoTurno");
  const validosHoy = registrosHoy.filter((r) => r.valido);
  const ultimo = validosHoy[0]; // ya vienen ordenados DESC por el backend

  if (!ultimo) {
    el.innerHTML = '<span class="badge bg-secondary">Sin marcar hoy</span>';
  } else if (ultimo.tipo === "entrada") {
    el.innerHTML = `<span class="badge badge-valido">En turno desde ${ultimo.timestamp_servidor.slice(11, 16)}</span>`;
  } else {
    el.innerHTML = `<span class="badge bg-secondary">Turno finalizado (${ultimo.timestamp_servidor.slice(11, 16)})</span>`;
  }
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
    const empleado = getEmpleado();

    // Chequeo local SOLO para empleados restringidos a su bodega principal
    // (autorizadoTodasBodegas=false): evita un viaje redondo cuando
    // claramente estan fuera de rango. Un autorizado a todas las bodegas
    // puede estar cerca de CUALQUIER geocerca del catalogo, no solo la de
    // su bodega principal — replicar esa logica en el cliente duplicaria
    // al backend sin necesidad real, asi que para esos se va directo a la
    // API, que de todas formas es la unica fuente de verdad.
    if (!empleado?.autorizadoTodasBodegas) {
      const bodega = empleado?.bodega;
      if (bodega) {
        const distanciaM = calcularDistanciaMetros(coords.latitude, coords.longitude, bodega.latitud, bodega.longitud);
        if (distanciaM > bodega.radioMetros) {
          resultado.textContent = "No se encuentra dentro del área autorizada para registrar asistencia.";
          resultado.className = "alert mt-3 alert-danger";
          resultado.classList.remove("d-none");
          botones.forEach((b) => (b.disabled = false));
          return;
        }
      }
    }

    await intentarMarcar({ tipo, coords, foto, resultado, botones });
  } catch (err) {
    if (manejarSesionExpirada(err)) return;
    resultado.textContent = err.data?.error || err.message || "No se pudo registrar el marcaje.";
    resultado.className = "alert mt-3 alert-danger";
    resultado.classList.remove("d-none");
    botones.forEach((b) => (b.disabled = false));
  }
}

/**
 * Llama a POST /asistencia/marcar. Se usa tanto para el primer intento
 * (sin bodegaId) como para el reintento tras elegir una bodega en el
 * selector (con bodegaId) — misma foto/coords capturadas una sola vez,
 * nunca se le vuelve a pedir camara/GPS al empleado por esto.
 */
async function intentarMarcar({ tipo, coords, foto, resultado, botones, bodegaId }) {
  try {
    const data = await apiRequest("/asistencia/marcar", {
      method: "POST",
      body: {
        tipo,
        latitud: coords.latitude,
        longitud: coords.longitude,
        precisionM: coords.accuracy,
        dispositivoId: "web-" + (getEmpleado()?.id || "anon"),
        foto,
        ...(bodegaId ? { bodegaId } : {}),
      },
    });

    resultado.textContent = data.mensaje;
    resultado.className = "alert mt-3 alert-success";
    resultado.classList.remove("d-none");
    botones.forEach((b) => (b.disabled = false));
    cargarHistorial();
  } catch (err) {
    // El GPS coincide con mas de una bodega autorizada a la vez (ej.
    // BOCQ/BDCQ, que comparten predio): el backend nunca elige por
    // desempate automatico, pide seleccion explicita. Los botones quedan
    // deshabilitados hasta que el empleado elija o cancele.
    if (err.status === 409 && err.data?.motivo === "seleccion_bodega_requerida") {
      mostrarSelectorBodega(err.data.opciones, { tipo, coords, foto, resultado, botones });
      return;
    }
    throw err; // el resto de errores (422, sesion expirada) los maneja marcar()
  }
}

function mostrarSelectorBodega(opciones, contexto) {
  const contenedor = document.getElementById("opcionesBodega");
  contenedor.innerHTML = opciones
    .map(
      (o) =>
        `<button type="button" class="btn btn-outline-primary btn-seleccionar-bodega" data-id="${escapeHtml(o.id)}">${escapeHtml(o.codigo)} — ${escapeHtml(o.nombre)}</button>`
    )
    .join("");

  const modalEl = document.getElementById("modalSeleccionBodega");
  const modal = new bootstrap.Modal(modalEl);

  contenedor.querySelectorAll(".btn-seleccionar-bodega").forEach((btn) => {
    btn.addEventListener(
      "click",
      async () => {
        modal.hide();
        contexto.resultado.textContent = "Registrando...";
        contexto.resultado.className = "alert mt-3 alert-info";
        contexto.resultado.classList.remove("d-none");
        try {
          await intentarMarcar({ ...contexto, bodegaId: btn.dataset.id });
        } catch (err) {
          if (manejarSesionExpirada(err)) return;
          contexto.resultado.textContent = err.data?.error || err.message || "No se pudo registrar el marcaje.";
          contexto.resultado.className = "alert mt-3 alert-danger";
          contexto.resultado.classList.remove("d-none");
          contexto.botones.forEach((b) => (b.disabled = false));
        }
      },
      { once: true }
    );
  });

  document.getElementById("btnCancelarSeleccionBodega").addEventListener(
    "click",
    () => {
      contexto.botones.forEach((b) => (b.disabled = false));
      contexto.resultado.classList.add("d-none");
    },
    { once: true }
  );

  modal.show();
}

document.getElementById("btnEntrada").addEventListener("click", () => marcar("entrada"));
document.getElementById("btnSalida").addEventListener("click", () => marcar("salida"));

async function cargarHistorial() {
  const tbody = document.getElementById("tablaHistorial");
  const empleado = getEmpleado();
  if (!empleado) return;

  try {
    // Solo el historial de hoy: mas liviano que traer toda la carrera del
    // empleado en cada carga de la pantalla, y es lo unico que el portal
    // necesita mostrar (estado del turno + historial del dia).
    const registrosHoy = await apiRequest(`/asistencia/historial/${empleado.id}?fecha=${fechaHoyLocal()}`);

    pintarEstadoTurno(registrosHoy);

    if (registrosHoy.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-3">Sin marcaciones hoy todavia</td></tr>`;
      return;
    }

    tbody.innerHTML = registrosHoy
      .map(
        (r) => `
      <tr>
        <td>${escapeHtml(r.timestamp_servidor.slice(11, 19))}</td>
        <td class="text-capitalize">${escapeHtml(r.tipo)}</td>
        <td>${escapeHtml(r.bodega_nombre || "-")}</td>
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
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-danger py-3">${escapeHtml(err.data?.error || err.message)}</td></tr>`;
  }
}

// Si ya hay una sesion guardada de una visita anterior, saltar directo al marcaje.
if (getToken() && getEmpleado()) {
  mostrarBloqueMarcaje();
}

// PWA: registra el service worker para que el portal sea instalable
// ("Agregar a pantalla de inicio") y cargue rapido en visitas siguientes.
// No cachea la API ni marca asistencia offline — eso siempre va en vivo
// contra el backend (unica fuente de verdad de la geovalidacion).
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.error("No se pudo registrar el service worker:", err);
    });
  });
}
