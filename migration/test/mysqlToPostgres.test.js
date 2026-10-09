"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const {
  EXPECTED_TABLES,
  convertValue,
  getPostgresConnectionOptions,
  isDeferrableConstraint,
  isColumnTypeCompatible,
  orderTables,
  parseArgs,
  REQUIRED_FOREIGN_KEYS,
  requireEnvironment,
  runReadOnlyDryRun,
  validateExpectedForeignKeys,
  validateSourceRows,
} = require("../mysqlToPostgres");

test("allows an explicitly empty MySQL password while requiring the variable", () => {
  const keys = [
    "MYSQL_HOST",
    "MYSQL_DATABASE",
    "MYSQL_USER",
    "MYSQL_PASSWORD",
    "DATABASE_URL",
  ];
  const originalValues = new Map(keys.map((key) => [key, process.env[key]]));

  try {
    process.env.MYSQL_HOST = "localhost";
    process.env.MYSQL_DATABASE = "source";
    process.env.MYSQL_USER = "root";
    process.env.MYSQL_PASSWORD = "";
    process.env.DATABASE_URL = "postgres://localhost/target";

    assert.equal(requireEnvironment(), "public");
    delete process.env.MYSQL_PASSWORD;
    assert.throws(() => requireEnvironment(), /MYSQL_PASSWORD/);
  } finally {
    for (const [key, value] of originalValues) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("allows only the inspected 19 source tables", () => {
  assert.equal(EXPECTED_TABLES.length, 19);
  assert.ok(EXPECTED_TABLES.includes("asistencias"));
  assert.ok(EXPECTED_TABLES.includes("usuarios"));
});

test("converts only valid zero/one values for PostgreSQL booleans", () => {
  assert.equal(convertValue(1, "tinyint", "boolean", "tinyint(1)"), true);
  assert.equal(convertValue("0", "tinyint", "boolean", "tinyint(1) unsigned"), false);
  assert.equal(convertValue(null, "tinyint", "boolean", "tinyint(1)"), null);
  assert.throws(() => convertValue(2, "tinyint", "boolean", "tinyint(1)"), /no binario/);
  assert.throws(() => convertValue(1, "tinyint", "boolean", "tinyint unsigned"), /Solo se convierte/);
});

test("checks narrowing-sensitive numeric and text types", () => {
  assert.equal(
    isColumnTypeCompatible(
      { dataType: "decimal", numericPrecision: 10, numericScale: 7 },
      { dataType: "numeric", numericPrecision: 12, numericScale: 7 }
    ),
    true
  );
  assert.equal(
    isColumnTypeCompatible(
      { dataType: "decimal", numericPrecision: 10, numericScale: 7 },
      { dataType: "numeric", numericPrecision: 9, numericScale: 6 }
    ),
    false
  );
  assert.equal(
    isColumnTypeCompatible(
      { dataType: "varchar", characterMaximumLength: 150 },
      { dataType: "character varying", characterMaximumLength: 100 }
    ),
    false
  );
});

test("parses JSON and rejects malformed JSON", () => {
  assert.deepEqual(convertValue('{"ok":true}', "json", "jsonb"), { ok: true });
  assert.throws(() => convertValue("{", "json", "jsonb"), /JSON de origen/);
});

test("does not guess a timezone for MySQL DATETIME", () => {
  assert.equal(
    convertValue("2026-10-09 08:00:00", "datetime", "timestamp without time zone"),
    "2026-10-09 08:00:00"
  );
  assert.throws(
    () => convertValue("2026-10-09 08:00:00", "datetime", "timestamp with time zone"),
    /no tiene zona horaria/
  );
});

test("recognizes PostgreSQL catalog booleans for deferrable constraints", () => {
  assert.equal(isDeferrableConstraint(true), true);
  assert.equal(isDeferrableConstraint(false), false);
  assert.equal(isDeferrableConstraint("YES"), true);
  assert.equal(isDeferrableConstraint("NO"), false);
});

test("orders parent tables before child tables", () => {
  const result = orderTables(["child", "parent"], [
    {
      tableName: "child",
      foreignTableName: "parent",
      isDeferrable: false,
    },
  ]);
  assert.deepEqual(result, { ordered: ["parent", "child"], deferConstraints: false });
});

test("requires deferrable constraints for circular relationships", () => {
  assert.throws(
    () =>
      orderTables(["departamentos", "empleados"], [
        { tableName: "departamentos", foreignTableName: "empleados", isDeferrable: false },
        { tableName: "empleados", foreignTableName: "departamentos", isDeferrable: false },
      ]),
    /circulares no diferibles/
  );
  const result = orderTables(["departamentos", "empleados"], [
    { tableName: "departamentos", foreignTableName: "empleados", isDeferrable: true },
    { tableName: "empleados", foreignTableName: "departamentos", isDeferrable: true },
  ]);
  assert.equal(result.deferConstraints, true);
});

test("requires the reviewed parent/child foreign keys in destination schema", () => {
  const required = REQUIRED_FOREIGN_KEYS.map(([tableName, column, foreignTableName, foreignColumn]) => ({
    tableName,
    columns: [column],
    foreignTableName,
    foreignColumns: [foreignColumn],
  }));
  assert.doesNotThrow(() => validateExpectedForeignKeys(required));
  assert.throws(() => validateExpectedForeignKeys([]), /Faltan claves foraneas/);
});

test("requires the five confirmed foreign keys and the deferrable employee-department cycle", () => {
  const confirmed = [
    ["departamentos", ["supervisor_id"], "empleados", ["id"]],
    ["empleados", ["supervisor_id"], "empleados", ["id"]],
    ["empleado_horario", ["created_by"], "usuarios", ["id"]],
    ["asistencias", ["aprobado_por"], "usuarios", ["id"]],
    ["incidencias", ["revisado_por"], "usuarios", ["id"]],
  ];
  for (const [table, columns, foreignTableName, foreignColumns] of confirmed) {
    assert.ok(
      REQUIRED_FOREIGN_KEYS.some(
        ([requiredTable, requiredColumn, requiredParent, requiredParentColumn]) =>
          requiredTable === table &&
          columns.length === 1 &&
          requiredColumn === columns[0] &&
          requiredParent === foreignTableName &&
          requiredParentColumn === foreignColumns[0]
      ),
      `Missing required foreign key ${table}.${columns[0]}`
    );
  }

  const result = orderTables(["departamentos", "empleados"], [
    { tableName: "departamentos", foreignTableName: "empleados", isDeferrable: true },
    { tableName: "empleados", foreignTableName: "departamentos", isDeferrable: true },
    { tableName: "empleados", foreignTableName: "empleados", isDeferrable: true },
  ]);
  assert.deepEqual(result.ordered, ["departamentos", "empleados"]);
  assert.equal(result.deferConstraints, true);
});

test("apply mode requires source quiescence and exact target confirmation", () => {
  assert.throws(() => parseArgs(["--apply"]), /--source-quiesced/);
  assert.throws(
    () => parseArgs(["--apply", "--source-quiesced"]),
    /--confirm-target-project/
  );
  assert.deepEqual(
    parseArgs([
      "--apply",
      "--source-quiesced",
      "--confirm-target-project=lhygcctzdxjrevsugllg",
    ]),
    {
      dryRun: false,
      apply: true,
      sourceQuiesced: true,
      confirmedProject: "lhygcctzdxjrevsugllg",
      help: false,
    }
  );
});

test("defaults to read-only dry-run and rejects combining dry-run with apply", () => {
  assert.deepEqual(parseArgs([]), {
    dryRun: true,
    apply: false,
    sourceQuiesced: false,
    confirmedProject: null,
    help: false,
  });
  assert.equal(parseArgs(["--dry-run"]).dryRun, true);
  assert.throws(
    () =>
      parseArgs([
        "--dry-run",
        "--apply",
        "--source-quiesced",
        "--confirm-target-project=lhygcctzdxjrevsugllg",
      ]),
    /son opciones incompatibles/
  );
});

test("forces PostgreSQL read-only transactions for dry-run connections", () => {
  assert.equal(
    getPostgresConnectionOptions(false),
    "-c default_transaction_read_only=on -c timezone=UTC"
  );
  assert.equal(getPostgresConnectionOptions(true), "-c timezone=UTC");
});

test("read-only row validation streams rows and catches conversion failures", async () => {
  const sourceMetadata = new Map([
    [
      "flags",
      {
        columns: [
          { columnName: "id", dataType: "bigint", columnType: "bigint unsigned" },
          { columnName: "active", dataType: "tinyint", columnType: "tinyint(1)" },
        ],
        primaryKey: ["id"],
      },
    ],
  ]);
  const targetMetadata = new Map([
    [
      "flags",
      {
        columns: [
          { columnName: "id", dataType: "bigint" },
          { columnName: "active", dataType: "boolean" },
        ],
      },
    ],
  ]);
  const mysql = {
    query(sql) {
      assert.match(sql, /^SELECT \* FROM `flags` ORDER BY `id`$/);
      return { stream: () => Readable.from([{ id: "1", active: 1 }, { id: "2", active: 0 }]) };
    },
  };

  const validated = await validateSourceRows(mysql, sourceMetadata, targetMetadata, ["flags"]);
  assert.equal(validated.get("flags"), 2);

  const invalidMysql = {
    query() {
      return { stream: () => Readable.from([{ id: "1", active: 3 }]) };
    },
  };
  await assert.rejects(
    validateSourceRows(invalidMysql, sourceMetadata, targetMetadata, ["flags"]),
    /flags, fila 1: Valor no binario/
  );
});

test("read-only dry-run validation issues only SELECT statements", async () => {
  const tables = EXPECTED_TABLES;
  const sourceMetadata = new Map(
    tables.map((table) => [
      table,
      {
        columns: [
          {
            columnName: "id",
            dataType: "bigint",
            columnType: "bigint unsigned",
            isNullable: "NO",
          },
        ],
        primaryKey: ["id"],
        engine: "MyISAM",
      },
    ])
  );
  const targetMetadata = new Map(
    tables.map((table) => [
      table,
      {
        columns: [
          {
            columnName: "id",
            dataType: "bigint",
            isNullable: "NO",
            columnDefault: null,
            isIdentity: "YES",
          },
        ],
        primaryKey: ["id"],
      },
    ])
  );
  const foreignKeys = REQUIRED_FOREIGN_KEYS.map(
    ([tableName, column, foreignTableName, foreignColumn]) => ({
      tableName,
      columns: [column],
      foreignTableName,
      foreignColumns: [foreignColumn],
      isDeferrable: true,
    })
  );
  const mysqlStatements = [];
  const pgStatements = [];
  const mysql = {
    promise() {
      return {
        async query(sql) {
          mysqlStatements.push(sql);
          return [[{ total: 0 }], []];
        },
      };
    },
    query(sql) {
      mysqlStatements.push(sql);
      return { stream: () => Readable.from([]) };
    },
  };
  const pg = {
    async query(sql) {
      pgStatements.push(sql);
      return { rows: [{ total: "0" }] };
    },
  };

  const result = await runReadOnlyDryRun(
    mysql,
    pg,
    "public",
    sourceMetadata,
    targetMetadata,
    foreignKeys
  );

  assert.equal(result.ordered.length, 19);
  assert.equal(result.counts.get("empleados").sourceRows, 0);
  assert.ok(mysqlStatements.every((sql) => /^\s*SELECT\b/i.test(sql)));
  assert.ok(pgStatements.every((sql) => /^\s*SELECT\b/i.test(sql)));
  assert.doesNotMatch([...mysqlStatements, ...pgStatements].join("\n"), /\b(INSERT|UPDATE|DELETE|LOCK|BEGIN|COMMIT|ROLLBACK)\b/i);
});
