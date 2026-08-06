# Panel web — Control de Asistencia (Fase 2)

Panel de administración en HTML + CSS + JavaScript plano (sin build ni
frameworks), con Bootstrap 5 vía CDN. Consume la API del `backend/`
directamente desde el navegador (`fetch`).

**No tiene login.** Cada petición al backend envía un header fijo
`X-API-Key` (definido en `js/api.js`) que debe coincidir con
`ADMIN_API_KEY` en `backend/.env`. Es un modelo de auth simple pensado
para uso interno/confianza baja — cualquiera con la clave (visible en el
JS del navegador) puede administrar empleados y geocercas.

## Pantallas de administración (API key, sin login)

- **Marcaciones** (`marcaciones.html`) — listado general de marcajes con
  filtros por fecha, empleado y tipo (entrada/salida), paginado.
- **Empleados** (`empleados.html`) — CRUD de empleados (crear, editar,
  desactivar) con búsqueda por nombre.
- **Geocercas** (`geocercas.html`) — CRUD de las bodegas/geocercas (nombre,
  dirección, latitud, longitud, radio).

`index.html` solo redirige a `marcaciones.html`.

## Pantalla de empleado (login propio, JWT)

- **Marcar Asistencia** (`marcaje.html`) — pensada para que cada empleado
  la abra desde su celular o PC **sin instalar la app móvil**. A
  diferencia de las 3 pantallas anteriores, **sí tiene login**: el
  empleado ingresa su email/contraseña (el mismo `POST /api/auth/login`
  que usa la app), y el JWT resultante se guarda en `localStorage` bajo
  claves separadas (`empleado_token` / `empleado_data`) para no chocar
  con nada del panel admin. Desde ahí puede marcar entrada/salida (usa
  `navigator.geolocation` del navegador, igual que el GPS de la app) y
  ver su propio historial.
- Requiere **HTTPS** para funcionar fuera de `localhost` — los
  navegadores bloquean `navigator.geolocation` en origenes HTTP que no
  sean `localhost`.
- No puede detectar "ubicación simulada" (mock location) como sí hace la
  app móvil — es una limitación de la API de geolocalización del
  navegador, no algo que se pueda evitar desde el front.

## Cómo probarlo

1. Levanta el backend (ver `backend/README.md`) con `ADMIN_API_KEY`
   definido en `.env` (por defecto `miclave123` en `.env.example`).
2. Si cambiaste `ADMIN_API_KEY` en el backend, actualiza `API_KEY` en
   [`js/api.js`](js/api.js) para que coincida.
3. Abre `web/index.html` en el navegador (o, como este proyecto ya vive
   dentro de la carpeta `www` de WAMP, vía Apache en
   `http://localhost/proyecto-asistencia/web/`).

Si tu backend no corre en `http://localhost:4000`, cambia `API_URL` en
`js/api.js` también.

## Estructura

```
web/
  index.html          # redirige a marcaciones.html
  marcaciones.html      # listado + filtros (admin, API key)
  empleados.html          # CRUD empleados (admin, API key)
  geocercas.html            # CRUD geocercas (admin, API key)
  marcaje.html                # login + marcar entrada/salida (empleado, JWT)
  css/style.css
  js/
    api.js                   # fetch wrapper + X-API-Key fijo (admin)
    nav.js                    # navbar compartido (admin)
    marcaciones.js
    empleados.js
    geocercas.js
    marcaje.js                 # login/marcar/historial del empleado (JWT)
```

No incluye horarios/turnos, reportes exportables ni notificaciones — eso
queda fuera del alcance de esta fase.
