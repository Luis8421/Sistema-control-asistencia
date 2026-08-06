import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Platform } from "react-native";
import * as Location from "expo-location";
import * as Application from "expo-application";
import { marcarAsistencia, logout } from "../api/client";

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
      const dispositivoId = await obtenerDispositivoId();

      const resultado = await marcarAsistencia({
        tipo,
        latitud: ubicacion.latitud,
        longitud: ubicacion.longitud,
        precisionM: ubicacion.precisionM,
        dispositivoId,
      });

      setUltimoResultado({ ok: true, ...resultado });
    } catch (e) {
      const data = e.data || {};
      if (data.registro) {
        // El backend devuelve 422 cuando el marcaje se guarda pero es invalido
        setUltimoResultado({ ok: false, ...data });
      } else {
        Alert.alert("No se pudo registrar el marcaje", e.message || "Intenta nuevamente.");
      }
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

      {ultimoResultado && (
        <View
          style={[
            styles.resultado,
            { backgroundColor: ultimoResultado.registro?.valido ? "#e8f6ec" : "#fdecea" },
          ]}
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
