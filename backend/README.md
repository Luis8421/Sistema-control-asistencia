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
| POST | `/api/asistencia/marcar` | JWT | Registra entrada/salida y valida geocerca |
| GET | `/api/asistencia/historial/:empleadoId` | JWT | Historial de un empleado |
| GET | `/api/asistencia/en-turno` | JWT (supervisor/admin) | Empleados en turno hoy |
| GET | `/api/indicadores/:empleadoId?desde&hasta` | JWT | Puntualidad, atrasos, ausencias y horas trabajadas en un rango (default: mes en curso) |
| GET | `/api/bodegas?incluirInactivas=` | JWT (supervisor/admin) | Lista de geocercas (activas por defecto) |
| POST | `/api/bodegas` | JWT (supervisor/admin) | Crear geocerca |
| PUT | `/api/bodegas/:id` | JWT (supervisor/admin) | Editar geocerca |
| DELETE | `/api/bodegas/:id` | JWT (supervisor/admin) | Eliminar geocerca (solo si no tiene empleados ni marcaciones) |
| GET | `/api/empleados?page&limit&busqueda` | JWT (supervisor/admin) | Listar empleados (rol `empleado`), paginado |
| POST | `/api/empleados` | JWT (supervisor/admin) | Crear empleado |
| PUT | `/api/empleados/:id` | JWT (supervisor/admin) | Editar empleado |
| DELETE | `/api/empleados/:id` | JWT (supervisor/admin) | Desactivar empleado (soft delete) |
| GET | `/api/marcaciones?page&limit&fecha&empleadoId&tipo` | JWT (supervisor/admin) | Listado general de marcaciones, filtrable |
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
  utils/auditoria.js    # registra crear/actualizar/eliminar del panel
  middleware/auth.js      # JWT + control de roles
  controllers/               # lógica de cada recurso
  routes/                     # definición de rutas Express
  seed.js                      # datos de ejemplo
  backup.js                     # backup de dev.db (npm run backup)
  server.js                    # punto de entrada
```

## Producción

- **`JWT_SECRET`**: debe ser un valor aleatorio largo, no el placeholder de
  `.env.example`. Genera el tuyo con
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
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

En `.env`:
- `MAX_GPS_PRECISION_M`: si el GPS del dispositivo reporta una precisión
  peor que este valor (en metros), el marcaje se invalida
  (`motivo_invalido: "precision_insuficiente"`).
- El radio autorizado se define por bodega, en la columna `radio_metros`
  de la tabla `bodegas`.

Un marcaje se invalida automáticamente si:
- la distancia a la bodega supera `radio_metros`,
- la precisión del GPS es peor que `MAX_GPS_PRECISION_M`, o
- el dispositivo reporta ubicación simulada (`mock location`).

En los tres casos el registro **se guarda igual**, marcado como inválido,
para que quede evidencia y el supervisor pueda revisarlo.

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
- Turnos rotativos / dias laborables configurables por empleado — hoy
  `GET /api/indicadores` asume lunes-viernes para calcular ausencias
  (ver comentario en `src/utils/indicadores.js`).
