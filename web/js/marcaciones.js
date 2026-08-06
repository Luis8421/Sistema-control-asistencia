renderNavbar("marcaciones");

const estado = { page: 1, totalPaginas: 1 };

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function formatFecha(iso) {
  return iso ? iso.replace("T", " ").slice(0, 19) : "";
}

// foto_url viene relativa (/uploads/fotos/xxx.jpg); se sirve desde el
// backend, no desde donde esta el panel, asi que se arma con el origen
// de API_URL (definido en api.js) en vez de con la URL de esta pagina.
const BACKEND_ORIGIN = API_URL.replace(/\/api$/, "");

function celdaFoto(fotoUrl) {
  if (!fotoUrl) return '<span class="text-muted small">-</span>';
  const url = `${BACKEND_ORIGIN}${fotoUrl}`;
  return `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="Foto del marcaje" style="width:40px;height:40px;object-fit:cover;border-radius:6px;" /></a>`;
}

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

function construirQueryFiltros() {
  const params = new URLSearchParams();

  const fecha = document.getElementById("filtroFecha").value;
  const empleadoId = document.getElementById("filtroEmpleado").value;
  const tipo = document.getElementById("filtroTipo").value;

  if (fecha) params.set("fecha", fecha);
  if (empleadoId) params.set("empleadoId", empleadoId);
  if (tipo) params.set("tipo", tipo);

  return params;
}

function construirQuery() {
  const params = construirQueryFiltros();
  params.set("page", estado.page);
  params.set("limit", 20);
  return params.toString();
}

async function cargarMarcaciones() {
  const tbody = document.getElementById("tablaMarcaciones");
  tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">Cargando...</td></tr>`;

  try {
    const resp = await apiRequest(`/marcaciones?${construirQuery()}`);
    estado.totalPaginas = resp.totalPaginas;

    if (resp.data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">Sin resultados</td></tr>`;
    } else {
      tbody.innerHTML = resp.data
        .map(
          (r) => `
        <tr>
          <td>${formatFecha(r.timestamp_servidor)}</td>
          <td>${escapeHtml(r.nombre_completo)} <span class="text-muted small">(${escapeHtml(r.codigo_empleado)})</span></td>
          <td>${escapeHtml(r.bodega_nombre)}</td>
          <td class="text-capitalize">${escapeHtml(r.tipo)}</td>
          <td>${Math.round(r.distancia_a_bodega_m)} m</td>
          <td>
            ${
              r.valido
                ? '<span class="badge badge-valido">Valido</span>'
                : `<span class="badge badge-invalido" title="${escapeHtml(r.motivo_invalido)}">Invalido</span>`
            }
          </td>
          <td>${celdaFoto(r.foto_url)}</td>
        </tr>`
        )
        .join("");
    }

    document.getElementById("resumenPaginacion").textContent =
      `Pagina ${resp.page} de ${resp.totalPaginas} (${resp.total} registros)`;
    document.getElementById("btnAnterior").disabled = resp.page <= 1;
    document.getElementById("btnSiguiente").disabled = resp.page >= resp.totalPaginas;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">${escapeHtml(err.data?.error || err.message)}</td></tr>`;
  }
}

document.getElementById("formFiltros").addEventListener("submit", (e) => {
  e.preventDefault();
  estado.page = 1;
  cargarMarcaciones();
});

document.getElementById("btnLimpiar").addEventListener("click", () => {
  document.getElementById("filtroFecha").value = "";
  document.getElementById("filtroEmpleado").value = "";
  document.getElementById("filtroTipo").value = "";
  estado.page = 1;
  cargarMarcaciones();
});

document.getElementById("btnAnterior").addEventListener("click", () => {
  if (estado.page > 1) {
    estado.page -= 1;
    cargarMarcaciones();
  }
});

document.getElementById("btnSiguiente").addEventListener("click", () => {
  if (estado.page < estado.totalPaginas) {
    estado.page += 1;
    cargarMarcaciones();
  }
});

document.getElementById("btnExportarExcel").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = "Generando...";
  try {
    await descargarArchivo(`/marcaciones/exportar?${construirQueryFiltros().toString()}`);
  } catch (err) {
    alert(err.message || "No se pudo exportar el Excel.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Exportar a Excel";
  }
});

cargarEmpleadosEnFiltro();
cargarMarcaciones();
