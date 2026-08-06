function renderNavbar(activo) {
  const nav = document.getElementById("navbar");
  if (!nav) return;

  const link = (href, label, key) =>
    `<a class="nav-link ${activo === key ? "active fw-semibold" : ""}" href="${href}">${label}</a>`;

  nav.innerHTML = `
    <nav class="navbar navbar-expand-lg navbar-dark bg-dark px-3 mb-4">
      <span class="navbar-brand mb-0 h1">Panel de Asistencia</span>
      <div class="navbar-nav me-auto flex-row gap-3">
        ${link("marcaciones.html", "Marcaciones", "marcaciones")}
        ${link("empleados.html", "Empleados", "empleados")}
        ${link("geocercas.html", "Geocercas", "geocercas")}
      </div>
      <a class="nav-link text-info" href="marcaje.html" target="_blank" rel="noopener">Marcar asistencia (empleados) ↗</a>
    </nav>
  `;
}
