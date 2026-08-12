# Peitho — Backend

Esqueleto del backend de Peitho (Tarea 1): servidor Node.js + TypeScript conectado a Postgres (Supabase), con la tabla `meetings` y un endpoint de salud.

## Requisitos

- Node.js v20+
- Un proyecto de Supabase (o cualquier Postgres) con su connection string

## Setup

```bash
cd peitho-backend
npm install
cp .env.example .env
```

Edita `.env` y pega tu connection string de Supabase en `DATABASE_URL`:

> Supabase Dashboard → tu proyecto → **Project Settings → Database → Connection string → URI**

## Crear la tabla `meetings`

```bash
npm run migrate
```

Esto crea la tabla `meetings` (y una tabla auxiliar `_migrations` para no reaplicar el mismo script dos veces). Deberías ver en la consola:

```
Aplicando migración: 001_create_meetings.sql
Migraciones al día.
```

**Cómo verificarlo tú mismo:** en Supabase Studio → Table Editor, debería aparecer la tabla `meetings` con las columnas `google_event_id`, `meet_code`, `ejecutivo`, `contraparte`, `empresa_contraparte`, `start_time`, `auto_capture`, `pre_brief_sent`, `status`.

## Levantar el servidor

```bash
npm run dev
```

Deberías ver:

```
Peitho backend escuchando en http://localhost:3001
```

## Probar el endpoint de salud

```bash
curl http://localhost:3001/health
```

Respuesta esperada si todo está bien (servidor arriba + conexión a Postgres funcionando):

```json
{"status":"ok","db":"connected","timestamp":"..."}
```

Si `DATABASE_URL` está mal (o Supabase está caído), el mismo endpoint responde con status HTTP 503 y `{"status":"error","db":"disconnected",...}` — así confirmas que el chequeo realmente está probando la conexión, no solo si el proceso está vivo.

---

## Tarea 2 — Google Calendar (OAuth + webhook `events.watch`)

Este flujo detecta cuando el ejecutivo crea/modifica un evento en su Google Calendar y lo guarda en `meetings`. Requiere dos cosas que Google exige y que no existían en la Tarea 1:

1. Un proyecto en Google Cloud Console con OAuth para conectar el calendario del ejecutivo.
2. Una **URL pública HTTPS** donde Google te mande el webhook — `localhost` no funciona para esto. En local se resuelve con un túnel (ngrok).

### 1. Crear las credenciales en Google Cloud Console

1. Ve a [console.cloud.google.com](https://console.cloud.google.com) → crea un proyecto (o usa uno existente).
2. **APIs & Services → Library** → busca **Google Calendar API** → habilítala.
3. **APIs & Services → OAuth consent screen**:
   - Tipo: **External**.
   - Completa los campos obligatorios (nombre de la app, email de soporte).
   - En **Test users**, agrega el email de Gmail del ejecutivo cuyo calendario vas a conectar (mientras la app no esté verificada por Google, solo estos usuarios pueden autorizarla).
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Tipo de aplicación: **Web application**.
   - En **Authorized redirect URIs**, agrega tu URL de callback (la defines en el paso 2, ya con el dominio de ngrok).
   - Copia el **Client ID** y **Client Secret**.

### 2. Levantar un túnel público (ngrok)

```bash
brew install ngrok   # si no lo tienes
ngrok http 3001
```

Ngrok te va a dar una URL como `https://abcd1234.ngrok-free.app`. Úsala para completar:

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://abcd1234.ngrok-free.app/auth/google/callback
PUBLIC_BASE_URL=https://abcd1234.ngrok-free.app
```

Y agrega exactamente esa misma `GOOGLE_REDIRECT_URI` en **Authorized redirect URIs** del OAuth client (paso 1.4).

> **Ojo:** el plan gratis de ngrok cambia la URL cada vez que lo reinicias. Si eso pasa, tienes que actualizar `GOOGLE_REDIRECT_URI`/`PUBLIC_BASE_URL` en `.env` **y** el redirect URI en Google Cloud Console con la nueva URL, y volver a autorizar. Un plan pagado de ngrok (o una static domain gratuita de tu cuenta) evita este problema — si te da lata, avísame y lo dejamos fijo antes de seguir.
>
> **Posible bloqueo a tener en cuenta:** Google puede exigir verificar el dominio del webhook en Google Search Console antes de aceptar `events.watch` sobre un dominio nuevo. Si al registrar el watch (paso 4) te sale un error de verificación de dominio, avísame — hay que verificar el dominio de ngrok (o pasar a probarlo directo en un deploy real, que es lo que vamos a hacer en el paso final igual).

### 3. Reinstala dependencias y corre la migración nueva

```bash
npm install
npm run migrate
```

Deberías ver `Aplicando migración: 002_create_google_calendar_tables.sql`.

### 4. Conectar el calendario del ejecutivo

Con el servidor corriendo (`npm run dev`) y el túnel de ngrok activo:

1. Abre en el navegador: `https://abcd1234.ngrok-free.app/auth/google` (o `http://localhost:3001/auth/google`, redirige igual)
2. Inicia sesión con la cuenta de Gmail del ejecutivo (la que agregaste como test user) y acepta los permisos
3. Te redirige de vuelta y deberías ver: `Cuenta de Google conectada: ejecutivo@gmail.com...`

### 5. Registrar el watch (push notifications)

```bash
curl -X POST http://localhost:3001/calendar/watch \
  -H "Content-Type: application/json" \
  -d '{"google_account_email": "ejecutivo@gmail.com"}'
```

Respuesta esperada: `{"status":"ok","channel_id":"...","expiration":"..."}`.

### 6. Probarlo con un evento real

1. En el Google Calendar de esa cuenta, crea un evento nuevo con Google Meet incluido (agrega un invitado con otro email para simular la contraparte).
2. Espera unos segundos (el webhook llega casi al instante).
3. Verifica en Supabase → Table Editor → `meetings`: debería aparecer una fila nueva con `meet_code`, `ejecutivo`, `contraparte`, `empresa_contraparte` y `start_time` completos.

Si no aparece nada, revisa los logs de `npm run dev` (ahí se loguea cualquier error del webhook o del sync) y la consola de ngrok (`http://127.0.0.1:4040`) para ver si Google efectivamente está llamando al webhook.

### Limpiar canales de watch duplicados

Cada `POST /calendar/watch` crea un canal nuevo sin borrar los anteriores. Si registraste el watch varias veces (por pruebas), limpia los viejos así:

```bash
npx tsx src/scripts/stopStaleChannels.ts ejecutivo@gmail.com
```

Esto avisa a Google (`channels.stop`) y borra de la base todos los canales de esa cuenta excepto el más reciente.

---

## Tarea 3 — Endpoint de lookup para la extensión

`GET /meetings/lookup?meet_code=xxx` — dado el código de una URL de Meet, responde si esa reunión está registrada en `meetings` y si se debe capturar. Este es el endpoint que la extensión de Chrome (Tarea 4) va a llamar cada vez que detecte que el usuario entró a una llamada.

### Probarlo

Con el servidor corriendo y al menos una reunión ya en la tabla `meetings` (la del evento de prueba de la Tarea 2, por ejemplo):

```bash
# Con el meet_code de una reunión que sí existe en la tabla
curl "http://localhost:3001/meetings/lookup?meet_code=qxu-axoo-ybe"
```

Respuesta esperada:
```json
{"registered":true,"meeting_id":"...","auto_capture":true}
```

```bash
# Con un código que no existe
curl "http://localhost:3001/meetings/lookup?meet_code=xxx-yyyy-zzz"
```

Respuesta esperada:
```json
{"registered":false}
```

---

## Tarea 4 — Endpoint de subida de audio (para la extensión de Chrome)

`POST /meetings/:id/audio` — recibe el archivo de audio grabado por la extensión (carpeta `peitho-chrome-extension/`, ver su propio README), lo guarda en `uploads/` y marca la reunión como `status='captured'`. La transcripción/análisis de ese audio es la Tarea 5 — todavía no está implementada, por ahora solo se guarda el archivo.

### Probarlo directo con curl (sin la extensión)

Usa el `meeting_id` de una reunión real (el que te devuelve `/meetings/lookup`):

```bash
echo "audio de prueba" > /tmp/prueba.webm
curl -X POST http://localhost:3001/meetings/<meeting_id>/audio \
  -F "audio=@/tmp/prueba.webm"
```

Respuesta esperada: `{"status":"ok"}`. Verifica que apareció el archivo en `peitho-backend/uploads/` y que la fila en Supabase cambió `status` a `captured` con `audio_path` lleno.

### Probarlo con la extensión real

Ver `peitho-chrome-extension/README.md` — tiene el paso a paso completo (cargar la extensión en Chrome, entrar a una reunión de Meet registrada, y confirmar que el audio real llega al backend).

---

## Tarea 5 — Transcripción y análisis post-reunión

Al terminar la Tarea 4 (subir el audio), el backend dispara automáticamente en segundo plano:
1. **Transcripción con Deepgram** (`nova-2`, español, con diarización de hablantes)
2. **Análisis con Claude** (Anthropic API, `claude-sonnet-5`) usando el prompt calibrado de `docs/peitho_prompt_analisis_v1.md`
3. Guarda el JSON resultante en `meetings.analysis` y marca `status='analyzed'`

No hay un endpoint nuevo que llamar — se dispara solo desde `POST /meetings/:id/audio` (`src/postMeetingAnalysis.ts`).

### Configurar las API keys

En tu `.env`:
```
DEEPGRAM_API_KEY=tu-key-de-deepgram
ANTHROPIC_API_KEY=tu-key-de-anthropic
```

### Probarlo

Necesitas un audio con **voz real** (a diferencia de la Tarea 4, donde un archivo vacío/silencioso bastaba) — Deepgram no puede transcribir silencio. La forma más simple es repetir la prueba de la extensión (Tarea 4) hablando unos segundos de verdad frente al micrófono en la pestaña de Meet.

1. Con el backend corriendo y las API keys configuradas, entra a la reunión de prueba, haz clic en el ícono de la extensión, **habla un par de frases** ("Hola, esto es una prueba de Peitho, quiero agendar una demo la próxima semana"), y cierra la pestaña
2. En la terminal de `npm run dev` deberías ver la secuencia:
   ```
   [audio] guardado .../uploads/<id>-....webm para la reunión <id>
   [analysis] reunión <id>: buscando datos...
   [analysis] reunión <id>: transcribiendo con Deepgram...
   [analysis] reunión <id>: corriendo el prompt de análisis con Claude...
   [analysis] reunión <id>: análisis guardado, status=analyzed
   ```
3. Verifica en Supabase → Table Editor → `meetings`: la fila debería tener `status=analyzed` y la columna `analysis` con el JSON completo (predicción de éxito, métricas de desempeño, compromisos, etc.)

Si algo falla, el error queda logueado como `[analysis] falló el análisis de la reunión <id> ...` — no rompe la respuesta HTTP a la extensión (el audio ya se guardó bien de todas formas).

## Estructura

```
peitho-backend/
├── migrations/
│   ├── 001_create_meetings.sql               ← tabla meetings
│   ├── 002_create_google_calendar_tables.sql ← credenciales OAuth + canales de watch
│   ├── 003_add_audio_path_to_meetings.sql    ← columna audio_path
│   └── 004_add_analysis_to_meetings.sql      ← columna analysis (jsonb)
├── src/
│   ├── app.ts                    ← configuración de Express y rutas
│   ├── db.ts                     ← pool de conexión a Postgres
│   ├── google.ts                 ← OAuth client + credenciales por cuenta de Google
│   ├── calendarSync.ts           ← trae los cambios del calendario y los guarda en meetings
│   ├── postMeetingAnalysis.ts    ← transcribe con Deepgram + analiza con Claude
│   ├── migrate.ts                ← corredor simple de migraciones SQL
│   ├── prompts/
│   │   └── analisisPostReunion.ts ← prompt calibrado (instrucciones + esquema)
│   ├── scripts/
│   │   └── stopStaleChannels.ts  ← limpieza manual de canales de watch viejos
│   ├── routes/
│   │   ├── health.ts             ← GET /health
│   │   ├── auth.ts               ← GET /auth/google, GET /auth/google/callback
│   │   ├── calendar.ts           ← POST /calendar/watch, POST /webhooks/google-calendar
│   │   └── meetings.ts           ← GET /meetings/lookup, POST /meetings/:id/audio
│   └── server.ts                 ← punto de entrada
├── uploads/                       ← audio grabado por la extensión (no se sube a git)
├── .env.example
└── package.json
```

La extensión de Chrome (Tarea 4) vive en `../peitho-chrome-extension/` — es un proyecto separado, no un paquete npm de este backend.
