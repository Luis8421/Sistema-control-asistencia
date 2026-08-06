renderNavbar("geocercas");

const modalEl = document.getElementById("modalGeocerca");
const modal = new bootstrap.Modal(modalEl);

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

async function cargarGeocercas() {
  const tbody = document.getElementById("tablaGeocercas");
  tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">Cargando...</td></tr>`;

  try {
    const bodegas = await apiRequest("/bodegas?incluirInactivas=true");

    if (bodegas.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">Sin geocercas registradas</td></tr>`;
    } else {
      tbody.innerHTML = bodegas
        .map(
          (b) => `
        <tr>
          <td>${escapeHtml(b.nombre)}</td>
          <td>${escapeHtml(b.direccion || "-")}</td>
          <td>${b.latitud}</td>
          <td>${b.longitud}</td>
          <td>${b.radio_metros}</td>
          <td>${b.activo ? '<span class="badge bg-success">Activa</span>' : '<span class="badge bg-secondary">Inactiva</span>'}</td>
          <td class="text-end">
            <button class="btn btn-outline-primary btn-sm btn-editar" data-id="${b.id}">Editar</button>
            <button class="btn btn-outline-danger btn-sm btn-eliminar" data-id="${b.id}" data-nombre="${escapeHtml(b.nombre)}">Eliminar</button>
          </td>
        </tr>`
        )
        .join("");
    }

    document.querySelectorAll(".btn-editar").forEach((btn) =>
      btn.addEventListener("click", () => abrirModalEditar(btn.dataset.id, bodegas))
    );
    document.querySelectorAll(".btn-eliminar").forEach((btn) =>
      btn.addEventListener("click", () => eliminarGeocerca(btn.dataset.id, btn.dataset.nombre))
    );
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">${escapeHtml(err.data?.error || err.message)}</td></tr>`;
  }
}

function limpiarFormulario() {
  document.getElementById("formGeocerca").reset();
  document.getElementById("geocercaId").value = "";
  document.getElementById("activo").checked = true;
  document.getElementById("errorGeocerca").classList.add("d-none");
}

function abrirModalNueva() {
  limpiarFormulario();
  document.getElementById("tituloModalGeocerca").textContent = "Nueva geocerca";
  modal.show();
}

function abrirModalEditar(id, listaActual) {
  limpiarFormulario();
  const b = listaActual.find((x) => x.id === id);
  if (!b) return;

  document.getElementById("tituloModalGeocerca").textContent = "Editar geocerca";
  document.getElementById("geocercaId").value = b.id;
  document.getElementById("nombre").value = b.nombre;
  document.getElementById("direccion").value = b.direccion || "";
  document.getElementById("latitud").value = b.latitud;
  document.getElementById("longitud").value = b.longitud;
  document.getElementById("radioMetros").value = b.radio_metros;
  document.getElementById("activo").checked = !!b.activo;

  modal.show();
}

async function eliminarGeocerca(id, nombre) {
  if (!confirm(`Eliminar la geocerca "${nombre}"? Esto solo es posible si no tiene empleados ni marcaciones asociadas.`)) return;
  try {
    await apiRequest(`/bodegas/${id}`, { method: "DELETE" });
    cargarGeocercas();
  } catch (err) {
    alert(err.data?.error || "No se pudo eliminar la geocerca.");
  }
}

document.getElementById("btnNueva").addEventListener("click", abrirModalNueva);

document.getElementById("formGeocerca").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorBox = document.getElementById("errorGeocerca");
  errorBox.classList.add("d-none");

  const id = document.getElementById("geocercaId").value;

  const payload = {
    nombre: document.getElementById("nombre").value.trim(),
    direccion: document.getElementById("direccion").value.trim() || null,
    latitud: Number(document.getElementById("latitud").value),
    longitud: Number(document.getElementById("longitud").value),
    radioMetros: Number(document.getElementById("radioMetros").value),
  };

  if (id) {
    payload.activo = document.getElementById("activo").checked;
  }

  try {
    if (id) {
      await apiRequest(`/bodegas/${id}`, { method: "PUT", body: payload });
    } else {
      await apiRequest("/bodegas", { method: "POST", body: payload });
    }
    modal.hide();
    cargarGeocercas();
  } catch (err) {
    errorBox.textContent = err.data?.error || "No se pudo guardar la geocerca.";
    errorBox.classList.remove("d-none");
  }
});

cargarGeocercas();
