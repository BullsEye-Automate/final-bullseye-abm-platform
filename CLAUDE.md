# BullsEye — Contexto Maestro para Claude Code

> Este archivo es leído automáticamente por Claude Code en cada sesión.
> Mantenlo actualizado a medida que el proyecto evoluciona.

---

## Quiénes somos

**BullsEye** es una agencia de prospección B2B. La plataforma orquesta todo el pipeline de prospección: discovery de empresas, curación humana, búsqueda de contactos, pre-filtro IA, lead scoring, generación de copy personalizado, outreach multicanal y análisis de resultados.

**Arquitectura multi-tenant:** la app sirve a múltiples clientes (cada uno con su propio ICP, campañas de Lemlist, tablas de Clay y pipeline de HubSpot).

---

## Stack tecnológico

**Entorno local (Mac):**
- Node.js v20.20
- npm v11.11
- Vercel CLI v53
- Git v2.39

**Stack:**
- **Framework:** Next.js 14 (App Router)
- **Base de datos:** Supabase (PostgreSQL)
- **Deploy:** Vercel
- **Estilos:** Tailwind CSS + Outfit (Google Fonts)
- **Lenguaje:** TypeScript

**Producción:** https://portal.bullseye-abm.com (equipo y clientes entran por aquí).
El dominio anterior `https://bullseye-abm-platform-eq6f.vercel.app` sigue funcionando para las APIs (webhooks de Clay/HubSpot, crons); sus páginas redirigen al dominio nuevo cuando `APP_CANONICAL_HOST` está seteada (`middleware.ts`).

---

## Convenciones del proyecto

- Todo el código en **TypeScript**
- Comentarios en **español**
- Variables y funciones en **inglés** (estándar de código)
- Commits en español, descriptivos
- Nunca hardcodear credenciales — siempre usar `.env.local` o variables Vercel
- **Toda tabla nueva debe activar RLS** en su migración (`alter table ... enable row level security;`). La app consulta con service role desde el servidor; la anon key es pública y solo se usa para el login. Ver `supabase/enable_rls_all_tables_migration.sql`.
- Propiedades HubSpot usan prefijo `bullseye_` (no `wecad_`)
- IDs de Clay usan `bullseye_company_id` y `bullseye_contact_id`

---

## Variables de entorno configuradas en Vercel

```
SUPABASE_URL=https://ihxjjbbwldrdjhlvzkix.supabase.co
ANTHROPIC_API_KEY=configurada
PERPLEXITY_API_KEY=configurada
LEMLIST_API_KEY=configurada
HUBSPOT_ACCESS_TOKEN=configurada
LUSHA_API_KEY=configurada
CLAY_WEBHOOK_SECRET=bullseye-clay-2026
NEXT_PUBLIC_SUPABASE_URL=https://ihxjjbbwldrdjhlvzkix.supabase.co   -- requerido por el login (Supabase Auth)
NEXT_PUBLIC_SUPABASE_ANON_KEY=                                      -- ⚠️ verificar que esté seteada en Vercel
ALLO_API_KEY=                                                       -- ⚠️ pendiente: generar en Allo → Settings → API y setear en Vercel
APP_CANONICAL_HOST=portal.bullseye-abm.com                          -- redirige las páginas del dominio vercel.app al subdominio
NEXT_PUBLIC_APP_URL=https://portal.bullseye-abm.com                 -- URL pública (webhooks de Clay en onboarding, llamadas internas)
```

---

## Autenticación

Todas las rutas internas (todo excepto los links mágicos de abajo) requieren sesión de **Supabase Auth**. Se implementa en `middleware.ts` (raíz del repo) usando `@supabase/ssr`.

- **Crear un usuario del equipo:** Supabase Studio → Authentication → Users → "Add user" (email + password). No hay pantalla de signup pública a propósito — es una herramienta interna.
- **Login:** `/login`. **Logout:** botón al final del `Sidebar`.
- **Rutas públicas sin login** (protegidas por su propio token/secreto, no por sesión — ver lista exacta en `middleware.ts`):
  - `/feedback-cliente/[token]`, `/encuesta/[token]`, `/forms/icp/[token]`, `/review/empresas/[token]`, `/revision/[token]` — links que se comparten con clientes externos.
  - `/api/cron/*` (Vercel Cron, valida `CRON_SECRET`) y los webhooks entrantes de Clay (`x-webhook-secret`).
- Antes de agregar una ruta nueva a esa lista blanca, confirmar que valida un token o secreto propio — si no, queda expuesta sin sesión.
- `/api/clients` solo es público como `GET` exacto (lo usa `/chat`). Las subrutas `/api/clients/[id]/*` (config con API keys de Lemlist, contexto IA, borrar cliente…) requieren sesión.
- **Usuarios cliente** (portal): tienen `app_metadata.role = "client"` y el middleware los confina a `/portal` y `/api/portal`. Ver sección "Portal de clientes".

---

## ARQUITECTURA MULTI-TENANT

La app es usada por BullsEye para gestionar múltiples clientes (empresas que contratan prospección B2B).

### Tabla `clients` (a crear en Supabase)

```sql
create table clients (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text not null unique,           -- para URLs amigables
  logo_url text,
  is_active boolean default true,
  created_at timestamptz default now()
);
```

### Configuración por cliente (tabla `client_configs`)

```sql
create table client_configs (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) not null,
  lemlist_campaign_id text,            -- campaña principal de outreach
  lemlist_staging_campaign_id text,    -- campaña puente Sales Nav
  clay_companies_table_id text,        -- tabla Companies en Clay
  clay_contacts_table_id text,         -- tabla Contacts en Clay
  hubspot_pipeline_id text,            -- pipeline de HubSpot asignado
  hubspot_owner_id text,               -- SDR asignado (owner HubSpot)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

### Columna `client_id` en tablas existentes

Agregar `client_id uuid references clients(id)` a:
- `companies`
- `contacts`
- `icp_config`

### Contexto IA por cliente (tabla `client_ai_context`)

```sql
create table client_ai_context (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) not null,
  file_name text not null,
  file_type text,                      -- pdf, docx, txt, etc.
  content text,                        -- texto extraído
  storage_path text,                   -- path en Supabase Storage
  uploaded_at timestamptz default now()
);
```

---

## Branding

- **Colores sidebar:** fondo `#251762`, acento `#62E0D8`
- **Tipografía:** Outfit (Google Fonts) — weights 300, 400, 500, 600, 700
- **Logo:** "Bulls" en blanco + "Eye" en `#62E0D8`
- **Active nav item:** fondo `rgba(98,224,216,0.15)` + texto `#62E0D8`

---

## Lo que se intentó y NO funcionó

_(Sección para registrar aprendizajes negativos — no recrear estas rutas)_

- Clay REST API no expone CRUD de rows — solo usamos webhooks entrantes y salientes.
- Las properties de HubSpot deben crearse como `bullseye_*` (no `wecad_*`).

---

## Integraciones

### Clay

- IDs de reconciliación: `bullseye_company_id` y `bullseye_contact_id` en todos los payloads.
- Clay serializa campos usando el display name (ej. "Bullseye Company Id") — la app normaliza keys en `raw-contacts/route.ts`.
- Webhooks de Clay usan header `x-webhook-secret: bullseye-clay-2026`.
- **Tabla "Contacts Approved"** (`t_0tgc3pmHrUCGUPq4QEf`): recibe contactos aprobados por humano para enriquecer teléfono móvil con waterfall **LeadMagic (2cr) → People Data Labs (3cr) → upcell (3.5cr) → Clay Enrichments (4cr) → Wiza (5cr)**. Máximo ~17.5 créditos por contacto. Disparado automáticamente desde `bulk-approve-enrich` y manualmente desde `/telefonos`.
- Env var del webhook outbound (app → Clay): `CLAY_CONTACTS_APPROVED_WEBHOOK_URL` (actual: `pull-in-data-from-a-webhook-4bb3d54f-e1cc-49cb-a64d-1169af606af4`).
- Webhook inbound (Clay → app): `/api/clay/phone-enriched` actualiza `phone_clay`, `clay_phone_provider` en Supabase y empuja `bullseye_telefono_clay` + `bullseye_clay_phone_provider` a HubSpot.

### HubSpot

- Propiedades custom con prefijo `bullseye_`.
- Webhook de calls: `/api/hubspot/webhook/calls`.

### Lemlist

- Campaña principal: `LEMLIST_CAMPAIGN_ID` (por cliente en `client_configs`).
- Campaña puente: `LEMLIST_STAGING_CAMPAIGN_ID` (por cliente en `client_configs`).

### Allo (gestión telefónica)

- Plataforma de telefonía/AI receptionist. BullsEye compra **un número por cliente por país**; cada SDR usa el número de la cuenta que tiene asignada para que la reportería quede unificada por cliente.
- API base: `https://api.withallo.com`. Auth: header `Authorization: $ALLO_API_KEY` **sin** prefijo `Bearer` (Allo devuelve 401 si se manda con `Bearer `). Cliente server-side en `lib/allo.ts`.
- Tabla `client_allo_numbers`: mapea `client_id` → uno o más `allo_number` (E.164) con su `allo_number_name`. Un mismo número solo puede estar asignado a un cliente a la vez (índice único en `allo_number`) para que la reportería no se mezcle.
- En **Configuración → Cliente** hay una sección "Allo" con un desplegable buscable (fetch en vivo a `/api/allo/numbers`) para asignar/quitar números al cliente seleccionado (`/api/clients/[id]/allo-numbers`).
- Pendiente (próximo paso): usar estos números asignados para filtrar la reportería de Allo (actividades, tasa de conexión sin voicemail, reuniones agendadas, agrupación por tags) en el dashboard de SDR.

### Módulo Células SDR (`/analisis/celulas-sdr`)

Centro de mando del equipo SDR (14 vistas: Dirección / Operación / Análisis), réplica del prototipo `Dashboard-SDR-BullsEye.html` con datos reales. Todos los usuarios ven toda la información.

- **Metas:** pestaña "Asignación" de la planilla de metas (`GOOGLE_SHEETS_MEETINGS_ID`), meta interna por SDR × cliente × mes. Formato actual: una tabla "Mes | Cliente | N° mes | <SDR>… | Total meta interna…" (sin año: se asume el año del período); el formato anterior por bloques sigue soportado. Columnas de SDR que no calzan con la Maestra se omiten. La meta del cliente = suma de las metas de sus SDR. Solo lectura (no se editan en la app). Parser en `lib/celulasSdr/sheets.ts`; apodos de columnas ("Nico N", "Cote", "Angeles", "Lore"…) en `PERSON_NICKNAMES`.
- **Células:** pestaña "Maestra IA", columnas O y P (primer nombre = líder, siguientes = integrantes). Los líderes tienen meta propia que **no** suma a su célula (grupo "Líderes").
- **Reuniones:** tabla `meetings` (API Reuniones). Todas las de cualquier origen, atribuidas a "Responsable de la reunión". Realizado: Si = realizada, No = no-show, Reagendar = reprogramada (rescate), Pendiente = agendada por realizarse. Agendadas por fecha de agendamiento; realizadas/no-show/reprogramadas por fecha de reunión. Oportunidad = realizada con Propuesta/Oportunidad en los valores elegidos en Configurar (por defecto "Si").
- **Llamadas, contactados y puntaje:** Allo (`/api/celulas-sdr/allo?month=`), contactado = etapa "Conversación" del embudo de Allo; puntaje = "Score de Desempeño SDR" del summary (`lib/callScoreCard.ts`). País de llamadas = prefijo telefónico del número de Allo; país de reuniones = columna País.
- **Email / WhatsApp / LinkedIn:** HubSpot, sin cliente (con filtro de cliente o país se muestran solo llamadas). "Otras" y "empresas/contactos trabajados": pendientes de conexión.
- **Días hábiles:** lunes a viernes menos feriados de Chile (`lib/celulasSdr/calendar.ts`, agregar los de cada año nuevo).
- **Configurar:** global en la tabla `sdr_cells_config` (migración `supabase/20261016_sdr_cells_config.sql`), editable por cualquier usuario con sesión.
- Cálculo (agg / derive / forecast / alertas) en el navegador: `lib/celulasSdr/engine.ts`. Allo y HubSpot se cachean por mes en `allo_response_cache`.

---

## Portal de clientes (`/portal`)

Vista para que los clientes de BullsEye entren con su propio login. Fases: (1) accesos + ICP ✅, (2) wishlist de empresas, (3) recomendaciones por señales de llamadas, (4) reportería (se integra con el módulo de Ingri).

- **Accesos:** varios usuarios por cliente, sin límite. Se crean desde **Solicitudes clientes → Accesos al portal** (`/solicitudes-clientes`) con contraseña temporal que se muestra una sola vez; el cliente la cambia en `/portal/cuenta`. Tabla `client_users` (migración `supabase/client_portal_migration.sql`) + `app_metadata.role = "client"` en Supabase Auth. Desactivar = `ban_duration` en Auth + `is_active = false`.
- **Autorización:** las APIs `/api/portal/*` toman el `client_id` SIEMPRE de `client_users` vía `requirePortalUser()` (`lib/portalAuth.ts`), nunca de la request. En `/portal` no se monta `ClientProvider` (descargaría la lista de todos los clientes).
- **ICP y buyer persona:** el cliente NO edita directo. `/portal/icp` reutiliza `IcpPublicForm` (modo `embedded`) y crea una propuesta en `icp_change_requests` (una pendiente por cliente + industria; reenviar la reemplaza). BullsEye aprueba o rechaza en `/solicitudes-clientes` viendo el diff por campo contra el ICP vigente; aprobar escribe con `saveIcpContent()` (`lib/icpStore.ts`). El link público `/forms/icp/[token]` (onboarding) sigue guardando directo.
- **Wishlist (próxima fase) — definiciones acordadas:**
  - Fuentes de búsqueda: **base de Lemlist usando la API key de cada cliente** (`client_configs.lemlist_api_key`, así las empresas quedan en la cuenta del cliente) + **empresas de HubSpot de BullsEye** (+20.000) sincronizadas a Supabase. Filtrar por **todas las propiedades que estén rellenadas** (si está rellenada es confiable), incluido el módulo **"Tecnologías"** de HubSpot.
  - Al cliente solo se le muestran datos firmográficos de HubSpot, nunca para qué otro cliente se prospectó ni notas/resultados de llamadas de otra cuenta.
  - Dos modos: filtros manuales y recomendación IA vs. ICP del cliente (% de fit + razón).
  - Al agregar a la wishlist: la empresa va **directo a Lemlist** (lista de empresas en la cuenta del cliente) para buscar y enriquecer contactos ahí. **No pasa por Clay.**
  - Las empresas ya pedidas (o excluidas / ya en `companies` del cliente) no vuelven a aparecer en búsquedas de ese cliente — dedupe por dominio.
  - Las solicitudes caen en `/solicitudes-clientes` (pestaña "Empresas solicitadas"); las alertas se configuran después.
  - Bonus señales de llamadas: solo con llamadas del MISMO cliente (confidencialidad).

---

## Estructura de carpetas

```
bullseye-abm-platform/
├── CLAUDE.md
├── REPLICATE.md
├── app/
│   ├── api/
│   │   ├── clay/
│   │   ├── companies/
│   │   ├── contacts/
│   │   ├── icp/
│   │   └── clientes/          ← (a crear)
│   ├── clientes/              ← (a crear — CRUD de clientes)
│   ├── configuracion/
│   │   ├── icp/
│   │   └── cliente/           ← (a crear — config por cliente)
│   ├── empresas/
│   ├── contactos/
│   └── layout.tsx
├── components/
│   └── Sidebar.tsx
├── lib/
└── supabase/
    ├── schema.sql
    └── *_migration.sql
```
