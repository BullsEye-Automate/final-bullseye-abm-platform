# Peitho — Arquitectura técnica MVP: Flujo 1 (post-reunión) y Flujo 2 (pre-reunión)

Decisiones ya tomadas: agendamiento directo en **Google Calendar** (sin HubSpot Meetings ni Calendly), y el brief pre-reunión se entrega como **link a una página web**, insertado directamente en la descripción del evento de calendario — así el cliente lo ve justo donde ya va a mirar antes de la reunión, sin necesidad de infraestructura de email en el MVP.

---

## 0. Pieza compartida por ambos flujos: registro del evento

Cuando el SDR crea el evento en Google Calendar (con el link de Meet y los invitados), Peitho necesita enterarse en el momento.

**Cómo:** Google Calendar API tiene push notifications (`events.watch`) sobre el calendario del ejecutivo (no del SDR, porque es el ejecutivo quien va a estar en la llamada con la extensión corriendo). Cada vez que se crea o modifica un evento, Google manda un webhook a tu backend.

**Qué se guarda al registrar el evento** (tabla `meetings`):

| Campo | Ejemplo |
|---|---|
| `google_event_id` | id único del evento en Calendar |
| `meet_code` | el código de la URL de Meet (ej. `abc-defg-hij`) |
| `ejecutivo` | nombre/email del ejecutivo de Bullseye |
| `contraparte` | nombre del invitado externo |
| `empresa_contraparte` | dominio del correo del invitado, o inferido |
| `start_time` | fecha/hora de la reunión |
| `auto_capture` | `true` por defecto |
| `pre_brief_sent` | `false` por defecto |
| `status` | `scheduled` → `captured` → `analyzed` |

Este registro es el que consultan tanto la extensión (Flujo 1) como el job programado (Flujo 2).

---

## 1. Flujo 1 — Captura y análisis automático post-reunión

**Objetivo:** que al ejecutivo le llegue el feedback de la reunión sin que tenga que hacer nada manualmente, y sin que aparezca un bot en la llamada.

1. **Extensión de Chrome** (corre en segundo plano en el navegador del ejecutivo). Detecta cuando la pestaña activa navega a `meet.google.com/{codigo}`.
2. La extensión hace `GET /meetings/lookup?meet_code={codigo}` a tu backend.
3. Si el backend responde que ese código está registrado y `auto_capture=true`, la extensión arranca la captura de audio de la pestaña con `chrome.tabCapture` — sin unirse como participante adicional, sin aparecer en la lista de asistentes.
4. Al detectar que la pestaña se cerró o la llamada terminó, la extensión sube el archivo de audio: `POST /meetings/{id}/audio`.
5. **Backend:**
   - Transcribe el audio (Deepgram o Whisper, con diarización de hablantes)
   - Corre el prompt post-reunión v2 (el que ya calibramos) con la transcripción
   - Guarda el resultado JSON en `meetings.analysis`, `status=analyzed`
6. Notifica al ejecutivo/equipo que el feedback está listo (para el MVP, puede ser tan simple como un mensaje de Slack o un correo con el resumen — no se necesita dashboard propio todavía para esto).

**Nota de diseño:** el `meet_code` es la clave que conecta todo — es lo único que la extensión necesita para saber "¿esta reunión es de las que debo capturar?" sin tener que leer el calendario completo del ejecutivo desde el navegador.

---

## 2. Flujo 2 — Brief pre-reunión para el cliente

**Objetivo:** que el ejecutivo de tu cliente (a quien le agendaste la reunión) llegue mejor preparado.

1. **Job programado** (cron, corre cada 15-30 min): busca en `meetings` los registros donde `start_time` está entre "ahora" y "ahora + 2 horas" y `pre_brief_sent=false`.
2. Para cada uno:
   - Busca en `meetings` si existe un registro anterior con el mismo `contraparte` + `empresa_contraparte` y `status=analyzed` → si existe, extrae de su `analysis` los campos `compromisos`, `temas_pendientes`, `objeciones`, `tiempo_decision` (esto es el `{{HISTORIAL_PEITHO_JSON}}` del prompt pre-reunión)
   - Hace una búsqueda web simple del nombre de la empresa contraparte
   - Corre el prompt pre-reunión con todo ese contexto
3. **Genera la página web:** una ruta simple `GET /brief/{meeting_id}` que renderiza el JSON del brief en una página legible (server-side render, sin necesidad de un framework pesado — puede ser una plantilla HTML simple para el MVP)
4. **Inserta el link en el evento:** usando `events.patch` de la API de Calendar, agrega el link `https://peitho.tuapp.com/brief/{meeting_id}` a la descripción del evento — así el cliente lo ve directamente al abrir el evento en su calendario, sin necesitar un correo aparte
5. Marca `pre_brief_sent=true`

**Nota de diseño:** este flujo depende de que el Flujo 1 ya haya generado al menos un análisis previo para que el historial tenga contenido real — en la primera reunión con cualquier contacto, el brief simplemente indicará "primera reunión" (como ya lo maneja el prompt).

---

## 3. Orden de construcción sugerido

1. **Registro de eventos** (la pieza 0) — sin esto no funciona nada más
2. **Flujo 1 completo** — es el que genera los datos (`analysis`) que el Flujo 2 necesita como historial
3. **Flujo 2** — una vez que ya hay al menos algunas reuniones analizadas por el Flujo 1, tiene sentido y valor real

## 4. Fuera de scope del MVP

- Dashboard propio para ver todos los análisis (para el MVP, notificación directa por Slack/correo es suficiente)
- Reintentos automáticos si falla la transcripción o el webhook de Calendar
- Manejo de reuniones reprogramadas o canceladas (para el MVP, asumir que esto se maneja manualmente si ocurre)
