# Backend — Control de Asistencia con Geolocalización (Fase 1 MVP)

API en Node.js + Express que recibe el marcaje de entrada/salida de un
empleado, valida que la ubicación GPS reportada esté dentro del radio
autorizado de su bodega (geofencing con fórmula de Haversine), y guarda
**todos** los registros — válidos o no — para trazabilidad.

Usa SQLite (`better-sqlite3`) para poder arrancar sin instalar ni configurar
un motor de base de datos aparte. Ver la sección "Pasar a PostgreSQL" al
final para producción.

## Requisitos
- Node.js 18 o superior

## Instalación

```bash
cd backend
npm install
cp .env.example .env
npm run migrate    # crea las tablas
npm run seed        # crea una geocerca, 4 usuarios y 5 marcaciones de ejemplo
npm run dev          # levanta el servidor con recarga automática
```

El servidor queda en `http://localhost:4000`.

## Usuarios de prueba (creados por `npm run seed`)

Tres formas de entrar, todas por `codigoEmpleado` ("usuario"), nunca por
correo:
- **Portal de Marcaje** (`marcaje.html`): elige tu nombre de una lista y
  escribe tu código — **sin password** (`POST /auth/login-empleado`).
- **App móvil**: código + password (`POST /auth/login`).
- **Panel de administración** (`login.html`, supervisor/admin): usuario
  (código) + password (mismo `POST /auth/login`).

| Rol        | Codigo de empleado | Email                      | Password   |
|------------|---------------------|-----------------------------|------------|
| Empleado   | EMP-001             | juan.perez@empresa.com      | demo1234   |
| Empleado   | EMP-002             | ana.martinez@empresa.com    | demo1234   |
| Supervisor | SUP-001             | maria.torres@empresa.com    | demo1234   |
| Admin      | ADM-001             | admin@empresa.com           | demo1234   |

La geocerca de ejemplo ("Oficina Principal", lat -0.1807, lng -78.4678,
radio 100m) se crea con coordenadas fijas en `src/seed.js`. **Cámbialas por
tu propia ubicación** si vas a probar el marcaje desde tu celular o
navegador, o el marcaje siempre saldrá "fuera de rango".

El seed también crea 5 marcaciones de ejemplo (3 válidas, 2 inválidas —
una fuera de rango y otra por precisión GPS insuficiente) repartidas en
2 días y entre los 2 empleados, para que el panel web no se abra vacío.

## Probar rápido con curl

```bash
# 1. Login (empleado, por codigo — el panel admin/supervisor sigue
# entrando por email, ver tabla de endpoints abajo)
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"codigoEmpleado":"EMP-001","password":"demo1234"}'
# copia el "token" de la respuesta

# 2. Marcar entrada (reemplaza TOKEN, y usa lat/lon cercanas a la bodega)
curl -X POST http://localhost:4000/api/asistencia/marcar \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{"tipo":"entrada","latitud":-0.180653,"longitud":-78.467834,"precisionM":15}'
```

## Endpoints disponibles (Fase 1)

| Método | Endpoint | Auth | Descripción |
|---|---|---|---|
| POST | `/api/auth/login` | - | Login con `password`: por `codigoEmpleado` (app móvil y panel supervisor/admin) o `email` como alternativa, devuelve JWT |
| POST | `/api/auth/login-empleado` | - | Login del Portal: **solo `codigoEmpleado`, sin password**; solo `rol = 'empleado'`. Supervisor/admin usan `/login` con password. No hay autoregistro |
| GET | `/api/empleados/publico` | - | Sin autenticación: `[{ codigoEmpleado, nombreCompleto }]` de empleados activos para el selector del Portal. El endpoint expone los códigos y, junto con el login sin password, no verifica la identidad del empleado |
| POST | `/api/asistencia/marcar` | JWT | Valida geocerca (Haversine) contra las bodegas candidatas del empleado (`autorizado_todas_bodegas`: todas las activas, o solo su `bodega_id`), secuencia del día, y registra entrada/salida; `422` sin guardar nada si algo falla; `409` si el GPS coincide con 2+ bodegas candidatas a la vez (ver `bodegaId` abajo) |
| GET | `/api/asistencia/historial/:empleadoId?fecha=` | JWT | Historial de un empleado; `fecha=YYYY-MM-DD` opcional (sin ella, trae todo) |
| GET | `/api/asistencia/en-turno` | JWT (supervisor/admin) | Empleados en turno hoy |
| GET | `/api/indicadores/:empleadoId?desde&hasta` | JWT | Puntualidad, atrasos, ausencias y horas trabajadas en un rango (default: mes en curso) |
| GET | `/api/bodegas?incluirInactivas=` | JWT (supervisor/admin) | Lista de geocercas (activas por defecto) |
| POST | `/api/bodegas` | JWT (supervisor/admin) | Crear geocerca (`codigo` opcional, único, normalizado a mayúsculas) |
| PUT | `/api/bodegas/:id` | JWT (supervisor/admin) | Editar geocerca (incluye `codigo`) |
| DELETE | `/api/bodegas/:id` | JWT (supervisor/admin) | Eliminar geocerca (solo si no tiene empleados ni marcaciones) |
| GET | `/api/empleados?page&limit&busqueda&activo` | JWT (supervisor/admin) | Listar empleados (rol `empleado`), paginado; `activo=true\|false` opcional |
| POST | `/api/empleados` | JWT (supervisor/admin) | Crear empleado con `codigoEmpleado` — es como el admin lo autoriza a marcar (Portal: solo con el código, ver `/auth/login-empleado`). `email` y `password` son opcionales (el Portal ya no usa password; si se omite, se guarda un hash aleatorio inutilizable). `diasLaborables` opcional: arreglo 1-7, 1=lunes; default lunes-viernes |
| PUT | `/api/empleados/:id` | JWT (supervisor/admin) | Editar empleado (incluye `diasLaborables`, `bodegaId`). Nunca modifica `autorizado_todas_bodegas` |
| PUT | `/api/empleados/:id/autorizacion-bodegas` | JWT (supervisor/admin) | `{ autorizadoTodasBodegas: true\|false }` — único endpoint que puede cambiar esta autorización; auditado con valor anterior/nuevo |
| DELETE | `/api/empleados/:id` | JWT (supervisor/admin) | Desactivar empleado (soft delete) |
| GET | `/api/marcaciones?page&limit&fecha&empleadoId&tipo&valido` | JWT (supervisor/admin) | Listado general de marcaciones, filtrable; `valido=true\|false` opcional |
| GET | `/api/marcaciones/exportar?fecha&empleadoId&tipo` | JWT (supervisor/admin) | Mismos filtros, descarga un `.xlsx` (tope 5000 filas) |
| GET | `/api/indicadores/:empleadoId/exportar?desde&hasta` | JWT | Mismo calculo que `/api/indicadores`, descarga un `.pdf` |
| GET | `/api/auditoria?page&limit&entidad&usuarioId&fecha` | JWT (**solo admin**) | Historial de acciones administrativas (crear/editar/desactivar empleados y geocercas) |

Todos los endpoints requieren el header `Authorization: Bearer <token>`
obtenido en `/api/auth/login`. Los marcados **JWT (supervisor/admin)** además
exigen que el `rol` del token sea `supervisor` o `admin` (`403` si no).

El panel web de administración (`web/`) inicia sesión contra el mismo
`/api/auth/login` que la app móvil — ya no usa una API key fija. Cualquier
cuenta con rol `supervisor` o `admin` (creadas por `npm run seed` o desde el
propio panel) puede entrar.

## Estructura

```
src/
  db/
    schema.sql       # definición de tablas
    connection.js    # conexión SQLite
    migrate.js        # aplica schema.sql
  utils/geo.js         # Haversine + validación de geocerca
  utils/secuenciaMarcaje.js  # entrada/salida no duplicadas en el mismo día
  utils/auditoria.js    # registra crear/actualizar/eliminar del panel
  middleware/auth.js      # JWT + control de roles
  controllers/               # lógica de cada recurso
  routes/                     # definición de rutas Express
  seed.js                      # datos de ejemplo
  backup.js                     # backup de dev.db (npm run backup)
  server.js                    # punto de entrada
test/
  geo.test.js                # suite de validarGeocerca() / calcularDistanciaMetros
  secuenciaMarcaje.test.js      # suite de validarSecuenciaDelDia()
```

## Tests

```bash
npm test              # corre la suite (node --test, sin dependencias externas)
npm run test:coverage # igual, mas reporte de cobertura (c8)
```

Cubre `src/utils/geo.js` — la geovalidación (`validarGeocerca`) es la
pieza mas critica del sistema (decide si un marcaje se acepta o se
rechaza), asi que tiene la unica suite de tests del proyecto por ahora.
No depende de la app movil, del panel web, ni de un backend corriendo:
son pruebas unitarias puras sobre la funcion.

## Producción

- **`JWT_SECRET`**: debe ser un valor aleatorio largo, no el placeholder de
  `.env.example`. Genera el tuyo con
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- **`JWT_EXPIRES_IN`**: duración de la sesión (formato de la librería
  `jsonwebtoken`: `"12h"`, `"30m"`, `"7d"`...). Aplica por igual a la app
  móvil, el portal de marcaje y el panel admin — es el mismo mecanismo de
  auth para los tres. Default `12h` si no se define.
- **`CORS_ORIGIN`**: lista de origenes (separados por coma) desde los que
  se acepta CORS, ej. `CORS_ORIGIN=https://mipanel.com,http://localhost`.
  Cualquier otro origen recibe un error y el navegador bloquea la
  respuesta. Las peticiones sin header `Origin` (curl, apps moviles,
  servidor a servidor) no se ven afectadas.
- **Backup de la base de datos**: `npm run backup` hace checkpoint del WAL
  y copia `dev.db` a `backend/backups/dev-<fecha>-<hora>.db`. Se puede
  correr con el servidor arriba (no requiere downtime). Prográmalo con el
  Programador de tareas de Windows o un cron si usas otro SO.

## Configuración de geovalidación

Validación de geocerca **obligatoria y bloqueante**: `POST /api/asistencia/marcar`
calcula la distancia con Haversine (`src/utils/geo.js`) contra la bodega
asignada al empleado y, si el marcaje no pasa la validación, **lo rechaza
con `422` y no guarda ningún registro** — a diferencia de versiones
anteriores de este proyecto, que guardaban igual los marcajes inválidos
para trazabilidad. El backend es la única fuente de verdad: la app móvil
(`mobile/utils/geo.js`) y el marcaje web (`web/js/marcaje.js`) hacen el
mismo cálculo *localmente* antes de llamar a la API, pero solo como
optimización de UX (evita un viaje redondo cuando el empleado claramente
está fuera de rango) — nunca se confía en ese chequeo del lado del cliente.

En `.env`:
- `MAX_GPS_PRECISION_M`: si el GPS del dispositivo reporta una precisión
  peor que este valor (en metros), el marcaje se rechaza.
- El radio autorizado se define por bodega, en la columna `radio_metros`
  de la tabla `bodegas` (configurable por sucursal desde el panel,
  `geocercas.html`).

Un marcaje se rechaza (`422`, sin guardar nada) si (`motivo` en la
respuesta entre parentesis):
- la distancia a la bodega supera `radio_metros` (`fuera_de_rango`) —
  mensaje exacto: *"No se encuentra dentro del área autorizada para
  registrar asistencia."*
- la precisión del GPS es peor que `MAX_GPS_PRECISION_M`
  (`precision_insuficiente`), o no vino un numero valido
  (`precision_invalida`),
- el dispositivo reporta ubicación simulada (`gps_simulado`),
- las coordenadas del empleado no son numeros validos o estan fuera del
  rango geografico posible (`coordenadas_invalidas`),
- la bodega asignada no tiene coordenadas o radio validos
  (`bodega_mal_configurada` — error de configuración del admin, no del
  empleado).

Estas dos ultimas son una capa de defensa dentro de `validarGeocerca()`
misma (no solo en el controlador): protegen la funcion contra coordenadas
basura que, sin este chequeo, producirian una distancia `NaN` y `NaN >
radio` evalua a `false` en JS — pasando como "valido" por accidente. Ver
`test/geo.test.js` para la cobertura completa de estos casos.

Ademas de la geocerca, tambien se rechaza (mismo `422`, sin guardar nada)
si:
- el empleado no tiene una bodega asignada (`sin_bodega_asignada`) —
  estructuralmente casi imposible por la FK `empleados.bodega_id`, pero
  se revisa explicitamente en vez de dejar que crashee.
- **la secuencia del dia no es valida** (`src/utils/secuenciaMarcaje.js`,
  modulo separado de `geo.js` a proposito — es una regla de negocio
  distinta, no de geolocalizacion):
  - `entrada_duplicada`: ya hay una entrada hoy sin una salida despues.
  - `salida_sin_entrada`: intenta marcar salida sin haber marcado
    entrada hoy.
  - `salida_duplicada`: ya hay una salida hoy despues de la ultima
    entrada.
  - Los ciclos se reinician cada dia (`date('now', '-5 hours')`); un
    empleado puede tener varios ciclos entrada→salida el mismo dia.

Registros de marcajes inválidos anteriores a este cambio (columna `valido`
en `registros_asistencia`) se conservan para no perder historial, pero no
se generan más desde que este comportamiento entró en vigor.

## Autorización de marcaje: `autorizado_todas_bodegas`

Cada empleado tiene una columna `autorizado_todas_bodegas` (booleana,
`DEFAULT 0`) que determina en qué bodegas puede intentar marcar. Es
**independiente de `rol`** (no se infiere de admin/supervisor/empleado) y
del catálogo de geocercas en sí — solo dice contra qué conjunto de
bodegas se corre la validación GPS real:

- **`autorizado_todas_bodegas = 1`**: candidatas = todas las bodegas con
  `activo = 1` del catálogo completo, incluida Oficina Principal, sin
  excepciones.
- **`autorizado_todas_bodegas = 0`** (default): candidatas = únicamente
  `empleados.bodega_id` (su bodega principal) — el mismo comportamiento
  que existía antes de todo el trabajo de multi-bodega.

En ambos casos, cada candidata pasa por `validarGeocerca()`
(`utils/geo.js`, sin cambios) antes de aceptarse — el flag nunca
reemplaza la validación GPS, solo decide el universo de bodegas a
evaluar. La secuencia entrada/salida (`utils/secuenciaMarcaje.js`, sin
cambios) sigue siendo por empleado y día, no por bodega.

**Comportamiento según cuántas bodegas candidatas validan el GPS:**

| Resultado | Respuesta |
|---|---|
| Ninguna | `422`, informa distancia a la más cercana **entre las candidatas** (para un empleado sin autorización global, eso es simplemente su propia bodega) |
| Exactamente 1 | `201` automático, sin pedir nada más |
| 2 o más simultáneamente (ej. `BOCQ`/`BDCQ`, que comparten coordenadas — solo posible con autorización global) | `409`, `{ motivo: "seleccion_bodega_requerida", opciones: [...] }` — **no elige ninguna por desempate automático** |

Para resolver el caso de `409`, el cliente reenvía la misma marcación
agregando `bodegaId` con la elección del empleado. El backend **nunca
confía en ese valor tal cual**: verifica que la bodega exista, esté
activa y sea una candidata válida para ese empleado (`422
bodega_no_autorizada` si no) y vuelve a correr `validarGeocerca()` contra
esa bodega específica antes de aceptar.

**Gestión desde el panel**: `PUT /api/empleados/:id/autorizacion-bodegas`
con `{ autorizadoTodasBodegas: true|false }` es el **único** endpoint que
puede tocar esta columna — auditado con valor anterior y nuevo. El PUT
general de empleado (`PUT /api/empleados/:id`) nunca la modifica, ni
siquiera si el body incluye `bodegaId`.

**Nota histórica**: existe una tabla `empleado_bodegas` (empleado_id,
bodega_id) de un diseño anterior (autorización individual por bodega).
Ya no la lee ni la escribe ningún endpoint — queda en la base sin uso,
pendiente de una eliminación futura evaluada por separado.

## Supabase PostgreSQL para el backend

La aplicación conserva Express como API. El navegador y la app móvil llaman
a Express; únicamente el backend se conecta a PostgreSQL mediante `pg`.
GitHub Pages no ejecuta Express ni debe conectarse a la base directamente.
No se necesita `@supabase/supabase-js` en este backend, y no se usa
`service_role`.

### Desarrollo local y producción

- Local: deja `DATABASE_URL` vacía en `backend/.env`; se usa SQLite en
  `DATABASE_PATH` como antes.
- Producción: configura `DATABASE_URL` en el gestor de secretos del host
  donde se ejecute Node/Express. La conexión debe ser privada, nunca una
  variable del frontend.
- `SUPABASE_URL` y `SUPABASE_ANON_KEY` son opcionales para este diseño y no
  los lee Express. La URL y la clave publicable/anon no sustituyen una
  conexión PostgreSQL ni habilitan permisos automáticamente.
- `JWT_SECRET`, `DATABASE_URL`, `PORT`, `CORS_ORIGIN` y
  `MAX_GPS_PRECISION_M` controlan el backend. En producción, `JWT_SECRET`
  debe ser aleatorio y de al menos 32 caracteres. No uses el texto de
  ejemplo.

Instala dependencias y prueba SQLite desde PowerShell:

```powershell
Set-Location C:\wamp64\www\LCHANGO\proyecto-asistencia\backend
npm ci
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm run migrate
npm test
npm start
```

Pega el resultado del comando de Node en `JWT_SECRET` dentro de `backend/.env`
local; no lo compartas. Con `DATABASE_URL` vacía, `GET /health` ejecuta una
consulta `SELECT 1` a SQLite.

### Preparar Supabase

1. Entra al Dashboard y abre el proyecto cuyo **Project ID** sea
   `lhygcctzdxjrevsugllg`. No pegues claves ni contraseñas en el chat.
2. En **Table Editor**, revisa si ya hay tablas. Abre cada tabla para ver
   columnas y tipos; en sus detalles revisa relaciones. En **SQL Editor**,
   las secciones `Indexes`/`Constraints` de la definición muestran índices,
   claves únicas y foráneas. Si hay tablas previas, compáralas con
   `src/db/schema.postgres.sql` antes de aplicar el esquema.
3. En **Project Settings > API** (o **API Keys** en el Dashboard actual),
   copia solo la **Project URL** si otro cliente público la necesita y la
   clave `anon`/`publishable`. Este backend no necesita esas dos variables
   para conectar con `pg`.
4. Para `DATABASE_URL`, abre **Project Settings > Database > Connection
   string** o el botón **Connect** del proyecto y elige URI para Node.js.
   Usa la cadena del pooler si el host no admite conexiones IPv6/directas.
   La URI contiene una contraseña de base de datos: guárdala únicamente como
   secreto en el host del backend. Nunca uses una clave `service_role` como
   `DATABASE_URL`.
5. Ejecuta primero `npm run migrate:postgres` desde `backend`, con
   `DATABASE_URL` configurada solo en tu entorno privado. El script aplica
   `schema.postgres.sql` de forma transaccional. Luego confirma en
   **Table Editor** las cinco tablas: `bodegas`, `empleados`,
   `registros_asistencia`, `auditoria` y `empleado_bodegas`.
6. Las tablas se crean con RLS habilitado y sin políticas para el acceso
   `anon`/`authenticated`; además se revocan los permisos de esos roles. Es
   intencional: los clientes no consultan la base directamente, pasan por
   Express. El backend valida el JWT y los roles existentes. La credencial
   PostgreSQL del backend tiene permisos amplios y debe permanecer secreta.
   No habilites políticas `USING (true)` para los roles públicos.

Una respuesta `404` en la raíz del dominio Supabase o `401` al llamar REST
sin API key no demuestra que el proyecto esté dañado. Valida tablas en el
Dashboard y, desde el host privado del backend, valida `GET /health`.

### Prueba y migración de SQLite

No ejecutes la migración real sobre la única copia de tus datos. Primero
crea una copia consistente de SQLite; el script abre el origen en modo solo
lectura y no modifica esa base:

```powershell
Set-Location C:\wamp64\www\LCHANGO\proyecto-asistencia\backend
npm run sqlite:copy -- "C:\ruta\privada\dev.db" "C:\ruta\privada\prueba-migracion.db"
$env:DATABASE_PATH = "C:\ruta\privada\prueba-migracion.db"
npm run migrate
```

En un **proyecto Supabase de prueba**, configura `DATABASE_URL` en el entorno
de PowerShell (no la pongas en el comando que compartas ni en Git), aplica
`npm run migrate:postgres` y simula primero la migración:

```powershell
$env:DATABASE_URL = "TU_DATABASE_URL"
npm run migrate:data -- "C:\ruta\privada\prueba-migracion.db" --dry-run
```

El `--dry-run` revierte las inserciones. El reporte muestra conteos por tabla
y filas fallidas usando número de fila y código de error, no nombres ni
contraseñas. Revisa conteos, relaciones y errores antes de repetir el comando
sin `--dry-run` en el proyecto de prueba. La carga conserva IDs y relaciones,
convierte enteros de SQLite a booleanos, mantiene el orden de inserción de
marcaciones y omite claves ya presentes; no sobrescribe filas remotas.
Los errores de una fila quedan en el reporte y hacen que el proceso termine
con código distinto de cero.

Después de probar login, roles, consultas, marcaciones y reportes contra el
proyecto de prueba, haz respaldo de SQLite y programa la migración real. No
ejecutes `npm run seed` en producción: el comando está bloqueado cuando
`DATABASE_URL` está configurada.

Las fotos **no se copian** a Storage en este cambio. `foto_url` conserva la
ruta histórica, pero los archivos siguen en `backend/uploads/fotos`; hay que
planificar una migración separada a un bucket privado y cambiar la entrega de
archivos antes de mover producción. No hagas público ese directorio.

### Pruebas de API

Con el servidor local ejecutándose, en otra terminal:

```powershell
Invoke-RestMethod http://localhost:4000/health
```

Debe responder `{ "ok": true }`; si la base no está disponible responde HTTP
503. En un entorno de prueba con datos sintéticos:

- inicia sesión y confirma que un rol empleado no puede entrar a las rutas
  del panel (`403`); admin puede ver auditoría y empleado no (`403`);
- registra entrada dentro de la geocerca con precisión aceptable, luego una
  salida válida; repite una entrada y confirma `422`;
- envía una ubicación fuera del radio y confirma `422` sin crear registro;
- lista empleados y bodegas con una sesión de admin/supervisor;
- crea/edita un empleado o bodega y confirma el evento en auditoría;
- consulta indicadores y filtra por fecha para comprobar que los días se
  interpretan en `America/Guayaquil`;
- prueba exportación Excel/PDF.

Las pruebas automatizadas existentes validan geocerca, secuencia y selección
de bodega; `test/sqlDialect.test.js` valida la traducción SQL a PostgreSQL.
No sustituyen una prueba de integración contra un proyecto Supabase de
prueba.

**Bloqueadores antes de publicar:** `/api/auth/login-empleado` todavía
acepta solo el código de empleado, y `/api/empleados/publico` enumera esos
códigos; esto no verifica la identidad de una persona. Además, las fotos
continúan en disco local. No publiques el portal con datos reales hasta
resolver autenticación y almacenamiento privado.

## Próximos pasos (Fase 2 en adelante)
- Panel web de supervisión en tiempo real (usa `GET /api/asistencia/en-turno`
  como punto de partida).
- Turnos rotativos que cambian de horario/dias semana a semana. Hoy
  `empleados.dias_laborables` cubre "libra martes y jueves" (fijo toda la
  semana), pero no un turno que rota cada 2 semanas — ver limitación
  documentada en `src/utils/indicadores.js`.
