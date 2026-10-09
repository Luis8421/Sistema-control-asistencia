const path = require("path");
const { postgresSql } = require("./sqlDialect");

const isPostgres = Boolean(process.env.DATABASE_URL);

let sqlite;
let pool;

if (isPostgres) {
  const { Pool, types } = require("pg");

  // Keep timestamp-without-time-zone values as strings. The application
  // stores Ecuador wall-clock time and must not apply the host's local TZ.
  types.setTypeParser(1114, (value) => value);
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    options: "-c timezone=America/Guayaquil",
  });
  pool.on("error", (error) => {
    console.error("Error inesperado en el pool PostgreSQL:", error.message);
  });
} else {
  const Database = require("better-sqlite3");
  const dbPath = process.env.DATABASE_PATH || path.join(__dirname, "..", "..", "dev.db");
  sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
}

function normalizeSqliteParams(params) {
  return params.map((value) => {
    if (typeof value === "boolean") return value ? 1 : 0;
    return value;
  });
}

function prepare(sql, pgClient = pool) {
  return {
    all(...params) {
      if (isPostgres) {
        return pgClient.query(postgresSql(sql), params).then((result) => result.rows);
      }
      return sqlite.prepare(sql).all(...normalizeSqliteParams(params));
    },
    get(...params) {
      if (isPostgres) {
        return pgClient.query(postgresSql(sql), params).then((result) => result.rows[0]);
      }
      return sqlite.prepare(sql).get(...normalizeSqliteParams(params));
    },
    run(...params) {
      if (isPostgres) {
        return pgClient.query(postgresSql(sql), params).then((result) => ({
          changes: result.rowCount,
          rowCount: result.rowCount,
        }));
      }
      return sqlite.prepare(sql).run(...normalizeSqliteParams(params));
    },
  };
}

async function withTransaction(callback) {
  if (!isPostgres) {
    throw new Error("withTransaction solo esta disponible para PostgreSQL.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const transaction = {
      prepare(sql) {
        return prepare(sql, client);
      },
    };
    const result = await callback(transaction);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("No se pudo revertir la transaccion PostgreSQL:", rollbackError.message);
    }
    throw error;
  } finally {
    client.release();
  }
}

async function health() {
  if (isPostgres) {
    await pool.query("SELECT 1");
    return;
  }
  sqlite.prepare("SELECT 1").get();
}

module.exports = {
  isPostgres,
  prepare,
  withTransaction,
  health,
  pool,
  get name() {
    return isPostgres ? "PostgreSQL (Supabase)" : sqlite.name;
  },
};
