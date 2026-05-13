# Reglas del proyecto

## Flujo de despliegue

- Hago todo el ciclo end-to-end yo: editar → commit → push → **crear PR si no existe → mergear el PR yo mismo** (squash) sin pedirle al usuario que entre a GitHub.
- El usuario no usa terminal y prefiere no entrar a GitHub. Después del merge, basta con esperar a que Vercel redespliegue (1-2 min) y probar en `wecad-prospecting.vercel.app`.
- Rama de trabajo actual: `claude/validate-prospecting-loop-IRiLL`. Base por defecto: `claude/wecad4you-prospecting-app-Hltfi` (no hay `main`).

## Stack

- Next.js 14 (App Router) desplegado en Vercel.
- Supabase como DB. Schema en `supabase/schema.sql`, defaults v1 del ICP en `lib/icpDefaults.ts`. Migración Sprint 2 de contactos en `supabase/contacts_migration.sql` (pegar manual en SQL editor).
- El ICP se crea desde la propia app vía `POST /api/icp/seed` (no hace falta correr `seed.sql`).
- **El cliente Supabase fuerza `cache: "no-store"` en todos los fetch** (`lib/supabase.ts`). Sin eso Next.js 14 cachea los GET y muestra datos viejos. No quitar.

## Arquitectura completa (Sprint 1–5)

Ver `docs/contexto_sistema.md` y `docs/notas_arquitectura.md` (subidos por el usuario, son la fuente).

- **Stack externo**: Clay (hub de contactos), Lemlist (campañas + enriquecimiento), HubSpot (CRM), Lusha (fallback teléfonos).
- **Pre-filter de contactos vive en la app, no en Clay** — corre con Claude antes de meter el contacto en Clay. Prompt en `lib/contactsPrompts.ts`, validado con Tom Wiand.
- **App escribe contactos en HubSpot directo**, Lemlist solo sincroniza engagement por email.
- **Supabase = fuente de verdad** para feedback y entrenamiento; Clay = base de trabajo activa.

## Sprints

| Sprint | Estado | Entregable |
|---|---|---|
| 1 | Hecho | ICP + descubrimiento empresas + revisión humana |
| 2 | Hecho | Contactos: pre-filter Claude + import desde Clay + UI |
| 3 | En curso | Cola revisión manual (score 5-7) + feedback loop completo |
| 4 | Pendiente | Generador de mensajes + Lemlist API + HubSpot API |
| 5 | Pendiente | Dashboard unificado |

## Estado actual (handoff entre sesiones)

**Hecho del Sprint 2 (fase A):**
- Tablas `contacts` + `contact_feedback` migradas en Supabase del usuario.
- Pre-filter Claude funcionando: `lib/prefilter.ts` + `lib/contactsPrompts.ts` (prompt validado con Tom Wiand).
- `/api/contacts` (GET con buckets pending/manual_review/enriched/discarded + contadores).
- `/api/contacts/import` (POST: acepta JSON de Clay, corre pre-filter, persiste).
- `/contactos` pantalla con tabs, agrupada por empresa, panel de import por JSON.
- Sidebar tiene Contactos activo.
- Probado end-to-end: el usuario importó Tom Wiand (YES) y Jane Smith (NO) sobre DLP Dental Laboratory y funcionó.

**Hecho del Sprint 2 (fase B, parte 1 — push de empresas a Clay):**
- Migración `supabase/clay_push_migration.sql` añade `clay_pushed_at` y `clay_push_error` a `companies`. Pegar manual en SQL editor de Supabase una vez.
- `POST /api/clay/push-company` (single) y `POST /api/clay/push-companies` (bulk de aprobadas sin empujar). Lógica compartida en `lib/clayPush.ts`. Mapea `company_type` (multi_clinic→clinic, dso→DSO).
- Botón individual "Prospectar en Clay" en cada card aprobada + botón bulk "Prospectar todas en Clay (N)" en la pestaña Aprobadas.
- Variable de entorno requerida: `CLAY_COMPANIES_WEBHOOK_URL` (ya en Vercel).
- En Clay, las columnas de la tabla Companies se auto-mapearon desde el "Setup mapping" del webhook source (incluye `wecad_company_id` para reconciliar).

**Hecho del Sprint 2 (fase B, parte 2 — webhook entrante con contactos crudos):**
- `POST /api/clay/raw-contacts`: webhook entrante. Acepta payload single, batch `{wecad_company_id, contacts:[...]}` o array mixto. Agrupa por empresa, corre pre-filter Claude y persiste con la misma lógica que el import manual.
- Lógica de pre-filter + dedup + insert extraída a `lib/contactsIntake.ts` (compartida con `/api/contacts/import`).
- Auth opcional vía header `x-webhook-secret` o `Authorization: Bearer ...`. Activa solo si está seteada `CLAY_WEBHOOK_SECRET` en Vercel (recomendado pero opcional).

**Hecho del Sprint 2 (fase B, parte 3 — discovery requiere LinkedIn corporativo verificable):**
- `lib/discovery.ts` ahora descarta empresas sin `company_linkedin_url` válida (regex `linkedin.com/company/<slug>`). El prompt de Perplexity y el de Claude lo declaran como requisito duro y prohíben construir el slug a partir del nombre.
- Motivo: Clay "Find People" usa LinkedIn URL como identifier principal — sin LinkedIn la búsqueda de contactos rinde casi nada. Además, los modelos venían inventando URLs (linkedin Y website) y eso se filtraba a la cola de aprobación.
- Helper exportado: `isValidLinkedinCompanyUrl(url)`.

**Hecho del Sprint 2 (fase B, parte 4 — verificación HTTP de LinkedIn + rechazo desde Aprobadas):**
- `lib/discovery.ts`: además de la regex, ahora hace fetch HTTP a cada `company_linkedin_url` (paralelo, timeout 6s). Si LinkedIn redirige a `/company/unavailable/` o devuelve 404/410, descarta la empresa. Si bloquea (999/timeout), es permisivo (no descarta por falla transitoria).
- Helper exportado: `isLiveLinkedinCompanyUrl(url)`.
- Motivo: la regex sola no detectaba URLs hallucinated por Claude/Perplexity con formato válido pero slug inventado (todas las 3 empresas de la corrida de prueba estaban hallucinated). La verificación HTTP filtra hallucinations reales.
- UI `app/empresas/page.tsx`: las cards aprobadas ahora tienen un link "Mover a rechazadas" abajo del card. El backend de `/api/companies/[id]/decision` siempre soportó la transición; solo faltaba el botón.
- No retroactivo: las empresas ya aprobadas en Supabase con URLs falsas (ej. DLP Dental Laboratory) hay que rechazarlas a mano desde la pestaña Aprobadas. Próximas corridas de discovery ya no las dejarán pasar.

**Hecho del Sprint 2 (fase B, parte 5 — discovery respeta la región solicitada):**
- `lib/discovery.ts`: prompt de Perplexity y Claude exigen que la empresa esté en la región solicitada como requisito duro. Además, filtro defensivo en código vía `REGION_COUNTRIES` (US y CA estrictos por code-list; EU/LATAM trust-the-prompt porque son multi-país).
- Motivo: una corrida pidiendo US devolvió Modern Dental Group de Hong Kong. La región era solo hint, no enforcement.
- Edge: si Claude devuelve `company_country: null` para una región estricta (US o CA), la empresa se descarta. Mejor perder borderline que dejar pasar fuera-de-región.

**Hecho del Sprint 2 (fase B, parte 6 — endpoint raw-contacts acepta nested `company_table_data`):**
- PR #20 mergeado. `app/api/clay/raw-contacts/route.ts` ahora extrae `wecad_company_id` en este orden:
  1) `wecad_company_id` flat (shape viejo, intacto)
  2) `company_table_data.wecad_company_id` (objeto)
  3) `"Company Table Data".wecad_company_id` (alias con espacios — por si Clay serializa la columna con el nombre humano)
  4) Si `company_table_data` viene como string JSON, lo parsea
- Motivo: en la UI de Clay, chipear el sub-campo nested `Company Table Data → wecad_company_id` rompía el JSON del body. Con el cambio, en Clay basta con chipear `Company Table Data` top-level.
- Body recomendado para la columna HTTP API de Clay:
  ```json
  {
    "company_table_data": <chip Company Table Data>,
    "first_name": <chip First Name>,
    "last_name": <chip Last Name>,
    "job_title": <chip Job Title>,
    "linkedin_headline": <chip Headline>,
    "linkedin_url": <chip LinkedIn Profile>
  }
  ```

**Hecho del Sprint 2 (fase B, parte 7 — endpoint raw-contacts key-insensitive):**
- PR #22 mergeado. `extractCompanyId` ahora normaliza keys (strip espacios/underscores, lowercase) antes de buscar `wecadcompanyid`. Motivo: Clay serializa los sub-campos de `Company Table Data` con display name `"Wecad Company Id"` (espacios, Title Case), no con el internal name snake_case. La primera corrida desde Clay devolvía `received:1, inserted:0, error: "sin wecad_company_id"`. Con el fix, los chips Clay-style funcionan sin trabajo extra en el body.

**Hecho del Sprint 2 (fase B, parte 8 — pre-filter rechaza finanzas):**
- PR #23 mergeado. `lib/contactsPrompts.ts`: agregado a la lista NO explícita "Finance roles (CFO, Financial Controller, Accountant, Treasurer, Bookkeeper, Finance Manager) — they may approve but do not initiate CAD/CAM outsourcing decisions; the buyer is operations/production leadership".
- Motivo: Michelle O W. (Group Financial Controller) cayó YES porque finanzas no estaba en ninguna lista → aplicó la regla por defecto "When in doubt, YES". Inconsistente con buyer personas (`docs/contexto_sistema.md` §4 — el buyer es operations/production, no finanzas).
- Cambio retro: Michelle quedó en Pendientes con el resultado viejo. Para futuros contactos, finanzas → Descartados.

**Hecho del Sprint 2 (fase B, parte 9 — App → Clay Contacts push de YES):**
- PR #24 mergeado. Cierra el loop App ↔ Clay para contactos.
- Migración `supabase/contacts_clay_push_migration.sql` añade `clay_pushed_at` + `clay_push_error` a `contacts` (ya pegada por el usuario en Supabase ✅).
- `POST /api/clay/push-contact` (single) y `POST /api/clay/push-contacts` (bulk YES no empujados en status pending). Lógica compartida en `lib/clayPushContact.ts`.
- Payload incluye campos del contacto + join a empresa (company_name, company_type, company_size, cad_software, scanner_technology, fit_signals) + `wecad_company_id` + `wecad_contact_id` para reconciliar.
- Variable de entorno requerida: `CLAY_CONTACTS_WEBHOOK_URL` (ya set en Vercel ✅).
- UI `/contactos`: badge "en Clay ✓" cuando `clay_pushed_at` no es null, botón individual "Prospectar en Clay" en cards YES no empujadas, botón bulk "Prospectar todos en Clay (N)" arriba de la pestaña Pendientes.
- Webhook source en Clay tabla Contacts creado y mapeado (Setup mapping resuelto después del primer payload, igual que Companies en su momento).

**Hecho del Sprint 3 (fase 1 — cola revisión manual + feedback humano):**
- Migración `supabase/contacts_manual_review_migration.sql` añade `human_decision` (`approved`/`rejected`), `human_decision_at`, `human_decision_reason`, `human_decision_by` a `contacts`. Pegar manual en SQL editor de Supabase una vez.
- `POST /api/clay/scored-contacts`: webhook entrante de Clay con el resultado de la columna Lead Scoring AI. Acepta single o array. Identifica el contacto por `wecad_contact_id` (el UUID que mandamos al pushear). Actualiza `fit_score`, `fit`, `fit_reason`, `fit_action`, y opcionalmente `linkedin_icebreaker`, `email_subject`, `email_body`. Si `fit_action='discard'` también marca `status='discarded'`. Keys case-insensitive (mismo trato que `raw-contacts`).
- `POST /api/contacts/[id]/decision`: veredicto humano sobre un contacto en cola de revisión manual. `approved` → `fit_action='enrich'` + `human_decision='approved'`. `rejected` → `status='discarded'` + `human_decision='rejected'` (razón obligatoria). Ambos casos persisten en `contact_feedback` con `claude_score`/`claude_action` (lo que vino de Clay) vs `human_action`/`human_reason`.
- `GET /api/contacts` buckets actualizados: `manual_review` ahora excluye contactos ya decididos (`human_decision IS NULL`); `enriched` incluye `fit_action='enrich'` para que los aprobados manualmente aparezcan ahí aunque `status` no haya transicionado todavía; `discarded` incluye `human_decision='rejected'`.
- UI `/contactos`: cards en bucket Revisión manual muestran botones "Aprobar" y "Rechazar" (modal `prompt` para razón al rechazar). Badges "revisión manual" / "aprobado manual ✓" / "rechazado manual ✗" visibles en otros buckets para trazabilidad.
- Loop cerrado para entrenamiento: cada veredicto deja un registro en `contact_feedback` que en Sprint 4 podemos formatear como `historical_feedback` e inyectar en el prompt de Lead Scoring de Clay.

**Cableado Clay pendiente (paso del usuario, no código):**
1. Pegar `supabase/contacts_manual_review_migration.sql` en SQL editor de Supabase.
2. En Clay tabla **Contacts**, agregar columna **HTTP API** "Push score to App" análoga a la que ya existe para `raw-contacts`:
   - Method: `POST`
   - Endpoint: `https://wecad-prospecting.vercel.app/api/clay/scored-contacts`
   - Headers: `Content-Type: application/json`, `x-webhook-secret: <CLAY_WEBHOOK_SECRET>`
   - Body (chips Clay-style):
     ```json
     {
       "wecad_contact_id": "<chip wecad_contact_id>",
       "fit_score": "<chip Lead Scoring score>",
       "fit": "<chip Lead Scoring fit>",
       "fit_reason": "<chip Lead Scoring reason>",
       "fit_action": "<chip Lead Scoring action>",
       "linkedin_icebreaker": "<chip LinkedIn Icebreaker response>",
       "email_subject": "<chip email_subject>",
       "email_body": "<chip email_body>"
     }
     ```
   - Run condition: `Lead Scoring action != ""` (dispara solo cuando termina el scoring).
   - Auto-run: ON, Delay: Run immediately.

**Validación end-to-end del loop completo (Sprint 2 fase B cerrado):**

| Paso | Resultado |
|---|---|
| Discovery → Modern Dental Laboratory | Empresa aprobada, LinkedIn URL pasa verificación HTTP |
| App → Clay Companies (push) | `wecad_company_id` = `b179e3ac-3283-4129-af08-d658283dc5cd` ✅ |
| Clay Find People + Enrich Person | 2 contactos (Alison Cheng, Michelle O W.) |
| Clay HTTP API column → `/api/clay/raw-contacts` | `received:1, inserted:1` por fila ✅ |
| Pre-filter Claude | Alison NO (Senior Accountant), Michelle YES inicial (luego fix de finanzas) |
| `/contactos` UI | Alison en Descartados, Michelle en Pendientes ✅ |
| App → Clay Contacts (push de Michelle) | Fila nueva en tabla Contacts de Clay con `wecad_contact_id` ✅ |
| Clay scoring (Lead Scoring AI column) | action = `discard` para Michelle (correcto, finanzas) |
| Clay Add Lead to Campaign | Inicialmente disparó para Michelle (run condition vacía) → fix abajo |
| Run condition `Lead Scoring action = "enrich"` | Aplicada en Clay con chip + Generate ✅ |

**Cierres operativos pendientes (usuario, no código):**

1. **Michelle en Lemlist**: entró a la campaña antes del fix de run condition. Hay que sacarla manualmente: Lemlist → campaña `weCAD4you — Lab Digital Outreach v1` → buscar Michelle → Remove from campaign. Evita métricas contaminadas y un email sin sentido el día 5.
2. **DLP Dental Laboratory aprobada con URLs falsas**: rechazarla desde `/empresas` → Aprobadas → link "Mover a rechazadas". Gap conocido desde fase B parte 4, no se hizo todavía.
3. **Modern Dental Laboratory**: aprobada como ES (Valencia) pero el LinkedIn URL apunta a Modern Dental Group (HK). Verificación HTTP no detecta el caso porque la URL carga. Gap futuro: validar que el nombre en la LinkedIn page matchee `company_name`.

**Variables de entorno en Vercel:**
- `CLAY_COMPANIES_WEBHOOK_URL` — set ✅
- `CLAY_CONTACTS_WEBHOOK_URL` — set ✅
- `CLAY_WEBHOOK_SECRET` — set ✅ (requiere header `x-webhook-secret` en raw-contacts)
- `CLAY_APPROVAL_WEBHOOK_URL` — **pendiente** ⚠️ (para notificar a Clay cuando se aprueba un contacto en Revisión manual; ver setup abajo)

**Cableado de App → Clay para Revisión manual (cierra el loop):**

Cuando un humano aprueba un contacto en Revisión manual de la app, hay que actualizarlo en Clay para que `Add Lead to Campaign` lo mande a Lemlist. Setup:

1. **En Clay**, tabla **Contacts**:
   - Agregar columna manual **"App Decision"** (Text, sin source).
   - Crear webhook source nuevo que escuche payloads `{wecad_contact_id, app_decision, first_name, last_name}` y mapee `app_decision` → columna "App Decision" reconciliando por `wecad_contact_id`.
   - Copiar la URL del webhook → setear en Vercel como `CLAY_APPROVAL_WEBHOOK_URL`.
   - Actualizar la run condition de **Add Lead to Campaign** y opcionalmente de **LinkedIn Icebreaker**, **Email Personalizer**, **email_subject**, **email_body** a:
     ```
     Lead Scoring action = "enrich" OR App Decision = "approved"
     ```
   - Esto evita gastar créditos enriqueciendo contactos en manual_review y los habilita al aprobar.

2. **Flujo end-to-end después del setup**:
   - Contacto YES → push App → Clay → Lead Scoring → action `manual_review` → AI columns y Lemlist NO corren.
   - Usuario aprueba en `/contactos` Revisión manual → endpoint `/api/contacts/[id]/decision` actualiza Supabase y POSTea a `CLAY_APPROVAL_WEBHOOK_URL` con `{wecad_contact_id, app_decision: "approved"}`.
   - Clay setea App Decision = "approved" → run conditions matchean → AI columns corren si faltaban → Add Lead to Campaign empuja a Lemlist.

**Estado original donde quedó la sesión anterior (mantenido por contexto):**

Estamos en medio de cablear la columna HTTP en Clay que dispara hacia `/api/clay/raw-contacts`. Pasos completados en Clay:

1. ✅ Discovery devolvió "Modern Dental Laboratory" (Valencia, ES). El LinkedIn URL `linkedin.com/company/modern-dental-laboratory` carga (pasó verificación HTTP) pero en realidad apunta a la página corporativa de Modern Dental Group (HK). Sutil gap: la región dice ES en Supabase pero los contactos que devuelve LinkedIn son HK. No bloqueante para el test, anotar como gap futuro (validar que el nombre en el LinkedIn page matchee `company_name`).
2. ✅ Empresa aprobada + empujada a Clay. `wecad_company_id`: `b179e3ac-3283-4129-af08-d658283dc5cd`.
3. ✅ En Clay tabla Companies, agregué wizard **Find People** (Source: Companies/People/Jobs). Configuración: Start from "Table of companies" → Companies → View "Default view" → Company identifiers `linkedin_url`.
4. ✅ Find People preview devolvió 2 contactos: Alison Cheng (Senior Accountant, HK) y Michelle O W. (Group Financial Controller, HK). Ambos son finance — van a fallar el pre-filter de la app (esperado, esto valida el branch NO).
5. ✅ Continue → Enrich People modal → marqué SOLO "Enrich person" (0.5/row). NO marqué Work Email (Lemlist lo hace después con sus créditos), NO Summarize LinkedIn, NO Posts.
6. ✅ "Save and run 2 rows" → Clay creó tabla nueva **Raw People** (o como se llame en Clay) con las 2 filas enriquecidas.
7. ✅ Columnas en la tabla Raw People:
   - `Company Employees` (source de Find People)
   - **`Company Table Data`** ← oro, contiene el join completo a Companies incluyendo `wecad_company_id`
   - `First Name`, `Last Name`, `Full Name`
   - `Job Title`, `Location`, `Company Domain`, `LinkedIn Profile`
   - `Enrich person`
   - `# Connections`, `Headline`, `Summary`, `Jobs Count`

**Lo que está en pantalla AHORA (no terminado):**

El usuario abrió una columna nueva tipo **HTTP API** sobre la tabla Raw People. Está en el panel Configure con secciones:
- Account (Add account — opcional, no necesitamos auth todavía porque `CLAY_WEBHOOK_SECRET` no está set en Vercel)
- Column mapping con SETUP INPUTS:
  - Method (Optional) — hay que setear `POST`
  - Endpoint * (required) — vacío, hay que pegar `https://wecad-prospecting.vercel.app/api/clay/raw-contacts`
  - Query parameters (Optional) — dejar vacío
  - Body (Optional) — hay que armar el JSON
  - Headers (Optional) — `Content-Type: application/json`
- Run settings:
  - Auto-run ON (bien)
  - Add run condition (sin marcar todavía — hay que marcarlo y configurar)
- Status: "Required inputs missing" porque falta Endpoint

**Body JSON que hay que armar (usando `/` para insertar refs a columnas en Clay):**

```json
{
  "wecad_company_id": "<ref: Company Table Data → wecad_company_id>",
  "first_name": "<ref: First Name>",
  "last_name": "<ref: Last Name>",
  "job_title": "<ref: Job Title>",
  "linkedin_headline": "<ref: Headline>",
  "linkedin_url": "<ref: LinkedIn Profile>"
}
```

**Run condition recomendada:**
- `Enrich person` is complete / status success
- `LinkedIn Profile` is not empty

**Estado actual (mid-setup en Clay):**

El usuario está configurando en la tabla **Companies** de Clay dos columnas nuevas:
1. Una enrichment para buscar contactos. En Clay aparece como **"Find people"** (Source · Companies, People, Jobs) — NO como "Find people at company". Esa es la correcta.
2. Una columna HTTP / Webhook que dispara hacia `/api/clay/raw-contacts` cuando "Find people" termina.

Quedó pendiente confirmar el shape exacto que devuelve "Find people" (cómo Clay representa la lista de contactos en la celda) para armar bien el body del webhook saliente. Cuando el usuario corra "Find people" sobre la empresa DLP Dental Laboratory (que ya está en Clay), tiene que mandar screenshot del resultado.

**Próximo paso (Sprint 2 fase B — completar loop con Clay):**

1. ~~App → Clay Companies (push)~~ — hecho.
2. **Clay: "Find people"** — usuario lo está configurando AHORA. Al terminar, hay que verificar shape de los datos.
3. ~~Backend de Clay → App (raw contactos)~~ — endpoint `POST /api/clay/raw-contacts` ya vive. Falta cablear en Clay la columna HTTP que dispara hacia él.
4. **App → Clay Contacts (push YES)**: para los contactos pre-filter YES, POSTear al webhook de la tabla Contacts de Clay (todavía no generado). Variable de entorno futura: `CLAY_CONTACTS_WEBHOOK_URL`.
5. **Clay scorea y manda a Lemlist** automáticamente (lo configura Clay, no la app).

**Variables de entorno en Vercel:**
- `CLAY_COMPANIES_WEBHOOK_URL` — set
- `CLAY_WEBHOOK_SECRET` — opcional. Si está set, el endpoint raw-contacts requiere header `x-webhook-secret` o `Authorization: Bearer …` con el mismo valor. Si no está set, queda público.
- `CLAY_CONTACTS_WEBHOOK_URL` — pendiente, para el siguiente paso.

**Estado UI Clay al cortar la sesión (handoff mid-config):**

Tabla activa en Clay: **"Company Employees, Spe..."** (la creada por Find People sobre Modern Dental Laboratory). 2 filas de test: Alison Cheng + Michelle O W. (ambas finance HK, esperadas como pre-filter NO).

Columna HTTP API "Push to App" en Configure → estado:
- **Account**: vacío (sin auth, `CLAY_WEBHOOK_SECRET` no está set).
- **Method**: POST ✅
- **Endpoint**: `https://wecad-prospecting.vercel.app/api/clay/raw-contacts` ✅
- **Headers**: `Content-Type: application/json` ✅
- **Body**: PENDIENTE. Pegar la base y reemplazar cada `null` por chip vía `/`:
  ```json
  {
    "company_table_data": null,
    "first_name": null,
    "last_name": null,
    "job_title": null,
    "linkedin_headline": null,
    "linkedin_url": null
  }
  ```
  Chips: Company Table Data (top-level, NO sub-campo), First Name, Last Name, Job Title, Headline, LinkedIn Profile.
- **Run condition**: ✅ confirmada visualmente en screenshot. `Enrich person != "" AND LinkedIn Profile != ""` (ambos chips top-level, operadores escritos a mano).
- **Auto-run**: ON ✅
- **Delay run**: "Run immediately" ✅
- **Retry on failure**: pendiente verificar si Clay expone esa opción en esta vista.

**Próximo paso al retomar:**

1. Confirmar que el body de la columna quedó armado (pedir screenshot del Body si hay duda).
2. Pedir al usuario que corra SOLO la fila de Alison Cheng (no "Run all rows"). Buscar "Run row" en el menú de 3 puntos sobre esa fila.
3. Verificar en `/contactos` (UI app) que el contacto aparece en bucket **Descartados** (pre-filter espera NO para roles finance). Si aparece en Pending, revisar prompt del pre-filter.
4. Si Alison anduvo, repetir con Michelle.
5. Una vez validado el loop entrante, próximo bloque del Sprint 2 fase B: **App → Clay Contacts (push YES)**. Necesita:
   - Variable `CLAY_CONTACTS_WEBHOOK_URL` en Vercel (pendiente de generar webhook source en la tabla Contacts de Clay).
   - Endpoint `POST /api/clay/push-contacts` en la app (no existe todavía).
   - Botón en `/contactos` para empujar los YES a Clay.

**Gaps conocidos abiertos:**

1. Modern Dental Laboratory está aprobada en Supabase como Valencia/ES pero el LinkedIn URL apunta a Modern Dental Group (HK). La verificación HTTP del paso B parte 4 no detecta este caso porque la URL carga. Gap futuro: validar que el nombre de empresa en la LinkedIn page matchee `company_name` de Supabase.
2. DLP Dental Laboratory sigue aprobada en Supabase con URLs inventadas. Hay que rechazarla manual desde `/empresas` → pestaña Aprobadas → link "Mover a rechazadas" (agregado en PR #17). No se hizo todavía.

**Para retomar en una nueva sesión:**

> Continúo weCAD4you-prospecting. Sprint 2 fase B está cerrado: el loop completo App ↔ Clay ↔ Lemlist está validado end-to-end con Tom Wiand (YES → enrich → en Lemlist) y Michelle O W. (YES → discard, ya quedó filtrada por run condition `Lead Scoring action = "enrich"`). Rama base por defecto: `claude/wecad4you-prospecting-app-Hltfi`. Antes de empezar a codear cualquier cosa, lee `CLAUDE.md` completo, `docs/contexto_sistema.md` y `docs/notas_arquitectura.md`. Recordá las reglas: (a) todo lo que puedas hacer vos hacelo vos sin pedirme (editar, commit, push, PR, merge squash vía mcp__github) — solo pedime ayuda cuando no tengas alcance (Clay UI, Vercel env vars, Supabase SQL editor, Lemlist UI), (b) cuando me toque actuar fuera de la app, dame paso a paso muy detallado. Próximos bloques pendientes en orden sugerido: (1) cierres operativos sin código — sacar a Michelle de la campaña de Lemlist, rechazar DLP Dental Laboratory desde `/empresas` Aprobadas, (2) Sprint 3 — cola revisión manual score 5-7 + feedback loop a Supabase (`contact_feedback` ya migrado), (3) Sprint 4 — la app escribe contactos en HubSpot directo vía API (no Lemlist), (4) Sprint 5 — dashboard unificado. Antes de arrancar cualquier sprint nuevo, preguntame qué priorizar o si hay un bug/iteración primero.
