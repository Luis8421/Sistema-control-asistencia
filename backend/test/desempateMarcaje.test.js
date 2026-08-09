const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Database = require("better-sqlite3");
const { v4: uuidv4 } = require("uuid");

// Reproduce el desempate de "ultimo marcaje del dia" en
// asistenciaController.js (funcion continuarMarcaje): datetime('now')
// trunca a segundos, asi que dos marcajes dentro del mismo segundo
// pueden empatar en timestamp_servidor. Sin un desempate secundario por
// rowid, ORDER BY timestamp_servidor DESC LIMIT 1 no garantiza devolver
// el marcaje realmente mas reciente. Usa una fecha sintetica (2099) que
// no puede colisionar con datos reales, y limpia sus filas en `finally`
// aunque el assert falle.
test("desempate rowid DESC — dos marcajes con timestamp_servidor identico", () => {
  const db = new Database(path.join(__dirname, "..", "dev.db"));
  const empleadoId = db.prepare("SELECT id FROM empleados LIMIT 1").get().id;
  const bodegaId = db.prepare("SELECT id FROM bodegas LIMIT 1").get().id;
  const timestampEmpatado = "2099-01-01 12:00:00";
  const id1 = uuidv4();
  const id2 = uuidv4();

  try {
    const insertar = db.prepare(`
      INSERT INTO registros_asistencia
        (id, tipo, latitud, longitud, precision_gps_m, distancia_a_bodega_m, valido, motivo_invalido, dispositivo_id, foto_url, empleado_id, bodega_id, timestamp_servidor)
      VALUES (?, ?, 0, 0, 10, 5, 1, NULL, 'TEST-AUTOMATIZADO', NULL, ?, ?, ?)
    `);
    insertar.run(id1, "entrada", empleadoId, bodegaId, timestampEmpatado);
    insertar.run(id2, "salida", empleadoId, bodegaId, timestampEmpatado);

    const ultimoConDesempate = db
      .prepare(
        `SELECT tipo FROM registros_asistencia
         WHERE empleado_id = ? AND valido = 1 AND date(timestamp_servidor) = date(?)
         ORDER BY timestamp_servidor DESC, rowid DESC LIMIT 1`
      )
      .get(empleadoId, timestampEmpatado);

    assert.equal(
      ultimoConDesempate.tipo,
      "salida",
      "con rowid DESC como desempate, debe identificar la fila insertada despues (salida) como el ultimo marcaje, sin importar el empate de timestamp"
    );
  } finally {
    db.prepare("DELETE FROM registros_asistencia WHERE id IN (?, ?)").run(id1, id2);
    const restantes = db.prepare("SELECT COUNT(*) c FROM registros_asistencia WHERE id IN (?, ?)").get(id1, id2);
    db.close();
    assert.equal(restantes.c, 0, "las filas sinteticas de la prueba deben quedar eliminadas");
  }
});
