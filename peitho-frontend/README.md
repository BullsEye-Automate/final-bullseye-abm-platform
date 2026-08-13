# Peitho — Frontend

App Next.js separada de `bullseye-abm-platform` (ver `peitho-backend/CLAUDE.md`, sección "Roadmap frontend", para el contexto de por qué existe). Consume la API de `peitho-backend` — no tiene base de datos propia, ni lógica de negocio: solo muestra lo que el backend ya calculó.

Dos módulos (por ahora solo el esqueleto — listado simple, sin página de detalle):

1. **`/reuniones/futuras`** — Módulo 1: preparación de reuniones agendadas.
2. **`/reuniones/pasadas`** — Módulo 2: análisis de reuniones ya capturadas (tipo DIIO).

## Autenticación

Mismo patrón que `bullseye-abm-platform` (Supabase Auth + `middleware.ts`), pero usa el proyecto de Supabase **"peitho"** (el mismo que usa `peitho-backend` para `DATABASE_URL`), no el proyecto de BullsEye ABM. No hay pantalla de signup — los usuarios se crean a mano en Supabase Studio → Authentication → Users → "Add user".

**Antes de poder loguearte, verifica en el proyecto "peitho" de Supabase:**
1. Authentication → Providers → que **Email** esté habilitado.
2. Authentication → Users → crea tu usuario (email + password) si todavía no existe ahí (los usuarios de Supabase Auth son por proyecto — no se comparten con el proyecto de bullseye-abm-platform).

## Configurar y correr en local

```bash
cd peitho-frontend
cp .env.example .env.local
```

Completa `.env.local` con:
- `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` — proyecto Supabase **"peitho"** (Project Settings → API). Ojo: no son las mismas keys que usa `bullseye-abm-platform`.
- `PEITHO_BACKEND_URL` — normalmente `http://localhost:3001`, déjalo como está si `peitho-backend` corre en su puerto por defecto.

```bash
npm install
npm run dev   # levanta en :3002 (peitho-backend ya usa :3001)
```

Con `peitho-backend` corriendo (`npm run dev` en esa carpeta) y esto corriendo en paralelo, abre `http://localhost:3002` — debería redirigirte a `/login`.

## Cómo funciona el listado (esqueleto actual)

- Las páginas de `/reuniones/futuras` y `/reuniones/pasadas` son Server Components: piden los datos a `peitho-backend` (`GET /meetings?scope=upcoming|past`) desde el servidor de Next.js, no desde el navegador — así no hace falta configurar CORS en el backend.
- Todavía no hay página de detalle por reunión (el research de empresa/prospecto para el Módulo 1, y el análisis + puntaje 1-10 para el Módulo 2) — es la siguiente tarea del roadmap.

## Limitaciones conocidas de este esqueleto

- Sin página de detalle todavía (ver arriba).
- El listado no pagina — para el volumen actual de reuniones no hace falta, revisar si se vuelve necesario.
- No hay manejo de error visual si `peitho-backend` no está corriendo (la página server-side lanza un error genérico de Next.js) — aceptable para este esqueleto, se puede mejorar cuando haya más UI real.
