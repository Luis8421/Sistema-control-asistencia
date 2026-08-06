function escapeHtmlNav(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function renderNavbar(activo) {
  const nav = document.getElementById("navbar");
  if (!nav) return;

  const link = (href, label, key) =>
    `<a class="nav-link ${activo === key ? "active fw-semibold" : ""}" href="${href}">${label}</a>`;

  const usuario = typeof getUsuario === "function" ? getUsuario() : null;
  const infoUsuario = usuario
    ? `<span class="navbar-text text-light small me-3">${escapeHtmlNav(usuario.nombreCompleto)} <span class="text-muted">(${escapeHtmlNav(usuario.rol)})</span></span>
       <button class="btn btn-outline-light btn-sm" id="btnLogoutPanel" type="button">Cerrar sesion</button>`
    : "";

  nav.innerHTML = `
    <nav class="navbar navbar-expand-lg navbar-dark bg-dark px-3 mb-4">
      <span class="navbar-brand mb-0 h1">Panel de Asistencia</span>
      <div class="navbar-nav me-auto flex-row gap-3">
        ${link("marcaciones.html", "Marcaciones", "marcaciones")}
        ${link("indicadores.html", "Indicadores", "indicadores")}
        ${link("empleados.html", "Empleados", "empleados")}
        ${link("geocercas.html", "Geocercas", "geocercas")}
        ${usuario?.rol === "admin" ? link("auditoria.html", "Auditoria", "auditoria") : ""}
      </div>
      <a class="nav-link text-info me-3" href="marcaje.html" target="_blank" rel="noopener">Marcar asistencia (empleados) ↗</a>
      ${infoUsuario}
    </nav>
  `;

  const btnLogout = document.getElementById("btnLogoutPanel");
  if (btnLogout) {
    btnLogout.addEventListener("click", () => {
      clearSesion();
      location.href = "login.html";
    });
  }
}
