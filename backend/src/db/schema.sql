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
  activo        INTEGER NOT NULL DEFAULT 1,
  creado_en     TEXT NOT NULL DEFAULT (datetime('now', '-5 hours'))
);

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
