# Peitho — Contexto y progreso (backend)

> Este archivo lo lee Claude Code automáticamente al trabajar dentro de `peitho-backend/`.
> Actualízalo cada vez que se completa o se decide algo relevante, para no repetir contexto en sesiones futuras.

---

## Qué es Peitho

Producto de *conversation intelligence* para reuniones de venta B2B, construido por Bullseye-ABM. Dos casos de uso:

1. **Uso interno de Bullseye:** captura y analiza automáticamente las llamadas comerciales de sus propios SDRs (reemplaza DIIO).
2. **Producto para clientes de Bullseye** (ej. CCHC): genera un brief de preparación antes de una reunión que Bullseye le agendó a un prospecto del cliente.

Restricción de diseño clave: **no debe aparecer un bot visible en la llamada** — la captura de audio es vía extensión de Chrome (`chrome.tabCapture`) en el navegador del ejecutivo, no un participante que se une a la reunión.

Documentos de referencia completos en `docs/`:
- `docs/PEITHO_BRIEF_claude_code.md` — brief general, stack, las 8 tareas en orden
- `docs/peitho_arquitectura_tecnica_v1.md` — diseño de los 2 flujos (post-reunión y pre-reunión) y tabla `meetings`
- `docs/peitho_prompt_analisis_v1.md` — prompt de análisis post-reunión (ya calibrado con minutas reales)
- `docs/peitho_prompt_pre_reunion_v1.md` — prompt de brief pre-reunión

---

## Stack

- Node.js v20 + TypeScript, Express
- Postgres vía Supabase (proyecto "peitho" del usuario), acceso con `pg` (pool de conexión)
- Pendiente de integrar más adelante: Deepgram (STT + diarización), Anthropic API (Claude, para correr los prompts), Google Calendar API, Slack webhook, Railway/Render (deploy)

---

## Progreso de tareas (ver orden completo en `docs/PEITHO_BRIEF_claude_code.md`)

- [x] **Tarea 1** — Esqueleto backend + tabla `meetings` + `GET /health`. Completado y probado localmente contra Supabase (confirmado por el usuario: `{"status":"ok","db":"connected"}`).
- [x] **Tarea 2** — OAuth de Google Calendar + webhook `events.watch` → guarda eventos nuevos en `meetings`. Completada y confirmada por el usuario end-to-end: creó un evento de prueba con Meet + invitado en Google Calendar, y apareció en `meetings` con `meet_code`, `ejecutivo` y `contraparte` correctos.
- [x] **Tarea 3** — `GET /meetings/lookup?meet_code=xxx`. Completada y confirmada: responde `{"registered":true,...}` para un meet_code existente y `{"registered":false}` para uno inexistente.
- [x] **Tarea 4** — Extensión de Chrome (Manifest V3, `chrome.tabCapture`) + `POST /meetings/:id/audio`. Completada y confirmada end-to-end: detección automática (ícono celeste), clic del usuario para autorizar la captura (ícono rojo), subida del audio al cerrar la pestaña, y la fila en `meetings` pasó a `status=captured` con `audio_path` lleno.
- [x] **Tarea 5** — Pipeline de análisis post-reunión (Deepgram + prompt de `peitho_prompt_analisis_v1.md` vía Anthropic API → `meetings.analysis`). Completada y confirmada end-to-end: audio real (grabado desde un segundo dispositivo hablando en la llamada) → transcripción con Deepgram → análisis con Claude → `meetings.analysis` con el JSON completo y `status=analyzed`. **Fix de audio (mic + reconexión a parlantes) confirmado end-to-end** con una llamada real de dos personas (Jaime): el ejecutivo escuchó con normalidad durante toda la grabación (el bug original quedó resuelto). Tarea 5 dada por cerrada por el usuario.
- [ ] **Tarea 6** — Notificación de feedback listo (Slack o correo).
- [ ] **Tarea 7** — Cron del brief pre-reunión (historial + búsqueda web + prompt de `peitho_prompt_pre_reunion_v1.md`).
- [ ] **Tarea 8** — Página `GET /brief/:meetingId` + inserción del link vía `events.patch`.
- [ ] **(Al final, no es una de las 8)** Deploy a Railway o Render — el usuario decidió explícitamente dejarlo para el final; hasta entonces se prueba todo local con `npm run dev`.

**Regla de trabajo del usuario:** una tarea a la vez, probarla él mismo antes de avanzar a la siguiente. No adelantarse a tareas futuras sin que lo pida.

---

## Ideas para v2 (evaluar después, no ahora)

- **Bot que se une a la reunión como participante visible** (como DIIO/Gong), en vez de la extensión de Chrome. El usuario confirmó explícitamente que **no le importa** que se vea un bot en la llamada — la restricción "sin bot visible" del brief original ya no aplica como decisión de producto. Reemplazaría la Tarea 4 por completo: un servicio backend con Playwright que entra al link de Meet según el `start_time` de `meetings` (no según que el ejecutivo abra una pestaña), capturando audio vía WebRTC/dispositivo de audio virtual en vez de `chrome.tabCapture`. Es un desarrollo grande (varias sesiones), no una extensión de la Tarea 4 — evaluar viabilidad técnica antes de comprometerse. Decisión explícita: terminar primero la extensión de Chrome (Tarea 4) y avanzar con las Tareas 5-8; esto se evalúa después.

## Decisiones y aprendizajes (no repetir)

- El backend vive en `peitho-backend/` dentro de este mismo repo (`final-bullseye-abm-platform`), no en un repo separado — así no se gestiona infraestructura de git adicional.
- **Conexión a Supabase:** la connection string de "Direct connection" (`db.<ref>.supabase.co:5432`) falla con `ENOTFOUND` en la red del usuario porque ese hostname solo resuelve por IPv6. Usar siempre el **Session pooler** (`aws-0-<region>.pooler.supabase.com:5432`, usuario `postgres.<project-ref>`) en `DATABASE_URL`.
- Migraciones SQL simples en `migrations/*.sql`, corridas con `npm run migrate` (runner propio en `src/migrate.ts`, sin dependencias externas como Prisma/Knex — no se justifican para el tamaño actual del proyecto).
- La tabla `meetings` incluye únicamente los campos descritos en la sección 0 de `peitho_arquitectura_tecnica_v1.md` más metadata estándar (`id`, `created_at`, `updated_at`). Columnas de tareas futuras (ej. `analysis` de la Tarea 5) se agregan cuando corresponda, no antes.
- El proyecto Supabase del usuario se llama **"peitho"** (ya existía antes de empezar Tarea 1).
- **Google Calendar push notifications (`events.watch`) exigen una URL de webhook HTTPS pública** — no funciona con `localhost`. Para probar en local se usa ngrok (`ngrok http 3001`), seteando `GOOGLE_REDIRECT_URI` y `PUBLIC_BASE_URL` con esa URL. Riesgo conocido: Google puede exigir verificar el dominio del webhook en Search Console antes de aceptar el watch — si eso bloquea al usuario, evaluar probar directo en el deploy final (Railway/Render) en vez de forzarlo en local.
- `google.ts` valida las env vars de Google **dentro de las funciones**, no a nivel de módulo — si se valida al importar, el server entero no arranca (rompe `/health`) cuando el usuario todavía no configuró Google. Mantener este patrón para cualquier integración nueva que sea opcional/incremental.
- El scope de OAuth pedido es solo `calendar.readonly` (+ `userinfo.email`). La Tarea 8 (`events.patch` para insertar el link del brief) va a necesitar re-autorizar con un scope de escritura (`calendar.events`) — no está cubierto todavía.
- **La sincronización inicial de `events.list` necesita `timeMin` Y `timeMax`.** Sin `timeMax`, un evento recurrente sin fecha de fin hace que `singleEvents:true` devuelva cada ocurrencia futura sin parar (se manifestó como un "colgue" de varios minutos sin ningún error — en realidad estaba paginando cientos de eventos). Se acotó a una ventana de 90 días. Las sincronizaciones incrementales posteriores (con `syncToken`) no llevan estos filtros de tiempo.
- Todas las llamadas a la API de Google (`events.watch`, `events.list`) y al pool de Postgres (`connectionTimeoutMillis`) tienen timeouts explícitos + logs de progreso (`console.log('[watch] ...')` / `'[sync] ...'`) — sin esto, un problema de red se manifiesta como un colgue silencioso e indiagnosticable. Mantener este patrón (timeout + log de progreso) en las integraciones futuras que hagan llamadas de red externas (Deepgram, Anthropic API).
- Quedaron ~6 canales de `calendar_watch_channels` activos de las pruebas repetidas de esta tarea (cada llamada a `/calendar/watch` crea uno nuevo, no reemplaza el anterior) — todos apuntan al mismo webhook, así que un mismo evento se procesa varias veces en paralelo (no rompe nada por el `on conflict` en `meetings`, pero es redundante). Se limpiaron con `src/scripts/stopStaleChannels.ts` (dado de baja con `channels.stop` + borrado de la fila) — correr ese script si se vuelve a acumular.
- **La extensión de Chrome (`peitho-chrome-extension/`) apunta a `http://localhost:3001` directo, sin ngrok** — corre en el mismo Mac que el backend, así que no necesita el túnel público (eso solo es necesario para que Google *entre* al webhook desde internet, no para que la extensión *salga* hacia localhost).
- **`chrome.tabCapture` no se puede grabar desde el service worker** (no tiene acceso a `MediaRecorder`/`getUserMedia`, no tiene DOM). El patrón MV3 correcto es: el service worker consigue el `streamId` con `chrome.tabCapture.getMediaStreamId()`, y un **offscreen document** (`chrome.offscreen.createDocument`, `offscreen.html`/`offscreen.js`) hace la grabación real y sube el archivo.
- El audio se guarda en `peitho-backend/uploads/` (disco local, gitignored) — funciona para probar en local, pero **no sirve para el deploy final** (Railway/Render suelen tener filesystem efímero). Antes de desplegar, evaluar mover esto a Supabase Storage o S3.
- **`chrome.tabCapture` no se puede activar 100% en automático desde el background — Chrome exige un gesto del usuario** (ej. clic en el ícono de la extensión) para autorizarlo, es una restricción de seguridad de la plataforma, no algo evitable con código (se confirmó probando: error real "Extension has not been invoked for the current page (see activeTab permission)"). El diseño quedó así: detección automática (ícono se pone celeste) + un clic del ejecutivo para arrancar la grabación (ícono se pone rojo) vía `chrome.action.onClicked`. Esto no rompe el requisito de "sin bot visible en la llamada" (el clic es local, nadie más lo ve), pero sí significa que no es 100% zero-touch.
- **Modelo de Claude usado: `claude-sonnet-5`** (el actual, reemplaza al `claude-sonnet-4-6` que sugería el brief original — mismo precio, mejor calidad). Con `thinking: {type: 'disabled'}` explícito — es una tarea de extracción/evaluación de un solo paso sobre una transcripción ya dada, no necesita razonamiento extendido, y evita el riesgo de que `max_tokens` se consuma entre thinking + la respuesta JSON (en Sonnet 5, si no se especifica `thinking`, corre adaptive por defecto y comparte el mismo `max_tokens`).
- El prompt de análisis se separó en dos partes para aprovechar **prompt caching**: la parte fija (instrucciones + esquema, `ANALISIS_SYSTEM_PROMPT`) va como `system` con `cache_control: ephemeral`, y el contexto variable de cada reunión (empresa, ejecutivo, contraparte, transcripción) va en el mensaje de usuario. Así solo se paga precio completo de esa parte fija una vez por ventana de caché, no en cada reunión.
- `EMPRESA_CLIENTE` ("BullsEye") y `PLAYBOOK` ("Ventas") están **hardcodeados** en `postMeetingAnalysis.ts` — Peitho todavía no modela múltiples clientes/empresas (eso es una idea de la plataforma BullsEye ABM, no de Peitho en su MVP actual). Si Peitho se usa para más de una empresa cliente, esto hay que revisarlo.
- Sin diarización por rol, Deepgram solo distingue "hablante 0, hablante 1, ..." por voz — se asume que el primer hablante que aparece cronológicamente es el ejecutivo (quien inicia la llamada), tal como sugiere la arquitectura del prompt. Con 3+ hablantes distintos, todos los que no son el primero se etiquetan igual como "Contraparte" (simplificación del MVP).
- **Bug crítico detectado probando la Tarea 5 con una segunda persona real ("Jaime") en la llamada: `chrome.tabCapture` capturaba solo el audio entrante de la pestaña, nunca el micrófono, y además dejaba al ejecutivo sin poder escuchar al otro participante mientras grababa.** Causa raíz (confirmada investigando el sample oficial de Google, `functional-samples/sample.tabcapture-recorder`): capturar el stream de audio de una pestaña vía `getUserMedia({chromeMediaSource:'tab'})` lo desvía de los parlantes normales — hay que reconectarlo explícitamente. Esto también significaba que la voz del propio ejecutivo nunca se grababa, solo lo que él escuchaba. Fix implementado en `offscreen.js`: se capturan ambos streams (tab + mic) y se mezclan con la Web Audio API (`AudioContext.createMediaStreamDestination()`), y el stream de la pestaña se reconecta también a `audioContext.destination` para que el ejecutivo lo siga escuchando con normalidad. Complicación adicional: **un offscreen document no puede mostrar el diálogo de permiso de micrófono de Chrome** (no tiene UI visible) — `getUserMedia({audio:true})` falla directo con `NotAllowedError` la primera vez. Se resolvió con una página de configuración de una sola vez (`mic-permission.html`/`.js`, abierta como pestaña normal vía `chrome.tabs.create`, gatillada después del primer clic en el ícono si `chrome.storage.local` no tiene `micPermissionGranted`) — el permiso concedido ahí queda guardado por origen (`chrome-extension://<id>`) y el offscreen document (mismo origen) puede usarlo después sin volver a preguntar. Si el usuario nunca hace esa configuración, la extensión sigue grabando solo el audio entrante (degradación aceptable, no bloquea nada) — se loguea un `console.warn` con la URL exacta a abrir.
- **Confirmado con la prueba real de dos personas:** el fix de audio (mic + reconexión a parlantes) funcionó — el ejecutivo escuchó a la otra persona con normalidad durante toda la grabación. Se descartó por código (revisando `routes/meetings.ts` y `postMeetingAnalysis.ts`) la hipótesis de que un análisis viejo quedara "pegado" al reusar el mismo link de Meet: cada subida de audio genera un archivo con nombre único (`${id}-${Date.now()}.webm`), sobreescribe `audio_path`, y `analyzeMeetingAudio` siempre transcribe ese archivo nuevo y sobreescribe `analysis` — no hay caché ni reuso de texto anterior. Lo que sí se observó en esa prueba: Deepgram detectó un solo hablante en vez de dos (todo salió etiquetado "Ejecutivo" por el heurístico de "primer hablante"), probablemente por ser una llamada corta y/o mezcla de audio en un solo canal — limitación de diarización ya documentada más arriba, no relacionada con el bug de audio. El usuario decidió explícitamente dar la Tarea 5 por cerrada sin investigar esto más a fondo por ahora (aceptado como limitación conocida del MVP).

---

## Cómo correr y probar localmente

```bash
cd peitho-backend
cp .env.example .env   # completar DATABASE_URL con el Session pooler de Supabase
npm install
npm run migrate        # crea la tabla meetings
npm run dev             # levanta el servidor en :3001
curl http://localhost:3001/health
```

Respuesta esperada: `{"status":"ok","db":"connected","timestamp":"..."}`.
