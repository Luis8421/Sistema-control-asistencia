const { v4: uuidv4 } = require("uuid");
const db = require("../db/connection");
const { validarGeocerca } = require("../utils/geo");
const { validarSecuenciaDelDia } = require("../utils/secuenciaMarcaje");
const { clasificarResultadosBodega } = require("../utils/seleccionBodega");
const { parsePaginacion } = require("../utils/paginacion");
const { guardarFotoBase64 } = require("../utils/fotos");
const { generarExcelMarcaciones } = require("../utils/excelExport");

const MAX_FILAS_EXPORTACION = 5000;

const MAX_GPS_PRECISION_M = Number(process.env.MAX_GPS_PRECISION_M || 50);

/**
 * Mensaje que ve el empleado cuando el marcaje se rechaza. El texto de
 * "fuera_de_rango" es literal, pedido explicitamente: cualquier cambio de
 * redaccion ahi debe ser intencional.
 */
function mensajeRechazo(motivo, distanciaM, radioMetros) {
  switch (motivo) {
    case "fuera_de_rango":
      return `No se encuentra dentro del área autorizada para registrar asistencia. Estás a ${Math.round(distanciaM)} m (radio permitido: ${radioMetros} m).`;
    case "precision_insuficiente":
      return "La precisión de tu GPS no es suficiente para validar el marcaje. Intenta nuevamente en un lugar con mejor señal.";
    case "gps_simulado":
      return "No se puede registrar el marcaje: se detectó una ubicación simulada (mock location).";
    case "coordenadas_invalidas":
      return "No se recibieron coordenadas GPS válidas. Verifica que la ubicación esté activada e intenta de nuevo.";
    case "bodega_mal_configurada":
      return "La geocerca de tu sucursal no está configurada correctamente. Contacta al administrador.";
    case "sin_bodega_asignada":
      return "Tu usuario no tiene una bodega/sucursal asignada. Contacta al administrador.";
    case "entrada_duplicada":
      return "Ya registraste tu entrada de hoy. Marca tu salida antes de volver a marcar entrada.";
    case "salida_sin_entrada":
      return "Debes marcar tu entrada antes de poder marcar tu salida.";
    case "salida_duplicada":
      return "Ya registraste tu salida de hoy.";
    case "bodega_no_autorizada":
      return "La bodega seleccionada no está autorizada para tu usuario.";
    case "precision_invalida":
    default:
      return "No se recibió una precisión de GPS válida. Verifica que la ubicación esté activada e intenta de nuevo.";
  }
}

/**
 * Bodegas candidatas para validar el GPS de este empleado. Depende
 * EXCLUSIVAMENTE de empleados.autorizado_todas_bodegas (columna dedicada,
 * independiente de rol y de empleado_bodegas — esa tabla ya no se lee
 * aqui, ver README):
 *  - autorizado_todas_bodegas = 1: cualquier bodega con activo=1 del
 *    catalogo completo (incluida Oficina Principal, sin excepciones).
 *  - autorizado_todas_bodegas = 0: unicamente su bodega_id principal,
 *    exactamente el comportamiento previo a todo el trabajo de
 *    multi-bodega — por eso esta rama NO filtra por bodega.activo, para
 *    no introducir un cambio de conducta no pedido.
 */
function obtenerBodegasCandidatas(empleado) {
  if (empleado.autorizado_todas_bodegas) {
    return db.prepare("SELECT * FROM bodegas WHERE activo = 1 ORDER BY codigo").all();
  }
  return db.prepare("SELECT * FROM bodegas WHERE id = ?").all(empleado.bodega_id);
}

/**
 * Corre validarGeocerca() (sin modificar) contra cada bodega autorizada,
 * emparejando cada bodega con su propio resultado — insumo de
 * clasificarResultadosBodega().
 */
function validarContraTodas(bodegasAutorizadas, { latitud, longitud, precisionM, ubicacionSimulada }) {
  return bodegasAutorizadas.map((bodega) => ({
    bodega,
    resultado: validarGeocerca({
      lat: latitud,
      lon: longitud,
      precisionM,
      bodega: { latitud: bodega.latitud, longitud: bodega.longitud, radioMetros: bodega.radio_metros },
      maxPrecisionAceptadaM: MAX_GPS_PRECISION_M,
      ubicacionSimulada: !!ubicacionSimulada,
    }),
  }));
}

/**
 * Ultimo paso, comun a los dos caminos que terminan en un marcaje
 * aceptado: bodega unica automatica, o bodega elegida explicitamente tras
 * un 409 de ambiguedad. La secuencia (entrada/salida) sigue siendo por
 * empleado y dia, nunca por bodega — un empleado no puede tener una
 * entrada abierta en dos bodegas a la vez.
 */
function continuarMarcaje({ res, empleado, bodega, distanciaM, tipo, latitud, longitud, precisionM, dispositivoId, foto }) {
  // Desempate por rowid (orden real de insercion) ademas de
  // timestamp_servidor: datetime('now') trunca a segundos, asi que dos
  // marcajes dentro del mismo segundo (poco probable caminando entre
  // bodegas, pero posible) empatarian en timestamp — sin el desempate,
  // ORDER BY ... LIMIT 1 podria devolver la fila equivocada como "la
  // ultima". rowid siempre crece con cada INSERT.
  const ultimoMarcajeHoy = db
    .prepare(
      `SELECT tipo FROM registros_asistencia
       WHERE empleado_id = ? AND valido = 1 AND date(timestamp_servidor) = date('now', '-5 hours')
       ORDER BY timestamp_servidor DESC, rowid DESC LIMIT 1`
    )
    .get(empleado.id);

  const secuencia = validarSecuenciaDelDia(ultimoMarcajeHoy?.tipo ?? null, tipo);
  if (!secuencia.valido) {
    return res.status(422).json({
      error: mensajeRechazo(secuencia.motivo),
      motivo: secuencia.motivo,
      distanciaM: Math.round(distanciaM),
    });
  }

  // La foto solo se decodifica/guarda si el marcaje va a quedar registrado
  // (evita dejar archivos huerfanos en uploads/fotos/ por marcajes que se
  // terminan rechazando).
  let fotoUrl = null;
  if (foto) {
    try {
      fotoUrl = guardarFotoBase64(foto);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  const id = uuidv4();

  db.prepare(
    `INSERT INTO registros_asistencia
      (id, tipo, latitud, longitud, precision_gps_m, distancia_a_bodega_m, valido, motivo_invalido, dispositivo_id, foto_url, empleado_id, bodega_id)
     VALUES (?, ?, ?, ?, ?, ?, 1, NULL, ?, ?, ?, ?)`
  ).run(id, tipo, latitud, longitud, precisionM ?? null, distanciaM, dispositivoId ?? null, fotoUrl, empleado.id, bodega.id);

  const registro = db.prepare("SELECT * FROM registros_asistencia WHERE id = ?").get(id);

  return res.status(201).json({
    registro,
    mensaje: "Marcaje registrado y validado correctamente.",
  });
}

/**
 * POST /api/asistencia/marcar
 * body: { tipo: "entrada"|"salida", latitud, longitud, precisionM, ubicacionSimulada, dispositivoId, foto, bodegaId? }
 *
 * El empleado se identifica por el token (req.usuario.id), nunca por el body,
 * para que un tercero no pueda marcar en nombre de otro.
 *
 * `foto` es opcional: la app movil no la envia (ya tiene otros controles),
 * el marcaje web si la exige antes de llamar a este endpoint.
 *
 * `bodegaId` es opcional: solo se envia en el SEGUNDO paso del flujo de
 * ambiguedad (ver mas abajo), cuando el empleado ya eligio explicitamente
 * entre 2+ bodegas que validaron simultaneamente (ej. BOCQ y BDCQ, que
 * comparten coordenadas). Nunca se confia en el valor tal cual: se
 * verifica que este autorizada Y se revalida el GPS contra ella
 * especificamente antes de aceptar nada.
 *
 * Validacion de geocerca OBLIGATORIA: un marcaje fuera del radio de TODAS
 * las bodegas autorizadas (o con GPS invalido/simulado/impreciso) se
 * RECHAZA y no se guarda ningun registro — el backend es la unica fuente
 * de verdad, la app movil/web solo hacen un chequeo local previo como
 * optimizacion de UX, nunca se confia en el.
 *
 * Si el GPS valida simultaneamente contra 2+ bodegas autorizadas, no se
 * elige ninguna por desempate automatico: se responde 409 con las
 * opciones, y el empleado debe reenviar la misma marcacion agregando
 * `bodegaId` con su eleccion.
 */
function marcar(req, res) {
  const { tipo, latitud, longitud, precisionM, ubicacionSimulada, dispositivoId, foto, bodegaId } = req.body;

  if (!tipo || !["entrada", "salida"].includes(tipo)) {
    return res.status(400).json({ error: "tipo debe ser 'entrada' o 'salida'" });
  }
  if (typeof latitud !== "number" || typeof longitud !== "number") {
    return res.status(400).json({ error: "latitud y longitud son requeridas y deben ser numericas" });
  }

  const empleado = db.prepare("SELECT * FROM empleados WHERE id = ?").get(req.usuario.id);

  if (!empleado || !empleado.activo) {
    return res.status(404).json({ error: "Empleado no encontrado o inactivo" });
  }

  const bodegasAutorizadas = obtenerBodegasCandidatas(empleado);

  // Estructuralmente casi imposible tras el backfill de la migracion,
  // pero si algun dia ocurriera (dato corrupto), mejor un 422 claro que
  // dejar que el resto del flujo trabaje con un arreglo vacio.
  if (bodegasAutorizadas.length === 0) {
    return res.status(422).json({
      error: mensajeRechazo("sin_bodega_asignada"),
      motivo: "sin_bodega_asignada",
      distanciaM: null,
    });
  }

  // Segundo paso del flujo de ambiguedad: el empleado ya eligio una
  // bodega especifica entre las opciones de un 409 anterior.
  if (bodegaId !== undefined) {
    const bodegaElegida = bodegasAutorizadas.find((b) => b.id === bodegaId);
    if (!bodegaElegida) {
      return res.status(422).json({
        error: mensajeRechazo("bodega_no_autorizada"),
        motivo: "bodega_no_autorizada",
        distanciaM: null,
      });
    }

    const [{ resultado }] = validarContraTodas([bodegaElegida], { latitud, longitud, precisionM, ubicacionSimulada });
    if (!resultado.valido) {
      return res.status(422).json({
        error: mensajeRechazo(resultado.motivo, resultado.distanciaM, bodegaElegida.radio_metros),
        motivo: resultado.motivo,
        distanciaM: typeof resultado.distanciaM === "number" ? Math.round(resultado.distanciaM) : null,
      });
    }

    return continuarMarcaje({
      res, empleado, bodega: bodegaElegida, distanciaM: resultado.distanciaM,
      tipo, latitud, longitud, precisionM, dispositivoId, foto,
    });
  }

  // Primer intento: validar contra TODAS las bodegas autorizadas.
  const itemsConResultado = validarContraTodas(bodegasAutorizadas, { latitud, longitud, precisionM, ubicacionSimulada });
  const clasificacion = clasificarResultadosBodega(itemsConResultado);

  if (clasificacion.tipo === "ninguna") {
    const { bodega, resultado } = clasificacion.masCercana;
    return res.status(422).json({
      error: mensajeRechazo(resultado.motivo, resultado.distanciaM, bodega.radio_metros),
      motivo: resultado.motivo,
      distanciaM: typeof resultado.distanciaM === "number" ? Math.round(resultado.distanciaM) : null,
    });
  }

  if (clasificacion.tipo === "multiple") {
    return res.status(409).json({
      motivo: "seleccion_bodega_requerida",
      error: "Se detectó más de una bodega autorizada en esta ubicación. Selecciona la correcta.",
      opciones: clasificacion.validas.map(({ bodega }) => ({ id: bodega.id, codigo: bodega.codigo, nombre: bodega.nombre })),
    });
  }

  // tipo === "unica"
  return continuarMarcaje({
    res, empleado, bodega: clasificacion.bodega, distanciaM: clasificacion.resultado.distanciaM,
    tipo, latitud, longitud, precisionM, dispositivoId, foto,
  });
}

/**
 * GET /api/asistencia/historial/:empleadoId?fecha=YYYY-MM-DD
 * Un empleado solo puede ver su propio historial, salvo supervisor/admin.
 * `fecha` es opcional (sin ella, trae todo el historial, igual que
 * antes); el portal de marcaje la usa para pedir solo el dia en curso en
 * vez de traer meses de historial en cada carga.
 */
function historial(req, res) {
  const { empleadoId } = req.params;
  const { fecha } = req.query;

  const esPropio = req.usuario.id === empleadoId;
  const esSupervisorOAdmin = ["supervisor", "admin"].includes(req.usuario.rol);

  if (!esPropio && !esSupervisorOAdmin) {
    return res.status(403).json({ error: "No autorizado a ver este historial" });
  }

  const where = ["r.empleado_id = ?"];
  const params = [empleadoId];
  if (fecha) {
    where.push("date(r.timestamp_servidor) = date(?)");
    params.push(fecha);
  }

  const registros = db
    .prepare(
      `SELECT r.*, b.nombre AS bodega_nombre
       FROM registros_asistencia r
       JOIN bodegas b ON b.id = r.bodega_id
       WHERE ${where.join(" AND ")}
       ORDER BY r.timestamp_servidor DESC`
    )
    .all(...params);

  return res.json(registros);
}

/**
 * GET /api/asistencia/en-turno
 * Empleados cuyo ultimo marcaje valido del dia es "entrada".
 * Pensado como base para el panel de supervision (Fase 2).
 */
function enTurno(req, res) {
  const registrosHoy = db
    .prepare(
      `SELECT r.*, e.nombre_completo, b.nombre AS bodega_nombre
       FROM registros_asistencia r
       JOIN empleados e ON e.id = r.empleado_id
       JOIN bodegas b ON b.id = r.bodega_id
       WHERE date(r.timestamp_servidor) = date('now')
         AND r.valido = 1
       ORDER BY r.timestamp_servidor ASC`
    )
    .all();

  const ultimoPorEmpleado = new Map();
  for (const r of registrosHoy) {
    ultimoPorEmpleado.set(r.empleado_id, r);
  }

  const enTurnoAhora = [...ultimoPorEmpleado.values()].filter((r) => r.tipo === "entrada");

  return res.json(enTurnoAhora);
}

/**
 * Filtros compartidos por /api/marcaciones (listado paginado) y su
 * exportacion a Excel: fecha exacta, empleado, tipo (entrada/salida) y
 * validez. `valido=true|false` es opcional (sin el filtro, trae ambos) —
 * lo usa el dashboard para contar marcaciones validas/invalidas del dia
 * con una sola consulta COUNT cada una.
 * Devuelve null y ya escribe la respuesta de error si `tipo` es invalido.
 */
function construirFiltrosMarcaciones(query, res) {
  const { fecha, empleadoId, tipo, valido } = query;

  if (tipo && !["entrada", "salida"].includes(tipo)) {
    res.status(400).json({ error: "tipo debe ser 'entrada' o 'salida'" });
    return null;
  }

  const where = [];
  const params = [];

  if (fecha) {
    where.push("date(r.timestamp_servidor) = date(?)");
    params.push(fecha);
  }
  if (empleadoId) {
    where.push("r.empleado_id = ?");
    params.push(empleadoId);
  }
  if (tipo) {
    where.push("r.tipo = ?");
    params.push(tipo);
  }
  if (valido === "true" || valido === "false") {
    where.push("r.valido = ?");
    params.push(valido === "true" ? 1 : 0);
  }

  return { whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

/**
 * GET /api/marcaciones?page&limit&fecha&empleadoId&tipo
 * Listado general para el panel de administracion, con filtros opcionales.
 */
function listarTodas(req, res) {
  const { page, limit, offset } = parsePaginacion(req.query);

  const filtros = construirFiltrosMarcaciones(req.query, res);
  if (!filtros) return;
  const { whereSql, params } = filtros;

  const total = db
    .prepare(`SELECT COUNT(*) AS total FROM registros_asistencia r ${whereSql}`)
    .get(...params).total;

  const data = db
    .prepare(
      `SELECT r.*, e.nombre_completo, e.codigo_empleado, b.nombre AS bodega_nombre
       FROM registros_asistencia r
       JOIN empleados e ON e.id = r.empleado_id
       JOIN bodegas b ON b.id = r.bodega_id
       ${whereSql}
       ORDER BY r.timestamp_servidor DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  return res.json({ data, page, limit, total, totalPaginas: Math.ceil(total / limit) || 1 });
}

/**
 * GET /api/marcaciones/exportar?fecha&empleadoId&tipo
 * Mismos filtros que el listado, sin paginar (tope MAX_FILAS_EXPORTACION
 * para no generar un Excel gigante por error). Descarga un .xlsx.
 */
async function exportarExcel(req, res) {
  const filtros = construirFiltrosMarcaciones(req.query, res);
  if (!filtros) return;
  const { whereSql, params } = filtros;

  const registros = db
    .prepare(
      `SELECT r.*, e.nombre_completo, e.codigo_empleado, b.nombre AS bodega_nombre
       FROM registros_asistencia r
       JOIN empleados e ON e.id = r.empleado_id
       JOIN bodegas b ON b.id = r.bodega_id
       ${whereSql}
       ORDER BY r.timestamp_servidor DESC
       LIMIT ?`
    )
    .all(...params, MAX_FILAS_EXPORTACION);

  try {
    await generarExcelMarcaciones(registros, res);
  } catch (err) {
    console.error("Error generando Excel de marcaciones:", err);
    if (!res.headersSent) res.status(500).json({ error: "No se pudo generar el archivo" });
  }
}

module.exports = { marcar, historial, enTurno, listarTodas, exportarExcel };
