# Panel web — Control de Asistencia (Fase 2)

Panel de administración en HTML + CSS + JavaScript plano (sin build ni
frameworks), con Bootstrap 5 vía CDN. Consume la API del `backend/`
directamente desde el navegador (`fetch`).

**Login real con JWT** (`login.html`), igual que la app móvil: el
administrador o supervisor ingresa su email/contraseña contra
`POST /api/auth/login`, y el token resultante se envía como
`Authorization: Bearer <token>` en cada petición (ver `js/api.js`). Solo
cuentas con rol `supervisor` o `admin` pueden entrar — el backend rechaza
con `403` a cualquier otro rol, y el login del panel también lo valida del
lado del cliente antes de guardar la sesión.

## Pantallas de administración (login JWT, rol supervisor/admin)

- **Inicio** (`index.html`) — dashboard: empleados activos, geocercas
  activas, marcaciones válidas/inválidas del día, y quién está en turno
  ahora mismo.
- **Marcaciones** (`marcaciones.html`) — listado general de marcajes con
  filtros por fecha, empleado y tipo (entrada/salida), paginado, con
  exportación a Excel.
- **Indicadores** (`indicadores.html`) — puntualidad, atrasos, ausencias y
  horas trabajadas por empleado y rango de fechas, con exportación a PDF.
- **Empleados** (`empleados.html`) — CRUD de empleados (crear, editar,
  desactivar) con búsqueda por nombre.
- **Geocercas** (`geocercas.html`) — CRUD de las bodegas/geocercas (nombre,
  dirección, latitud, longitud, radio).
- **Auditoría** (`auditoria.html`, solo rol `admin`) — quién hizo qué
  acción administrativa y cuándo.

Todas estas páginas redirigen automáticamente a `login.html` si no hay
sesión guardada, o si el backend responde `401`/`403` (token vencido o sin
permisos).

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

1. Levanta el backend (ver `backend/README.md`) y corre `npm run seed` al
   menos una vez (crea `admin@empresa.com` / `demo1234`, rol `admin`).
2. Abre `web/index.html` en el navegador (o, como este proyecto ya vive
   dentro de la carpeta `www` de WAMP, vía Apache en
   `http://localhost/proyecto-asistencia/web/`) e inicia sesión con esa
   cuenta (o cualquier cuenta `supervisor`/`admin`).

Si tu backend no corre en `http://localhost:4000`, cambia `API_URL` en
`js/api.js` también.

## Estructura

```
web/
  index.html          # dashboard (admin, JWT)
  login.html            # login del panel (JWT, supervisor/admin)
  marcaciones.html        # listado + filtros + exportar Excel (admin, JWT)
  indicadores.html           # puntualidad/atrasos/ausencias + exportar PDF (admin, JWT)
  empleados.html                 # CRUD empleados (admin, JWT)
  geocercas.html                    # CRUD geocercas (admin, JWT)
  auditoria.html                       # historial de acciones (solo rol admin, JWT)
  marcaje.html                             # login + marcar entrada/salida (empleado, JWT)
  css/style.css
  js/
    api.js                                     # fetch wrapper + sesion JWT + descarga de archivos
    login.js                                      # login del panel (standalone, sin api.js)
    nav.js                                          # navbar compartido (admin) + logout
    dashboard.js
    marcaciones.js
    indicadores.js
    empleados.js
    geocercas.js
    auditoria.js
    marcaje.js                                            # login/marcar/historial del empleado (JWT)
```

No incluye horarios/turnos, reportes exportables ni notificaciones — eso
queda fuera del alcance de esta fase.
