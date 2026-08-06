import * as SecureStore from "expo-secure-store";

// IMPORTANTE: cambia esta URL por la IP de tu backend en la red local
// (no uses "localhost" en un dispositivo/emulador físico, usa la IP de tu PC,
// ej: "http://192.168.1.50:4000/api"). En el emulador de Android usa
// "http://10.0.2.2:4000/api".
const API_URL = "http://192.168.1.50:4000/api";

async function getToken() {
  return SecureStore.getItemAsync("token");
}

async function setToken(token) {
  return SecureStore.setItemAsync("token", token);
}

async function clearToken() {
  return SecureStore.deleteItemAsync("token");
}

async function request(path, { method = "GET", body } = {}) {
  const token = await getToken();

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const error = new Error(data.error || "Error de red");
    error.status = res.status;
    error.data = data;
    throw error;
  }

  return data;
}

export async function login(email, password) {
  const data = await request("/auth/login", { method: "POST", body: { email, password } });
  await setToken(data.token);
  return data.empleado;
}

export async function registro(nombreCompleto, email, password) {
  const data = await request("/auth/registro", {
    method: "POST",
    body: { nombreCompleto, email, password },
  });
  await setToken(data.token);
  return data.empleado;
}

export async function logout() {
  await clearToken();
}

export async function marcarAsistencia({ tipo, latitud, longitud, precisionM, dispositivoId }) {
  return request("/asistencia/marcar", {
    method: "POST",
    body: { tipo, latitud, longitud, precisionM, dispositivoId },
  });
}

export async function obtenerHistorial(empleadoId) {
  return request(`/asistencia/historial/${empleadoId}`);
}

export { getToken };
