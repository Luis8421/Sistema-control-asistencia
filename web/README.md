# Panel web — Control de Asistencia (Fase 2)

Panel de administración en HTML + CSS + JavaScript plano (sin build ni
frameworks), con Bootstrap 5 vía CDN. Consume la API del `backend/`
directamente desde el navegador (`fetch`).

**Login real con JWT** (`login.html`): el administrador o supervisor
ingresa su código de empleado y contraseña contra `POST /api/auth/login`
(los empleados usan el Portal de Marcaje o la app móvil — ver
`backend/README.md`), y el token resultante se envía como
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

## Portal de Asistencia — punto único de marcaje (login propio, JWT, PWA)

`marcaje.html` es el **portal oficial de marcaje para todo el personal**:
un solo enlace (`https://tu-dominio/marcaje.html`), sin enlaces
individuales por empleado. Usa `POST /api/auth/login-empleado` (solo
código, sin contraseña) y comparte la validación de geocerca del backend
con la app móvil. El login simplificado no verifica sólidamente la
identidad: la lista pública que alimenta el selector también entrega los
códigos de empleado. Para datos reales, se recomienda requerir un PIN o
contraseña. El chequeo local de distancia es solo una optimización de UX,
nunca autoritativo.

El JWT se guarda en `localStorage` bajo claves separadas
(`empleado_token` / `empleado_data`) para no chocar con la sesión del
panel admin. La vigencia por defecto es de `180d` para empleados y `12h`
para supervisor/admin; se configura con `JWT_EXPIRES_IN_EMPLEADO` y
`JWT_EXPIRES_IN` en `backend/.env`.

Tras iniciar sesión, el empleado ve **únicamente lo suyo**: nombre,
cargo, bodega asignada, fecha/hora en vivo, estado del turno ("en turno
desde...", "turno finalizado", o "sin marcar hoy" — calculado en el
cliente a partir de su propio historial del día, sin pedir nada nuevo al
backend), los botones Marcar Entrada/Marcar Salida, y su historial de
marcaciones **del día en curso** (`GET /api/asistencia/historial/:id?fecha=`).
No hay forma de ver información de otro empleado — el backend ya lo
impedía (`historial` rechaza con `403` si no es el propio ID), esto no
cambió.

**Preparado como PWA** (instalable en Android, iPhone y escritorio):
`manifest.json` + `sw.js` (service worker) cachean solo el *app shell*
estático (html/css/js/iconos) para carga rápida y "Agregar a pantalla de
inicio" — **nunca** cachea `/api/` ni `/uploads/`: marcar asistencia
siempre va en vivo contra el backend, cachear eso sería incorrecto dado
que el backend es la única fuente de verdad de la geovalidación. Los
iconos en `icons/` son placeholders generados por
`scripts/generar-iconos-pwa.js` (ver raíz del repo) — reemplazar con el
logo real de la empresa cuando esté disponible, misma ruta/nombre.

Notas ya conocidas de la plataforma web (no cambian con esta mejora):
- Requiere **HTTPS** para funcionar fuera de `localhost` — los
  navegadores bloquean `navigator.geolocation` en orígenes HTTP que no
  sean `localhost`. También lo exige la instalación de un service worker.
- El Portal busca la mejor lectura durante hasta **30 segundos** y exige
  precisión GPS reportada de **50 m o menos**. Es un umbral de precisión,
  no el radio de la bodega: por ejemplo, la bodega asignada a Milton Cajas
  tiene un radio de **20 m**. La laptop suele estimar ubicación por Wi-Fi/IP
  y puede no alcanzar la precisión necesaria; para marcajes reales conviene
  usar un celular con ubicación precisa activada, idealmente al aire libre.
  No aumentes el radio ni relajes el umbral sin confirmar las coordenadas
  y probar varias lecturas en sitio.
- No puede detectar "ubicación simulada" (mock location) como sí hace la
  app móvil — limitación de la API de geolocalización del navegador. El
  backend igual valida `precisionM` y rechaza GPS poco confiable.

## Cómo probarlo

1. Levanta el backend (ver `backend/README.md`) y corre `npm run seed` al
   menos una vez (crea `admin@empresa.com` / `demo1234`, rol `admin`).
2. Abre `web/index.html` en el navegador (o, como este proyecto ya vive
   dentro de la carpeta `www` de WAMP, vía Apache en
   `http://localhost/proyecto-asistencia/web/`) e inicia sesión con esa
   cuenta (o cualquier cuenta `supervisor`/`admin`).

En desarrollo local servido por Apache/WAMP (`localhost`), las páginas
conectan directamente con `http://localhost:4000/api`. En despliegues
detrás de Caddy usan `/api` en el mismo origen. Si tu backend local usa
otro host o puerto, configura `ASISTENCIA_API_URL` en `js/config.js`. Para
GitHub Pages y un backend alojado por separado, pon ahí la URL pública de
Express terminada en `/api` y agrega el origen exacto de GitHub Pages a
`CORS_ORIGIN` del backend. Esa URL no es un secreto; no pongas en el archivo
una clave de base de datos ni claves administrativas de Supabase.

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
  marcaje.html                             # Portal de Asistencia: login + marcar + PWA (empleado, JWT)
  manifest.json                               # Web App Manifest (PWA)
  sw.js                                          # service worker (cachea solo el app shell)
  icons/                                            # iconos PWA (placeholders, ver scripts/generar-iconos-pwa.js)
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

No incluye horarios/turnos rotativos, notificaciones, ni modo offline
para el marcaje en sí (la PWA da carga rápida e instalabilidad, no
marcaje sin conexión) — eso queda fuera del alcance de esta fase.
