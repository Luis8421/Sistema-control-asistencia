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

| Rol        | Email                      | Password   |
|------------|-----------------------------|------------|
| Empleado   | juan.perez@empresa.com      | demo1234   |
| Empleado   | ana.martinez@empresa.com    | demo1234   |
| Supervisor | maria.torres@empresa.com    | demo1234   |
| Admin      | admin@empresa.com           | demo1234   |

La geocerca de ejemplo ("Oficina Principal", lat -0.1807, lng -78.4678,
radio 100m) se crea con coordenadas fijas en `src/seed.js`. **Cámbialas por
tu propia ubicación** si vas a probar el marcaje desde tu celular o
navegador, o el marcaje siempre saldrá "fuera de rango".

El seed también crea 5 marcaciones de ejemplo (3 válidas, 2 inválidas —
una fuera de rango y otra por precisión GPS insuficiente) repartidas en
2 días y entre los 2 empleados, para que el panel web no se abra vacío.

## Probar rápido con curl

```bash
# 1. Login
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"juan.perez@empresa.com","password":"demo1234"}'
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
| POST | `/api/auth/login` | - | Login de empleado/supervisor, devuelve JWT |
| POST | `/api/auth/registro` | - | Autoregistro (nombreCompleto, email, password) con rol `empleado`, devuelve JWT |
| POST | `/api/asistencia/marcar` | JWT | Valida geocerca (Haversine), secuencia del día (no permite dos entradas/salidas seguidas) y registra entrada/salida; `422` sin guardar nada si algo falla |
| GET | `/api/asistencia/historial/:empleadoId?fecha=` | JWT | Historial de un empleado; `fecha=YYYY-MM-DD` opcional (sin ella, trae todo) |
| GET | `/api/asistencia/en-turno` | JWT (supervisor/admin) | Empleados en turno hoy |
| GET | `/api/indicadores/:empleadoId?desde&hasta` | JWT | Puntualidad, atrasos, ausencias y horas trabajadas en un rango (default: mes en curso) |
| GET | `/api/bodegas?incluirInactivas=` | JWT (supervisor/admin) | Lista de geocercas (activas por defecto) |
| POST | `/api/bodegas` | JWT (supervisor/admin) | Crear geocerca (`codigo` opcional, único, normalizado a mayúsculas) |
| PUT | `/api/bodegas/:id` | JWT (supervisor/admin) | Editar geocerca (incluye `codigo`) |
| DELETE | `/api/bodegas/:id` | JWT (supervisor/admin) | Eliminar geocerca (solo si no tiene empleados ni marcaciones) |
| GET | `/api/empleados?page&limit&busqueda&activo` | JWT (supervisor/admin) | Listar empleados (rol `empleado`), paginado; `activo=true\|false` opcional |
| POST | `/api/empleados` | JWT (supervisor/admin) | Crear empleado (`diasLaborables` opcional: arreglo 1-7, 1=lunes; default lunes-viernes) |
| PUT | `/api/empleados/:id` | JWT (supervisor/admin) | Editar empleado (incluye `diasLaborables`) |
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

## Pasar a PostgreSQL (recomendado para producción)

1. Reescribe `src/db/schema.sql` con tipos de PostgreSQL (`UUID`,
   `TIMESTAMPTZ`, `BOOLEAN`, etc.) y considera agregar la extensión
   PostGIS para cálculos geoespaciales nativos (`ST_DWithin`).
2. Reemplaza `src/db/connection.js` por un pool de `pg` (`npm i pg`).
3. Los controladores usan SQL parametrizado casi idéntico; solo cambia
   la sintaxis de placeholders (`?` → `$1, $2, ...`) y el manejo de
   booleanos (ya no hace falta `1`/`0`).

## Próximos pasos (Fase 2 en adelante)
- Panel web de supervisión en tiempo real (usa `GET /api/asistencia/en-turno`
  como punto de partida).
- Turnos rotativos que cambian de horario/dias semana a semana. Hoy
  `empleados.dias_laborables` cubre "libra martes y jueves" (fijo toda la
  semana), pero no un turno que rota cada 2 semanas — ver limitación
  documentada en `src/utils/indicadores.js`.
