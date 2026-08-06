require("dotenv").config();
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const db = require("./db/connection");
const { validarGeocerca } = require("./utils/geo");

const MAX_GPS_PRECISION_M = Number(process.env.MAX_GPS_PRECISION_M || 50);

async function main() {
  // Geocerca de ejemplo: ajusta latitud/longitud a tu ubicacion real para
  // poder probar marcajes "validos" desde tu propia posicion.
  const bodegaId = uuidv4();
  const bodega = {
    nombre: "Oficina Principal",
    direccion: "Av. Amazonas y Naciones Unidas, Quito",
    latitud: -0.1807,
    longitud: -78.4678,
    radioMetros: 100,
  };
  db.prepare(
    `INSERT INTO bodegas (id, nombre, direccion, latitud, longitud, radio_metros)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(bodegaId, bodega.nombre, bodega.direccion, bodega.latitud, bodega.longitud, bodega.radioMetros);

  const passwordHash = await bcrypt.hash("demo1234", 10);
  const juanId = uuidv4();
  db.prepare(
    `INSERT INTO empleados
      (id, nombre_completo, codigo_empleado, email, password_hash, rol, bodega_id, hora_entrada_esperada, hora_salida_esperada)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(juanId, "Juan Perez", "EMP-001", "juan.perez@empresa.com", passwordHash, "empleado", bodegaId, "08:00", "17:00");

  const anaHash = await bcrypt.hash("demo1234", 10);
  const anaId = uuidv4();
  db.prepare(
    `INSERT INTO empleados
      (id, nombre_completo, codigo_empleado, email, password_hash, rol, bodega_id, hora_entrada_esperada, hora_salida_esperada)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(anaId, "Ana Martinez", "EMP-002", "ana.martinez@empresa.com", anaHash, "empleado", bodegaId, "08:00", "17:00");

  const supervisorHash = await bcrypt.hash("demo1234", 10);
  const supervisorId = uuidv4();
  db.prepare(
    `INSERT INTO empleados
      (id, nombre_completo, codigo_empleado, email, password_hash, rol, bodega_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(supervisorId, "Maria Torres", "SUP-001", "maria.torres@empresa.com", supervisorHash, "supervisor", bodegaId);

  const adminHash = await bcrypt.hash("demo1234", 10);
  const adminId = uuidv4();
  db.prepare(
    `INSERT INTO empleados
      (id, nombre_completo, codigo_empleado, email, password_hash, rol, bodega_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(adminId, "Admin Panel", "ADM-001", "admin@empresa.com", adminHash, "admin", bodegaId);

  // 5 marcaciones de ejemplo (mezcla de validas/invalidas, dos empleados,
  // dos dias) para que el panel no se abra vacio. Se valida cada una con
  // la misma funcion que usa el endpoint real (utils/geo) para que
  // distancia/estado/motivo queden consistentes.
  const hoy = new Date();
  const ayer = new Date(hoy.getTime() - 24 * 60 * 60 * 1000);
  const fechaHora = (fecha, hora) => `${fecha.toISOString().slice(0, 10)} ${hora}`;

  const marcacionesEjemplo = [
    {
      empleadoId: juanId,
      tipo: "entrada",
      timestamp: fechaHora(hoy, "08:02:00"),
      lat: -0.1808,
      lon: -78.4679,
      precisionM: 12,
    },
    {
      empleadoId: juanId,
      tipo: "salida",
      timestamp: fechaHora(hoy, "17:05:00"),
      lat: -0.1807,
      lon: -78.4678,
      precisionM: 10,
    },
    {
      empleadoId: anaId,
      tipo: "entrada",
      timestamp: fechaHora(hoy, "08:10:00"),
      lat: -0.19,
      lon: -78.48,
      precisionM: 15,
    },
    {
      empleadoId: anaId,
      tipo: "salida",
      timestamp: fechaHora(hoy, "17:00:00"),
      lat: -0.1806,
      lon: -78.4677,
      precisionM: 8,
    },
    {
      empleadoId: juanId,
      tipo: "entrada",
      timestamp: fechaHora(ayer, "08:00:00"),
      lat: -0.1807,
      lon: -78.4678,
      precisionM: 80, // peor que MAX_GPS_PRECISION_M -> invalido por precision
    },
  ];

  const insertarMarcacion = db.prepare(
    `INSERT INTO registros_asistencia
      (id, tipo, timestamp_servidor, latitud, longitud, precision_gps_m, distancia_a_bodega_m, valido, motivo_invalido, dispositivo_id, empleado_id, bodega_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const m of marcacionesEjemplo) {
    const { valido, distanciaM, motivo } = validarGeocerca({
      lat: m.lat,
      lon: m.lon,
      precisionM: m.precisionM,
      bodega: { latitud: bodega.latitud, longitud: bodega.longitud, radioMetros: bodega.radioMetros },
      maxPrecisionAceptadaM: MAX_GPS_PRECISION_M,
      ubicacionSimulada: false,
    });

    insertarMarcacion.run(
      uuidv4(),
      m.tipo,
      m.timestamp,
      m.lat,
      m.lon,
      m.precisionM,
      distanciaM,
      valido ? 1 : 0,
      motivo,
      "seed-demo",
      m.empleadoId,
      bodegaId
    );
  }

  console.log("Datos de ejemplo creados:");
  console.log("Geocerca:", bodega.nombre, bodegaId);
  console.log("Empleado demo -> email: juan.perez@empresa.com / password: demo1234");
  console.log("Empleado demo -> email: ana.martinez@empresa.com / password: demo1234");
  console.log("Supervisor demo -> email: maria.torres@empresa.com / password: demo1234");
  console.log("Admin demo -> email: admin@empresa.com / password: demo1234");
  console.log(`${marcacionesEjemplo.length} marcaciones de ejemplo creadas.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
