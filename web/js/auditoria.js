renderNavbar("auditoria");

const estado = { page: 1, totalPaginas: 1 };

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function formatFecha(iso) {
  return iso ? iso.replace("T", " ").slice(0, 19) : "";
}

function formatDetalle(detalleJson) {
  if (!detalleJson) return "-";
  try {
    const obj = JSON.parse(detalleJson);
    return escapeHtml(
      Object.entries(obj)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
        .join(" · ")
    );
  } catch {
    return "-";
  }
}

function construirQuery() {
  const params = new URLSearchParams();
  params.set("page", estado.page);
  params.set("limit", 20);

  const fecha = document.getElementById("filtroFecha").value;
  const entidad = document.getElementById("filtroEntidad").value;

  if (fecha) params.set("fecha", fecha);
  if (entidad) params.set("entidad", entidad);

  return params.toString();
}

async function cargarAuditoria() {
  const tbody = document.getElementById("tablaAuditoria");
  tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">Cargando...</td></tr>`;

  try {
    const resp = await apiRequest(`/auditoria?${construirQuery()}`);
    estado.totalPaginas = resp.totalPaginas;

    if (resp.data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">Sin registros</td></tr>`;
    } else {
      tbody.innerHTML = resp.data
        .map(
          (a) => `
        <tr>
          <td>${formatFecha(a.creado_en)}</td>
          <td>${escapeHtml(a.usuario_email)}</td>
          <td class="text-capitalize">${escapeHtml(a.accion)}</td>
          <td class="text-capitalize">${escapeHtml(a.entidad)}</td>
          <td class="small text-muted">${formatDetalle(a.detalle)}</td>
        </tr>`
        )
        .join("");
    }

    document.getElementById("resumenPaginacion").textContent =
      `Pagina ${resp.page} de ${resp.totalPaginas} (${resp.total} registros)`;
    document.getElementById("btnAnterior").disabled = resp.page <= 1;
    document.getElementById("btnSiguiente").disabled = resp.page >= resp.totalPaginas;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger py-4">${escapeHtml(err.data?.error || err.message)}</td></tr>`;
  }
}

document.getElementById("formFiltros").addEventListener("submit", (e) => {
  e.preventDefault();
  estado.page = 1;
  cargarAuditoria();
});

document.getElementById("btnLimpiar").addEventListener("click", () => {
  document.getElementById("filtroFecha").value = "";
  document.getElementById("filtroEntidad").value = "";
  estado.page = 1;
  cargarAuditoria();
});

document.getElementById("btnAnterior").addEventListener("click", () => {
  if (estado.page > 1) {
    estado.page -= 1;
    cargarAuditoria();
  }
});

document.getElementById("btnSiguiente").addEventListener("click", () => {
  if (estado.page < estado.totalPaginas) {
    estado.page += 1;
    cargarAuditoria();
  }
});

// El backend restringe /api/auditoria a rol admin (mas estricto que el
// resto del panel). Se comprueba aqui tambien ANTES de llamar a la API:
// si no se filtrara aca, un supervisor recibiria un 403 que apiRequest
// interpreta como "sesion invalida" y lo mandaria a login.html sin razon.
const usuario = getUsuario();
if (usuario?.rol === "admin") {
  cargarAuditoria();
} else {
  document.getElementById("soloAdmin").classList.add("d-none");
  document.getElementById("sinPermiso").classList.remove("d-none");
}
