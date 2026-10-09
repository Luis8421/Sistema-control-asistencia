"use strict";

const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

class MigrationError extends Error {}

function isDeferrableConstraint(value) {
  return value === true || value === "YES";
}

const EXPECTED_TABLES = [
  "asistencias",
  "auditoria_log",
  "cargos",
  "configuracion_sistema",
  "departamentos",
  "empleados",
  "empleado_horario",
  "feriados",
  "geocercas",
  "horarios",
  "horario_detalle",
  "incidencias",
  "migrations",
  "notificaciones",
  "refresh_tokens",
  "roles",
  "sedes",
  "tipos_incidencia",
  "usuarios",
];

const REQUIRED_FOREIGN_KEYS = [
  ["asistencias", "empleado_id", "empleados", "id"],
  ["asistencias", "geocerca_id", "geocercas", "id"],
  ["asistencias", "aprobado_por", "usuarios", "id"],
  ["departamentos", "sede_id", "sedes", "id"],
  ["departamentos", "supervisor_id", "empleados", "id"],
  ["empleados", "sede_id", "sedes", "id"],
  ["empleados", "departamento_id", "departamentos", "id"],
  ["empleados", "cargo_id", "cargos", "id"],
  ["empleados", "supervisor_id", "empleados", "id"],
  ["empleado_horario", "empleado_id", "empleados", "id"],
  ["empleado_horario", "horario_id", "horarios", "id"],
  ["empleado_horario", "created_by", "usuarios", "id"],
  ["feriados", "sede_id", "sedes", "id"],
  ["geocercas", "sede_id", "sedes", "id"],
  ["horario_detalle", "horario_id", "horarios", "id"],
  ["incidencias", "empleado_id", "empleados", "id"],
  ["incidencias", "tipo_incidencia_id", "tipos_incidencia", "id"],
  ["incidencias", "revisado_por", "usuarios", "id"],
  ["notificaciones", "usuario_id", "usuarios", "id"],
  ["refresh_tokens", "usuario_id", "usuarios", "id"],
  ["usuarios", "empleado_id", "empleados", "id"],
  ["usuarios", "rol_id", "roles", "id"],
  ["auditoria_log", "usuario_id", "usuarios", "id"],
];

function quoteIdentifier(identifier) {
  if (typeof identifier !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new MigrationError("Identificador SQL no permitido.");
  }
  return `"${identifier.replaceAll('"', '""')}"`;
}

function quoteMysqlIdentifier(identifier) {
  if (typeof identifier !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new MigrationError("Identificador MySQL no permitido.");
  }
  return `\`${identifier.replaceAll("`", "``")}\``;
}

function convertValue(value, sourceType, targetType, sourceColumnType = sourceType) {
  if (value === null || value === undefined) return value;

  const target = String(targetType).toLowerCase();
  const source = String(sourceType).toLowerCase();

  if (target === "boolean") {
    if (source !== "tinyint" || !/^tinyint\(1\)(?:\s|$)/i.test(sourceColumnType)) {
      throw new MigrationError("Solo se convierte TINYINT(1) a PostgreSQL BOOLEAN.");
    }
    if (value === true || value === 1 || value === "1") return true;
    if (value === false || value === 0 || value === "0") return false;
    throw new MigrationError("Valor no binario para una columna PostgreSQL BOOLEAN.");
  }

  if (target === "json" || target === "jsonb") {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      throw new MigrationError("Valor JSON de origen no valido.");
    }
  }

  if (source === "datetime" && (target === "timestamp with time zone" || target === "timestamptz")) {
    throw new MigrationError("DATETIME no tiene zona horaria; requiere una regla de conversion aprobada.");
  }
  if (source === "timestamp" && target !== "timestamp with time zone" && target !== "timestamptz") {
    throw new MigrationError("TIMESTAMP de MySQL debe conservarse como TIMESTAMPTZ con sesion UTC.");
  }

  return value;
}

function orderTables(tableNames, foreignKeys) {
  const included = new Set(tableNames);
  const parents = new Map(tableNames.map((table) => [table, new Set()]));
  const selfReferences = new Set();

  for (const foreignKey of foreignKeys) {
    if (!included.has(foreignKey.tableName) || !included.has(foreignKey.foreignTableName)) continue;
    if (foreignKey.tableName === foreignKey.foreignTableName) {
      selfReferences.add(foreignKey.tableName);
    } else {
      parents.get(foreignKey.tableName).add(foreignKey.foreignTableName);
    }
  }

  const remaining = new Set(tableNames);
  const ordered = [];
  while (remaining.size) {
    const ready = [...remaining]
      .filter((table) => [...parents.get(table)].every((parent) => !remaining.has(parent)))
      .sort();
    if (!ready.length) break;
    for (const table of ready) {
      ordered.push(table);
      remaining.delete(table);
    }
  }

  const cycleTables = new Set([...remaining, ...selfReferences]);
  if (cycleTables.size) {
    const cycleConstraints = foreignKeys.filter(
      (fk) =>
        cycleTables.has(fk.tableName) &&
        cycleTables.has(fk.foreignTableName)
    );
    if (cycleConstraints.some((fk) => fk.isDeferrable !== true)) {
      throw new MigrationError(
        `Hay referencias circulares no diferibles en: ${[...cycleTables].sort().join(", ")}.`
      );
    }
    ordered.push(...[...remaining].sort());
  }

  return { ordered, deferConstraints: cycleTables.size > 0 };
}

function parseArgs(argv) {
  const options = {
    dryRun: true,
    apply: false,
    sourceQuiesced: false,
    confirmedProject: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--apply") {
      options.apply = true;
      options.dryRun = false;
    }
    else if (arg === "--source-quiesced") options.sourceQuiesced = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg.startsWith("--confirm-target-project=")) {
      options.confirmedProject = arg.slice("--confirm-target-project=".length);
    } else if (arg === "--confirm-target-project") {
      options.confirmedProject = argv[++index] || null;
    } else {
      throw new Error(`Opcion desconocida: ${arg}`);
    }
  }

  if (options.apply && argv.includes("--dry-run")) {
    throw new Error("--dry-run y --apply son opciones incompatibles.");
  }
  if (options.apply && !options.sourceQuiesced) {
    throw new Error("--apply requiere --source-quiesced para confirmar que MySQL no recibe escrituras.");
  }
  if (options.apply && options.confirmedProject !== "lhygcctzdxjrevsugllg") {
    throw new Error("--apply requiere --confirm-target-project=lhygcctzdxjrevsugllg.");
  }
  if (!options.apply && options.confirmedProject) {
    throw new Error("--confirm-target-project solo se admite junto con --apply.");
  }
  return options;
}

function printHelp() {
  console.log(`Uso:
  npm run migrate -- --dry-run    Solo lectura: valida esquema, referencias, conteos y orden
  npm run migrate                 Ejecuta el mismo modo de solo lectura
  npm run migrate -- --help       Muestra esta ayuda

El modo --dry-run no ejecuta INSERT, LOCK TABLE ni transacciones.
Solo para una importacion real, tras respaldos y autorizacion explicita:
  npm run migrate -- --apply --source-quiesced \\
    --confirm-target-project=lhygcctzdxjrevsugllg

La importacion exige el esquema PostgreSQL ya preparado por migraciones
versionadas, las 19 tablas destino vacias y credenciales de MySQL de solo lectura.
`);
}

function getPostgresConnectionOptions(apply) {
  return apply
    ? "-c timezone=UTC"
    : "-c default_transaction_read_only=on -c timezone=UTC";
}

function requireEnvironment() {
  const required = [
    "MYSQL_HOST",
    "MYSQL_DATABASE",
    "MYSQL_USER",
    "MYSQL_PASSWORD",
    "DATABASE_URL",
  ];
  const missing = required.filter((key) =>
    key === "MYSQL_PASSWORD" ? process.env[key] === undefined : !process.env[key]
  );
  if (missing.length) {
    throw new MigrationError(`Faltan variables de entorno requeridas: ${missing.join(", ")}.`);
  }
  const schema = process.env.PG_SCHEMA || "public";
  quoteIdentifier(schema);
  return schema;
}

async function getMysqlMetadata(mysql, tableNames) {
  const [tableRows] = await mysql.promise().query(
    `SELECT TABLE_NAME AS tableName, ENGINE AS engine
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`
  );
  const tables = new Map(tableRows.map((row) => [row.tableName, row]));
  const missing = tableNames.filter((table) => !tables.has(table));
  if (missing.length) {
    throw new MigrationError(`Faltan tablas de origen esperadas: ${missing.join(", ")}.`);
  }

  const metadata = new Map();
  for (const table of tableNames) {
    const [columns] = await mysql.promise().query(
      `SELECT COLUMN_NAME AS columnName, DATA_TYPE AS dataType,
              COLUMN_TYPE AS columnType, IS_NULLABLE AS isNullable,
              COLUMN_DEFAULT AS columnDefault, EXTRA AS extra,
              NUMERIC_PRECISION AS numericPrecision,
              NUMERIC_SCALE AS numericScale,
              CHARACTER_MAXIMUM_LENGTH AS characterMaximumLength
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION`,
      [table]
    );
    const [keys] = await mysql.promise().query(
      `SELECT COLUMN_NAME AS columnName
         FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
          AND CONSTRAINT_NAME = 'PRIMARY'
        ORDER BY ORDINAL_POSITION`,
      [table]
    );
    if (!keys.length) throw new MigrationError(`La tabla ${table} no declara clave primaria.`);
    metadata.set(table, {
      ...tables.get(table),
      columns,
      primaryKey: keys.map((key) => key.columnName),
    });
  }
  return metadata;
}

async function getPostgresMetadata(pg, schema, tableNames) {
  const [tableRows, fkRows, triggerRows] = await Promise.all([
    pg.query(
      `SELECT tables.table_name AS "tableName", relations.relrowsecurity AS "rlsEnabled"
         FROM information_schema.tables tables
         JOIN pg_namespace namespaces ON namespaces.nspname = tables.table_schema
         JOIN pg_class relations
           ON relations.relnamespace = namespaces.oid
          AND relations.relname = tables.table_name
        WHERE tables.table_schema = $1 AND tables.table_type = 'BASE TABLE'`,
      [schema]
    ),
    pg.query(
      `SELECT tc.constraint_name AS "constraintName",
              child.relname AS "tableName",
              child_column.attname AS "columnName",
              parent.relname AS "foreignTableName",
              parent_column.attname AS "foreignColumnName",
              key_column.position AS "ordinalPosition",
              con.condeferrable AS "isDeferrable"
         FROM pg_constraint con
         JOIN pg_class child ON child.oid = con.conrelid
         JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
         JOIN pg_class parent ON parent.oid = con.confrelid
         JOIN LATERAL unnest(con.conkey) WITH ORDINALITY
              AS key_column(attnum, position) ON TRUE
         JOIN pg_attribute child_column
           ON child_column.attrelid = child.oid AND child_column.attnum = key_column.attnum
         JOIN pg_attribute parent_column
           ON parent_column.attrelid = parent.oid
          AND parent_column.attnum = con.confkey[key_column.position::integer]
        WHERE child_ns.nspname = $1 AND con.contype = 'f'
        ORDER BY child.relname, con.conname, key_column.position`,
      [schema]
    ),
    pg.query(
      `SELECT event_object_table AS "tableName", trigger_name AS "triggerName"
         FROM information_schema.triggers
        WHERE event_object_schema = $1 AND event_object_table = ANY($2::text[])`,
      [schema, tableNames]
    ),
  ]);

  const tableInfo = new Map(tableRows.rows.map((row) => [row.tableName, row]));
  const available = new Set(tableInfo.keys());
  const missing = tableNames.filter((table) => !available.has(table));
  if (missing.length) {
    throw new MigrationError(
      `El esquema PostgreSQL versionado debe crear primero estas tablas: ${missing.join(", ")}.`
    );
  }
  const rlsMissing = tableNames.filter((table) => !tableInfo.get(table).rlsEnabled);
  if (rlsMissing.length) {
    throw new MigrationError(
      `RLS debe estar habilitado antes de importar tablas publicas: ${rlsMissing.join(", ")}.`
    );
  }
  if (triggerRows.rows.length) {
    throw new MigrationError(
      `Hay triggers en tablas destino; deben revisarse antes de importar: ${triggerRows.rows
        .map((row) => `${row.tableName}.${row.triggerName}`)
        .join(", ")}.`
    );
  }

  const foreignKeysByName = new Map();
  for (const row of fkRows.rows) {
    const key = `${row.tableName}.${row.constraintName}`;
    if (!foreignKeysByName.has(key)) {
      foreignKeysByName.set(key, {
        tableName: row.tableName,
        constraintName: row.constraintName,
        foreignTableName: row.foreignTableName,
        isDeferrable: isDeferrableConstraint(row.isDeferrable),
        columns: [],
        foreignColumns: [],
      });
    }
    const fk = foreignKeysByName.get(key);
    fk.columns.push(row.columnName);
    fk.foreignColumns.push(row.foreignColumnName);
  }

  const metadata = new Map();
  for (const table of tableNames) {
    const [columns, keys, identities] = await Promise.all([
      pg.query(
        `SELECT column_name AS "columnName", data_type AS "dataType",
                udt_name AS "udtName", is_nullable AS "isNullable",
                column_default AS "columnDefault", is_identity AS "isIdentity",
                numeric_precision AS "numericPrecision",
                numeric_scale AS "numericScale",
                character_maximum_length AS "characterMaximumLength"
           FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2
          ORDER BY ordinal_position`,
        [schema, table]
      ),
      pg.query(
        `SELECT kcu.column_name AS "columnName"
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_catalog = kcu.constraint_catalog
            AND tc.constraint_schema = kcu.constraint_schema
            AND tc.constraint_name = kcu.constraint_name
            AND tc.table_name = kcu.table_name
          WHERE tc.table_schema = $1 AND tc.table_name = $2
            AND tc.constraint_type = 'PRIMARY KEY'
          ORDER BY kcu.ordinal_position`,
        [schema, table]
      ),
      pg.query(
        `SELECT column_name AS "columnName"
           FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2 AND is_identity = 'YES'`,
        [schema, table]
      ),
    ]);
    if (!columns.rows.length) throw new MigrationError(`No se encontraron columnas destino para ${table}.`);
    if (!keys.rows.length) throw new MigrationError(`La tabla destino ${table} no declara clave primaria.`);
    metadata.set(table, {
      columns: columns.rows,
      primaryKey: keys.rows.map((key) => key.columnName),
      identityColumns: identities.rows.map((column) => column.columnName),
    });
  }

  return { tables: metadata, foreignKeys: [...foreignKeysByName.values()] };
}

function validateColumnCompatibility(table, source, target) {
  const sourceByName = new Map(source.columns.map((column) => [column.columnName, column]));
  const targetByName = new Map(target.columns.map((column) => [column.columnName, column]));
  const missing = [...sourceByName.keys()].filter((column) => !targetByName.has(column));
  if (missing.length) {
    throw new MigrationError(`${table}: faltan columnas destino: ${missing.join(", ")}.`);
  }
  const extraRequired = target.columns
    .filter(
      (column) =>
        !sourceByName.has(column.columnName) &&
        column.isNullable === "NO" &&
        column.columnDefault === null &&
        column.isIdentity !== "YES"
    )
    .map((column) => column.columnName);
  if (extraRequired.length) {
    throw new MigrationError(
      `${table}: columnas destino NOT NULL sin valor de origen ni DEFAULT: ${extraRequired.join(", ")}.`
    );
  }
  for (const [columnName, sourceColumn] of sourceByName) {
    const targetColumn = targetByName.get(columnName);
    if (!isColumnTypeCompatible(sourceColumn, targetColumn)) {
      throw new MigrationError(
        `${table}.${columnName}: tipo MySQL ${sourceColumn.columnType} incompatible con PostgreSQL ${targetColumn.dataType}.`
      );
    }
  }
  if (
    source.primaryKey.length !== target.primaryKey.length ||
    source.primaryKey.some((column, index) => column !== target.primaryKey[index])
  ) {
    throw new MigrationError(`${table}: las claves primarias MySQL/PostgreSQL no coinciden en nombre y orden.`);
  }
}

function validateExpectedForeignKeys(foreignKeys) {
  const actual = new Set(
    foreignKeys.flatMap((fk) =>
      fk.columns.map((column, index) =>
        [fk.tableName, column, fk.foreignTableName, fk.foreignColumns[index]].join(".")
      )
    )
  );
  const missing = REQUIRED_FOREIGN_KEYS.filter(
    ([table, column, parent, parentColumn]) =>
      !actual.has([table, column, parent, parentColumn].join("."))
  );
  if (missing.length) {
    throw new MigrationError(
      `Faltan claves foraneas requeridas en PostgreSQL: ${missing
        .map(([table, column, parent, parentColumn]) => `${table}.${column}->${parent}.${parentColumn}`)
        .join(", ")}.`
    );
  }
}

async function validateNoNullViolations(mysql, sourceMetadata, targetMetadata) {
  for (const table of EXPECTED_TABLES) {
    const sourceColumns = new Map(
      sourceMetadata.get(table).columns.map((column) => [column.columnName, column])
    );
    for (const targetColumn of targetMetadata.get(table).columns) {
      const sourceColumn = sourceColumns.get(targetColumn.columnName);
      if (!sourceColumn || targetColumn.isNullable !== "NO" || sourceColumn.isNullable !== "YES") {
        continue;
      }
      const [result] = await mysql.promise().query(
        `SELECT COUNT(*) AS total FROM ${quoteMysqlIdentifier(table)}
          WHERE ${quoteMysqlIdentifier(targetColumn.columnName)} IS NULL`
      );
      if (Number(result[0].total) > 0) {
        throw new MigrationError(
          `${table}.${targetColumn.columnName}: hay filas NULL que no caben en la columna NOT NULL destino.`
        );
      }
    }
  }
}

function isColumnTypeCompatible(source, target) {
  const sourceType = String(source.dataType).toLowerCase();
  const sourceDefinition = String(source.columnType).toLowerCase();
  const targetType = String(target.dataType).toLowerCase();

  const allowed = {
    tinyint: ["smallint", "integer", "bigint", "numeric", "boolean"],
    smallint: ["smallint", "integer", "bigint", "numeric"],
    mediumint: ["integer", "bigint", "numeric"],
    int: ["integer", "bigint", "numeric"],
    integer: ["integer", "bigint", "numeric"],
    bigint: ["bigint", "numeric"],
    decimal: ["numeric"],
    numeric: ["numeric"],
    float: ["real", "double precision", "numeric"],
    double: ["double precision", "numeric"],
    date: ["date"],
    time: ["time without time zone"],
    datetime: ["timestamp without time zone"],
    timestamp: ["timestamp with time zone"],
    json: ["json", "jsonb"],
    char: ["character", "character varying", "text"],
    varchar: ["character", "character varying", "text"],
    tinytext: ["character", "character varying", "text"],
    text: ["character", "character varying", "text"],
    mediumtext: ["character", "character varying", "text"],
    longtext: ["character", "character varying", "text"],
    enum: ["character", "character varying", "text", "user-defined"],
  };
  if (sourceType === "tinyint" && targetType === "boolean") {
    return /^tinyint\(1\)(?:\s|$)/i.test(sourceDefinition);
  }
  const targetAllowed = allowed[sourceType];
  if (!targetAllowed?.includes(targetType)) return false;

  if (["decimal", "numeric"].includes(sourceType) && targetType === "numeric") {
    const sourcePrecision = Number(source.numericPrecision);
    const sourceScale = Number(source.numericScale || 0);
    const targetPrecision = target.numericPrecision === null ? null : Number(target.numericPrecision);
    const targetScale = target.numericScale === null ? null : Number(target.numericScale);
    if (targetPrecision !== null && targetPrecision < sourcePrecision) return false;
    if (targetScale !== null && targetScale < sourceScale) return false;
  }
  if (["char", "varchar"].includes(sourceType) && targetType !== "text") {
    const sourceLength = Number(source.characterMaximumLength);
    const targetLength =
      target.characterMaximumLength === null ? null : Number(target.characterMaximumLength);
    if (targetLength !== null && targetLength < sourceLength) return false;
  }
  return true;
}

async function validateNoOrphans(mysql, schema, foreignKeys) {
  for (const fk of foreignKeys) {
    if (!EXPECTED_TABLES.includes(fk.tableName) || !EXPECTED_TABLES.includes(fk.foreignTableName)) {
      continue;
    }
    const child = quoteMysqlIdentifier(fk.tableName);
    const parent = quoteMysqlIdentifier(fk.foreignTableName);
    const join = fk.columns
      .map(
        (column, index) =>
          `p.${quoteMysqlIdentifier(fk.foreignColumns[index])} = c.${quoteMysqlIdentifier(column)}`
      )
      .join(" AND ");
    const nonNull = fk.columns.map((column) => `c.${quoteMysqlIdentifier(column)} IS NOT NULL`).join(" AND ");
    const [result] = await mysql.promise().query(
      `SELECT COUNT(*) AS total FROM ${child} c
        LEFT JOIN ${parent} p ON ${join}
       WHERE ${nonNull} AND p.${quoteMysqlIdentifier(fk.foreignColumns[0])} IS NULL`
    );
    if (Number(result[0].total) > 0) {
      throw new MigrationError(
        `Se detectaron ${result[0].total} referencias de origen sin padre en ${fk.tableName}.${fk.columns.join(",")}.`
      );
    }
  }
}

async function prepareTableCounts(mysql, pg, schema, tableNames, sourceMetadata) {
  const counts = new Map();
  for (const table of tableNames) {
    const quotedMysql = quoteMysqlIdentifier(table);
    const [sourceRows] = await mysql.promise().query(`SELECT COUNT(*) AS total FROM ${quotedMysql}`);
    if (!Number.isSafeInteger(sourceRows[0].total)) {
      throw new MigrationError(`El conteo de origen para ${table} supera el rango seguro de JavaScript.`);
    }
    const targetResult = await pg.query(
      `SELECT COUNT(*)::text AS total FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)}`
    );
    const targetRows = BigInt(targetResult.rows[0].total);
    if (targetRows !== 0n) {
      throw new MigrationError(
        `La tabla destino ${table} no esta vacia (${targetRows} filas); la migracion requiere tablas vacias.`
      );
    }
    counts.set(table, {
      sourceRows: Number(sourceRows[0].total),
      targetBefore: Number(targetRows),
      engine: sourceMetadata.get(table).engine,
    });
  }
  return counts;
}

async function runReadOnlyDryRun(
  mysql,
  pg,
  schema,
  sourceMetadata,
  targetMetadata,
  foreignKeys,
  tableNames = EXPECTED_TABLES
) {
  validateExpectedForeignKeys(foreignKeys);
  const { ordered, deferConstraints } = orderTables(tableNames, foreignKeys);
  await validateNoOrphans(mysql, schema, foreignKeys);
  await validateNoNullViolations(mysql, sourceMetadata, targetMetadata);

  const counts = await prepareTableCounts(mysql, pg, schema, tableNames, sourceMetadata);
  const validatedRows = await validateSourceRows(mysql, sourceMetadata, targetMetadata, ordered);
  for (const table of ordered) {
    if (counts.get(table).sourceRows !== validatedRows.get(table)) {
      throw new MigrationError(
        `El conteo de origen cambio durante la lectura de ${table}; repite la validacion con el origen detenido.`
      );
    }
  }

  return { ordered, deferConstraints, counts, validatedRows };
}

async function validateSourceRows(mysql, sourceMetadata, targetMetadata, ordered) {
  const validatedRows = new Map();
  for (const table of ordered) {
    const metadata = sourceMetadata.get(table);
    let rowNumber = 0;
    const stream = mysql
      .query(
        `SELECT * FROM ${quoteMysqlIdentifier(table)} ` +
          `ORDER BY ${metadata.primaryKey.map(quoteMysqlIdentifier).join(", ")}`
      )
      .stream({ highWaterMark: 32 });

    for await (const row of stream) {
      rowNumber++;
      try {
        transformRow(table, row, metadata, targetMetadata.get(table));
      } catch (error) {
        throw new MigrationError(
          `${table}, fila ${rowNumber}: ${error.message || "valor incompatible."}`
        );
      }
    }
    validatedRows.set(table, rowNumber);
  }
  return validatedRows;
}

function transformRow(table, row, sourceMetadata, targetMetadata) {
  const sourceColumns = new Map(sourceMetadata.columns.map((column) => [column.columnName, column]));
  const targetColumns = new Map(targetMetadata.columns.map((column) => [column.columnName, column]));
  const transformed = {};
  for (const [column, value] of Object.entries(row)) {
    const source = sourceColumns.get(column);
    const target = targetColumns.get(column);
    transformed[column] = convertValue(value, source.dataType, target.dataType, source.columnType);
  }
  return transformed;
}

async function syncIdentitySequences(pg, schema, tableNames, metadata) {
  for (const table of tableNames) {
    for (const column of metadata.get(table).identityColumns) {
      const sequence = await pg.query(
        "SELECT pg_get_serial_sequence($1, $2) AS sequence",
        [`${schema}.${table}`, column]
      );
      if (!sequence.rows[0].sequence) continue;
      const max = await pg.query(
        `SELECT MAX(${quoteIdentifier(column)})::text AS maximum
           FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)}`
      );
      if (max.rows[0].maximum === null) continue;
      await pg.query("SELECT setval($1::regclass, $2::bigint, true)", [
        sequence.rows[0].sequence,
        max.rows[0].maximum,
      ]);
    }
  }
}

function writeReport(report) {
  const reportPath = path.resolve(
    process.cwd(),
    `migration-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  return reportPath;
}

async function migrate(options) {
  const schema = requireEnvironment();
  const mysql2 = require("mysql2");
  const { Pool } = require("pg");
  const mysql = mysql2.createPool({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    database: process.env.MYSQL_DATABASE,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    connectionLimit: 1,
    charset: "utf8mb4",
    timezone: process.env.MYSQL_TIME_ZONE || "+00:00",
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: false,
  });
  const pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    options: getPostgresConnectionOptions(options.apply),
  });

  const report = {
    startedAt: new Date().toISOString(),
    mode: options.apply ? "apply" : "read-only-dry-run",
    sourceDatabase: process.env.MYSQL_DATABASE,
    targetSchema: schema,
    orderedTables: [],
    deferredConstraints: false,
    tables: [],
    status: "preflight",
    error: null,
  };
  let pgClient;
  let transactionOpen = false;
  let activeTable = null;
  let activeRow = null;

  try {
    await mysql.promise().query("SET SESSION time_zone = ?", [
      process.env.MYSQL_TIME_ZONE || "+00:00",
    ]);
    const sourceMetadata = await getMysqlMetadata(mysql, EXPECTED_TABLES);
    pgClient = await pgPool.connect();
    const { tables: targetMetadata, foreignKeys } = await getPostgresMetadata(
      pgClient,
      schema,
      EXPECTED_TABLES
    );

    for (const table of EXPECTED_TABLES) {
      validateColumnCompatibility(table, sourceMetadata.get(table), targetMetadata.get(table));
    }
    const { ordered, deferConstraints } = orderTables(EXPECTED_TABLES, foreignKeys);
    report.orderedTables = ordered;
    report.deferredConstraints = deferConstraints;

    if (!options.apply) {
      report.status = "validating-read-only";
      const dryRun = await runReadOnlyDryRun(
        mysql,
        pgClient,
        schema,
        sourceMetadata,
        targetMetadata,
        foreignKeys
      );
      report.orderedTables = dryRun.ordered;
      report.deferredConstraints = dryRun.deferConstraints;
      report.tables = dryRun.ordered.map((table) => ({
        table,
        sourceRows: dryRun.counts.get(table).sourceRows,
        targetRows: Number(dryRun.counts.get(table).targetBefore),
        validatedRows: dryRun.validatedRows.get(table),
        engine: dryRun.counts.get(table).engine,
      }));
      report.status = "read-only-dry-run-passed";
      console.log(`Orden de migracion: ${ordered.join(" -> ")}`);
      console.log(
        `Conteos validados en modo de solo lectura: ${report.tables
          .map((table) => `${table.table}=${table.sourceRows}`)
          .join(", ")}`
      );
      return;
    }

    validateExpectedForeignKeys(foreignKeys);
    await validateNoOrphans(mysql, schema, foreignKeys);
    await validateNoNullViolations(mysql, sourceMetadata, targetMetadata);
    report.status = "loading";
    await pgClient.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    transactionOpen = true;
    const targetTables = EXPECTED_TABLES.map(
      (table) => `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`
    ).join(", ");
    await pgClient.query(`LOCK TABLE ${targetTables} IN ACCESS EXCLUSIVE MODE`);
    const counts = await prepareTableCounts(
      mysql,
      pgClient,
      schema,
      EXPECTED_TABLES,
      sourceMetadata
    );
    report.tables = ordered.map((table) => ({
      table,
      sourceRows: counts.get(table).sourceRows,
      targetBefore: counts.get(table).targetBefore,
      engine: counts.get(table).engine,
      inserted: 0,
      skipped: 0,
      failed: 0,
    }));
    if (deferConstraints) await pgClient.query("SET CONSTRAINTS ALL DEFERRED");

    for (const table of ordered) {
      activeTable = table;
      activeRow = 0;
      const sourceColumns = sourceMetadata.get(table).columns;
      const columnNames = sourceColumns.map((column) => column.columnName);
      const identityClause = targetMetadata.get(table).identityColumns.length
        ? " OVERRIDING SYSTEM VALUE"
        : "";
      const insertSql =
        `INSERT INTO ${quoteIdentifier(schema)}.${quoteIdentifier(table)} ` +
        `(${columnNames.map(quoteIdentifier).join(", ")})${identityClause} VALUES ` +
        `(${columnNames.map((_, index) => `$${index + 1}`).join(", ")})`;
      const stream = mysql
        .query(
          `SELECT * FROM ${quoteMysqlIdentifier(table)} ` +
            `ORDER BY ${sourceMetadata.get(table).primaryKey.map(quoteMysqlIdentifier).join(", ")}`
        )
        .stream({ highWaterMark: 32 });

      for await (const sourceRow of stream) {
        activeRow++;
        const row = transformRow(table, sourceRow, sourceMetadata.get(table), targetMetadata.get(table));
        await pgClient.query(insertSql, columnNames.map((column) => row[column]));
        report.tables.find((item) => item.table === table).inserted++;
      }
      if (activeRow !== counts.get(table).sourceRows) {
        throw new MigrationError(
          `El conteo de origen cambio durante la lectura de ${table}; no se confirma la transaccion.`
        );
      }
    }

    for (const table of ordered) {
      const result = await pgClient.query(
        `SELECT COUNT(*)::text AS total FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)}`
      );
      const actual = Number(result.rows[0].total);
      const expected = counts.get(table).sourceRows;
      if (actual !== expected) {
        throw new MigrationError(`La reconciliacion de conteos fallo para ${table}.`);
      }
    }

    if (options.apply) {
      await syncIdentitySequences(pgClient, schema, ordered, targetMetadata);
      await pgClient.query("COMMIT");
      report.status = "committed";
    } else {
      await pgClient.query("ROLLBACK");
      report.status = "dry-run-rolled-back";
    }
    transactionOpen = false;
  } catch (error) {
    if (pgClient && transactionOpen) {
      try {
        await pgClient.query("ROLLBACK");
      } catch {
        report.error = { code: "ROLLBACK_FAILED" };
      }
    }
    report.status = "failed";
    report.error = {
      ...(report.error || {}),
      table: activeTable,
      sourceRow: activeRow,
      code: error.code || "MIGRATION_ERROR",
      message:
        error instanceof MigrationError
          ? error.message
          : "Operacion de base de datos fallida; revisar los logs privados sin compartirlos.",
    };
    if (activeTable) {
      const failedTable = report.tables.find((item) => item.table === activeTable);
      if (failedTable) failedTable.failed++;
    }
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    const reportPath = writeReport(report);
    console.log(`Reporte de migracion (sin valores de filas): ${reportPath}`);
    if (pgClient) pgClient.release();
    await Promise.allSettled([mysql.promise().end(), pgPool.end()]);
  }
}

if (require.main === module) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
    } else {
      migrate(options)
        .then(() => {
          console.log(
            options.apply
              ? "Importacion completada y confirmada."
              : "Simulacion completada; PostgreSQL fue revertido."
          );
        })
          .catch((error) => {
            const message =
              error instanceof MigrationError
                ? error.message
                : "Operacion de base de datos fallida; revisar los logs privados sin compartirlos.";
            console.error(`Migracion cancelada: ${message}`);
            process.exitCode = 1;
          });
    }
  } catch (error) {
    console.error(`Migracion cancelada: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  EXPECTED_TABLES,
  convertValue,
  getPostgresConnectionOptions,
  isDeferrableConstraint,
  isColumnTypeCompatible,
  orderTables,
  parseArgs,
  REQUIRED_FOREIGN_KEYS,
  requireEnvironment,
  validateColumnCompatibility,
  validateExpectedForeignKeys,
  runReadOnlyDryRun,
  validateSourceRows,
};
