// Standalone a proposito: no depende de js/api.js (que redirige aqui mismo
// si no hay sesion), para evitar un bucle de redireccion en esta pagina.
const API_URL = location.protocol === "file:" ? "http://localhost:4000/api" : "/api";

function setSesionPanel(token, usuario) {
  localStorage.setItem("panel_token", token);
  localStorage.setItem("panel_usuario", JSON.stringify(usuario));
}

// Si ya hay una sesion de administrador guardada, saltar directo al panel.
if (localStorage.getItem("panel_token")) {
  location.href = "marcaciones.html";
}

document.getElementById("formLogin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorBox = document.getElementById("errorLogin");
  const btn = document.getElementById("btnLogin");
  errorBox.classList.add("d-none");
  btn.disabled = true;
  btn.textContent = "Ingresando...";

  try {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    const res = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
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
