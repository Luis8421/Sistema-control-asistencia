/**
 * Calculo de indicadores de asistencia (puntualidad, atrasos, ausencias,
 * horas trabajadas) a partir de los registros crudos de
 * registros_asistencia + el horario y dias laborables esperados del
 * empleado (empleados.dias_laborables: "1,2,3,4,5" = lunes a viernes).
 *
 * Es una funcion pura (no toca la base de datos) para que sea facil de
 * probar: recibe los registros ya filtrados por empleado/rango y devuelve
 * el resumen. El controlador (indicadoresController.js) hace las consultas
 * SQL y resuelve la fecha de "hoy".
 *
 * Limitacion documentada: dias_laborables es fijo por semana (no rota de
 * una semana a otra). Cubre el caso de "libra martes y jueves" pero no un
 * turno que cambia de horario/dias cada 2 semanas.
 */

function minutosDeHoraTexto(horaTexto) {
  const [h, m] = horaTexto.split(":").map(Number);
  return h * 60 + m;
}

/** "1,2,3,4,5" -> Set{1,2,3,4,5} (1=lunes ... 7=domingo, ISO) */
function parseDiasLaborables(diasLaborablesTexto) {
  return new Set(diasLaborablesTexto.split(",").map(Number));
}

/** JS getUTCDay() (0=domingo...6=sabado) -> numero ISO (1=lunes...7=domingo) */
function aDiaIso(diaSemanaJs) {
  return diaSemanaJs === 0 ? 7 : diaSemanaJs;
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
 * @param {{hora_entrada_esperada: string, tolerancia_min: number, dias_laborables: string}} params.empleado
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

  const diasLaborablesSet = parseDiasLaborables(empleado.dias_laborables);

  let diasLaborables = 0;
  let diasAusente = 0;
  for (
    let d = new Date(`${fechaInicio}T00:00:00Z`);
    formatearFechaUTC(d) <= fechaFinAusencias;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    if (!diasLaborablesSet.has(aDiaIso(d.getUTCDay()))) continue;

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
