# Peitho — Brief para Claude Code

Este documento reúne todo lo necesario para empezar a construir. Tráete también estos 3 archivos ya creados — Claude Code los va a necesitar como referencia:

- `peitho_prompt_analisis_v1.md` — prompt post-reunión (calibrado con 5 minutas reales)
- `peitho_prompt_pre_reunion_v1.md` — prompt pre-reunión
- `peitho_arquitectura_tecnica_v1.md` — diseño de los 2 flujos

## Cómo usar esto

1. Crea una carpeta/repo nuevo para el proyecto
2. Copia estos 4 archivos (los 3 anteriores + este) a la raíz del repo
3. Abre Claude Code en esa carpeta
4. Pégale el contenido de este archivo como primer mensaje, o dile "lee PEITHO_BRIEF.md y los otros 3 archivos .md de esta carpeta antes de empezar"
5. Pide que empiece por la Tarea 1 — no le pidas que construya todo de una vez, ve tarea por tarea y prueba cada una antes de avanzar

---

## Contexto del proyecto (para que Claude Code entienda el "por qué")

Peitho es un producto de conversation intelligence para reuniones de venta B2B, construido por Bullseye-ABM. Dos casos de uso en paralelo:

1. **Uso interno de Bullseye:** cuando su SDR agenda una reunión comercial (Bullseye vendiendo su servicio ABM a un prospecto), Peitho debe capturar y analizar automáticamente esa llamada — reemplazando la herramienta que usan hoy (DIIO).
2. **Producto para clientes de Bullseye:** cuando Bullseye le agenda una reunión a uno de sus clientes (ej. la Cámara Chilena de la Construcción, CCHC) con un prospecto del cliente, Peitho debe generarle a ese cliente un brief de preparación antes de la reunión.

Restricción de diseño importante: **no debe aparecer un bot visible en la llamada** (a diferencia de herramientas como Gong/DIIO que se unen como participante). La captura de audio se hace vía extensión de Chrome corriendo localmente en el navegador del ejecutivo, no uniéndose a la reunión como asistente.

---

## Stack técnico recomendado (ajustable — esto es un punto de partida razonable, no una obligación)

| Pieza | Recomendación | Por qué |
|---|---|---|
| Backend | Node.js + TypeScript (Express o Fastify) | Mismo lenguaje que la extensión de Chrome, simplifica compartir tipos/lógica |
| Base de datos | Postgres (vía Supabase para evitar gestionar infraestructura en el MVP) | Supabase da Postgres + hosting + auth con setup mínimo |
| Transcripción (STT) | Deepgram | Buena diarización de hablantes (necesaria para separar ejecutivo/contraparte), API simple |
| Análisis (LLM) | Anthropic API (Claude), modelo `claude-sonnet-4-6` | Los prompts ya están escritos y probados contra minutas reales |
| Extensión de captura | Chrome Extension Manifest V3, `chrome.tabCapture` | Permite capturar audio de la pestaña sin unirse como participante |
| Hosting backend | Railway o Render | Deploy simple para un backend Node pequeño |
| Calendario | Google Calendar API (`events.watch` para push notifications, `events.patch` para insertar el link del brief) | Ya decidido — agendamiento directo en Calendar, sin HubSpot Meetings |

## Credenciales / cuentas que vas a necesitar antes de empezar a codear

- [ ] Proyecto en Google Cloud Console con **Calendar API** habilitada + credenciales OAuth (client ID/secret) para el calendario del ejecutivo
- [ ] Cuenta y API key de **Anthropic** (para correr los prompts)
- [ ] Cuenta y API key de **Deepgram** (o Whisper de OpenAI como alternativa)
- [ ] Cuenta de **Supabase** (o Postgres propio) para la base de datos
- [ ] Cuenta de **Railway/Render** para desplegar el backend

---

## Tareas en orden (dáselas a Claude Code una por una)

**Tarea 1 — Esqueleto del backend + base de datos**
Crear el proyecto Node/TypeScript, conectar a Postgres/Supabase, crear la tabla `meetings` con los campos descritos en `peitho_arquitectura_tecnica_v1.md` sección 0. Un endpoint de salud (`GET /health`) para confirmar que corre.

**Tarea 2 — Integración con Google Calendar**
Implementar el flujo OAuth para conectar el calendario del ejecutivo, y el webhook (`events.watch`) que detecta eventos nuevos y los guarda en `meetings`. Probarlo creando un evento de prueba manualmente y viendo que aparece en la base de datos.

**Tarea 3 — Endpoint de lookup para la extensión**
`GET /meetings/lookup?meet_code=xxx` — dado un código de Meet, responde si esa reunión está registrada y debe capturarse. Este es el endpoint que va a llamar la extensión.

**Tarea 4 — Extensión de Chrome (captura)**
Manifest V3. Detecta navegación a `meet.google.com/*`, llama al endpoint de la Tarea 3, y si corresponde, activa `chrome.tabCapture` para grabar el audio de la pestaña. Al terminar la llamada, sube el archivo (`POST /meetings/:id/audio`).

**Tarea 5 — Pipeline de análisis post-reunión**
El backend recibe el audio, lo transcribe con Deepgram, corre el prompt de `peitho_prompt_analisis_v1.md` contra la transcripción usando la API de Anthropic, y guarda el resultado JSON en `meetings.analysis`.

**Tarea 6 — Notificación de feedback listo**
Cuando el análisis termina, notificar (empezar simple: un mensaje a un canal de Slack via webhook, o un correo) — no se necesita dashboard propio todavía.

**Tarea 7 — Job programado del brief pre-reunión**
Cron que corre cada 15-30 min, busca reuniones próximas sin brief enviado, junta el historial (`meetings` anteriores del mismo contacto) + búsqueda web básica, corre el prompt de `peitho_prompt_pre_reunion_v1.md`, y genera el JSON del brief.

**Tarea 8 — Página web del brief + inserción en el evento**
Ruta `GET /brief/:meetingId` que renderiza el JSON del brief en una página simple. Luego, usar `events.patch` de Calendar para insertar ese link en la descripción del evento.

---

## Nota sobre cómo trabajar con Claude Code en esto

Dado que son 8 tareas con dependencias entre sí (la 2 depende de la 1, la 5 depende de la 2-4, etc.), lo más efectivo es pedirle a Claude Code que resuelva una tarea, la pruebes tú (aunque sea manualmente), y recién ahí avances a la siguiente — en vez de pedirle todo el proyecto de una vez. Esto también te da puntos de control para ajustar decisiones (ej. cambiar Deepgram por Whisper) sin haber construido encima de una base equivocada.
