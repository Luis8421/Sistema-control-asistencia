// Standalone a proposito: no depende de js/api.js (que redirige aqui mismo
// si no hay sesion), para evitar un bucle de redireccion en esta pagina.
const apiUrlConfigurada = window.ASISTENCIA_API_URL && window.ASISTENCIA_API_URL.trim();
const API_URL = apiUrlConfigurada
  ? apiUrlConfigurada.replace(/\/+$/, "")
  : location.protocol === "file:" || location.hostname === "localhost"
    ? "http://localhost:4000/api"
    : "/api";

function setSesionPanel(token, usuario) {
  localStorage.setItem("panel_token", token);
  localStorage.setItem("panel_usuario", JSON.stringify(usuario));
}

// NOTA: antes este bloque saltaba directo a marcaciones.html si habia un
// panel_token en localStorage, sin verificar que fuera valido. Eso es lo
// que causaba un bucle infinito de recargas: si el token estaba presente
// pero invalido/expirado, marcaciones.html (via api.js) lo detectaba con
// un 401, lo borraba y volvia aqui — y si el token volvia a aparecer
// (varias pestanas del panel abiertas a la vez, restauracion de sesion
// del navegador, etc.), login.html volvia a saltar, repitiendo el ciclo
// sin parar. Se quita el salto automatico: login.html SIEMPRE muestra el
// formulario, nunca asume que un token presente es valido.

document.getElementById("formLogin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorBox = document.getElementById("errorLogin");
  const btn = document.getElementById("btnLogin");
  errorBox.classList.add("d-none");
  btn.disabled = true;
  btn.textContent = "Ingresando...";

  try {
    const codigoEmpleado = document.getElementById("usuario").value.trim();
    const password = document.getElementById("password").value;

    const res = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigoEmpleado, password }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || "No se pudo iniciar sesion.");
    }

    if (!["supervisor", "admin"].includes(data.empleado.rol)) {
      throw new Error("Tu cuenta no tiene permisos para acceder al panel de administracion.");
    }

    setSesionPanel(data.token, data.empleado);
    location.href = "marcaciones.html";
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.remove("d-none");
  } finally {
    btn.disabled = false;
    btn.textContent = "Iniciar sesion";
  }
});
