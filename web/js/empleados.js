renderNavbar("empleados");

const estado = { page: 1, totalPaginas: 1, busqueda: "" };
let bodegasCache = [];

const modalEl = document.getElementById("modalEmpleado");
const modal = new bootstrap.Modal(modalEl);

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

async function cargarBodegasEnSelect() {
  const select = document.getElementById("bodegaId");
  const resp = await apiRequest("/bodegas");
  bodegasCache = resp;
  select.innerHTML = resp.map((b) => `<option value="${b.id}">${escapeHtml(b.nombre)}</option>`).join("");
}

function nombreBodega(id) {
  const b = bodegasCache.find((x) => x.id === id);
  return b ? b.nombre : "-";
}

function construirQuery() {
  const params = new URLSearchParams();
  params.set("page", estado.page);
  params.set("limit", 20);
  if (estado.busqueda) params.set("busqueda", estado.busqueda);
  return params.toString();
}

async function cargarEmpleados() {
  const tbody = document.getElementById("tablaEmpleados");
  tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">Cargando...</td></tr>`;

  try {
    const resp = await apiRequest(`/empleados?${construirQuery()}`);
    estado.totalPaginas = resp.totalPaginas;

    if (resp.data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">Sin resultados</td></tr>`;
    } else {
      tbody.innerHTML = resp.data
        .map(
          (emp) => `
        <tr>
          <td>${escapeHtml(emp.codigo_empleado)}</td>
          <td>${escapeHtml(emp.nombre_completo)}</td>
          <td>${escapeHtml(emp.email || "-")}</td>
          <td>${escapeHtml(emp.cargo || "-")}</td>
          <td>${escapeHtml(nombreBodega(emp.bodega_id))}</td>
          <td>${emp.activo ? '<span class="badge bg-success">Activo</span>' : '<span class="badge bg-secondary">Inactivo</span>'}</td>
          <td class="text-end">
            <button class="btn btn-outline-primary btn-sm btn-editar" data-id="${emp.id}">Editar</button>
            <button class="btn btn-outline-danger btn-sm btn-eliminar" data-id="${emp.id}" data-nombre="${escapeHtml(emp.nombre_completo)}">Desactivar</button>
          </td>
        </tr>`
        )
        .join("");
    }

    document.getElementById("resumenPaginacion").textContent =
      `Pagina ${resp.page} de ${resp.totalPaginas} (${resp.total} empleados)`;
    document.getElementById("btnAnterior").disabled = resp.page <= 1;
    document.getElementById("btnSiguiente").disabled = resp.page >= resp.totalPaginas;

    document.querySelectorAll(".btn-editar").forEach((btn) =>
      btn.addEventListener("click", () => abrirModalEditar(btn.dataset.id, resp.data))
    );
    document.querySelectorAll(".btn-eliminar").forEach((btn) =>
      btn.addEventListener("click", () => eliminarEmpleado(btn.dataset.id, btn.dataset.nombre))
    );
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">${escapeHtml(err.data?.error || err.message)}</td></tr>`;
  }
}

function leerDiasLaborables() {
  return [1, 2, 3, 4, 5, 6, 7].filter((d) => document.getElementById(`dia${d}`).checked);
}

function pintarDiasLaborables(diasCsv) {
  const dias = new Set((diasCsv || "1,2,3,4,5").split(",").map(Number));
  for (let d = 1; d <= 7; d++) {
    document.getElementById(`dia${d}`).checked = dias.has(d);
  }
}

function limpiarFormulario() {
  document.getElementById("formEmpleado").reset();
  document.getElementById("empleadoId").value = "";
  document.getElementById("codigoEmpleado").disabled = false;
  document.getElementById("passwordEmpleado").required = true;
  document.getElementById("ayudaPasswordEmpleado").textContent =
    "El administrador asigna el PIN que el empleado usara para iniciar sesion.";
  document.getElementById("grupoActivo").classList.add("d-none");
  document.getElementById("errorEmpleado").classList.add("d-none");
  // No tiene sentido en "Nuevo empleado": el endpoint dedicado necesita un
  // id existente. Nace en 0/false para todo empleado nuevo de todas formas.
  document.getElementById("grupoAutorizacionGlobal").classList.add("d-none");
  document.getElementById("estadoAutorizacionGlobal").classList.add("d-none");
}

function abrirModalNuevo() {
  limpiarFormulario();
  document.getElementById("tituloModalEmpleado").textContent = "Nuevo empleado";
  modal.show();
}

function abrirModalEditar(id, listaActual) {
  limpiarFormulario();
  const emp = listaActual.find((e) => e.id === id);
  if (!emp) return;

  document.getElementById("tituloModalEmpleado").textContent = "Editar empleado";
  document.getElementById("empleadoId").value = emp.id;
  document.getElementById("nombreCompleto").value = emp.nombre_completo;
  document.getElementById("codigoEmpleado").value = emp.codigo_empleado;
  document.getElementById("email").value = emp.email || "";
  document.getElementById("passwordEmpleado").required = false;
  document.getElementById("ayudaPasswordEmpleado").textContent =
    "Deja este campo vacio para conservar el PIN actual. Si lo completas, lo restableceras.";
  document.getElementById("cargo").value = emp.cargo || "";
  document.getElementById("bodegaId").value = emp.bodega_id;
  pintarDiasLaborables(emp.dias_laborables);
  document.getElementById("activo").checked = !!emp.activo;
  document.getElementById("grupoActivo").classList.remove("d-none");

  document.getElementById("grupoAutorizacionGlobal").classList.remove("d-none");
  document.getElementById("estadoAutorizacionGlobal").classList.add("d-none");
  document.getElementById("autorizadoSi").checked = !!emp.autorizado_todas_bodegas;
  document.getElementById("autorizadoNo").checked = !emp.autorizado_todas_bodegas;

  modal.show();
}

// Independiente del submit general del formulario: PUT /:id no maneja este
// campo (a proposito, ver backend). Un solo listener fijo (no se re-crea
// en cada abrirModalEditar) para no acumular handlers duplicados.
document.querySelectorAll('input[name="autorizadoTodasBodegas"]').forEach((radio) => {
  radio.addEventListener("change", async () => {
    const id = document.getElementById("empleadoId").value;
    if (!id) return; // por seguridad; el grupo esta oculto en "Nuevo empleado"

    const estadoTexto = document.getElementById("estadoAutorizacionGlobal");
    const autorizadoTodasBodegas = document.getElementById("autorizadoSi").checked;

    estadoTexto.className = "small mt-1 text-muted";
    estadoTexto.textContent = "Guardando...";
    estadoTexto.classList.remove("d-none");

    try {
      await apiRequest(`/empleados/${id}/autorizacion-bodegas`, {
        method: "PUT",
        body: { autorizadoTodasBodegas },
      });
      estadoTexto.className = "small mt-1 text-success";
      estadoTexto.textContent = "Guardado.";
    } catch (err) {
      // Revierte la seleccion visual al valor real si el backend rechazo el
      // cambio (ej. sin permisos) — nunca se confia en lo que el usuario
      // alcanzo a marcar en el radio si el guardado no se confirmo.
      document.getElementById("autorizadoSi").checked = !autorizadoTodasBodegas;
      document.getElementById("autorizadoNo").checked = autorizadoTodasBodegas;
      estadoTexto.className = "small mt-1 text-danger";
      estadoTexto.textContent = err.data?.error || "No se pudo guardar.";
    }
  });
});

async function eliminarEmpleado(id, nombre) {
  if (!confirm(`Desactivar a ${nombre}? Podra reactivarse editandolo despues.`)) return;
  try {
    await apiRequest(`/empleados/${id}`, { method: "DELETE" });
    cargarEmpleados();
  } catch (err) {
    alert(err.data?.error || "No se pudo desactivar al empleado.");
  }
}

document.getElementById("btnNuevo").addEventListener("click", abrirModalNuevo);

document.getElementById("formEmpleado").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorBox = document.getElementById("errorEmpleado");
  errorBox.classList.add("d-none");

  const id = document.getElementById("empleadoId").value;

  const diasLaborables = leerDiasLaborables();
  if (diasLaborables.length === 0) {
    errorBox.textContent = "Selecciona al menos un dia laborable.";
    errorBox.classList.remove("d-none");
    return;
  }

  const payload = {
    nombreCompleto: document.getElementById("nombreCompleto").value.trim(),
    codigoEmpleado: document.getElementById("codigoEmpleado").value.trim(),
    // Vacio -> null explicito (no ""), para no chocar con el indice UNICO
    // de email si otro empleado tambien lo deja en blanco.
    email: document.getElementById("email").value.trim() || null,
    cargo: document.getElementById("cargo").value.trim() || null,
    bodegaId: document.getElementById("bodegaId").value,
    diasLaborables,
  };
  const password = document.getElementById("passwordEmpleado").value;
  if (password) payload.password = password;

  if (id) {
    payload.activo = document.getElementById("activo").checked;
  }

  try {
    if (id) {
      await apiRequest(`/empleados/${id}`, { method: "PUT", body: payload });
    } else {
      await apiRequest("/empleados", { method: "POST", body: payload });
    }
    modal.hide();
    cargarEmpleados();
  } catch (err) {
    errorBox.textContent = err.data?.error || "No se pudo guardar el empleado.";
    errorBox.classList.remove("d-none");
  }
});

document.getElementById("formBusqueda").addEventListener("submit", (e) => {
  e.preventDefault();
  estado.busqueda = document.getElementById("busqueda").value.trim();
  estado.page = 1;
  cargarEmpleados();
});

document.getElementById("btnLimpiarBusqueda").addEventListener("click", () => {
  document.getElementById("busqueda").value = "";
  estado.busqueda = "";
  estado.page = 1;
  cargarEmpleados();
});

document.getElementById("btnAnterior").addEventListener("click", () => {
  if (estado.page > 1) {
    estado.page -= 1;
    cargarEmpleados();
  }
});

document.getElementById("btnSiguiente").addEventListener("click", () => {
  if (estado.page < estado.totalPaginas) {
    estado.page += 1;
    cargarEmpleados();
  }
});

(async function init() {
  try {
    await cargarBodegasEnSelect();
  } catch (err) {
    console.error("No se pudieron cargar las geocercas para el formulario", err);
  }
  cargarEmpleados();
})();
