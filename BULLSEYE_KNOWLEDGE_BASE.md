# BullsEye ABM Platform — Base de Conocimiento Completa

> Este documento es la fuente de verdad del equipo BullsEye. Está pensado para que cualquier miembro pueda preguntarle al agente sobre cualquier funcionalidad de la plataforma y recibir respuestas precisas, como si le estuviera preguntando directamente al creador.

---

## ÍNDICE

1. [¿Qué es BullsEye y para qué sirve?](#1-qué-es-bullseye-y-para-qué-sirve)
2. [Stack tecnológico](#2-stack-tecnológico)
3. [Arquitectura multi-tenant](#3-arquitectura-multi-tenant)
4. [Flujos principales (workflows end-to-end)](#4-flujos-principales)
5. [Módulos y páginas de la plataforma](#5-módulos-y-páginas)
6. [Integraciones externas](#6-integraciones-externas)
7. [Base de datos (Supabase)](#7-base-de-datos-supabase)
8. [APIs internas — referencia completa](#8-apis-internas)
9. [IA y generación de mensajes](#9-ia-y-generación-de-mensajes)
10. [Onboarding de un nuevo cliente — paso a paso](#10-onboarding-de-un-nuevo-cliente)
11. [Variables de entorno](#11-variables-de-entorno)
12. [Errores comunes y soluciones](#12-errores-comunes-y-soluciones)
13. [Glosario](#13-glosario)

---

## 1. ¿Qué es BullsEye y para qué sirve?

BullsEye es una plataforma de prospección B2B desarrollada internamente. Orquesta todo el pipeline de prospección de principio a fin:

```
Descubrimiento de empresas
        ↓
Curación humana (aprobación/rechazo)
        ↓
Búsqueda y scoring de contactos (vía Clay)
        ↓
Pre-filtro IA de contactos
        ↓
Enriquecimiento de teléfono (waterfall Clay)
        ↓
Generación de copy personalizado (Claude)
        ↓
Outreach multicanal (Lemlist: email + LinkedIn)
        ↓
Sincronización HubSpot (CRM)
        ↓
Análisis de llamadas IA + reportería
```

**Quiénes lo usan:** El equipo interno de BullsEye Automate para gestionar la prospección de múltiples clientes B2B simultáneamente.

**URL de producción:** https://bullseye-abm-platform-eq6f.vercel.app

---

## 2. Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Framework | Next.js 14 (App Router) |
| Lenguaje | TypeScript |
| Base de datos | Supabase (PostgreSQL) |
| Deploy | Vercel |
| Estilos | Tailwind CSS + Outfit (Google Fonts) |
| IA principal | Anthropic Claude (claude-sonnet-4-6) |
| IA de búsqueda | Perplexity (sonar-pro) |
| Outreach | Lemlist |
| Enrichment/Scoring | Clay |
| CRM | HubSpot |
| Teléfonos | Lusha (fallback) |

---

## 3. Arquitectura multi-tenant

La plataforma sirve a múltiples clientes (empresas que contratan el servicio de prospección B2B a BullsEye). Cada cliente tiene sus propios datos aislados, sus propias integraciones y su propia configuración de ICP.

### Selector de cliente

En la barra lateral hay un dropdown que permite cambiar entre clientes. También existe la opción "Todos los clientes" para ver reportería consolidada.

### Tablas principales por cliente

| Tabla | Propósito |
|-------|-----------|
| `clients` | Datos del cliente (nombre, slug, estado) |
| `client_configs` | IDs de integración (Lemlist, Clay, HubSpot) |
| `client_ai_context` | Documentos subidos (ICP, one-pager, presentaciones) |
| `model_training_config` | Configuración del modelo de mensajes |
| `icp_config` | ICP versionado del cliente |
| `companies` | Empresas descubiertas/aprobadas |
| `contacts` | Contactos en pipeline |
| `calls` | Llamadas de HubSpot sincronizadas |
| `excluded_companies` | Lista negra de empresas |

> **Regla clave:** Toda query a Supabase debe incluir `client_id` para no mezclar datos entre clientes.

---

## 4. Flujos principales

### Flujo A — Descubrimiento de empresas

```
1. SDR va a /empresas → modo "Recomendación IA"
2. Elige región + tamaño + cantidad
3. La plataforma consulta Perplexity (sonar-pro) con el ICP del cliente
4. Perplexity devuelve empresas candidatas con fuentes
5. Claude extrae y valida datos (nombre, web, LinkedIn, país, tamaño)
6. Se insertan en tabla `companies` con status="pending"
7. SDR revisa → aprueba o rechaza cada empresa
8. Las aprobadas quedan listas para enviar a Clay
```

### Flujo B — Push a Clay (empresas)

```
1. Empresa aprobada (status="approved")
2. Click en "Enviar a Clay" → POST /api/clay/push-company
3. BullsEye hace POST al webhook de Clay (companies table del cliente)
4. Clay enriquece la empresa y busca contactos
5. Clay devuelve contactos via webhook → POST /api/clay/raw-contacts
6. Contactos se guardan en `contacts` con status="pending", prefilter=null
```

### Flujo C — Scoring y aprobación de contactos

```
1. Contacto llega de Clay → guardado como pending
2. Pre-filtro IA (Claude) decide: ¿es un cargo relevante? → yes/no
3. Si prefilter=yes → se puede enviar a Clay para scoring
4. Clay scoring (con prompt personalizado por cliente) → retorna:
   - fit_score (1-10)
   - fit_action: "enrich" / "manual_review" / "discard"
   - Plantillas de mensajes iniciales
5. Webhook /api/clay/scored-contacts actualiza el contacto
6. SDR revisa en /contactos → aprueba o descarta
```

### Flujo D — Enriquecimiento y push a Lemlist

```
1. SDR aprueba contactos con fit_action="enrich"
2. POST /api/contacts/bulk-approve-enrich:
   a. Si no tiene teléfono → enviar a Clay waterfall de enriquecimiento:
      LeadMagic (2cr) → PDL (3cr) → upcell (3.5cr) → Clay Enrichments (4cr) → Wiza (5cr)
      Máximo ~17.5 créditos por contacto
   b. Claude genera mensajes personalizados:
      - Email subject + body (secuencia 1, 2, 3)
      - LinkedIn icebreaker
      - LinkedIn connect message
   c. Push a Lemlist → crea lead en campaña
   d. Upsert en HubSpot → crea/actualiza contacto y empresa
3. Lemlist enriquece async (email/phone) → webhook actualiza BullsEye
```

### Flujo E — Sincronización Lemlist → HubSpot

```
1. SDR hace click "Sync Lemlist → HubSpot" en /campanas o /contactos
2. POST /api/lemlist/refresh-contacts:
   a. Descarga todos los leads de la campaña Lemlist
   b. Actualiza Supabase (email, phone, status por actividad)
   c. Por cada contacto:
      - Crea/actualiza contacto en HubSpot
      - Asocia con empresa HubSpot
      - Calcula engagement_score (aperturas + clicks email + actividad LinkedIn)
      - Agrega a listas de segmentación si corresponde:
        * Alta interacción (score ≥ 70)
        * Warm por llamar (score 40-69)
        * Hot por llamar (score ≥ 80 + llamada abierta)
```

### Flujo F — Análisis de llamadas IA

```
1. SDR hace llamada, registra notas en HubSpot
2. SDR va a /llamadas → "Sincronizar HubSpot"
3. POST /api/hubspot/calls/sync:
   - Descarga llamadas nuevas/modificadas desde HubSpot
   - Guarda en tabla `calls`
4. SDR hace click "Analizar pendientes"
5. POST /api/hubspot/calls/analyze:
   - Claude lee las notas de cada llamada sin analizar
   - Clasifica el outcome: Interesado / Objeción / Buzón / No contestó / etc.
   - Evalúa performance del SDR (score 1-10) con criterios específicos
   - Genera resumen y próximos pasos
   - Guarda: ai_outcome, ai_score, ai_summary, ai_next_steps
```

### Flujo G — Enriquecimiento de teléfono (Clay waterfall)

```
1. Contacto aprobado sin teléfono
2. BullsEye envía a tabla "Contacts Approved" en Clay (t_0tgc3pmHrUCGUPq4QEf)
3. Clay ejecuta waterfall:
   LeadMagic → People Data Labs → upcell → Clay Enrichments → Wiza
4. Clay dispara webhook POST /api/clay/phone-enriched con el teléfono encontrado
5. BullsEye actualiza:
   - `phone_clay` en Supabase
   - `clay_phone_provider` en Supabase
   - `bullseye_telefono_clay` en HubSpot
   - `bullseye_clay_phone_provider` en HubSpot
```

---

## 5. Módulos y páginas

### /empresas — Descubrimiento y curación de empresas

**Qué hace:**
- Tab "Pendientes": empresas descubiertas por IA esperando revisión humana
- Tab "Aprobadas": empresas validadas, listas para enviar a Clay
- Tab "Rechazadas": empresas descartadas (con razón de rechazo)

**Modos de descubrimiento:**
1. **Recomendación IA** — Perplexity + Claude busca empresas que cumplan el ICP
2. **Buscar empresa individual** — Investiga una empresa específica por nombre/web
3. **Importar CSV** — Carga masiva desde archivo

**Acciones disponibles:**
- Aprobar / Rechazar empresa individual
- Deep Research — investigación avanzada (trigger, ángulo, señales, decisores)
- Re-verificar — re-evalúa fit con el ICP actual
- Bulk approve — aprueba todas las pendientes de un cliente
- Push a Clay — envía empresa(s) aprobadas al webhook de Clay

**Datos mostrados por empresa:**
- Nombre, website, LinkedIn, ciudad/país, tamaño, tipo
- Fit score (alto/medio/bajo) con razón
- Señales detectadas
- Fuentes de investigación

---

### /contactos — Pipeline de contactos

**Buckets (pestañas):**
| Bucket | Estado | Descripción |
|--------|--------|-------------|
| Pendientes | pending | Llegaron de Clay, esperan revisión |
| Pre-aprobados | approved_pending | Aprobados, listos para push a Lemlist |
| En campaña | enriched | Ya en Lemlist |
| Descartados | discarded | Rechazados |

**Acciones disponibles:**
- Importar desde JSON de Clay
- Aprobar / Descartar contacto
- Preview de mensajes generados
- Bulk approve + enrich → push masivo a Lemlist + Clay phone waterfall
- Ver company card expandida (agrupa contactos por empresa)

**Datos por contacto:**
- Nombre, cargo, empresa, LinkedIn, email, teléfono
- Fit score + razón + acción recomendada
- Mensajes generados (email 1/2/3, LinkedIn icebreaker, connect)

---

### /campanas — Gestión de campaña Lemlist

**Tab "En campaña":**
- Lista todos los leads en la campaña Lemlist
- Filtros: estado (activo/pausado/respondió/rebotó), SDR
- Acciones por lead: pausar/reanudar
- Stats: contactados, abiertos, clicks, respuestas, rebotes

**Tab "Por enviar":**
- Contactos aprobados aún no enviados a Lemlist
- Botón "Push all" para enviar todos de una vez
- Botón "Sync HubSpot" para sincronizar
- Botón "Import desde Lemlist" para traer leads existentes
- Botón "Enrich existentes" para enriquecer email/phone de leads ya en Lemlist

---

### /llamadas — Análisis de llamadas HubSpot

**Qué hace:**
- Muestra llamadas grupadas por fecha
- Sincroniza llamadas nuevas desde HubSpot
- Análisis IA de notas (Claude clasifica outcome, evalúa SDR, sugiere próximos pasos)

**Stats mostradas:**
- Total llamadas, duración promedio, score SDR promedio
- % conversaciones reales, % interesados por outcome
- Filtros: outcome, nombre SDR, rango de fechas

**Outcomes IA posibles:**
- Interesado
- Objeción (con detalle)
- Buzón de voz
- No contestó
- Llamada cortada
- Número incorrecto
- Conversación no relevante

---

### /reporteria — Reportería consolidada

**Filtros:** 7 días / 30 días / 90 días / Todo

**KPIs mostrados:**
- Empresas descubiertas
- Contactos importados
- En Lemlist
- Respuestas recibidas
- Llamadas totales / conectadas / tasa de conversación

**Vistas:**
- "Todos los clientes" → tabla comparativa por cliente
- Cliente individual → métricas detalladas + funnel visual

---

### /dashboard — Analytics principal

**KPIs del funnel:**
- Empresas descubiertas
- Empresas aprobadas (+ tasa de aprobación)
- Contactos importados
- Contactos en Lemlist
- Contactos con teléfono

**Gráficos:**
- Evolución 8 meses (líneas)
- Distribución por tipo de empresa (pie)
- Distribución por fit_action (pie)
- Funnel de Clay (prefilter → scored → enrich → discard)
- Sparklines de actividad diaria

---

### /configuracion/cliente — Configuración del cliente

**Secciones:**
1. **Integraciones** — API keys, IDs de campaña Lemlist, tabla Clay, URLs webhooks Clay
2. **HubSpot** — Botón para crear propiedades y listas en HubSpot
3. **Empresas excluidas** — Upload Excel/CSV de empresas a excluir del descubrimiento
4. **Scripts SDR** — Generación de scripts de llamada con IA

---

### /configuracion/icp — ICP del cliente

Formulario versionado con:
- Tipos de organización aceptados
- Señales digitales (fuertes, medias, débiles)
- Reglas por tamaño de empresa
- Mix de pipeline recomendado
- Competidores a monitorear
- Geografías (principal, secundaria, terciaria, oportunística)
- Notas adicionales

> Cada vez que se guarda una nueva versión del ICP, se crea un nuevo registro y se desactiva el anterior. El historial se mantiene.

---

### /configuracion/contexto — Documentos de contexto IA

Permite subir documentos que Claude usa para personalizar mensajes y análisis:
- ICP documentado (PDF, DOCX, TXT)
- One-pagers del cliente
- Presentaciones
- Cualquier material de producto/servicio

---

### /entrenar-modelo — Entrenamiento del modelo de mensajes

**Secciones:**
1. **Descripción del negocio** — Qué hace el cliente, qué vende, propuesta de valor
2. **Buyer persona** — A quién van dirigidos los mensajes
3. **Segmentos** — Diferentes tipos de contactos con rutas de mensajes distintas
4. **Ejemplos aprobados** — Mensajes reales que funcionaron (few-shot learning)
5. **Guía de estilo** — Tono, reglas, qué evitar, largo del email
6. **Laboratorio** — Test en tiempo real de generación de mensajes

---

### /telefonos — Gestión de enriquecimiento telefónico

Historial de lookups de teléfono (Lusha + Clay waterfall). Permite disparar manualmente el enriquecimiento para contactos seleccionados.

---

### /sales-navigator — Importación desde Sales Nav

Importa leads directamente desde LinkedIn Sales Navigator hacia la tabla `contacts` con source="sales_navigator".

---

## 6. Integraciones externas

### Clay

**Rol:** Enriquecimiento de datos y scoring de contactos.

**Configuración por cliente (en /configuracion/cliente):**
- `clay_companies_webhook_url` — URL del webhook de la tabla Companies en Clay
- `clay_contacts_webhook_url` — URL del webhook de la tabla Contacts en Clay
- `clay_companies_table_id` — ID de la tabla Companies (para referencia, no para API directa)
- `clay_contacts_table_id` — ID de la tabla Contacts (para referencia)

**Flujo de datos BullsEye → Clay:**
1. BullsEye hace POST al `clay_companies_webhook_url` con datos de la empresa
2. Clay enriquece y busca contactos
3. Clay hace POST a `/api/clay/raw-contacts` con los contactos encontrados
4. BullsEye hace POST al `clay_contacts_webhook_url` con cada contacto pre-filtrado (yes)
5. Clay ejecuta scoring con el prompt personalizado del cliente
6. Clay hace POST a `/api/clay/scored-contacts` con score + mensajes

**Formato del payload empresa (BullsEye → Clay):**
```json
{
  "bullseye_company_id": "uuid",
  "company_name": "Nombre S.A.",
  "company_website": "https://...",
  "company_linkedin_url": "https://linkedin.com/company/...",
  "company_size": "51-200",
  "company_city": "Madrid",
  "company_country": "España",
  "fit_score": "high",
  "research_summary": "...",
  "client_id": "uuid"
}
```

**Formato del payload contacto (BullsEye → Clay):**
```json
{
  "bullseye_contact_id": "uuid",
  "bullseye_company_id": "uuid",
  "first_name": "Juan",
  "last_name": "Pérez",
  "job_title": "CEO",
  "linkedin_url": "https://linkedin.com/in/...",
  "email": "juan@empresa.com",
  "prefilter_result": "yes",
  "company_name": "Nombre S.A.",
  "client_id": "uuid"
}
```

**Webhook Clay → BullsEye (raw-contacts):**
```
POST /api/clay/raw-contacts
Header: x-webhook-secret: bullseye-clay-2026
```
Clay serializa los campos con display names (ej. "Bullseye Company Id"). La app normaliza las keys automáticamente.

**Webhook Clay → BullsEye (scored-contacts):**
```
GET /api/clay/scored-contacts?bullseye_contact_id=...&fit_score=8&fit_action=enrich&...
```
Actualiza el contacto en Supabase con score, razón, acción y plantillas de mensajes.

**Tabla "Contacts Approved" (enriquecimiento telefónico):**
- ID: `t_0tgc3pmHrUCGUPq4QEf`
- Esta tabla es global (no por cliente)
- Recibe contactos aprobados para waterfall de teléfono
- Variable de entorno: `CLAY_CONTACTS_APPROVED_WEBHOOK_URL`
- Webhook de retorno: `POST /api/clay/phone-enriched`

**Importante:** Clay NO tiene API REST para CRUD de filas. Todo fluye por webhooks (entrantes y salientes).

---

### Lemlist

**Rol:** Outreach multicanal (email + LinkedIn).

**Configuración por cliente:**
- `lemlist_api_key` — API key (puede ser global o específica por cliente)
- `lemlist_campaign_id` — Campaña principal de outreach activo
- `lemlist_staging_campaign_id` — Campaña puente para Sales Navigator

**Operaciones principales:**
| Operación | Endpoint | Descripción |
|-----------|----------|-------------|
| Push contacto | POST /api/lemlist/push | Crea lead en campaña |
| Pausar lead | POST /api/lemlist/leads/pause | Pausa/reanuda un lead |
| Sync datos | POST /api/lemlist/refresh-contacts | Baja leads y actualiza Supabase + HubSpot |
| Importar leads | POST /api/lemlist/import-leads | Trae leads existentes a Supabase |
| Enriquecer | POST /api/lemlist/enrich-existing | Enriquece email/phone de leads en campaña |
| Estadísticas | GET /api/lemlist/campaigns | Stats de la campaña activa |
| Respuestas | GET /api/lemlist/replies | Lista respuestas recibidas |

**Payload push a Lemlist:**
```json
{
  "email": "juan@empresa.com",
  "firstName": "Juan",
  "lastName": "Pérez",
  "companyName": "Empresa S.A.",
  "linkedinUrl": "https://linkedin.com/in/...",
  "phone": "+34600000000",
  "icebreaker": "Vi que están expandiendo a LATAM...",
  "emailSubject": "¿Tienen este problema?",
  "emailBody": "Hola Juan, ...",
  "emailSubject2": "Follow-up",
  "emailBody2": "...",
  "emailSubject3": "Último intento",
  "emailBody3": "..."
}
```

**Variables de personalización en Lemlist:**
BullsEye genera los textos completos y los pasa como variables custom. Lemlist los inserta via `{{variable}}`.

---

### HubSpot

**Rol:** CRM. Repositorio central de contactos, empresas y actividad.

**Propiedades custom creadas (prefijo `bullseye_`):**
| Propiedad | Objeto | Descripción |
|-----------|--------|-------------|
| `bullseye_email_body` | Contact | Cuerpo del email 1 |
| `bullseye_icebreaker` | Contact | Icebreaker LinkedIn |
| `bullseye_phone_lusha` | Contact | Teléfono de Lusha |
| `bullseye_telefono_clay` | Contact | Teléfono de Clay waterfall |
| `bullseye_clay_phone_provider` | Contact | Proveedor del teléfono Clay |
| `bullseye_fit_score` | Contact | Score de fit del contacto |
| `bullseye_engagement_score` | Contact | Score de engagement calculado |
| `bullseye_sdr_script` | Contact | Script de llamada generado por IA |
| `bullseye_fit_score` | Company | Score de fit de la empresa |

**Setup inicial HubSpot por cliente:**
```
POST /api/hubspot/setup-client → crea carpeta + 3 listas de segmentación
POST /api/hubspot/setup-properties → crea todas las propiedades bullseye_*
```
Ambas operaciones son idempotentes (no duplican si ya existen).

**Listas de segmentación creadas:**
- **Alta interacción** — contacts con engagement_score ≥ 70
- **Warm por llamar** — contacts con engagement_score 40-69
- **Hot por llamar** — contacts con score ≥ 80 + llamada previa

**Cálculo de engagement_score:**
```
Base: aperturas de email × 5 + clicks × 15
LinkedIn: si respuesta LinkedIn → +30
Si bounced → score = 0
Máximo: 100
```

**Sync de llamadas:**
- La app extrae las notas de las llamadas de HubSpot
- Claude analiza las notas y genera outcome, score, resumen, próximos pasos
- Los resultados se guardan en Supabase (tabla `calls`) NO en HubSpot

---

### Anthropic (Claude)

**Modelo principal:** `claude-sonnet-4-6`
**Modelo de revisión:** `claude-haiku-4-5-20251001`

**Usos:**
| Uso | Descripción |
|-----|-------------|
| Descubrimiento de empresas | Extrae y valida datos de empresas desde Perplexity |
| Análisis de fit ICP | Evalúa si una empresa cumple el ICP del cliente |
| Deep research | Genera trigger, ángulo, señales, decisores por empresa |
| Pre-filtro de contactos | Decide si el cargo de un contacto es relevante (yes/no) |
| Generación de mensajes | Email (secuencia 3 emails) + LinkedIn (icebreaker + connect + msg2) |
| Análisis de llamadas | Clasifica outcome, evalúa SDR, genera próximos pasos |
| Scripts SDR | Genera scripts de llamada personalizados |
| Generación de prompts Clay | Crea el prompt de scoring de Clay basado en el training config |

---

### Perplexity

**Modelo:** `sonar-pro`

**Usos:**
- Búsqueda inicial de empresas candidatas (con fuentes/citations)
- Investigación profunda por empresa
- Verificación de señales digitales

**Respuesta incluye:** texto con contexto + `citations[]` (fuentes con URL, título, fecha)

---

### Lusha

**Rol:** Fallback de teléfono cuando Clay waterfall no encuentra número.

**Endpoint interno:** `POST /api/lusha/lookup`

**Datos del lookup guardados en:** tabla `phone_lookups` (cache para no repetir lookups)

---

## 7. Base de datos Supabase

### Tabla: `clients`

```sql
id              uuid PK
name            text NOT NULL          -- "Clínica Dental España"
slug            text UNIQUE            -- "clinica-dental-espana"
logo_url        text
is_active       boolean DEFAULT true
description     text
hubspot_owner_id text                  -- owner por defecto para sus contactos
clay_companies_webhook_url text        -- URL webhook tabla Companies en Clay
clay_contacts_webhook_url  text        -- URL webhook tabla Contacts en Clay
clay_scoring_prompt        text        -- Prompt personalizado para scoring en Clay
onboarding_step integer DEFAULT 0
onboarding_completed_at timestamptz
status          text DEFAULT 'active'
created_at      timestamptz DEFAULT now()
updated_at      timestamptz DEFAULT now()
```

### Tabla: `client_configs`

```sql
id              uuid PK
client_id       uuid FK → clients(id) UNIQUE
lemlist_api_key text                   -- key específica del cliente (opcional)
lemlist_campaign_id text               -- campaña principal
lemlist_staging_campaign_id text       -- campaña puente
clay_companies_table_id text           -- ID tabla Companies en Clay
clay_contacts_table_id  text           -- ID tabla Contacts en Clay
hubspot_pipeline_id text
hubspot_owner_id text
created_at      timestamptz
updated_at      timestamptz
```

### Tabla: `companies`

```sql
id              uuid PK
client_id       uuid FK → clients(id)
company_name    text NOT NULL
company_website text
company_linkedin_url text
company_city    text
company_country text
company_size    text                   -- "51-200", "201-500", etc.
company_type    text                   -- "lab", "multi_clinic", "dso", "other"
fit_score       text                   -- "high", "medium", "low"
fit_signals     text
research_summary text
research_sources jsonb                 -- array de {url, title, date}
deep_research   jsonb                  -- {trigger, angulo, senales, decisores, fuentes}
status          text DEFAULT 'pending' -- pending / approved / rejected
reject_reason   text
approved_by     text
approved_at     timestamptz
icp_version     integer
clay_pushed_at  timestamptz
clay_push_error text
hubspot_company_id text
hubspot_synced_at  timestamptz
hubspot_sync_error text
created_at      timestamptz
updated_at      timestamptz
```

**Unique constraint:** `(client_id, company_name)` — no puede haber dos empresas con el mismo nombre para el mismo cliente.

### Tabla: `contacts`

```sql
id              uuid PK
client_id       uuid FK
company_id      uuid FK → companies(id)
first_name      text
last_name       text
job_title       text
linkedin_headline text
linkedin_url    text
email           text
phone           text
seniority       text
tenure          text
-- Pre-filtro
prefilter_result text                  -- "yes" / "no" / null
prefilter_reason text
-- Scoring Clay
fit_score       integer                -- 1-10
fit             text                   -- "yes" / "no" / "maybe"
fit_reason      text
fit_action      text                   -- "enrich" / "manual_review" / "discard"
-- Mensajes generados
email_subject   text
email_body      text
email_subject_2 text
email_body_2    text
email_subject_3 text
email_body_3    text
linkedin_icebreaker text
connect_message text
linkedin_msg_2  text
-- Estado en pipeline
status          text DEFAULT 'pending' -- pending / enriched / contacted / replied / discarded
human_decision  text                   -- "approved" / "rejected"
-- IDs externos
clay_row_id     text
lemlist_lead_id text
lemlist_contact_id text
hubspot_contact_id text
lemlist_pushed_at timestamptz
-- Enriquecimiento telefónico
phone_source    text                   -- "lusha" / "lemlist" / "clay"
phone_clay      text
clay_phone_provider text
-- Origen
source          text DEFAULT 'clay'    -- "clay" / "sales_navigator"
created_at      timestamptz
updated_at      timestamptz
```

**Unique constraint:** `(client_id, email)` — no puede haber dos contactos con el mismo email para el mismo cliente.

### Tabla: `icp_config`

```sql
id              uuid PK
client_id       uuid FK
version         integer
is_active       boolean DEFAULT false
org_types       jsonb                  -- array de tipos aceptados
signals_strong  jsonb                  -- señales que confirman fit fuerte
signals_medium  jsonb
signals_weak    jsonb
size_rules      jsonb                  -- reglas por rango de empleados
pipeline_mix    jsonb                  -- mix recomendado por tamaño
competitors     jsonb
geographies     jsonb                  -- {principal: [], secondary: [], etc.}
notes           text
created_by      text
created_at      timestamptz
```

**Unique constraint:** `(client_id, is_active)` donde `is_active = true` — solo un ICP activo por cliente.

### Tabla: `model_training_config`

```sql
id              uuid PK
client_id       uuid FK UNIQUE
version         integer
is_active       boolean
business_description text             -- Qué hace el cliente, qué vende
target_buyer_persona text             -- A quién va dirigido
value_props     text                   -- Propuestas de valor
talking_points  text                   -- Puntos clave de conversación
strong_decision_maker_keywords text[]  -- Cargos que son decisores fuertes
exclude_role_keywords text[]           -- Cargos a excluir
style_tone      text                   -- "formal" / "conversacional" / "directo"
style_rules     text                   -- Reglas de escritura
style_avoid     text                   -- Qué evitar
style_email_length text               -- "corto" / "medio" / "largo"
created_at      timestamptz
updated_at      timestamptz
```

### Tabla: `calls`

```sql
id              uuid PK
client_id       uuid FK
hubspot_call_id text UNIQUE
contact_name    text
company_name    text
direction       text                   -- "OUTBOUND" / "INBOUND"
duration_ms     integer
disposition     text                   -- código HubSpot
disposition_label text                 -- label legible
notes_raw       text                   -- notas originales
notes_clean     text                   -- notas limpiadas
called_at       timestamptz
hubspot_owner_id text
sdr_name        text
-- Análisis IA
ai_score        integer               -- 1-10 performance SDR
ai_outcome      text                   -- "Interesado" / "Objeción" / etc.
ai_outcome_detail text
ai_is_real_conversation boolean
ai_summary      text
ai_next_steps   text
analyzed_at     timestamptz
created_at      timestamptz
```

### Tabla: `excluded_companies`

```sql
id              uuid PK
client_id       uuid FK
company_name    text NOT NULL
company_website text
added_at        timestamptz DEFAULT now()
```

**Unique constraint:** `(client_id, company_name)`

### Tabla: `client_ai_context`

```sql
id          uuid PK
client_id   uuid FK
file_name   text NOT NULL
file_type   text              -- "icp" / "one_pager" / "presentation" / "other"
content     text              -- Texto extraído del documento
storage_path text             -- Path en Supabase Storage
uploaded_at timestamptz DEFAULT now()
```

### Tabla: `training_segments`

```sql
id              uuid PK
client_id       uuid FK
name            text                   -- "Directores Clínica" / "DSO" / etc.
description     text
routing_hint    text                   -- Criterio para asignar contacto a este segmento
email_count     integer DEFAULT 3
linkedin_msg_count integer DEFAULT 2
include_connect_msg boolean DEFAULT true
created_at      timestamptz
```

### Tabla: `segment_sources`

```sql
id          uuid PK
segment_id  uuid FK → training_segments(id)
source_type text              -- "text" / "url" / "document"
title       text
content     text
url         text
created_at  timestamptz
```

### Tabla: `message_examples`

```sql
id              uuid PK
client_id       uuid FK
segment_id      uuid FK → training_segments(id)  -- opcional
contact_name    text
job_title       text
company_name    text
email_subject   text
email_body      text
icebreaker      text
had_reply       boolean
notes           text
created_at      timestamptz
```

---

## 8. APIs internas

### Empresas

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/companies?client_id=&status=` | Listar empresas filtradas |
| POST | `/api/companies/recommend` | Descubrir empresas con IA (Perplexity+Claude) |
| POST | `/api/companies/research-one` | Investigar empresa individual |
| POST | `/api/companies/diagnose` | Evaluar fit de empresa con ICP |
| POST | `/api/companies/[id]/deep-research` | Deep research (trigger, ángulo, señales) |
| POST | `/api/companies/[id]/re-verify` | Re-evaluar fit con ICP actual |
| GET/PATCH | `/api/companies/[id]` | Ver/actualizar empresa |
| POST | `/api/companies/bulk-approve` | Aprobar todas las pendientes |
| POST | `/api/companies/bulk-re-verify` | Re-verificar todas las aprobadas |

### Contactos

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/contacts?client_id=&bucket=` | Listar contactos por bucket |
| POST | `/api/contacts/import` | Importar desde JSON de Clay |
| POST | `/api/contacts/bulk-approve-enrich` | Aprobar + enriquecer + push Lemlist |
| POST | `/api/contacts/[id]/decision` | Aprobar/rechazar/recuperar |
| POST | `/api/contacts/[id]/status` | Actualizar estado |
| POST | `/api/contacts/[id]/preview-messages` | Previsualizar mensajes IA |
| POST | `/api/contacts/generate-scripts` | Generar scripts SDR para HubSpot |

### Clay

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/clay/push-company` | Push empresa individual a Clay |
| POST | `/api/clay/push-companies` | Push bulk todas las empresas sin pushear |
| POST | `/api/clay/push-contact` | Push contacto (prefilter=yes) a Clay |
| POST | `/api/clay/push-contacts` | Push bulk contactos |
| POST | `/api/clay/push-contact-phone` | Push contacto al waterfall telefónico |
| GET | `/api/clay/scored-contacts` | **Webhook receptor** — scores desde Clay |
| GET | `/api/clay/raw-contacts` | **Webhook receptor** — contactos crudos desde Clay |
| GET | `/api/clay/phone-enriched` | **Webhook receptor** — teléfonos enriquecidos |
| GET | `/api/clay/company-no-contacts` | **Webhook receptor** — empresa sin contactos |

### Lemlist

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/lemlist/campaigns` | Stats de campaña |
| GET | `/api/lemlist/campaigns/leads` | Todos los leads en campaña |
| POST | `/api/lemlist/push` | Push contactos a Lemlist |
| POST | `/api/lemlist/refresh-contacts` | Sync Lemlist → Supabase → HubSpot |
| POST | `/api/lemlist/import-leads` | Importar leads existentes de Lemlist |
| POST | `/api/lemlist/enrich-existing` | Enriquecer leads ya en Lemlist |
| POST | `/api/lemlist/leads/pause` | Pausar/reanudar lead |
| GET | `/api/lemlist/replies` | Ver respuestas |

### HubSpot

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/hubspot/calls` | Ver llamadas guardadas |
| POST | `/api/hubspot/calls/sync` | Sincronizar llamadas desde HubSpot |
| POST | `/api/hubspot/calls/analyze` | Analizar llamadas con IA |
| POST | `/api/hubspot/setup-client` | Crear carpeta + listas en HubSpot |
| POST | `/api/hubspot/setup-properties` | Crear propiedades bullseye_* en HubSpot |
| GET | `/api/hubspot/owners` | Ver owners HubSpot |

### Clientes

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/clients` | Listar clientes |
| POST | `/api/clients` | Crear cliente |
| GET | `/api/clients/[id]` | Ver cliente |
| PATCH | `/api/clients/[id]` | Actualizar cliente |
| GET/PUT | `/api/clients/[id]/config` | Ver/actualizar configuración integración |
| GET/POST/DELETE | `/api/clients/[id]/excluded-companies` | Gestionar empresas excluidas |
| POST | `/api/clients/[id]/context` | Subir documento de contexto IA |
| GET/PUT | `/api/clients/[id]/model-config` | Ver/actualizar config de entrenamiento |
| POST | `/api/clients/[id]/generate-campaign-texts` | Generar plantillas de campaña |
| POST | `/api/clients/[id]/generate-clay-config` | Generar prompt de scoring Clay |

---

## 9. IA y generación de mensajes

### Cómo funciona la generación de mensajes

El sistema usa un enfoque de few-shot prompting con múltiples capas de contexto:

```
1. System prompt con:
   - Descripción del negocio del cliente
   - Buyer persona objetivo
   - Value props y talking points
   - Guía de estilo (tono, reglas, largo)
   - Contexto del segmento específico (routing_hint + fuentes del segmento)
   
2. Few-shot examples:
   - Ejemplos aprobados filtrados por segmento
   - Ejemplos marcados como had_reply=true tienen más peso
   
3. Datos del contacto:
   - Nombre, cargo, empresa
   - LinkedIn headline
   - Deep research de la empresa (trigger, ángulo, señales)
   - Fit reason del scoring Clay

4. Claude genera:
   - Email 1: subject + body
   - Email 2: follow-up
   - Email 3: último intento
   - LinkedIn icebreaker
   - LinkedIn connect message (corto, ≤300 chars)
   - LinkedIn message 2 (post-conexión)
   
5. Haiku revisa el resultado:
   - Corrige errores de lenguaje
   - Verifica que se respeta la guía de estilo
   - Valida límite de caracteres en mensajes LinkedIn
```

### Cómo funciona el scoring de contactos en Clay

El equipo BullsEye configura un prompt de scoring en Clay por cliente. Este prompt se genera automáticamente desde `/api/clients/[id]/generate-clay-config` usando el training config.

El scoring de Clay devuelve:
- `fit_score` (1-10)
- `fit` (yes/no/maybe)
- `fit_reason` (explicación)
- `fit_action`:
  - `enrich` → aprobar para outreach
  - `manual_review` → SDR decide
  - `discard` → rechazar automáticamente
- Plantillas iniciales de mensajes (que luego Claude enriquece)

### Análisis de llamadas HubSpot con IA

Claude recibe las notas crudas de la llamada y las analiza con este framework:

**Outcomes posibles:**
- Interesado (quiere más info / agendar)
- Objeción (precio, timing, no es decisor, ya tienen solución)
- Buzón de voz
- No contestó
- Llamada cortada
- Número incorrecto
- Conversación no relevante

**Score de SDR (1-10) evalúa:**
- ¿Logró identificar pain points?
- ¿Presentó el producto con claridad?
- ¿Manejó objeciones correctamente?
- ¿Estableció próximos pasos claros?
- ¿Tono adecuado?

---

## 10. Onboarding de un nuevo cliente

### Checklist completo de onboarding

#### Paso 1 — Crear el cliente en BullsEye
```
1. Ir a /clientes → "Nuevo cliente"
2. Completar: nombre, slug, descripción, logo (opcional)
3. Guardar → se crea el registro en tabla `clients`
```

#### Paso 2 — Configurar el ICP
```
1. Ir a /configuracion/icp (con el cliente seleccionado)
2. Completar todas las secciones del formulario ICP:
   - Tipos de organización
   - Señales digitales (fuertes/medias/débiles)
   - Reglas por tamaño
   - Geografías
   - Competidores
3. Guardar → se crea versión 1 del ICP
```

#### Paso 3 — Subir contexto de IA
```
1. Ir a /configuracion/contexto
2. Subir documentos del cliente:
   - ICP documentado (PDF o DOCX)
   - One-pager / pitch deck
   - Cualquier material del producto
3. La IA usará estos documentos para contextualizar mensajes y análisis
```

#### Paso 4 — Configurar el modelo de mensajes
```
1. Ir a /entrenar-modelo
2. Sección "Configuración":
   - Descripción del negocio
   - Buyer persona objetivo
   - Value propositions (una por línea)
   - Talking points
   - Keywords de decisores fuertes
   - Keywords de roles a excluir
   - Guía de estilo (tono, reglas, qué evitar, largo)
3. Crear segmentos si el cliente tiene múltiples buyer personas
4. Subir ejemplos de mensajes que hayan funcionado (had_reply=true)
```

#### Paso 5 — Configurar Clay

**5.1 — Crear tabla Companies en Clay:**
```
1. En Clay, crear nueva tabla en el workspace del cliente
2. Agregar las siguientes columnas:
   - bullseye_company_id (Text) — ID de reconciliación BullsEye
   - company_name (Text)
   - company_website (Text)
   - company_linkedin_url (Text)
   - company_size (Text)
   - company_city (Text)
   - company_country (Text)
   - fit_score (Text)
   - research_summary (Text)
3. Activar webhook "Pull in data from a Webhook" como fuente
4. Copiar la URL del webhook generada
5. Pegar en BullsEye: /configuracion/cliente → "Clay Companies Webhook URL"
```

**5.2 — Crear tabla Contacts en Clay:**
```
1. En Clay, crear nueva tabla
2. Agregar columnas:
   - bullseye_contact_id (Text) — ID de reconciliación BullsEye
   - bullseye_company_id (Text)
   - first_name (Text)
   - last_name (Text)
   - job_title (Text)
   - linkedin_url (Text)
   - email (Text)
   - company_name (Text)
   - prefilter_result (Text)
3. Configurar el scoring de Clay:
   a. Agregar columna de AI Score
   b. El prompt de scoring se genera desde BullsEye:
      /api/clients/[id]/generate-clay-config
   c. Copiar el prompt generado al campo de la columna Clay
4. Configurar webhook outbound desde Clay:
   Cuando Clay termina de scoring → POST a /api/clay/scored-contacts
   Incluir: bullseye_contact_id, fit_score, fit, fit_reason, fit_action,
            email_subject, email_body, linkedin_icebreaker
5. Activar webhook "Pull in data from a Webhook" como fuente
6. Copiar URL del webhook → pegar en BullsEye: "Clay Contacts Webhook URL"
```

**5.3 — Configurar tabla "Contacts Approved" (enriquecimiento telefónico):**
```
La tabla t_0tgc3pmHrUCGUPq4QEf es global y compartida.
Solo necesitas que el cliente tenga registros mapeados a su client_id.
El webhook de retorno /api/clay/phone-enriched ya está configurado.
```

**5.4 — Guardar IDs de tablas en BullsEye:**
```
1. En cada tabla Clay → Settings → copiar Table ID
2. En BullsEye: /configuracion/cliente
3. Pegar: Clay Companies Table ID + Clay Contacts Table ID
```

#### Paso 6 — Configurar Lemlist
```
1. Crear campaña de outreach en Lemlist para el cliente
2. Copiar el Campaign ID (formato: cam_XXXXX)
3. Opcional: crear campaña staging para Sales Navigator (cam_XXXXX)
4. En BullsEye: /configuracion/cliente
   - Lemlist Campaign ID
   - Lemlist Staging Campaign ID (opcional)
   - Lemlist API Key (si el cliente tiene su propia key)
5. Verificar: click "Verificar campaña" en la plataforma
```

#### Paso 7 — Configurar HubSpot
```
1. En BullsEye: /configuracion/cliente → sección HubSpot
2. Click "Crear propiedades HubSpot":
   - Crea todas las propiedades bullseye_* en HubSpot
   - Es idempotente: se puede ejecutar varias veces sin problema
3. Click "Crear carpeta y listas":
   - Crea carpeta con el nombre del cliente
   - Crea 3 listas de segmentación
4. Configurar hubspot_owner_id:
   - GET /api/hubspot/owners → ver lista de owners
   - Asignar el SDR responsable del cliente
```

#### Paso 8 — Excluir empresas (opcional)
```
1. Preparar Excel/CSV con columnas: company_name, company_website
2. En BullsEye: /configuracion/cliente → "Empresas excluidas"
3. Upload del archivo
4. Estas empresas nunca aparecerán en los resultados de discovery
```

#### Paso 9 — Primer descubrimiento de empresas
```
1. Ir a /empresas (con el cliente seleccionado)
2. Click "Recomendación IA"
3. Seleccionar: región, tamaño, cantidad (empieza con 5-10 para probar)
4. Revisar resultados → aprobar/rechazar
5. Las aprobadas → Push a Clay
```

#### Paso 10 — Verificar flujo completo
```
1. Clay recibe empresa → busca contactos → POST /api/clay/raw-contacts
   Verificar: contactos aparecen en /contactos → tab "Pendientes"
2. Aprobar contactos relevantes → Push a Clay contacts
   Clay scoring → POST /api/clay/scored-contacts
   Verificar: contactos actualizados con fit_score y mensajes
3. Bulk approve + enrich
   Verificar: contactos en Lemlist + en HubSpot
4. Sync Lemlist → HubSpot
   Verificar: engagement_scores calculados, contactos en listas correctas
```

---

## 11. Variables de entorno

### Variables globales (en Vercel)

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://ihxjjbbwldrdjhlvzkix.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# IA
ANTHROPIC_API_KEY=...
CLAUDE_MODEL=claude-sonnet-4-6
PERPLEXITY_API_KEY=...
PERPLEXITY_MODEL=sonar-pro

# Outreach
LEMLIST_API_KEY=...          # Global (los clientes pueden tener la suya en client_configs)
LEMLIST_CAMPAIGN_ID=...      # Deprecated — ahora se usa client_configs

# Clay
CLAY_WEBHOOK_SECRET=bullseye-clay-2026
CLAY_CONTACTS_APPROVED_WEBHOOK_URL=pull-in-data-from-a-webhook-4bb3d54f-e1cc-49cb-a64d-1169af606af4

# HubSpot
HUBSPOT_ACCESS_TOKEN=...     # Private App Token (no OAuth)
HUBSPOT_PRIVATE_APP_TOKEN=... # Alias

# Teléfonos
LUSHA_API_KEY=...
```

### Cómo agregar key específica por cliente

Para que un cliente use su propia Lemlist API key (en lugar de la global):
1. En Supabase: tabla `client_configs` → columna `lemlist_api_key`
2. O en BullsEye: /configuracion/cliente → campo "Lemlist API Key"

La función `lemlistKey(clientId)` en `/lib/lemlistKey.ts` primero busca la key del cliente en Supabase y hace fallback a la global.

---

## 12. Errores comunes y soluciones

### "Clay no recibe los contactos"

**Causa más común:** El `clay_contacts_webhook_url` está vacío o incorrecto.

**Verificar:**
1. /configuracion/cliente → Clay Contacts Webhook URL → click "Verificar"
2. Si falla → regenerar la URL en Clay: tabla Contacts → Settings → Webhook Source → copiar nueva URL

**Segunda causa:** El contacto tiene `prefilter_result = "no"`. Solo se pushean los prefiltered=yes.

---

### "Clay recibió empresa pero no devuelve contactos"

**Causa:** Clay puede tardar varios minutos en procesar y buscar contactos.

**También puede ser:** La empresa no tiene contactos en las bases de datos que Clay consulta.

**En la plataforma:** Llega un webhook a `/api/clay/company-no-contacts` que marca la empresa como sin contactos disponibles.

---

### "Los mensajes generados están en el idioma incorrecto"

**Causa:** El `style_guide` no especifica el idioma.

**Solución:** En /entrenar-modelo → Guía de estilo → agregar regla explícita: "Todos los mensajes deben estar en [idioma]".

---

### "El fit_score no se actualiza después del scoring de Clay"

**Verificar:**
1. Clay tiene configurado el webhook outbound correcto
2. La URL del webhook en Clay apunta a: `https://bullseye-abm-platform-eq6f.vercel.app/api/clay/scored-contacts`
3. Los campos enviados por Clay incluyen `bullseye_contact_id`
4. Logs en Vercel → Functions → `api/clay/scored-contacts` para ver errores

---

### "Error al hacer push a HubSpot"

**Causa más común:** El `HUBSPOT_ACCESS_TOKEN` expiró o no tiene los scopes correctos.

**Scopes necesarios del Private App:**
- `crm.objects.contacts.read`
- `crm.objects.contacts.write`
- `crm.objects.companies.read`
- `crm.objects.companies.write`
- `crm.lists.read`
- `crm.lists.write`
- `engagements.read`
- `engagements.write`
- `calls.read`

---

### "Las propiedades bullseye_* no aparecen en HubSpot"

**Solución:** Ejecutar setup de propiedades:
```
POST /api/hubspot/setup-properties
Body: { "clientId": "uuid-del-cliente" }
```
Es idempotente, se puede ejecutar sin miedo a duplicar.

---

### "El teléfono de Clay no llega"

**Verificar:**
1. El contacto fue enviado a la tabla "Contacts Approved" en Clay (t_0tgc3pmHrUCGUPq4QEf)
2. Clay tiene configurado el webhook outbound hacia `/api/clay/phone-enriched`
3. La variable `CLAY_CONTACTS_APPROVED_WEBHOOK_URL` está correctamente configurada en Vercel

---

### "Lemlist da error 422 al hacer push"

**Causa:** El email o el LinkedIn del contacto tiene un formato inválido, o ya existe el lead en esa campaña.

**Verificar:**
1. El email tiene formato válido
2. El lead no existe ya en la campaña (Lemlist no permite duplicados)
3. Los campos personalizados del lead coinciden con las variables de la campaña Lemlist

---

## 13. Glosario

| Término | Definición |
|---------|------------|
| **ICP** | Ideal Customer Profile — perfil de empresa ideal para el cliente |
| **Fit score** | Score de compatibilidad empresa/contacto con el ICP (high/medium/low o 1-10) |
| **Fit action** | Decisión del sistema: enrich (sí), manual_review (revisar), discard (no) |
| **Pre-filtro** | Análisis IA del cargo del contacto antes de enviarlo a Clay scoring |
| **Waterfall telefónico** | Secuencia de proveedores para buscar teléfono: LeadMagic → PDL → upcell → Clay → Wiza |
| **Deep research** | Investigación avanzada de una empresa: trigger de contacto, ángulo de pitch, señales específicas, decisores |
| **Trigger** | Evento o señal en la empresa que hace relevante el contacto ahora |
| **Ángulo** | Perspectiva de pitch personalizada para esa empresa específica |
| **Engagement score** | Score calculado por BullsEye basado en actividad del lead en Lemlist (email + LinkedIn) |
| **Bucket** | Clasificación de contactos: pending / approved_pending / enriched / discarded |
| **Staging campaign** | Campaña Lemlist auxiliar para importar leads de Sales Navigator antes de moverlos a la campaña principal |
| **SDR** | Sales Development Representative — la persona que hace outreach y llamadas |
| **Campaña principal** | Campaña Lemlist activa donde van los contactos aprobados para outreach |
| **Clay webhook secret** | Header de autenticación para webhooks de Clay: `x-webhook-secret: bullseye-clay-2026` |
| **bullseye_company_id** | UUID de BullsEye usado para reconciliar empresas entre sistemas |
| **bullseye_contact_id** | UUID de BullsEye usado para reconciliar contactos entre sistemas |
| **client_id** | UUID del cliente en BullsEye — clave de aislamiento multi-tenant |
| **Onboarding step** | Progreso del onboarding del cliente (0 = sin empezar, N = completo) |
| **Model training config** | Configuración que define cómo Claude genera mensajes para un cliente específico |
| **Few-shot examples** | Ejemplos de mensajes aprobados que se pasan a Claude para que imite el estilo |
| **Segment** | Subgrupo de buyer personas con mensajes, conocimiento y reglas propias |
| **Style guide** | Guía de escritura por cliente: tono, reglas, qué evitar, largo del email |

---

*Documento generado el 15 de junio de 2026. Actualizar cuando se incorporen nuevas funcionalidades.*
