/**
 * Clasifica los resultados de validarGeocerca() contra cada bodega
 * autorizada de un empleado (utils/geo.js no se modifica: esta funcion
 * solo decide que hacer con los resultados ya calculados, uno por
 * bodega). La usa asistenciaController.marcar() para soportar empleados
 * con mas de una bodega autorizada:
 *
 * - "unica": exactamente una bodega valida -> se acepta automaticamente.
 * - "multiple": 2+ bodegas validas al mismo tiempo (ej. BOCQ y BDCQ, que
 *   comparten coordenadas exactas) -> NO se elige ninguna por desempate
 *   automatico; el empleado debe seleccionar explicitamente.
 * - "ninguna": ninguna bodega autorizada es valida -> se rechaza,
 *   reportando la mas cercana entre las autorizadas (mejor mensaje de
 *   error posible, en vez de uno generico).
 *
 * Funcion pura (sin acceso a base de datos), para poder probarla en
 * aislamiento igual que geo.js y secuenciaMarcaje.js.
 *
 * @param {Array<{bodega: object, resultado: {valido: boolean, distanciaM: number|null, motivo: string|null}}>} itemsConResultado
 *   No debe llamarse con un arreglo vacio — el llamador debe garantizar
 *   que el empleado tiene al menos una bodega autorizada antes de invocar
 *   esta funcion (mismo criterio que "sin_bodega_asignada" ya existente).
 */
function clasificarResultadosBodega(itemsConResultado) {
  const validas = itemsConResultado.filter((item) => item.resultado.valido);

  if (validas.length === 1) {
    return { tipo: "unica", bodega: validas[0].bodega, resultado: validas[0].resultado };
  }

  if (validas.length > 1) {
    return { tipo: "multiple", validas };
  }

  let masCercana = itemsConResultado[0];
  for (const item of itemsConResultado) {
    const distancia = item.resultado.distanciaM;
    const distanciaActual = masCercana.resultado.distanciaM;
    if (distancia !== null && (distanciaActual === null || distancia < distanciaActual)) {
      masCercana = item;
    }
  }
  return { tipo: "ninguna", masCercana };
}

module.exports = { clasificarResultadosBodega };
