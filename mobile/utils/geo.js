/**
 * Formula de Haversine, identica a backend/src/utils/geo.js. Se usa para
 * un chequeo LOCAL de la distancia antes de llamar a /asistencia/marcar
 * (mejor UX: evita un viaje redondo cuando el empleado claramente esta
 * fuera de rango). El backend siempre vuelve a calcular esto mismo de
 * forma autoritativa — nunca se confia unicamente en este chequeo.
 */
export function calcularDistanciaMetros(lat1, lon1, lat2, lon2) {
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
