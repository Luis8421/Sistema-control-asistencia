renderNavbar("inicio");

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function formatHora(iso) {
  return iso ? iso.slice(11, 19) : "";
}

function hoyLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function cargarStats() {
  const hoy = hoyLocal();

  // Cada llamada solo pide limit=1 (o el listado por defecto de bodegas,
  // que ya viene sin paginar): lo que interesa es el campo `total` de la
  // respuesta paginada, no las filas en si, asi que el costo es una
  // consulta COUNT liviana en cada caso.
  const [empleados, geocercas, validas, invalidas] = await Promise.all([
    apiRequest("/empleados?activo=true&limit=1"),
    apiRequest("/bodegas"),
    apiRequest(`/marcaciones?fecha=${hoy}&valido=true&limit=1`),
    apiRequest(`/marcaciones?fecha=${hoy}&valido=false&limit=1`),
  ]);

  document.getElementById("statEmpleados").textContent = empleados.total;
  document.getElementById("statGeocercas").textContent = geocercas.length;
  document.getElementById("statValidas").textContent = validas.total;
  document.getElementById("statInvalidas").textContent = invalidas.total;
}

async function cargarEnTurno() {
  const tbody = document.getElementById("tablaEnTurno");
  try {
    const registros = await apiRequest("/asistencia/en-turno");

    if (registros.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted py-4">Nadie en turno en este momento</td></tr>`;
      return;
    }

    tbody.innerHTML = registros
      .map(
        (r) => `
      <tr>
        <td>${escapeHtml(r.nombre_completo)}</td>
        <td>${escapeHtml(r.bodega_nombre)}</td>
        <td>${formatHora(r.timestamp_servidor)}</td>
      </tr>`
      )
      .join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="3" class="text-center text-danger py-4">${escapeHtml(err.data?.error || err.message)}</td></tr>`;
  }
}

cargarStats().catch((err) => console.error("No se pudieron cargar las estadisticas", err));
cargarEnTurno();
