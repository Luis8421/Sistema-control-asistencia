const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

// Reproduce el desempate de "ultimo marcaje del dia" en
// asistenciaController.js (funcion continuarMarcaje): datetime('now')
// trunca a segundos, asi que dos marcajes dentro del mismo segundo
// pueden empatar en timestamp_servidor. Sin un desempate secundario por
// rowid, ORDER BY timestamp_servidor DESC LIMIT 1 no garantiza devolver
// el marcaje realmente mas reciente.
test("desempate rowid DESC — dos marcajes con timestamp_servidor identico", (t) => {
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE registros_asistencia (
      id TEXT PRIMARY KEY,
      tipo TEXT NOT NULL,
      timestamp_servidor TEXT NOT NULL,
      valido INTEGER NOT NULL,
      empleado_id TEXT NOT NULL
    )
  `);

  const empleadoId = "test-employee";
  const timestampEmpatado = "2099-01-01 12:00:00";
  const id1 = "test-entry";
  const id2 = "test-exit";

  const insertar = db.prepare(`
    INSERT INTO registros_asistencia (id, tipo, timestamp_servidor, valido, empleado_id)
    VALUES (?, ?, ?, 1, ?)
  `);
  insertar.run(id1, "entrada", timestampEmpatado, empleadoId);
  insertar.run(id2, "salida", timestampEmpatado, empleadoId);

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
});
