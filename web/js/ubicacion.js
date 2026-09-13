// Modal reutilizable de detalle de ubicacion de una marcacion. Lo usan
// marcaciones.js (listado general) y dashboard.js (en turno) — un solo
// lugar, sin duplicar el markup del modal en cada HTML ni la logica de
// armar el link del mapa.
//
// No depende de ningun endpoint nuevo: recibe el registro tal cual ya
// viene de /api/marcaciones o /api/asistencia/en-turno (ambos hacen
// `SELECT r.*, ...`, asi que latitud/longitud/precision_gps_m/etc. ya
// estan en cada fila, aunque las tablas no las muestren directamente).
// Requiere que la pagina que lo usa cargue bootstrap.bundle.min.js
// (para bootstrap.Modal) y este script, en ese orden.
(function () {
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }

  function asegurarModal() {
    if (document.getElementById("modalUbicacionMarcaje")) return;
    const contenedor = document.createElement("div");
    contenedor.innerHTML = `
      <div class="modal fade" id="modalUbicacionMarcaje" tabindex="-1">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Ubicacion de la marcacion</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              <dl class="row small mb-0" id="detalleUbicacionMarcaje"></dl>
            </div>
            <div class="modal-footer">
              <a href="#" target="_blank" rel="noopener" class="btn btn-primary btn-sm" id="btnVerUbicacionEnMapa">Ver en mapa</a>
              <button type="button" class="btn btn-outline-secondary btn-sm" data-bs-dismiss="modal">Cerrar</button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(contenedor.firstElementChild);
  }

  function fila(etiqueta, valorHtml) {
    return `<dt class="col-5">${escapeHtml(etiqueta)}</dt><dd class="col-7">${valorHtml}</dd>`;
  }

  function formatFechaHora(iso) {
    return iso ? iso.replace("T", " ").slice(0, 19) : "-";
  }

  /**
   * @param {object} r - registro tal cual lo devuelve la API (necesita al
   *   menos: nombre_completo, timestamp_servidor, tipo, bodega_nombre,
   *   latitud, longitud, precision_gps_m, distancia_a_bodega_m, valido,
   *   motivo_invalido, dispositivo_id).
   */
  window.mostrarUbicacionMarcaje = function (r) {
    asegurarModal();

    const filas = [
      fila("Empleado", escapeHtml(r.nombre_completo || "-")),
      fila("Fecha y hora", escapeHtml(formatFechaHora(r.timestamp_servidor))),
      fila("Tipo", `<span class="text-capitalize">${escapeHtml(r.tipo || "-")}</span>`),
      fila("Bodega", escapeHtml(r.bodega_nombre || "-")),
      fila("Latitud", escapeHtml(String(r.latitud))),
      fila("Longitud", escapeHtml(String(r.longitud))),
      fila("Precision GPS", r.precision_gps_m != null ? `${Math.round(r.precision_gps_m)} m` : "-"),
      fila("Distancia a la bodega", r.distancia_a_bodega_m != null ? `${Math.round(r.distancia_a_bodega_m)} m` : "-"),
      fila(
        "Estado",
        r.valido
          ? '<span class="badge badge-valido">Valido</span>'
          : '<span class="badge badge-invalido">Invalido</span>'
      ),
    ];
    if (!r.valido && r.motivo_invalido) {
      filas.push(fila("Motivo", escapeHtml(r.motivo_invalido)));
    }
    filas.push(fila("Dispositivo", escapeHtml(r.dispositivo_id || "-")));

    document.getElementById("detalleUbicacionMarcaje").innerHTML = filas.join("");

    const lat = Number(r.latitud);
    const lon = Number(r.longitud);
    const btnMapa = document.getElementById("btnVerUbicacionEnMapa");
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      btnMapa.href = `https://www.google.com/maps?q=${lat},${lon}`;
      btnMapa.classList.remove("disabled");
    } else {
      btnMapa.href = "#";
      btnMapa.classList.add("disabled");
    }

    new bootstrap.Modal(document.getElementById("modalUbicacionMarcaje")).show();
  };
})();
