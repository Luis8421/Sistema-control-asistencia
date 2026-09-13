// Ver comentario en js/api.js: con Caddy sirviendo panel + proxy /api en
// el mismo origen, una ruta relativa funciona para cualquier empleado sin
// importar si entro por asistencia.local o por la IP.
const API_URL = location.protocol === "file:" ? "http://localhost:4000/api" : "/api";

// Modo diagnostico para pruebas de campo de GPS: SOLO se activa si la URL
// trae ?diag=1 explicitamente (ej. https://asistencia.local/marcaje.html?diag=1).
// Sin ese parametro, un empleado normal nunca ve nada distinto — el panel
// #panelDiagnostico permanece oculto y esta funcion no hace nada. Pensado
// para que quien prueba en campo (celular/laptop) vea las lecturas GPS en
// pantalla sin necesitar la consola del navegador.
const MODO_DIAGNOSTICO = new URLSearchParams(location.search).get("diag") === "1";
let lineasDiagnostico = [];
function diag(linea) {
  console.log(linea);
  if (!MODO_DIAGNOSTICO) return;
  lineasDiagnostico.push(linea);
  const el = document.getElementById("panelDiagnostico");
  if (el) {
    el.textContent = lineasDiagnostico.join("\n");
    el.classList.remove("d-none");
  }
}
function reiniciarDiagnostico() {
  lineasDiagnostico = [];
  const el = document.getElementById("panelDiagnostico");
  if (el) {
    el.textContent = "";
    el.classList.add("d-none");
  }
}

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

  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // fetch() lanza (no responde con un status) cuando no hay conexion al
    // servidor — un mensaje de navegador como "Failed to fetch" no le dice
    // nada util a un empleado de bodega.
    throw new Error("Ocurrió un error al conectar con el servidor. Verifica tu conexión e intenta de nuevo.");
  }

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

// Umbral y ventana de busqueda de GPS: reflejan MAX_GPS_PRECISION_M del
// backend (backend/.env) solo para decidir CUANDO DEJAR DE BUSCAR una mejor
// lectura y para poder mostrar el error de precision localmente sin gastar
// una llamada a la API — el backend SIEMPRE vuelve a validar la precision
// de forma autoritativa en cada POST /asistencia/marcar, sin importar lo
// que decida este chequeo local.
const PRECISION_ACEPTABLE_M = 50;
const VENTANA_BUSQUEDA_GPS_MS = 12000;

/**
 * Obtiene la mejor lectura de GPS posible dentro de una ventana de tiempo,
 * en vez de conformarse con la primera (que en interiores/bajo techo suele
 * ser la peor: la precision del GPS tipicamente mejora en los primeros
 * segundos mientras el dispositivo engancha mas satelites). Usa
 * watchPosition() y se queda con la lectura de menor `accuracy` vista hasta
 * el momento; corta la busqueda antes de tiempo apenas una lectura ya
 * cumple PRECISION_ACEPTABLE_M. Nunca usa una lectura en cache
 * (maximumAge: 0) y siempre limpia el watcher/temporizador al terminar
 * (exito, error o timeout), para no dejar procesos de GPS corriendo de
 * fondo. `busquedaGpsActiva` evita que dos busquedas corran en paralelo si
 * por algun motivo se llama de nuevo antes de que la anterior termine.
 */
let busquedaGpsActiva = false;
function obtenerUbicacion({ onLectura } = {}) {
  if (busquedaGpsActiva) {
    return Promise.reject(new Error("Ya hay una busqueda de ubicacion en curso."));
  }
  if (!navigator.geolocation) {
    return Promise.reject(new Error("Tu navegador no soporta geolocalizacion."));
  }
  busquedaGpsActiva = true;

  return new Promise((resolve, reject) => {
    const inicio = Date.now();
    let mejor = null;
    let watchId = null;
    let terminado = false;
    let contadorLecturas = 0;

    const limpiar = () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      clearTimeout(timeoutId);
      busquedaGpsActiva = false;
    };

    const terminarConMejorLectura = () => {
      if (terminado) return;
      terminado = true;
      limpiar();
      if (mejor) {
        diag(
          `[GPS] Busqueda terminada: mejor accuracy=${mejor.accuracy.toFixed(1)} m en ${Date.now() - inicio} ms ` +
            `(umbral: ${PRECISION_ACEPTABLE_M} m). lat=${mejor.latitude} lon=${mejor.longitude}`
        );
        resolve({ coords: mejor, tiempoBusquedaMs: Date.now() - inicio });
      } else {
        // Se agoto la ventana sin recibir NINGUNA lectura (no es un tema de
        // precision: el dispositivo nunca entrego coordenadas). Distinto
        // del caso "permiso denegado" (ese corta antes, ver abajo) y
        // distinto de "precision insuficiente" (ese SI llega a resolver
        // con una lectura, solo que mala — lo maneja marcar()).
        reject(new Error("No pudimos obtener tu ubicación. Verifica que el GPS/la ubicación estén activados e intenta de nuevo."));
      }
    };

    const timeoutId = setTimeout(terminarConMejorLectura, VENTANA_BUSQUEDA_GPS_MS);

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        const esMejora = !mejor || c.accuracy < mejor.accuracy;
        diag(
          `[GPS] Lectura #${++contadorLecturas}: accuracy=${c.accuracy.toFixed(1)} m lat=${c.latitude} lon=${c.longitude} ` +
            `t=${Date.now() - inicio} ms${esMejora ? " -> nueva mejor lectura" : ""}`
        );
        if (esMejora) {
          mejor = c;
          onLectura?.(c);
        }
        if (c.accuracy <= PRECISION_ACEPTABLE_M) {
          terminarConMejorLectura();
        }
      },
      (err) => {
        diag(`[GPS] Error de lectura: codigo=${err.code} mensaje=${err.message || "(sin mensaje)"}`);
        // Un solo error no aborta la busqueda si aun queda tiempo o ya hay
        // una lectura util — solo cortamos de inmediato si el permiso fue
        // denegado explicitamente, porque eso no se resuelve esperando.
        if (err.code === err.PERMISSION_DENIED) {
          terminado = true;
          limpiar();
          reject(new Error("No podemos acceder a tu ubicación. Activa el permiso de ubicación del navegador y vuelve a intentarlo."));
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: VENTANA_BUSQUEDA_GPS_MS }
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

    // video.videoWidth/videoHeight son la resolucion REAL negociada con la
    // camara (width/height en getUserMedia arriba son solo un "ideal", el
    // dispositivo puede devolver otra proporcion, ej. 16:9 en vez de 4:3).
    // Escalar el canvas a partir de esas dimensiones reales evita estirar
    // la imagen — antes el canvas era 640x480 fijo sin importar la
    // proporcion real, lo que deformaba la foto en camaras no 4:3.
    const escala = Math.min(1, 640 / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth * escala;
    canvas.height = video.videoHeight * escala;
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

  // El Portal de Marcaje es el mismo para todos los roles (nunca cambia el
  // flujo de marcaje en si), pero admin/supervisor tienen ademas un Panel
  // Administrativo separado (login.html en adelante) — se les muestra un
  // enlace de acceso, invisible para empleados normales.
  const esAdminOSupervisor = ["admin", "supervisor"].includes(empleado.rol);
  document.getElementById("linkPanelAdmin").classList.toggle("d-none", !esAdminOSupervisor);

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
  reiniciarDiagnostico();
  diag(`[Marcaje] Iniciando "${tipo}"...`);

  if (navigator.permissions?.query) {
    try {
      const estadoPermiso = await navigator.permissions.query({ name: "geolocation" });
      diag(`[Marcaje] Permiso de geolocalizacion: ${estadoPermiso.state}`);
    } catch (err) {
      diag(`[Marcaje] No se pudo consultar el permiso de geolocalizacion: ${err.message}`);
    }
  }

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
    resultado.innerHTML =
      "Obteniendo tu ubicación...<br><small>Buscando una señal GPS más precisa. Esto puede tardar unos segundos.</small>";
    resultado.className = "alert mt-3 alert-info";
    resultado.classList.remove("d-none");

    const { coords, tiempoBusquedaMs } = await obtenerUbicacion({
      onLectura: (c) => {
        resultado.innerHTML =
          "Obteniendo tu ubicación...<br><small>Precisión actual: " + Math.round(c.accuracy) + " m</small>";
      },
    });
    const empleado = getEmpleado();

    diag(
      `[Marcaje] Mejor lectura GPS: accuracy=${coords.accuracy.toFixed(1)} m lat=${coords.latitude} lon=${coords.longitude} ` +
        `tiempo=${tiempoBusquedaMs} ms hora=${new Date().toLocaleTimeString("es-EC")}`
    );

    // A. Precision insuficiente: ni buscando la mejor lectura posible
    // durante la ventana de tiempo se logro bajar del umbral. Se corta
    // aqui mismo sin gastar una llamada al backend que de todas formas la
    // rechazaria por el mismo motivo (el backend siempre revalida esto de
    // forma autoritativa). Mensaje distinto y explicito de "fuera de
    // geocerca" para no mezclar ambos motivos.
    if (coords.accuracy > PRECISION_ACEPTABLE_M) {
      diag(`[Marcaje] RECHAZADO localmente por precision: ${coords.accuracy.toFixed(1)} m > ${PRECISION_ACEPTABLE_M} m`);
      resultado.textContent =
        "No pudimos obtener una ubicación GPS suficientemente precisa. Permanece unos segundos en el lugar y vuelve a intentarlo. Si estás usando una laptop sin GPS dedicado, prueba desde tu celular.";
      resultado.className = "alert mt-3 alert-danger";
      resultado.classList.remove("d-none");
      botones.forEach((b) => (b.disabled = false));
      return;
    }

    resultado.textContent = "Ubicación obtenida. Validando marcación...";

    // B. Fuera de geocerca: chequeo local SOLO para empleados restringidos
    // a su bodega principal (autorizadoTodasBodegas=false); es UNICAMENTE
    // una optimizacion de experiencia para evitar un viaje redondo cuando
    // claramente esta fuera de rango — la decision definitiva SIEMPRE la
    // toma el backend (POST /asistencia/marcar -> utils/geo.js), que vuelve
    // a calcular todo desde cero sin confiar en nada de lo que decida este
    // chequeo local. Un autorizado a todas las bodegas puede estar cerca de
    // CUALQUIER geocerca del catalogo, no solo la de su bodega principal —
    // replicar esa logica en el cliente duplicaria al backend sin necesidad
    // real, asi que para esos se va directo a la API.
    if (!empleado?.autorizadoTodasBodegas) {
      const bodega = empleado?.bodega;
      if (bodega) {
        const distanciaM = calcularDistanciaMetros(coords.latitude, coords.longitude, bodega.latitud, bodega.longitud);
        diag(
          `[Marcaje] Distancia a "${bodega.nombre}": ${distanciaM.toFixed(1)} m (radio permitido: ${bodega.radioMetros} m) -> ` +
            (distanciaM <= bodega.radioMetros ? "DENTRO de la geocerca" : "FUERA de la geocerca")
        );
        if (distanciaM > bodega.radioMetros) {
          resultado.textContent = `Tu ubicación está fuera del área autorizada de esta bodega. Distancia aproximada: ${Math.round(distanciaM)} metros.`;
          resultado.className = "alert mt-3 alert-danger";
          resultado.classList.remove("d-none");
          botones.forEach((b) => (b.disabled = false));
          return;
        }
      } else {
        diag("[Marcaje] Empleado sin bodega asignada localmente; la decision queda 100% en manos del backend.");
      }
    } else {
      diag("[Marcaje] Empleado autorizado en todas las bodegas: sin chequeo local de distancia, va directo al backend.");
    }

    diag(`[Marcaje] Enviando POST /asistencia/marcar (tipo=${tipo})...`);
    await intentarMarcar({ tipo, coords, foto, resultado, botones });
    diag(`[Marcaje] Resultado final: ${resultado.textContent}`);
  } catch (err) {
    if (manejarSesionExpirada(err)) return;
    const mensaje = err.data?.error || err.message || "No se pudo registrar el marcaje.";
    diag(`[Marcaje] ERROR: ${mensaje}`);
    resultado.textContent = mensaje;
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
