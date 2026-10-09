require("dotenv").config();
const fs = require("fs");
const path = require("path");
const db = require("./connection");

async function main() {
  if (!db.isPostgres) {
    throw new Error("Define DATABASE_URL para aplicar la migracion PostgreSQL.");
  }

  const schemaPath = path.join(__dirname, "schema.postgres.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(schemaSql);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await db.pool.end();
  }

  console.log("Esquema PostgreSQL aplicado correctamente.");
}

main().catch((error) => {
  console.error("No se pudo aplicar el esquema PostgreSQL:", error.message);
  process.exitCode = 1;
});
