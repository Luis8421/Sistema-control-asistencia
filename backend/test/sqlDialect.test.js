const assert = require("node:assert/strict");
const test = require("node:test");
const { postgresSql } = require("../src/db/sqlDialect");

test("translates booleans, Ecuador local dates, and SQLite placeholders", () => {
  const sql = postgresSql(
    "SELECT * FROM registros_asistencia WHERE valido = 1 AND date(timestamp_servidor) = date('now', '-5 hours') AND empleado_id = ?"
  );

  assert.equal(
    sql,
    "SELECT * FROM registros_asistencia WHERE valido = TRUE AND (timestamp_servidor)::date = (timezone('America/Guayaquil', now()))::date AND empleado_id = $1"
  );
});

test("translates date parameters and case-insensitive SQLite LIKE", () => {
  const sql = postgresSql(
    "SELECT * FROM auditoria WHERE date(creado_en) = date(?) AND usuario_email LIKE ?"
  );

  assert.equal(
    sql,
    "SELECT * FROM auditoria WHERE (creado_en)::date = CAST($1 AS date) AND usuario_email ILIKE $2"
  );
});
