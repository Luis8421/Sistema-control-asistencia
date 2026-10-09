require("dotenv").config();
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const db = require("./connection");

const tables = [
  { name: "bodegas", key: ["id"] },
  { name: "empleados", key: ["id"] },
  { name: "registros_asistencia", key: ["id"], preserveRowOrder: true },
  { name: "auditoria", key: ["id"] },
  { name: "empleado_bodegas", key: ["empleado_id", "bodega_id"] },
];
const boolColumns = {
  bodegas: ["activo"],
  empleados: ["activo", "autorizado_todas_bodegas"],
  registros_asistencia: ["valido"],
};

function buildInsert(table, columns) {
  const names = columns.map((column) => `"${column}"`).join(", ");
  const values = columns.map((_, index) => `$${index + 1}`).join(", ");
  return `INSERT INTO "${table.name}" (${names}) VALUES (${values}) ON CONFLICT DO NOTHING`;
}

function normalizeRow(tableName, row) {
  return Object.fromEntries(
    Object.entries(row).map(([column, value]) => [
      column,
      boolColumns[tableName]?.includes(column) && value !== null ? Boolean(value) : value,
    ])
  );
}

async function main() {
  if (!db.isPostgres) {
    throw new Error("Define DATABASE_URL para migrar datos hacia PostgreSQL.");
  }

  const sourcePath = process.argv[2];
  if (!sourcePath) {
    throw new Error("Indica la ruta de una base SQLite (preferiblemente una copia de prueba).");
  }
  const dryRun = process.argv.includes("--dry-run");
  const absoluteSourcePath = path.resolve(sourcePath);
  const source = new Database(absoluteSourcePath, { readonly: true, fileMustExist: true });
  const errors = [];
  const summary = [];
  let client;
  let transactionStarted = false;

  try {
    const integrity = source.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") throw new Error(`La base SQLite no paso integrity_check: ${integrity}`);

    const foreignKeyErrors = source.pragma("foreign_key_check");
    if (foreignKeyErrors.length) {
      throw new Error(`La base SQLite tiene ${foreignKeyErrors.length} referencias foraneas invalidas.`);
    }

    client = await db.pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;

    for (const table of tables) {
      const orderBy = table.preserveRowOrder ? "rowid" : table.key.map((column) => `"${column}"`).join(", ");
      const select = table.preserveRowOrder
        ? `SELECT rowid AS orden, * FROM "${table.name}" ORDER BY rowid`
        : `SELECT * FROM "${table.name}" ORDER BY ${orderBy}`;
      const sourceRows = source.prepare(select).all();
      let inserted = 0;
      let alreadyPresent = 0;
      let verified = 0;

      for (let index = 0; index < sourceRows.length; index++) {
        const row = normalizeRow(table.name, sourceRows[index]);
        const columns = Object.keys(row);
        const savepoint = `row_${tables.indexOf(table)}_${index}`;
        await client.query(`SAVEPOINT ${savepoint}`);
        try {
          const result = await client.query(
            buildInsert(table, columns),
            columns.map((column) => row[column])
          );
          const keyWhere = table.key.map((column, keyIndex) => `"${column}" = $${keyIndex + 1}`).join(" AND ");
          const existing = await client.query(
            `SELECT 1 FROM "${table.name}" WHERE ${keyWhere}`,
            table.key.map((column) => row[column])
          );
          if (existing.rowCount === 0) {
            throw new Error("La fila no aparece en el destino despues del INSERT.");
          }
          if (result.rowCount === 1) inserted++;
          else alreadyPresent++;
          verified++;
          await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        } catch (error) {
          await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          await client.query(`RELEASE SAVEPOINT ${savepoint}`);
          errors.push({
            table: table.name,
            sourceRow: index + 1,
            code: error.code || null,
            message: error.message,
          });
        }
      }

      const targetCount = await client.query(`SELECT COUNT(*)::bigint AS total FROM "${table.name}"`);
      summary.push({
        table: table.name,
        sourceRows: sourceRows.length,
        inserted,
        alreadyPresent,
        verified,
        failed: errors.filter((item) => item.table === table.name).length,
        targetRows: Number(targetCount.rows[0].total),
      });
    }

    if (dryRun) {
      await client.query("ROLLBACK");
      transactionStarted = false;
    } else {
      await client.query("COMMIT");
      transactionStarted = false;
      await client.query(`
        SELECT setval(
          pg_get_serial_sequence('public.registros_asistencia', 'orden'),
          GREATEST(COALESCE((SELECT MAX(orden) FROM public.registros_asistencia), 1), 1),
          EXISTS(SELECT 1 FROM public.registros_asistencia)
        )
      `);
    }

    const report = {
      source: path.basename(absoluteSourcePath),
      dryRun,
      finishedAt: new Date().toISOString(),
      tables: summary,
      errors,
    };
    const reportPath = path.join(process.cwd(), `migration-report-${Date.now()}.json`);
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify({ ...report, source: path.basename(absoluteSourcePath), errors: errors.length }, null, 2));
    console.log(`Reporte (sin datos de filas): ${reportPath}`);

    if (errors.length) process.exitCode = 2;
  } finally {
    if (transactionStarted) await client.query("ROLLBACK");
    if (client) client.release();
    source.close();
    await db.pool.end();
  }
}

main().catch((error) => {
  console.error("No se pudo completar la migracion de datos:", error.message);
  process.exitCode = 1;
});
