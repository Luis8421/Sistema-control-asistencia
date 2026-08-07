/**
 * Valida que un marcaje siga la secuencia logica del dia para un
 * empleado: entrada -> salida -> entrada -> salida... No es una regla de
 * geolocalizacion — vive separada de utils/geo.js a proposito, que quedo
 * cerrado como modulo formal (auditoria aprobada) y no debe reabrirse
 * para mezclar una regla de negocio distinta.
 *
 * Es una funcion pura: el llamador (asistenciaController) resuelve cual
 * fue el ultimo marcaje valido del dia en curso.
 *
 * @param {"entrada"|"salida"|null} ultimoTipoHoy - tipo del ultimo
 *   marcaje VALIDO de hoy de este empleado, o null si no ha marcado nada
 *   hoy todavia.
 * @param {"entrada"|"salida"} tipoNuevo
 * @returns {{valido: boolean, motivo: string|null}}
 */
function validarSecuenciaDelDia(ultimoTipoHoy, tipoNuevo) {
  if (tipoNuevo === "entrada" && ultimoTipoHoy === "entrada") {
    return { valido: false, motivo: "entrada_duplicada" };
  }

  if (tipoNuevo === "salida") {
    if (ultimoTipoHoy === null) {
      return { valido: false, motivo: "salida_sin_entrada" };
    }
    if (ultimoTipoHoy === "salida") {
      return { valido: false, motivo: "salida_duplicada" };
    }
  }

  return { valido: true, motivo: null };
}

module.exports = { validarSecuenciaDelDia };
