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

## Estructura

```
peitho-backend/
├── migrations/
│   └── 001_create_meetings.sql   ← definición de la tabla meetings
├── src/
│   ├── app.ts                    ← configuración de Express y rutas
│   ├── db.ts                     ← pool de conexión a Postgres
│   ├── migrate.ts                ← corredor simple de migraciones SQL
│   ├── routes/health.ts          ← GET /health
│   └── server.ts                 ← punto de entrada
├── .env.example
└── package.json
```
