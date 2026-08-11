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

## Estructura

```
peitho-backend/
├── migrations/
│   ├── 001_create_meetings.sql               ← tabla meetings
│   └── 002_create_google_calendar_tables.sql ← credenciales OAuth + canales de watch
├── src/
│   ├── app.ts                    ← configuración de Express y rutas
│   ├── db.ts                     ← pool de conexión a Postgres
│   ├── google.ts                 ← OAuth client + credenciales por cuenta de Google
│   ├── calendarSync.ts           ← trae los cambios del calendario y los guarda en meetings
│   ├── migrate.ts                ← corredor simple de migraciones SQL
│   ├── routes/
│   │   ├── health.ts             ← GET /health
│   │   ├── auth.ts               ← GET /auth/google, GET /auth/google/callback
│   │   └── calendar.ts           ← POST /calendar/watch, POST /webhooks/google-calendar
│   └── server.ts                 ← punto de entrada
├── .env.example
└── package.json
```
