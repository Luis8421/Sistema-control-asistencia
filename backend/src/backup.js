require("dotenv").config();
const fs = require("fs");
const path = require("path");
const db = require("./db/connection");

if (db.isPostgres) {
  throw new Error("Este script solo crea backups de SQLite local.");
}

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, "..", "dev.db");
const BACKUP_DIR = path.join(__dirname, "..", "backups");

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// Vuelca el WAL al archivo principal antes de copiar: con journal_mode=WAL
// los cambios recientes pueden vivir solo en dev.db-wal, y copiar dev.db
// sin este paso daria un backup incompleto.
db.pragma("wal_checkpoint(TRUNCATE)");
db.close();

if (!fs.existsSync(DB_PATH)) {
  console.error(`No se encontro la base de datos en ${DB_PATH}`);
  process.exit(1);
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });

const destino = path.join(BACKUP_DIR, `dev-${timestamp()}.db`);
fs.copyFileSync(DB_PATH, destino);

console.log(`Backup creado: ${destino}`);
