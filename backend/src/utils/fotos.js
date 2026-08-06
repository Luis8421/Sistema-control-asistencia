const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const UPLOADS_DIR = path.join(__dirname, "..", "..", "uploads", "fotos");
const MAX_BYTES = 2 * 1024 * 1024; // 2MB, generoso para un jpg 640x480

/**
 * Decodifica un data URI (data:image/jpeg;base64,....) y lo guarda en
 * uploads/fotos/. Devuelve la URL relativa a guardar en la DB.
 * El nombre del archivo lo genera esta funcion (uuid), nunca viene del
 * cliente, asi que no hay riesgo de path traversal.
 */
function guardarFotoBase64(dataUri) {
  const match = /^data:image\/(png|jpe?g);base64,(.+)$/.exec(dataUri);
  if (!match) {
    throw new Error("Formato de foto invalido (se espera un data URI image/jpeg o image/png)");
  }

  const extension = match[1] === "jpg" ? "jpeg" : match[1];
  const buffer = Buffer.from(match[2], "base64");

  if (buffer.length > MAX_BYTES) {
    throw new Error("La foto es demasiado grande (maximo 2MB)");
  }

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  const nombreArchivo = `${uuidv4()}.${extension}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, nombreArchivo), buffer);

  return `/uploads/fotos/${nombreArchivo}`;
}

module.exports = { guardarFotoBase64 };
