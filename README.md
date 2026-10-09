# Sistema de Control de Asistencia con Geolocalización

Marcaje de entrada/salida validado por GPS contra la geocerca de la
bodega asignada a cada empleado. La validación de geocerca (Haversine) es
**obligatoria y bloqueante** en el backend: un marcaje fuera de rango, con
GPS impreciso/simulado, o que rompe la secuencia del día (dos entradas
seguidas, etc.) se rechaza y no se guarda — ver `backend/README.md` para
el detalle completo.

## Contenido

- **`backend/`** — API Node.js + Express + SQLite local o Supabase PostgreSQL
  mediante `pg` en producción. Geovalidación,
  auditoría de acciones administrativas, indicadores de puntualidad,
  reportes Excel/PDF, dashboard, y una suite de tests automatizados
  (`npm test`) sobre la lógica de geovalidación y secuencia de marcaje.
- **`mobile/`** — App React Native (Expo) con login y pantalla de marcaje
  que captura el GPS del dispositivo.
- **`web/`** — Dos superficies distintas, ambas con login JWT real:
  - **Panel de administración** (`index.html`, `empleados.html`,
    `geocercas.html`, `marcaciones.html`, `indicadores.html`,
    `auditoria.html`) para supervisor/admin.
  - **Portal de Asistencia** (`marcaje.html`) — el punto único de marcaje
    para todo el personal, instalable como PWA en Android/iPhone/escritorio.
- **`scripts/`** — herramientas de desarrollo que no son parte del
  runtime (ej. `generar-iconos-pwa.js`).

## Orden para probarlo

1. Sigue `backend/README.md` para levantar la API (instala, migra, siembra
   datos de ejemplo, corre `npm run dev`, corre `npm test`).
2. Abre `web/marcaje.html` (Portal de Asistencia) o sigue `mobile/README.md`
   para correr la app en tu celular con Expo Go.
3. En el Portal y en la app móvil, ingresa el código y PIN/contraseña
   asignados al empleado (en los datos de ejemplo: `EMP-001` / `demo1234`). Prueba
   "Marcar Entrada".
4. Para el panel de administración, abre `web/login.html` e inicia sesión
   con `ADM-001` / `demo1234`.

## Qué sigue

- Turnos rotativos que cambian de horario/días semana a semana (hoy
  `empleados.dias_laborables` cubre días fijos, no rotación).
- Notificaciones (correo, push).
- Modo offline para el marcaje en sí (la PWA da carga rápida e
  instalabilidad, no marcaje sin conexión — marcar siempre requiere
  backend en vivo, es la única fuente de verdad de la geovalidación).
- Preparación para reconocimiento facial.
