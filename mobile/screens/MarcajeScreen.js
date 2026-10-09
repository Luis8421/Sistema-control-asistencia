import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Platform } from "react-native";
import * as Location from "expo-location";
import * as Application from "expo-application";
import { marcarAsistencia, logout } from "../api/client";
import { calcularDistanciaMetros } from "../utils/geo";

// ID estable por dispositivo/instalacion: Android ID en Android,
// identifierForVendor en iOS. No cambia entre sesiones como Constants.sessionId.
async function obtenerDispositivoId() {
  if (Platform.OS === "android") {
    return Application.getAndroidId();
  }
  if (Platform.OS === "ios") {
    return Application.getIosIdForVendorAsync();
  }
  return null;
}

// Umbral y ventana de busqueda de GPS: espejo de PRECISION_ACEPTABLE_M y
// VENTANA_BUSQUEDA_GPS_MS en web/js/marcaje.js, para que el Portal web y
// la app movil se comporten igual. El backend siempre revalida la
// precision de forma autoritativa en cada marcaje, sin importar lo que
// decida este chequeo local.
const PRECISION_ACEPTABLE_M = 50;
const VENTANA_BUSQUEDA_GPS_MS = 30000;

/**
 * Busca la mejor lectura de GPS posible dentro de una ventana de tiempo,
 * en vez de conformarse con la primera (que en interiores/bajo techo
 * suele ser la peor: la precision del GPS tipicamente mejora en los
 * primeros segundos mientras el dispositivo engancha mas satelites).
 * Usa watchPositionAsync() y se queda con la lectura de menor `accuracy`
 * vista hasta el momento; corta la busqueda antes de tiempo apenas una
 * lectura ya cumple PRECISION_ACEPTABLE_M.
 */
async function obtenerMejorUbicacion({ onLectura } = {}) {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") {
    throw new Error("Se necesita permiso de ubicacion para marcar asistencia.");
  }

  return new Promise((resolve, reject) => {
    let mejor = null;
    let subscripcion = null;
    let terminado = false;

    const limpiar = () => {
      clearTimeout(timeoutId);
      subscripcion?.remove();
    };

    const terminarConMejorLectura = () => {
      if (terminado) return;
      terminado = true;
      limpiar();
      if (mejor) {
        resolve(mejor);
      } else {
        // Se agoto la ventana sin recibir NINGUNA lectura (no es un tema
        // de precision: el dispositivo nunca entrego coordenadas).
        reject(
          new Error(
            "No pudimos obtener tu ubicación. Verifica que el GPS esté activado e intenta de nuevo."
          )
        );
      }
    };

    const timeoutId = setTimeout(terminarConMejorLectura, VENTANA_BUSQUEDA_GPS_MS);

    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 0, distanceInterval: 0 },
      (posicion) => {
        if (terminado) return;
        const c = posicion.coords;
        const esMejora = !mejor || c.accuracy < mejor.coords.accuracy;
        if (esMejora) {
          mejor = posicion;
          onLectura?.(c);
        }
        if (c.accuracy != null && c.accuracy <= PRECISION_ACEPTABLE_M) {
          terminarConMejorLectura();
        }
      }
    )
      .then((sub) => {
        subscripcion = sub;
        // La busqueda ya pudo haber terminado (timeout o precision ya
        // alcanzada) antes de que watchPositionAsync termine de registrar
        // el watcher nativo — no dejarlo corriendo de fondo en ese caso.
        if (terminado) sub.remove();
      })
      .catch((err) => {
        if (!terminado) {
          terminado = true;
          clearTimeout(timeoutId);
          reject(err);
        }
      });
  });
}

export default function MarcajeScreen({ route, navigation }) {
  const { empleado } = route.params;
  const [cargando, setCargando] = useState(null); // "entrada" | "salida" | null
  const [estadoTexto, setEstadoTexto] = useState(null);
  const [ultimoResultado, setUltimoResultado] = useState(null);

  async function capturarUbicacion(onLectura) {
    const posicion = await obtenerMejorUbicacion({ onLectura });

    // Nota: `mocked` solo esta disponible de forma confiable en Android.
    const ubicacionSimulada = posicion.mocked === true;

    return {
      latitud: posicion.coords.latitude,
      longitud: posicion.coords.longitude,
      precisionM: posicion.coords.accuracy,
      ubicacionSimulada,
    };
  }

  async function handleMarcar(tipo) {
    setCargando(tipo);
    setUltimoResultado(null);
    setEstadoTexto("Obteniendo tu ubicación...");
    try {
      const ubicacion = await capturarUbicacion((c) => {
        setEstadoTexto(`Obteniendo tu ubicación... Precisión actual: ${Math.round(c.accuracy)} m`);
      });

      // Precision insuficiente: ni buscando la mejor lectura posible
      // durante la ventana de tiempo se logro bajar del umbral. Se corta
      // aqui mismo sin gastar una llamada al backend que de todas formas
      // la rechazaria por el mismo motivo.
      if (ubicacion.precisionM > PRECISION_ACEPTABLE_M) {
        Alert.alert(
          "Ubicación poco precisa",
          "No pudimos obtener una ubicación GPS suficientemente precisa. Permanece unos segundos en el lugar y vuelve a intentarlo."
        );
        return;
      }

      // Chequeo local antes de llamar al backend: evita un viaje redondo
      // cuando el empleado claramente esta fuera de rango. Es solo UX —
      // el backend vuelve a validar la distancia de forma autoritativa
      // en cada peticion, sin importar lo que diga el cliente.
      if (empleado.bodega) {
        const distanciaM = calcularDistanciaMetros(
          ubicacion.latitud,
          ubicacion.longitud,
          empleado.bodega.latitud,
          empleado.bodega.longitud
        );
        if (distanciaM > empleado.bodega.radioMetros) {
          Alert.alert(
            "Fuera del área autorizada",
            "No se encuentra dentro del área autorizada para registrar asistencia."
          );
          return;
        }
      }

      const dispositivoId = await obtenerDispositivoId();

      const resultado = await marcarAsistencia({
        tipo,
        latitud: ubicacion.latitud,
        longitud: ubicacion.longitud,
        precisionM: ubicacion.precisionM,
        ubicacionSimulada: ubicacion.ubicacionSimulada,
        dispositivoId,
      });

      setUltimoResultado({ ok: true, ...resultado });
    } catch (e) {
      // Cubre tanto el rechazo del backend (422: fuera de rango, GPS
      // impreciso/simulado) como no tener permiso de ubicacion: en ambos
      // casos el marcaje no se registra y se avisa por que.
      Alert.alert("No se pudo registrar el marcaje", e.message || "Intenta nuevamente.");
    } finally {
      setCargando(null);
      setEstadoTexto(null);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.saludo}>Hola, {empleado.nombreCompleto}</Text>
      <Text style={styles.codigo}>{empleado.codigoEmpleado}</Text>

      <View style={styles.botones}>
        <TouchableOpacity
          style={[styles.boton, styles.botonEntrada]}
          onPress={() => handleMarcar("entrada")}
          disabled={!!cargando}
        >
          {cargando === "entrada" ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.botonTexto}>Marcar Entrada</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.boton, styles.botonSalida]}
          onPress={() => handleMarcar("salida")}
          disabled={!!cargando}
        >
          {cargando === "salida" ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.botonTexto}>Marcar Salida</Text>
          )}
        </TouchableOpacity>
      </View>

      {cargando && estadoTexto && <Text style={styles.estadoTexto}>{estadoTexto}</Text>}

      {/* ultimoResultado solo se llena en exito: un marcaje rechazado
          (fuera de rango, GPS invalido) nunca se registra, se avisa por
          Alert y no queda nada que mostrar aqui. */}
      {ultimoResultado && (
        <View
          style={[styles.resultado, { backgroundColor: "#e8f6ec" }]}
        >
          <Text style={styles.resultadoTexto}>{ultimoResultado.mensaje}</Text>
        </View>
      )}

      <TouchableOpacity
        style={styles.linkSalir}
        onPress={async () => {
          await logout();
          navigation.replace("Login");
        }}
      >
        <Text style={styles.linkSalirTexto}>Cerrar sesion</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, paddingTop: 80, backgroundColor: "#fff" },
  saludo: { fontSize: 22, fontWeight: "700", color: "#1F4E5F" },
  codigo: { fontSize: 14, color: "#888", marginBottom: 40 },
  botones: { gap: 16 },
  boton: { borderRadius: 12, padding: 20, alignItems: "center" },
  botonEntrada: { backgroundColor: "#2E86AB" },
  botonSalida: { backgroundColor: "#5c6b73" },
  botonTexto: { color: "#fff", fontSize: 17, fontWeight: "600" },
  estadoTexto: { marginTop: 16, fontSize: 13, color: "#666", textAlign: "center" },
  resultado: { marginTop: 28, padding: 16, borderRadius: 10 },
  resultadoTexto: { fontSize: 14, color: "#333" },
  linkSalir: { marginTop: "auto", alignItems: "center", paddingVertical: 20 },
  linkSalirTexto: { color: "#999" },
});
