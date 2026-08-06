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
| GET | `/api/bodegas?incluirInactivas=` | API key | Lista de geocercas (activas por defecto) |
| POST | `/api/bodegas` | API key | Crear geocerca |
| PUT | `/api/bodegas/:id` | API key | Editar geocerca |
| DELETE | `/api/bodegas/:id` | API key | Eliminar geocerca (solo si no tiene empleados ni marcaciones) |
| GET | `/api/empleados?page&limit&busqueda` | API key | Listar empleados (rol `empleado`), paginado |
| POST | `/api/empleados` | API key | Crear empleado |
| PUT | `/api/empleados/:id` | API key | Editar empleado |
| DELETE | `/api/empleados/:id` | API key | Desactivar empleado (soft delete) |
| GET | `/api/marcaciones?page&limit&fecha&empleadoId&tipo` | API key | Listado general de marcaciones, filtrable |

Los endpoints marcados **JWT** (login de empleado/supervisor y el flujo de
marcaje/historial de la app móvil) requieren el header
`Authorization: Bearer <token>` obtenido en `/api/auth/login`.

Los endpoints marcados **API key** (los que usa el panel web de
administración) requieren el header `X-API-Key: <valor de ADMIN_API_KEY>`
en vez de JWT — no hay login para el panel, es una clave fija compartida
definida en `.env`. Pensado para uso interno/confianza baja (MVP); si el
panel se expone fuera de una red confiable, esto debería reforzarse
(HTTPS obligatorio, rotación de la key, o volver a un login real).

## Estructura

```
src/
  db/
    schema.sql       # definición de tablas
    connection.js    # conexión SQLite
    migrate.js        # aplica schema.sql
  utils/geo.js         # Haversine + validación de geocerca
  middleware/auth.js    # JWT + control de roles
  controllers/           # lógica de cada recurso
  routes/                 # definición de rutas Express
  seed.js                  # datos de ejemplo
  backup.js                 # backup de dev.db (npm run backup)
  server.js                # punto de entrada
```

## Producción

- **`ADMIN_API_KEY` y `JWT_SECRET`**: deben ser valores aleatorios largos,
  no los placeholders de `.env.example`. Genera los tuyos con
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
  Si cambias `ADMIN_API_KEY`, actualiza tambien `API_KEY` en
  `web/js/api.js` para que sigan coincidiendo.
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
- Cálculo de indicadores (puntualidad, atrasos, ausencias, horas trabajadas)
  a partir de `registros_asistencia` + `hora_entrada_esperada` /
  `hora_salida_esperada` de cada empleado.
- Reportes exportables (Excel/PDF).
