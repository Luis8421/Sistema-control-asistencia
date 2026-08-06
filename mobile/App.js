import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import LoginScreen from "./screens/LoginScreen";
import RegistroScreen from "./screens/RegistroScreen";
import MarcajeScreen from "./screens/MarcajeScreen";

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Registro" component={RegistroScreen} />
        <Stack.Screen name="Marcaje" component={MarcajeScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
