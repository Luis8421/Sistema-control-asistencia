/**
 * Calculo de indicadores de asistencia (puntualidad, atrasos, ausencias,
 * horas trabajadas) a partir de los registros crudos de
 * registros_asistencia + el horario esperado del empleado.
 *
 * Es una funcion pura (no toca la base de datos) para que sea facil de
 * probar: recibe los registros ya filtrados por empleado/rango y devuelve
 * el resumen. El controlador (indicadoresController.js) hace las consultas
 * SQL y resuelve la fecha de "hoy".
 *
 * Asuncion documentada: dias laborables = lunes a viernes. El esquema
 * actual no modela turnos rotativos ni dias libres por empleado (ver
 * seccion "Turnos rotativos" en el roadmap), asi que un empleado con un
 * horario distinto va a ver ausencias mal contadas hasta que eso exista.
 */

function minutosDeHoraTexto(horaTexto) {
  const [h, m] = horaTexto.split(":").map(Number);
  return h * 60 + m;
}

function minutosATexto(minutos) {
  const h = Math.floor(minutos / 60)
    .toString()
    .padStart(2, "0");
  const m = Math.floor(minutos % 60)
    .toString()
    .padStart(2, "0");
  return `${h}:${m}`;
}

function parseFechaHora(timestampServidor) {
  const [fecha, hora] = timestampServidor.split(" ");
  const [h, m] = hora.split(":").map(Number);
  return { fecha, minutosDelDia: h * 60 + m };
}

function formatearFechaUTC(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * @param {object} params
 * @param {Array<{tipo: string, timestamp_servidor: string, valido: number}>} params.registros
 * @param {{hora_entrada_esperada: string, tolerancia_min: number}} params.empleado
 * @param {string} params.fechaInicio - "YYYY-MM-DD"
 * @param {string} params.fechaFin - "YYYY-MM-DD", fin del rango solicitado (puede ser futuro)
 * @param {string} params.fechaFinAusencias - "YYYY-MM-DD", min(fechaFin, hoy); no se cuentan ausencias en dias futuros
 */
function calcularIndicadores({ registros, empleado, fechaInicio, fechaFin, fechaFinAusencias }) {
  const porDia = new Map();

  for (const r of registros) {
    if (!r.valido) continue;
    const { fecha, minutosDelDia } = parseFechaHora(r.timestamp_servidor);
    if (!porDia.has(fecha)) porDia.set(fecha, { entradas: [], salidas: [] });
    porDia.get(fecha)[r.tipo === "entrada" ? "entradas" : "salidas"].push(minutosDelDia);
  }

  const minutosEsperados = minutosDeHoraTexto(empleado.hora_entrada_esperada) + empleado.tolerancia_min;

  const detallePorDia = [];
  let diasConAtraso = 0;
  let minutosAtrasoTotal = 0;
  let horasTrabajadasTotal = 0;

  for (const fecha of [...porDia.keys()].sort()) {
    const { entradas, salidas } = porDia.get(fecha);
    if (entradas.length === 0) continue;

    const primeraEntrada = Math.min(...entradas);
    const ultimaSalida = salidas.length ? Math.max(...salidas) : null;

    const minutosAtraso = Math.max(0, primeraEntrada - minutosEsperados);
    const atrasado = minutosAtraso > 0;
    if (atrasado) {
      diasConAtraso++;
      minutosAtrasoTotal += minutosAtraso;
    }

    let horasTrabajadas = null;
    if (ultimaSalida !== null && ultimaSalida > primeraEntrada) {
      horasTrabajadas = Math.round(((ultimaSalida - primeraEntrada) / 60) * 100) / 100;
      horasTrabajadasTotal += horasTrabajadas;
    }

    detallePorDia.push({
      fecha,
      horaEntrada: minutosATexto(primeraEntrada),
      horaSalida: ultimaSalida !== null ? minutosATexto(ultimaSalida) : null,
      minutosAtraso,
      horasTrabajadas,
      estado: atrasado ? "atrasado" : "a_tiempo",
    });
  }

  let diasLaborables = 0;
  let diasAusente = 0;
  for (
    let d = new Date(`${fechaInicio}T00:00:00Z`);
    formatearFechaUTC(d) <= fechaFinAusencias;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const diaSemana = d.getUTCDay(); // 0 = domingo, 6 = sabado
    if (diaSemana === 0 || diaSemana === 6) continue;

    diasLaborables++;
    const fechaStr = formatearFechaUTC(d);
    const tieneEntrada = porDia.has(fechaStr) && porDia.get(fechaStr).entradas.length > 0;
    if (!tieneEntrada) diasAusente++;
  }

  return {
    rango: { desde: fechaInicio, hasta: fechaFin },
    diasLaborables,
    diasTrabajados: detallePorDia.length,
    diasAusente,
    diasConAtraso,
    minutosAtrasoPromedio: diasConAtraso ? Math.round(minutosAtrasoTotal / diasConAtraso) : 0,
    horasTrabajadas: Math.round(horasTrabajadasTotal * 100) / 100,
    detallePorDia,
  };
}

module.exports = { calcularIndicadores };
