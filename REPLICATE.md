# Guía de replicación — weCAD4you Prospecting App

**Propósito:** documentación completa para clonar esta app en otro vertical
(ej. otra industria B2B que no sea CAD/CAM dental) usando una nueva cuenta
de Claude.

**Pre-requisitos:** tienes el código de la app en un repo (puedes clonar
`wecad4you/wecad-prospecting` y renombrarlo, o copiar los archivos).

---

## 1. Visión general

Una app de prospección B2B end-to-end que orquesta:

- **Discovery** automático de empresas (Perplexity + Claude).
- **Curación humana** del fit con badge de evidencia.
- **Búsqueda de contactos** (Clay Find People + Sales Navigator manual).
- **Pre-filtro IA** de cargos relevantes.
- **Lead scoring IA** (Clay + fallback en la app).
- **Generación de copy personalizado** (Claude con config editable).
- **Outreach multicanal** (Lemlist: email + LinkedIn).
- **Enrichment** (Lemlist auto + Lusha fallback).
- **CRM sync** (HubSpot custom properties + listas dinámicas).
- **Análisis de llamadas** (HubSpot webhook + Claude coaching).
- **Respuestas inbox** (Lemlist Inbox API).
- **Reportería ejecutiva** para el cliente.

**Stack:** Next.js 14 (App Router) + Supabase + Vercel + Anthropic Claude
+ Perplexity + Clay + Lemlist + HubSpot + Lusha.

---

## 2. Pasos de replicación

### Paso 1 — Repositorio

```bash
git clone https://github.com/wecad4you/wecad-prospecting nueva-app
cd nueva-app
git remote remove origin
git remote add origin <tu nuevo repo>
```

### Paso 2 — Crear cuentas en cada proveedor externo

| Servicio | Pricing aproximado | Para qué |
|---|---|---|
| Vercel (Hobby o Pro) | $0 (Hobby) / $20/mes (Pro) | Hosting Next.js |
| Supabase (Free o Pro) | $0 (free) / $25/mes (Pro) | DB + auth |
| Anthropic API | pay-per-use ~$5-50/mes | Claude (research, mensajes, análisis) |
| Perplexity API | pay-per-use ~$5-10/mes | Discovery search |
| Clay (Solo o Starter+) | $149/mes Solo | Find People + Lead Scoring |
| Lemlist | $69-99/mes | Email + LinkedIn outreach |
| HubSpot CRM (Free, Sales o Marketing Hub Pro) | $0-800/mes | CRM + listas |
| Lusha | $99/mes | Phone enrichment fallback |
| GitHub | $0 | Repo + Actions |

### Paso 3 — Setup Supabase

1. Crea un proyecto nuevo en supabase.com.
2. SQL Editor → corre `supabase/schema.sql` (crea las tablas base).
3. Después corre cada migration en orden de fecha:
   - `contacts_migration.sql`
   - `clay_push_migration.sql`
   - `contacts_clay_push_migration.sql`
   - `contacts_manual_review_migration.sql`
   - `contacts_lemlist_push_migration.sql`
   - `lemlist_activities_migration.sql`
   - `lemlist_activities_replies_migration.sql`
   - `lemlist_activities_outbound_replies_migration.sql`
   - `icp_buyer_personas_migration.sql`
   - `hubspot_sync_migration.sql`
   - `phone_enrichment_migration.sql`
   - `phone_dual_source_migration.sql`
   - `companies_clay_no_contacts_migration.sql`
   - `companies_sales_nav_migration.sql`
   - `contacts_source_migration.sql`
   - `model_training_config_migration.sql`
   - `calls_migration.sql`

   Todas son idempotentes (`IF NOT EXISTS`). Pegar en SQL editor y correr.

4. Settings → API:
   - Copiar **URL** → variable `SUPABASE_URL`.
   - Copiar **service_role key** → variable `SUPABASE_SERVICE_ROLE_KEY`.

### Paso 4 — Setup Clay

1. Crea workspace nuevo.
2. Crea workbook con dos tablas:
   - **Companies** (recibe empresas desde la app).
   - **Contacts** (recibe contactos pre-filter YES).
3. En tabla **Companies**:
   - Agrega columna **Webhook Source** → "Pull in data from a Webhook".
     - Copia la URL del webhook → variable `CLAY_COMPANIES_WEBHOOK_URL`.
     - Activa "auto-run on new data".
     - Setup mapping (después del primer payload se autoconfigura).
   - Agrega columna **Find People** AI (Clay enrichment) → busca decisores
     en LinkedIn por empresa.
   - Agrega columna **HTTP API** → "POST a /api/clay/raw-contacts":
     - Endpoint: `https://tu-app.vercel.app/api/clay/raw-contacts`
     - Headers: `Content-Type: application/json`, `x-webhook-secret: <CLAY_WEBHOOK_SECRET>`
     - Body con chips: `{ "company_table_data": <chip Company Table Data>, "first_name": ..., "last_name": ..., "job_title": ..., "linkedin_headline": ..., "linkedin_url": ... }`
     - Run condition: cuando termina Find People.
4. En tabla **Contacts**:
   - Agrega columna **Webhook Source** "Pull in data from a Webhook":
     - URL → `CLAY_CONTACTS_WEBHOOK_URL`.
   - Agrega columna **Lead Scoring AI** (Claude/OpenAI) con prompt que
     devuelve JSON `{ fit_score: 1-10, fit, fit_reason, fit_action:
     enrich|manual_review|discard }`. Marca inputs como OPCIONALES
     (especialmente `company_size` — sino bloquea).
   - Agrega columna **HTTP API** → "POST a /api/clay/scored-contacts":
     - Endpoint: `https://tu-app.vercel.app/api/clay/scored-contacts`
     - Headers: idem.
     - Body con chips: `{ "wecad_contact_id": <chip>, "fit_score": <chip>, "fit": <chip>, "fit_reason": <chip>, "fit_action": <chip> }`
     - Run condition: `Lead Scoring action != ""`.
5. En Settings → API → crea token (NO se usa más; Cote validó que Clay
   REST API no expone CRUD de rows). Solo usamos webhooks.

### Paso 5 — Setup Lemlist

1. Crea workspace y conecta una cuenta de LinkedIn + un mailbox.
2. Crea dos campañas:
   - **Campaña principal** (ej. "Outreach v1") con tu secuencia de
     pasos (visit profile → invitation → email → wait → email). Copia
     el ID → `LEMLIST_CAMPAIGN_ID`.
   - **Campaña puente** (sin pasos, solo buzón). Copia el ID →
     `LEMLIST_STAGING_CAMPAIGN_ID`. Esta se usa para Sales Nav: el SDR
     manda leads desde Sales Nav vía la extensión a esta campaña, y la
     app los importa con `getCampaignLeadsWithDetails`.
3. Settings → Integrations → API key → `LEMLIST_API_KEY`.
4. Settings → Team → copiar tu user ID si tienes que mandar replies →
   `LEMLIST_SEND_USER_ID` (opcional, default se resuelve solo si hay 1
   usuario).
5. En la secuencia de la campaña principal, agrega la rama condicional
   por estado de email (`Not verified / Deliverable / Risky` vs
   `Undeliverable`) — para que los undeliverable sigan solo por LinkedIn.

### Paso 6 — Setup HubSpot

1. Crea Private App (o usa Service Key BETA si tienes acceso).
2. Scopes requeridos:
   - `crm.objects.contacts.read/write`
   - `crm.objects.companies.read/write`
   - `crm.objects.calls.read`
   - `crm.objects.owners.read`
   - `crm.schemas.contacts.read/write`
   - `crm.schemas.companies.read/write`
   - `crm.lists.read/write`
3. Copia el access token → `HUBSPOT_ACCESS_TOKEN`.
4. Si quieres webhook de calls real-time:
   - Crea Private App legacy "Webhooks".
   - Scope `crm.objects.contacts.read`.
   - Subscription type "Llamada → Creado" + "Llamada → Cambio de propiedad".
   - Properties para watch: `hs_call_body`, `hs_call_disposition`,
     `hs_call_status`, `hs_call_transcription`, `hs_call_duration`,
     `hs_call_recording_url`.
   - URL: `https://tu-app.vercel.app/api/hubspot/webhook/calls`.
   - Client Secret → `HUBSPOT_APP_SECRET`.

   Nota: Service Keys BETA NO exponen UI para crear subscriptions —
   usar Private App legacy si esto falla.

### Paso 7 — Setup Lusha (opcional)

1. Account → API → crea key → `LUSHA_API_KEY`.

### Paso 8 — Setup Anthropic + Perplexity

- Anthropic console → API keys → crea key → `ANTHROPIC_API_KEY`.
- Perplexity → API → crea key → `PERPLEXITY_API_KEY`.

### Paso 9 — Setup Vercel

1. Import git repo.
2. Build settings: framework Next.js (default).
3. Environment variables (todo lo de arriba):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ANTHROPIC_API_KEY`
   - `PERPLEXITY_API_KEY`
   - `HUBSPOT_ACCESS_TOKEN`
   - `HUBSPOT_APP_SECRET` (opcional, solo si configuras webhook)
   - `LEMLIST_API_KEY`
   - `LEMLIST_CAMPAIGN_ID`
   - `LEMLIST_STAGING_CAMPAIGN_ID`
   - `LEMLIST_SEND_USER_ID` (opcional)
   - `LUSHA_API_KEY`
   - `CLAY_COMPANIES_WEBHOOK_URL`
   - `CLAY_CONTACTS_WEBHOOK_URL`
   - `CLAY_WEBHOOK_SECRET` (string que vos elegís, va en headers de los
     webhooks de Clay)
   - `APP_DEFAULT_REVIEWER_EMAIL` (opcional, email del SDR default)
4. Deploy.

### Paso 10 — Inicialización de la app

1. Abre `https://tu-app.vercel.app`.
2. Va a `/configuracion/icp` → POST a `/api/icp/seed` (se llama solo al
   primer load) → crea ICP v1 con defaults del rubro (en
   `lib/icpDefaults.ts`). **EDITALO** según tu rubro nuevo (ver
   sección 5).
3. Va a `/configuracion/hubspot` → click "Crear properties + listas" →
   crea wecad_* properties y las 8 listas dinámicas en HubSpot.

---

## 3. Personalización por vertical

Para cambiar de dental CAD/CAM a otro vertical (ej. SaaS, manufactura,
servicios profesionales), edita estos archivos en orden:

### 3.1 `lib/icpDefaults.ts`

Define los defaults del ICP que `/configuracion/icp` semilla en la DB.
Contiene:
- `org_types`: tipos de empresa que vendes (lab/multi_clinic/dso para
  dental; cambia a tu rubro: agency/startup/enterprise, etc.).
- `buyer_personas`: array de cargos objetivo con descripción.
- `signals_strong` / `signals_medium`: señales de fit (tecnologías que
  usan, problemas que tienen, etc.).
- `size_rules`: bandas de tamaño con decisión (approve/manual/reject).
- `competitors`: competidores tuyos.
- `notes`: contexto libre.

### 3.2 `lib/discovery.ts`

Prompts de Perplexity y Claude para descubrir empresas. Hay tres
cosas a tocar:
- `SYSTEM_PERPLEXITY_BROAD`: prompt para que Perplexity encuentre
  empresas. Cambia "laboratorios dentales / grupos de clínicas / DSOs"
  por tu rubro.
- `SYSTEM_CLAUDE_EXTRACT`: prompt para que Claude extraiga el JSON.
  Cambia las reglas de fit_score (qué hace high vs medium vs low).
- `passesFit`: función que filtra por tipo y tamaño. Ajusta si tu
  banda de tamaño es distinta.

### 3.3 `lib/companyResearch.ts`

Prompts equivalentes para research dedicado por empresa. Mismo
ajuste que discovery.

### 3.4 `lib/contactsPrompts.ts`

Prompt del pre-filter Claude: decide si un cargo es decisor o no.
Lista NO explícita (Marketing, HR, Finance, IT, etc.) y SI explícita
(Operations, Production, Lab Manager, etc.). Ajusta a tu rubro.

### 3.5 `lib/contactScoring.ts`

Fallback de fit_score cuando un contacto no pasa por Clay (Sales Nav).
Prompt equivalente al de Clay Lead Scoring. Mismo ajuste.

### 3.6 `lib/messageGenerator.ts`

Prompt para generar icebreaker + email subject + body. Cambia:
- El value prop hardcodeado (default cae cuando no hay signals
  específicas).
- Las reglas de personalización por rol × tipo de empresa.
- Lista de frases prohibidas defaults (sales-y, AI-tells, etc.).

**Importante:** estos defaults se sobreescriben con la config de
`/entrenar-modelo` si la editas vía UI. Para cero código, dejá los
defaults y configurá todo desde la UI.

### 3.7 `app/api/clay/scored-contacts/route.ts`

`STRONG_DECISION_MAKER_PATTERNS`: regex array de cargos top que
auto-promueve de manual_review a enrich. Ajusta a los cargos de tu
rubro (ej. "Head of Marketing" si vendes martech).

### 3.8 Branding / nombre

Buscar y reemplazar:
- `wecad4you`, `weCAD4you`, `weCAD` → tu marca.
- `wecad_` (prefix de custom properties HubSpot) → `tumarca_`.
- `WECAD` (uppercase) → idem.

Cuidado con `wecad_company_id` y `wecad_contact_id` — son las llaves
de reconciliación entre la app, Clay y HubSpot. Si cambias el prefix
acá, hay que actualizar Clay (chips) y reconfigurar Setup mappings.

### 3.9 Customizar la secuencia de Lemlist

La secuencia es config del workspace de Lemlist (no de la app). Pero
el messageGenerator asume:
- Día 1: Visit profile (LinkedIn).
- Día 3: Invitation + `{{icebreaker}}` (LinkedIn, sin saludo, ≤180
  chars).
- Día 5: Email con `{{emailSubject}}` + `{{emailBody}}`.
- Días 8-10: emails follow-up.

Si cambias el orden, ajusta el messageGenerator para que el body
empiece con "Hi {firstName}," o sin saludo según corresponda.

---

## 4. Archivos clave de referencia

### Documentación
- `CLAUDE.md` — historia completa de sprints, decisiones, gotchas.
  **CRÍTICO**: léelo COMPLETO antes de codear cualquier cosa.
- `REPLICATE.md` — este archivo.
- `docs/contexto_sistema.md` — contexto B2B del rubro original
  (dental CAD/CAM). Reemplázalo con el tuyo.
- `docs/notas_arquitectura.md` — notas técnicas de la arquitectura
  Clay + Lemlist + HubSpot.

### Esquema y migrations
- `supabase/schema.sql` — schema base (companies, contacts, icp_config,
  contact_feedback, etc.).
- `supabase/*_migration.sql` — migrations incrementales.
- `supabase/seed.sql` — seed data inicial (ICP v1).

### Core libs
- `lib/supabase.ts` — cliente Supabase server-side. **Fuerza
  `cache: "no-store"`** (sin esto Next 14 cachea GETs y se ven datos
  viejos).
- `lib/claude.ts` — wrapper Anthropic SDK con retry (5 reintentos) y
  fallback Sonnet → Haiku 4.5 en 529 Overloaded.
- `lib/perplexity.ts` — wrapper sonar-pro.
- `lib/discovery.ts` — discovery broad (Perplexity + Claude + filtros).
- `lib/companyResearch.ts` — research dedicado por empresa.
- `lib/companyEvidence.ts` — clasificador de evidencia (specific /
  generic / none) + validador que strippea datos no respaldados.
- `lib/contactsIntake.ts` — pipeline pre-filter + dedup + insert.
- `lib/contactsPrompts.ts` — prompts del pre-filter.
- `lib/contactScoring.ts` — fallback fit_score app (cuando Clay no
  opina).
- `lib/contactEngagement.ts` — score 0-100 desde lemlist_activities +
  calls.
- `lib/contactValidation.ts` — detección mismatch nombre/email.
- `lib/messageGenerator.ts` — generación icebreaker + email con
  config /entrenar-modelo.
- `lib/modelTrainingConfig.ts` — types + loader de la config.
- `lib/clayPush.ts` — push empresa a Clay vía webhook.
- `lib/clayPushContact.ts` — push contacto a Clay.
- `lib/lemlist.ts` — cliente Lemlist API completo (push lead, get
  campaign leads with details, etc.).
- `lib/lemlistInbox.ts` — Inbox API (send reply).
- `lib/lemlistPush.ts` — push contacto aprobado a campaña principal.
- `lib/lemlistPhoneRefresh.ts` — pull phones desde Lemlist a Supabase
  + HubSpot.
- `lib/hubspot.ts` — cliente HubSpot v3 (CRUD + properties + lists).
- `lib/hubspotPush.ts` — push empresa/contacto a HubSpot.
- `lib/hubspotProperties.ts` — definición de custom properties wecad_*.
- `lib/hubspotLists.ts` — definición de las 8 listas dinámicas.
- `lib/hubspotCalls.ts` — cliente Calls API.
- `lib/hubspotWebhook.ts` — verificación firma HMAC del webhook.
- `lib/callsSync.ts` — sync calls de HubSpot a Supabase.
- `lib/callAnalyzer.ts` — análisis IA de transcript + notas.
- `lib/lusha.ts` — cliente Lusha API.
- `lib/websiteContacts.ts` — scrape de contactos de la web.
- `lib/replyDrafter.ts` — borrador IA de respuesta.
- `lib/dashboardQueries.ts` — agregaciones para el dashboard.
- `lib/dashboardRanges.ts` — presets de rango (8 períodos).
- `lib/reporteriaQueries.ts` — agregaciones para reportería ejecutiva.
- `lib/icpDefaults.ts` — defaults del ICP (EDITAR para tu rubro).

### Páginas (app/)
- `app/dashboard/page.tsx` — ejecutivo operacional.
- `app/reporteria/page.tsx` — vista al cliente.
- `app/empresas/page.tsx` — discovery + revisión empresas.
- `app/contactos/page.tsx` — 5 buckets de contactos.
- `app/busqueda-manual/page.tsx` — import manual desde Campaña puente +
  empresas que Clay no pudo.
- `app/busqueda-manual/instrucciones/page.tsx` — guía SDR paso a paso.
- `app/telefonos/page.tsx` — Lusha + Lemlist phone enrichment.
- `app/llamadas/page.tsx` + `[id]/page.tsx` + `reporte/page.tsx`.
- `app/respuestas/page.tsx`.
- `app/entrenar-modelo/page.tsx`.
- `app/configuracion/icp/page.tsx`.
- `app/configuracion/hubspot/page.tsx`.
- `app/diagnostico-empresa/page.tsx`.

### APIs (app/api/)
- `app/api/companies/recommend/route.ts` — discovery con cascada
  estricto → región relajada → permisivo + deep re-verify.
- `app/api/companies/[id]/decision/route.ts` — approve/reject empresa
  + push paralelo a HubSpot + Clay.
- `app/api/companies/bulk-re-verify/route.ts` — bulk research dedicado.
- `app/api/companies/research-one/route.ts` — research por nombre.
- `app/api/companies/import/route.ts` — import CSV.
- `app/api/companies/[id]/scrape-contacts/route.ts` — scrape web.
- `app/api/contacts/route.ts` — lista con buckets.
- `app/api/contacts/import/route.ts` — import JSON manual.
- `app/api/contacts/[id]/decision/route.ts` — manual review approve/reject.
- `app/api/contacts/[id]/push-to-lemlist/route.ts` — push individual.
- `app/api/contacts/bulk-approve-enrich/route.ts` — bulk approve.
- `app/api/contacts/backfill-fit-score/route.ts` — backfill scoring.
- `app/api/contacts/backfill-engagement/route.ts` — backfill engagement.
- `app/api/clay/raw-contacts/route.ts` — webhook entrante de contactos.
- `app/api/clay/scored-contacts/route.ts` — webhook con score + auto
  promote decisores top.
- `app/api/clay/company-no-contacts/route.ts` — webhook cuando Find
  People da 0.
- `app/api/clay/push-company/route.ts` y `push-contact/route.ts` —
  push manual a Clay.
- `app/api/busqueda-manual/import-manual/route.ts` — import manual agrupado
  por empresa desde la Campaña puente del cliente activo.
- `app/api/busqueda-manual/staged-leads/route.ts` — preview leads de la puente.
- `app/api/busqueda-manual/route.ts` — cola de empresas que Clay no pudo.
- `app/api/busqueda-manual/[id]/import/route.ts` — import por empresa desde
  Campaña puente con auto-push directo a Lemlist.
- `app/api/busqueda-manual/[id]/mark/route.ts` — marcar/reactivar sin fit.
- `app/api/busqueda-manual/icp-roles/route.ts` — cargos y filtros de Sales
  Nav recomendados a partir del ICP del cliente.
- `app/api/lemlist/refresh-phones/route.ts` — pull phones.
- `app/api/lemlist/sync-activities/route.ts` — pull email/LinkedIn events.
- `app/api/lemlist/outreach/route.ts` — agregados outreach.
- `app/api/lusha-lookup/route.ts` — phone enrichment manual.
- `app/api/hubspot/setup-lists/route.ts` — crea wecad_* props + listas.
- `app/api/hubspot/webhook/calls/route.ts` — webhook calls de HubSpot.
- `app/api/calls/sync/route.ts` — pull calls + análisis IA.
- `app/api/calls/[id]/analyze/route.ts` — re-analizar individual.
- `app/api/calls/route.ts`, `[id]/route.ts`, `report/route.ts`.
- `app/api/respuestas/route.ts`, `sync/route.ts`,
  `[id]/draft/route.ts`, `[id]/reply/route.ts`, `[id]/triage/route.ts`.
- `app/api/model-training/route.ts` y `preview/route.ts`.
- `app/api/dashboard/route.ts` y `reporteria/route.ts`.
- `app/api/icp/route.ts` y `seed/route.ts`.

### Components (components/)
- `Sidebar.tsx` — navegación.
- (otros componentes específicos por feature).

---

## 5. Cómo arrancar una nueva sesión de Claude con esta app

Cuando uses esta app desde otra cuenta de Claude (Claude Code), arranca
con este prompt:

> Estoy clonando una app llamada [TU APP] basada en la estructura de
> weCAD4you Prospecting. La app vive en este repo:
> [tu-org/tu-repo].
>
> Tu primera tarea: leer CLAUDE.md completo + REPLICATE.md completo +
> docs/contexto_sistema.md + docs/notas_arquitectura.md. Esos archivos
> contienen TODO el historial de decisiones, gotchas, módulos y la
> guía de replicación.
>
> Mi rubro NO es CAD/CAM dental — es [TU RUBRO]. Vendo a
> [TIPOS DE EMPRESA] y mi buyer persona es [CARGOS].
>
> Mis competidores son [NOMBRES]. Mi value prop es [PROP].
>
> Próximos pasos:
> 1. Adaptar lib/icpDefaults.ts a mi rubro.
> 2. Adaptar prompts en lib/discovery.ts, lib/companyResearch.ts,
>    lib/contactsPrompts.ts, lib/contactScoring.ts,
>    lib/messageGenerator.ts.
> 3. Ajustar STRONG_DECISION_MAKER_PATTERNS en
>    app/api/clay/scored-contacts/route.ts.
> 4. Cambiar branding (wecad → mi marca) en código y custom props.
> 5. Configurar Supabase, Clay, Lemlist, HubSpot, Vercel siguiendo
>    REPLICATE.md sección 2.
> 6. Verificar end-to-end con un caso real.
>
> NO RECREES nada que está en la sección "Lo que ya NO está en uso y
> NO recrear" del CLAUDE.md. Esos son aprendizajes caros.
>
> NO toques los módulos que ya funcionan a menos que te lo pida.
> Cambios chicos y mergeás directo. Para decisiones grandes,
> preguntáme antes con AskUserQuestion.
>
> Idioma: español neutro LATAM (tuteo).

---

## 6. Costos esperados

Para 200 empresas/mes (calculado en sesión real):

| Línea | USD/mes |
|---|---|
| Discovery + deep re-verify | $10 |
| Clay (Find People + Lead Scoring) | $90 |
| Pre-filter Claude (~1000 contactos) | $2 |
| Generación mensajes (~150 leads) | $1 |
| Lemlist (4050 créditos < 7000 free) | $0 |
| Lusha (~30 lookups) | $12 |
| HubSpot CRM | $0 (free tier) |
| Vercel | $0 (hobby) o $20 (pro) |
| Supabase | $0 (free) o $25 (pro) |
| **TOTAL** | **~$115/mes** |

Por empresa end-to-end: ~$0.58 USD. CAC en infra: si conviertes 1 de
50 empresas, ~$30 en infra por deal.

---

## 7. Roadmap potencial post-replicación

Cosas que NO están construidas todavía pero podrías priorizar:

1. **Vercel Cron** — auto-sync phones cada 2-4h (requiere Pro).
2. **Chat IA in-app** — Nivel 2: configurar listas (decisores fuertes,
   talking points) desde un chat sin tocar código.
3. **Few-shot examples en /entrenar-modelo** — marcar mensajes ganadores.
4. **A/B testing de copy** — versionar configs y medir response rate.
5. **Funnel unificado visual** — pipeline end-to-end en una vista.
6. **Webhook de Lemlist** para enrichment events (si Lemlist los expone).
7. **Backfill automático** de source / fit_score con cron.

---

## 8. Soporte

Esta app fue construida iterativamente por Claude Code en sesiones con
Cote como product owner. Toda la lógica y decisiones están en
`CLAUDE.md`. Si vas a iterar, lee primero — ahorra tiempo y evita
recrear cosas que ya se intentaron y descartaron.

Mucha suerte con la replicación.
