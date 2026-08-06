# App móvil — Marcaje de Asistencia (Fase 1 MVP)

App en React Native (Expo) con dos pantallas: login y marcaje de
entrada/salida. Captura el GPS del dispositivo y lo envía al backend, que
hace la validación real de geocerca.

## Requisitos
- Node.js 18+
- La app **Expo Go** instalada en tu celular (Android o iOS), o un emulador
- El backend corriendo (ver `../backend/README.md`)

## Instalación

```bash
cd mobile
npm install
```

## Antes de correr: configura la URL del backend

Edita `api/client.js` y cambia `API_URL` por la IP de tu computador en la
red local (no uses `localhost`, el celular no la vería):

```js
const API_URL = "http://192.168.1.50:4000/api"; // <- tu IP local, puerto 4000
```

- En un dispositivo físico con Expo Go: usa la IP local de tu PC
  (`ipconfig` en Windows, `ifconfig` o `ip a` en Mac/Linux). El celular y la
  PC deben estar en la misma red Wi-Fi.
- En el emulador de Android: puedes usar `http://10.0.2.2:4000/api`.
- En el simulador de iOS: puedes usar `http://localhost:4000/api`.

## Correr la app

```bash
npm start
```

Esto abre Expo Dev Tools. Escanea el código QR con la app Expo Go (Android)
o con la cámara (iOS) para abrir la app en tu celular.

## Flujo de prueba

1. Inicia sesión con `juan.perez@empresa.com` / `demo1234` (usuario creado
   por el `seed` del backend).
2. Presiona "Marcar Entrada". La app pedirá permiso de ubicación la primera
   vez.
3. Si estás dentro del radio autorizado de la bodega configurada en el
   backend, verás el mensaje de marcaje válido; si no, verás el motivo
   (fuera de rango, precisión insuficiente, etc.).

> Para probar un marcaje "válido" sin estar físicamente en la bodega real,
> ajusta la latitud/longitud de la bodega en `backend/src/seed.js` a tu
> ubicación actual y vuelve a correr `npm run seed`.

## Estructura

```
App.js                  # navegación (Login -> Marcaje)
screens/LoginScreen.js    # login
screens/MarcajeScreen.js  # captura GPS + marcaje entrada/salida
api/client.js              # llamadas HTTP al backend + manejo de token
```

## Notas de seguridad de ubicación

- Se usa `Location.Accuracy.BestForNavigation` para pedir la mejor
  precisión posible al sistema operativo.
- Se envía `precisionM` (accuracy) y la bandera `mocked` (Android) al
  backend, que es quien decide si el marcaje es válido — la app nunca
  decide esto por sí sola.

## Próximos pasos
- Pantalla de historial personal (`GET /api/asistencia/historial/:id`).
- Foto de verificación opcional al marcar (Fase 2).
- Notificaciones push cuando un marcaje queda "fuera de rango".
