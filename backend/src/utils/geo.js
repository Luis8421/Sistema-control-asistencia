/**
 * Calcula la distancia en metros entre dos coordenadas GPS
 * usando la formula de Haversine.
 *
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} distancia en metros
 */
function calcularDistanciaMetros(lat1, lon1, lat2, lon2) {
  const RADIO_TIERRA_M = 6371000;

  const rad = (grados) => (grados * Math.PI) / 180;

  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rad(lat1)) *
      Math.cos(rad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return RADIO_TIERRA_M * c;
}

function esNumeroFinito(valor) {
  return typeof valor === "number" && Number.isFinite(valor);
}

/** Rango geografico valido: latitud [-90, 90], longitud [-180, 180]. */
function coordenadaValida(lat, lon) {
  return esNumeroFinito(lat) && esNumeroFinito(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

/**
 * Valida si un marcaje ocurre dentro de la geocerca de una bodega,
 * y con una precision de GPS aceptable.
 *
 * @param {object} params
 * @param {number} params.lat - latitud reportada por el dispositivo
 * @param {number} params.lon - longitud reportada por el dispositivo
 * @param {number} params.precisionM - precision del GPS reportada (accuracy). Obligatoria y numerica.
 * @param {object} params.bodega - { latitud, longitud, radioMetros }
 * @param {number} params.maxPrecisionAceptadaM - tolerancia maxima de precision
 * @param {boolean} params.ubicacionSimulada - flag de mock location del dispositivo
 */
function validarGeocerca({
  lat,
  lon,
  precisionM,
  bodega,
  maxPrecisionAceptadaM,
  ubicacionSimulada,
}) {
  // Geocerca mal configurada (bodega ausente, sin coordenadas validas, o
  // con radio invalido/negativo): es un problema de datos administrativos,
  // no algo que el empleado resuelva reintentando. Se revisa primero para
  // no calcular una distancia sin sentido contra una bodega rota.
  if (
    !bodega ||
    !coordenadaValida(bodega.latitud, bodega.longitud) ||
    !esNumeroFinito(bodega.radioMetros) ||
    bodega.radioMetros < 0
  ) {
    return { valido: false, distanciaM: null, motivo: "bodega_mal_configurada" };
  }

  // Coordenadas del empleado invalidas (no numericas, NaN/Infinity, o
  // fuera del rango geografico posible). Sin este chequeo, coordenadas
  // basura producen una distancia NaN, y en JS "NaN > radio" es false,
  // asi que el marcaje pasaria como valido por accidente — el mismo tipo
  // de vector que la validacion de geocerca existe para cerrar.
  if (!coordenadaValida(lat, lon)) {
    return { valido: false, distanciaM: null, motivo: "coordenadas_invalidas" };
  }

  const distanciaM = calcularDistanciaMetros(
    lat,
    lon,
    bodega.latitud,
    bodega.longitud
  );

  if (ubicacionSimulada) {
    return { valido: false, distanciaM, motivo: "gps_simulado" };
  }

  // precisionM debe llegar como numero valido (no string, no vacio); si no,
  // no podemos confiar en el marcaje y se rechaza en vez de omitir el chequeo.
  if (typeof precisionM !== "number" || Number.isNaN(precisionM)) {
    return { valido: false, distanciaM, motivo: "precision_invalida" };
  }

  if (precisionM > maxPrecisionAceptadaM) {
    return { valido: false, distanciaM, motivo: "precision_insuficiente" };
  }

  if (distanciaM > bodega.radioMetros) {
    return { valido: false, distanciaM, motivo: "fuera_de_rango" };
  }

  return { valido: true, distanciaM, motivo: null };
}

module.exports = { calcularDistanciaMetros, validarGeocerca };
