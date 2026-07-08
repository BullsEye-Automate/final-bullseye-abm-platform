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

**Producción:** https://bullseye-abm-platform-eq6f.vercel.app

---

## Convenciones del proyecto

- Todo el código en **TypeScript**
- Comentarios en **español**
- Variables y funciones en **inglés** (estándar de código)
- Commits en español, descriptivos
- Nunca hardcodear credenciales — siempre usar `.env.local` o variables Vercel
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
