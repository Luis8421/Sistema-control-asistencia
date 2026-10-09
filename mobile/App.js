import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import LoginScreen from "./screens/LoginScreen";
import MarcajeScreen from "./screens/MarcajeScreen";

const Stack = createNativeStackNavigator();

// No hay pantalla de autoregistro: un empleado solo puede entrar si un
// administrador lo dio de alta antes (codigo de empleado + PIN) desde el
// panel web. Ver backend/src/routes/auth.js.
export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Marcaje" component={MarcajeScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
