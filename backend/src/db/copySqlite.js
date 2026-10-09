const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const sourcePath = process.argv[2];
const destinationPath = process.argv[3];

if (!sourcePath || !destinationPath) {
  console.error("Uso: node src/db/copySqlite.js <base-origen.db> <copia-prueba.db>");
  process.exit(1);
}

const absoluteSourcePath = path.resolve(sourcePath);
const absoluteDestinationPath = path.resolve(destinationPath);
if (absoluteSourcePath === absoluteDestinationPath) {
  console.error("La ruta de destino debe ser distinta de la base original.");
  process.exit(1);
}
if (fs.existsSync(absoluteDestinationPath)) {
  console.error("La copia de destino ya existe; usa una ruta nueva para no sobrescribirla.");
  process.exit(1);
}

async function main() {
  const source = new Database(absoluteSourcePath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(absoluteDestinationPath);
  } finally {
    source.close();
  }
  console.log(`Copia SQLite creada: ${absoluteDestinationPath}`);
}

main().catch((error) => {
  console.error("No se pudo crear la copia SQLite:", error.message);
  process.exitCode = 1;
});
