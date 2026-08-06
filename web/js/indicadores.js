renderNavbar("indicadores");

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function primerDiaDelMes() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function hoyLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

document.getElementById("filtroDesde").value = primerDiaDelMes();
document.getElementById("filtroHasta").value = hoyLocal();

async function cargarEmpleadosEnFiltro() {
  const select = document.getElementById("filtroEmpleado");
  try {
    const resp = await apiRequest("/empleados?limit=100");
    for (const emp of resp.data) {
      const opt = document.createElement("option");
      opt.value = emp.id;
      opt.textContent = `${emp.nombre_completo} (${emp.codigo_empleado})`;
      select.appendChild(opt);
    }
  } catch (err) {
    console.error("No se pudo cargar el filtro de empleados", err);
  }
}

function badgeEstado(estado) {
  return estado === "atrasado"
    ? '<span class="badge badge-invalido">Atrasado</span>'
    : '<span class="badge badge-valido">A tiempo</span>';
}

async function calcularIndicadores() {
  const empleadoId = document.getElementById("filtroEmpleado").value;
  const tbody = document.getElementById("tablaDetalle");
  const resumen = document.getElementById("resumen");

  if (!empleadoId) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">Selecciona un empleado</td></tr>`;
    resumen.classList.add("d-none");
    return;
  }

  const desde = document.getElementById("filtroDesde").value;
  const hasta = document.getElementById("filtroHasta").value;
  const params = new URLSearchParams();
  if (desde) params.set("desde", desde);
  if (hasta) params.set("hasta", hasta);

  tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">Calculando...</td></tr>`;
  resumen.classList.add("d-none");

  try {
    const data = await apiRequest(`/indicadores/${empleadoId}?${params.toString()}`);

    document.getElementById("statTrabajados").textContent = data.diasTrabajados;
    document.getElementById("statAtrasos").textContent = data.diasConAtraso;
    document.getElementById("statAusencias").textContent = data.diasAusente;
    document.getElementById("statHoras").textContent = `${data.horasTrabajadas} h`;
    resumen.classList.remove("d-none");

    if (data.detallePorDia.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">Sin marcaciones validas en el rango</td></tr>`;
    } else {
      tbody.innerHTML = data.detallePorDia
        .slice()
        .reverse()
        .map(
          (d) => `
        <tr>
          <td>${escapeHtml(d.fecha)}</td>
          <td>${escapeHtml(d.horaEntrada)}</td>
          <td>${d.horaSalida ? escapeHtml(d.horaSalida) : '<span class="text-muted small">Sin salida</span>'}</td>
          <td>${d.minutosAtraso > 0 ? `${d.minutosAtraso} min` : "-"}</td>
          <td>${d.horasTrabajadas !== null ? d.horasTrabajadas.toFixed(2) + " h" : "-"}</td>
          <td>${badgeEstado(d.estado)}</td>
        </tr>`
        )
        .join("");
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">${escapeHtml(err.data?.error || err.message)}</td></tr>`;
  }
}

document.getElementById("formFiltros").addEventListener("submit", (e) => {
  e.preventDefault();
  calcularIndicadores();
});

cargarEmpleadosEnFiltro();
