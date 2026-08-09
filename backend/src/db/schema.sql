-- Esquema de base de datos - Fase 1 MVP
-- SQLite para arrancar rapido. La migracion a PostgreSQL implica reescribir
-- este .sql con tipos equivalentes (UUID, TIMESTAMP, BOOLEAN nativos, etc.)
-- y cambiar el driver en src/db/connection.js; el resto del backend
-- (controladores, rutas) no depende del motor de base de datos.
--
-- Las columnas de fecha/hora usan datetime('now', '-5 hours') en vez de
-- 'localtime': Ecuador (America/Guayaquil) es UTC-5 fijo sin horario de
-- verano, y este offset explicito no depende de como este configurado el
-- reloj/zona horaria del sistema operativo donde corra el servidor (a
-- diferencia de 'localtime', que si depende de eso).

CREATE TABLE IF NOT EXISTS bodegas (
  id            TEXT PRIMARY KEY,
  nombre        TEXT NOT NULL,
  direccion     TEXT,
  latitud       REAL NOT NULL,
  longitud      REAL NOT NULL,
  radio_metros  INTEGER NOT NULL DEFAULT 100,
  -- Codigo corto opcional (ej. "BQZ1"), normalizado en mayusculas sin
  -- espacios por bodegaController antes de guardar. Nullable: bodegas
  -- creadas antes de este campo no tienen codigo hasta que se les asigne
  -- uno. NOT NULL habria roto la migracion sobre datos existentes.
  codigo        TEXT,
  activo        INTEGER NOT NULL DEFAULT 1,
  creado_en     TEXT NOT NULL DEFAULT (datetime('now', '-5 hours'))
);
-- El indice unico parcial de "codigo" se crea en migrate.js, DESPUES de
-- garantizar que la columna existe (ALTER TABLE incremental para bases
-- ya existentes) — si fuera parte de este archivo, correria antes que el
-- ALTER TABLE sobre una base existente y fallaria con "no such column".

CREATE TABLE IF NOT EXISTS empleados (
  id                      TEXT PRIMARY KEY,
  nombre_completo         TEXT NOT NULL,
  codigo_empleado         TEXT NOT NULL UNIQUE,
  cargo                   TEXT,
  email                   TEXT NOT NULL UNIQUE,
  password_hash           TEXT NOT NULL,
  rol                     TEXT NOT NULL DEFAULT 'empleado', -- empleado | supervisor | admin
  activo                  INTEGER NOT NULL DEFAULT 1,
  bodega_id               TEXT NOT NULL REFERENCES bodegas(id),
  hora_entrada_esperada   TEXT NOT NULL DEFAULT '08:00',
  hora_salida_esperada    TEXT NOT NULL DEFAULT '17:00',
  tolerancia_min          INTEGER NOT NULL DEFAULT 10,
  -- Dias de la semana que trabaja el empleado: lista separada por comas de
  -- numeros ISO (1=lunes ... 7=domingo). Default lunes-viernes, igual al
  -- comportamiento previo a que este campo existiera. La usa el calculo de
  -- ausencias en utils/indicadores.js.
  dias_laborables         TEXT NOT NULL DEFAULT '1,2,3,4,5',
  -- Autorizacion de marcaje INDEPENDIENTE de rol y de bodega_id: si es 1,
  -- el empleado puede intentar marcar en CUALQUIER bodega activa del
  -- catalogo (asistenciaController.marcar() sigue validando su geocerca
  -- real igual que siempre). Si es 0, mantiene el comportamiento anterior:
  -- solo puede marcar dentro de la geocerca de su bodega_id. DEFAULT 0:
  -- nadie recibe esta autorizacion automaticamente, ni al crearse ni por
  -- ningun otro motivo — es una concesion explicita via el endpoint
  -- dedicado PUT /api/empleados/:id/autorizacion-bodegas, nunca implicita.
  autorizado_todas_bodegas INTEGER NOT NULL DEFAULT 0,
  creado_en               TEXT NOT NULL DEFAULT (datetime('now', '-5 hours'))
);

CREATE TABLE IF NOT EXISTS registros_asistencia (
  id                     TEXT PRIMARY KEY,
  tipo                   TEXT NOT NULL, -- entrada | salida
  timestamp_servidor     TEXT NOT NULL DEFAULT (datetime('now', '-5 hours')),
  latitud                REAL NOT NULL,
  longitud               REAL NOT NULL,
  precision_gps_m        REAL,
  distancia_a_bodega_m   REAL NOT NULL,
  valido                 INTEGER NOT NULL, -- 1 = valido, 0 = invalido
  motivo_invalido        TEXT,
  dispositivo_id         TEXT,
  foto_url               TEXT, -- ruta relativa (/uploads/fotos/xxx.jpg); solo la envia el marcaje web, es opcional
  empleado_id            TEXT NOT NULL REFERENCES empleados(id),
  bodega_id              TEXT NOT NULL REFERENCES bodegas(id)
);

CREATE INDEX IF NOT EXISTS idx_registros_empleado ON registros_asistencia(empleado_id);
CREATE INDEX IF NOT EXISTS idx_registros_timestamp ON registros_asistencia(timestamp_servidor);

-- Auditoria de acciones administrativas (panel web): quien hizo que accion,
-- sobre que entidad, y cuando. Append-only, nunca se edita ni se borra.
-- usuario_email queda copiado aqui (no solo el id) para que el registro
-- historico se lea igual aunque el usuario cambie de email despues.
CREATE TABLE IF NOT EXISTS auditoria (
  id             TEXT PRIMARY KEY,
  usuario_id     TEXT NOT NULL REFERENCES empleados(id),
  usuario_email  TEXT NOT NULL,
  accion         TEXT NOT NULL, -- crear | actualizar | eliminar
  entidad        TEXT NOT NULL, -- empleado | bodega
  entidad_id     TEXT NOT NULL,
  detalle        TEXT, -- JSON compacto: campos afectados, nunca contrasenas
  creado_en      TEXT NOT NULL DEFAULT (datetime('now', '-5 hours'))
);

CREATE INDEX IF NOT EXISTS idx_auditoria_entidad ON auditoria(entidad, entidad_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_usuario ON auditoria(usuario_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_creado ON auditoria(creado_en);

-- TABLA DE UN MODELO DE AUTORIZACION ANTERIOR, YA NO USADA. Ningun
-- controller la lee ni la escribe: la autorizacion de marcaje depende
-- exclusivamente de empleados.autorizado_todas_bodegas (si es 1, cualquier
-- bodega activa es candidata; si es 0, solo empleados.bodega_id) — ver
-- asistenciaController.obtenerBodegasCandidatas(). Se deja la tabla y sus
-- datos intactos en la base (no se hace DROP aqui) hasta que una fase
-- separada, explicitamente autorizada, evalue eliminarla.
CREATE TABLE IF NOT EXISTS empleado_bodegas (
  empleado_id TEXT NOT NULL REFERENCES empleados(id),
  bodega_id   TEXT NOT NULL REFERENCES bodegas(id),
  creado_en   TEXT NOT NULL DEFAULT (datetime('now', '-5 hours')),
  PRIMARY KEY (empleado_id, bodega_id)
);

CREATE INDEX IF NOT EXISTS idx_empleado_bodegas_empleado ON empleado_bodegas(empleado_id);
