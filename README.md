# Sistema de Control de Asistencia con Geolocalización — Fase 1 (MVP)

Código fuente inicial correspondiente a la Fase 1 del documento técnico:
marcaje de entrada/salida validado por GPS contra la geocerca de la bodega
asignada a cada empleado.

## Contenido

- **`backend/`** — API Node.js + Express + SQLite. Valida cada marcaje con
  la fórmula de Haversine contra el radio autorizado de la bodega, y guarda
  el historial completo (válido e inválido) para trazabilidad.
  Ya probado end-to-end (login, marcaje válido, marcaje fuera de rango,
  historial).
- **`mobile/`** — App React Native (Expo) con login y pantalla de marcaje
  que captura el GPS del dispositivo.
- **`web/`** — Panel de administración (HTML + CSS + JS plano, Bootstrap)
  para supervisar marcaciones y gestionar empleados y geocercas. Fase 2.

## Orden para probarlo

1. Sigue `backend/README.md` para levantar la API (instala, migra, siembra
   datos de ejemplo, corre `npm run dev`).
2. Sigue `mobile/README.md` para correr la app en tu celular con Expo Go,
   apuntando `API_URL` a la IP local de tu backend.
3. Inicia sesión en la app con `juan.perez@empresa.com` / `demo1234` y
   prueba "Marcar Entrada".

## Qué sigue (Fase 3 en adelante)

Según el documento técnico:
- Cálculo de indicadores (puntualidad, atrasos, ausencias, horas
  trabajadas) y reportes exportables.
- Horarios/turnos configurables desde el panel.
- Integración con nómina/ERP.
- Notificaciones (correo, push).
