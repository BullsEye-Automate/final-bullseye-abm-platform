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
- [ ] **Tarea 4** — Extensión de Chrome (Manifest V3, `chrome.tabCapture`).
- [ ] **Tarea 5** — Pipeline de análisis post-reunión (Deepgram + prompt de `peitho_prompt_analisis_v1.md` vía Anthropic API → `meetings.analysis`).
- [ ] **Tarea 6** — Notificación de feedback listo (Slack o correo).
- [ ] **Tarea 7** — Cron del brief pre-reunión (historial + búsqueda web + prompt de `peitho_prompt_pre_reunion_v1.md`).
- [ ] **Tarea 8** — Página `GET /brief/:meetingId` + inserción del link vía `events.patch`.
- [ ] **(Al final, no es una de las 8)** Deploy a Railway o Render — el usuario decidió explícitamente dejarlo para el final; hasta entonces se prueba todo local con `npm run dev`.

**Regla de trabajo del usuario:** una tarea a la vez, probarla él mismo antes de avanzar a la siguiente. No adelantarse a tareas futuras sin que lo pida.

---

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
- Quedaron ~6 canales de `calendar_watch_channels` activos de las pruebas repetidas de esta tarea (cada llamada a `/calendar/watch` crea uno nuevo, no reemplaza el anterior) — todos apuntan al mismo webhook, así que un mismo evento se procesa varias veces en paralelo (no rompe nada por el `on conflict` en `meetings`, pero es redundante). Limpiar si molesta, no bloquea las tareas siguientes.

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
