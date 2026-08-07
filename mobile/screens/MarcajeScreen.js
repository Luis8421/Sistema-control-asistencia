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

export default function MarcajeScreen({ route, navigation }) {
  const { empleado } = route.params;
  const [cargando, setCargando] = useState(null); // "entrada" | "salida" | null
  const [ultimoResultado, setUltimoResultado] = useState(null);

  async function capturarUbicacion() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      throw new Error("Se necesita permiso de ubicacion para marcar asistencia.");
    }

    const posicion = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.BestForNavigation,
    });

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
    try {
      const ubicacion = await capturarUbicacion();

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
  resultado: { marginTop: 28, padding: 16, borderRadius: 10 },
  resultadoTexto: { fontSize: 14, color: "#333" },
  linkSalir: { marginTop: "auto", alignItems: "center", paddingVertical: 20 },
  linkSalirTexto: { color: "#999" },
});
