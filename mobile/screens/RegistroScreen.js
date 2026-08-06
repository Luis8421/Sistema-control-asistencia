import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { registro } from "../api/client";

export default function RegistroScreen({ navigation }) {
  const [nombreCompleto, setNombreCompleto] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  async function handleRegistro() {
    setError(null);
    setCargando(true);
    try {
      const empleado = await registro(nombreCompleto.trim(), email.trim(), password);
      navigation.replace("Marcaje", { empleado });
    } catch (e) {
      setError(e.data?.error || "No se pudo crear la cuenta");
    } finally {
      setCargando(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Text style={styles.titulo}>Crear cuenta</Text>
      <Text style={styles.subtitulo}>Regístrate como empleado</Text>

      <TextInput
        style={styles.input}
        placeholder="Nombre completo"
        value={nombreCompleto}
        onChangeText={setNombreCompleto}
      />
      <TextInput
        style={styles.input}
        placeholder="Correo electronico"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Contraseña"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.boton} onPress={handleRegistro} disabled={cargando}>
        {cargando ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.botonTexto}>Crear cuenta</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.linkVolver} onPress={() => navigation.navigate("Login")}>
        <Text style={styles.linkVolverTexto}>Ya tengo cuenta, iniciar sesion</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "#fff" },
  titulo: { fontSize: 26, fontWeight: "700", color: "#1F4E5F", marginBottom: 4, textAlign: "center" },
  subtitulo: { fontSize: 14, color: "#666", marginBottom: 32, textAlign: "center" },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    padding: 14,
    marginBottom: 14,
    fontSize: 15,
  },
  boton: {
    backgroundColor: "#2E86AB",
    borderRadius: 10,
    padding: 16,
    alignItems: "center",
    marginTop: 8,
  },
  botonTexto: { color: "#fff", fontWeight: "600", fontSize: 16 },
  error: { color: "#c0392b", marginBottom: 10, textAlign: "center" },
  linkVolver: { marginTop: 20, alignItems: "center" },
  linkVolverTexto: { color: "#2E86AB", fontSize: 14 },
});
