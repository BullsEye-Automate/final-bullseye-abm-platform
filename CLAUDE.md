# Reglas del proyecto

## Flujo de despliegue

- Hago todo el ciclo end-to-end yo: editar → commit → push → **crear PR si no existe → mergear el PR yo mismo** (squash) sin pedirle al usuario que entre a GitHub.
- El usuario no usa terminal y prefiere no entrar a GitHub. Después del merge, basta con esperar a que Vercel redespliegue (1-2 min) y probar en `wecad-prospecting.vercel.app`.
- Rama de trabajo actual: `claude/continue-wecad4you-prospecting-YNgtt`. Base por defecto: `claude/wecad4you-prospecting-app-Hltfi` (no hay `main`).

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
- **Approvals de Revisión manual van directo a Lemlist desde la app** (Sprint 3 fase 2). NO pasan por Clay porque Clay API REST no expone CRUD de filas. La app genera icebreaker + email_subject + email_body con Claude y llama a Lemlist API v2 directamente.

## Lo que se borró de Clay (sesión Sprint 3 fase 2) y NO debe volver

Durante una sesión previa se intentó cerrar el loop App → Clay para que las aprobaciones de Revisión manual dispararan Lemlist. Después de comprobar que Clay API REST no expone CRUD de rows (v1/v2 = "deprecated API endpoint", v3 = "NoMatchingURL" en TODAS las combinaciones razonables), se pivoteó a Lemlist API directa. La limpieza final dejó Clay en este estado — no recrear lo borrado a menos que Clay publique CRUD endpoints en el futuro:

- **Columna `App Decision`** (Text manual en tabla Contacts): borrada.
- **Webhook source `CLAY_APPROVAL_WEBHOOK`** ("Pull in data from a Webhook (2)" en tabla Contacts): borrado.
- **Filas vacías** que el webhook fallido creó: borradas.
- **Run conditions** de `LinkedIn Icebreaker`, `Email Personalizer`, `Add Lead to Campaign`: revertidas a `Lead Scoring action = "enrich"` (sin el `OR App Decision = "approved"` que se había agregado temporalmente).
- **Run condition** de `Push score to App` (HTTP API column que llama a `/api/clay/scored-contacts`): debe quedar en `Lead Scoring action != ""` para que llegue al app tanto si la acción es `enrich`, `manual_review` o `discard`.
- **Lib del código**: borradas `lib/clayApi.ts` y `lib/clayPushDecision.ts`. NO restaurar — si algo de Clay tiene que escribir state al app, usar webhooks de Clay → endpoints del app (no al revés).

## Sprints

| Sprint | Estado | Entregable |
|---|---|---|
| 1 | Hecho | ICP + descubrimiento empresas + revisión humana |
| 2 | Hecho | Contactos: pre-filter Claude + import desde Clay + UI |
| 3 | Hecho · fase 1 (cola revisión manual) + fase 2 (Lemlist API direct) | Cola revisión manual + feedback loop + Lemlist API directa para approvals |
| 4 | Pendiente | HubSpot writer + dashboard de mensajes |
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

**Cableado Clay (paso del usuario, no código — ya aplicado al cierre de Sprint 3):**
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

**Cierres operativos pendientes (usuario, no código — snapshot histórico de Sprint 2; ver "Gaps conocidos al cierre" al final para el estado vigente):**

1. **Michelle en Lemlist**: entró a la campaña antes del fix de run condition. Hay que sacarla manualmente. (Histórico; ya pasó hace semanas.)
2. **DLP Dental Laboratory aprobada con URLs falsas**: rechazarla desde `/empresas` → Aprobadas → link "Mover a rechazadas".
3. **Modern Dental Laboratory**: aprobada como ES (Valencia) pero el LinkedIn URL apunta a Modern Dental Group (HK). Verificación HTTP no detecta el caso porque la URL carga. Gap futuro: validar que el nombre en la LinkedIn page matchee `company_name`.

**Variables de entorno en Vercel (snapshot histórico — ver "Variables de entorno en Vercel (estado actual final)" más abajo para el estado vigente):**
- `CLAY_COMPANIES_WEBHOOK_URL` — set ✅
- `CLAY_CONTACTS_WEBHOOK_URL` — set ✅
- `CLAY_WEBHOOK_SECRET` — set ✅
- `ANTHROPIC_API_KEY` — set ✅
- `PERPLEXITY_API_KEY` — set ✅
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — set ✅

**Cableado de approvals de Revisión manual (estado vigente: Lemlist API direct):**

Cuando un humano aprueba un contacto en Revisión manual de la app, la app llama a Lemlist API directamente (NO pasa por Clay). El flujo es:

1. **Contacto YES** → push App → Clay → Lead Scoring → `action = "manual_review"` → las AI columns y `Add Lead to Campaign` NO corren (run condition `action = "enrich"` no matchea).
2. **Usuario aprueba** en `/contactos` Revisión manual → endpoint `/api/contacts/[id]/decision`:
   - Persiste `human_decision='approved'` + `fit_action='enrich'` en Supabase.
   - Genera `linkedin_icebreaker` + `email_subject` + `email_body` con Claude (Sonnet con fallback Haiku) si faltan.
   - Llama a `POST https://api.lemlist.com/api/v2/campaigns/{LEMLIST_CAMPAIGN_ID}/leads` con `linkedinUrl`, `email?`, datos del contacto/empresa y custom fields (`icebreaker`, `emailSubject`, `emailBody`, `wecad_fit_*`).
   - Persiste `lemlist_pushed_at` o `lemlist_push_error`.
   - Devuelve `lemlist_push` en el response.
3. **Lemlist recibe el lead** → corre su propio enrichment (email + teléfono con sus créditos) → al Día 3 dispara la invitación LinkedIn con `{{icebreaker}}` → al Día 5 dispara el email con `{{emailSubject}}` / `{{emailBody}}`.

**Por qué no Clay**: Clay API REST no expone CRUD de rows (ver "Investigación Clay API" más abajo) y los webhook sources de Clay solo soportan INSERT, no UPSERT por key.

**Si Lemlist responde error**, el response del endpoint `/api/contacts/[id]/decision` incluye `lemlist_push.debug.response` con el cuerpo crudo del API. UI surface ese debug en panel amarillo.

**Hecho del Sprint 3 (resto de iteraciones, sesión 2026-05-13):**

Sesión larga iterando sobre yield, calidad y feedback loop. PRs mergeados en orden:

- **PR #28**: `/empresas` dropdown "Tamaño objetivo" deja de ser hardcoded — ahora se llena dinámicamente desde `size_rules` aprobadas del ICP. Editar reglas en `/configuracion/icp` se refleja en discovery.
- **PR #29**: Discovery overshoot (Perplexity asks `limit*2`) + retry relajado automático cuando 0 + diagnóstico `funnel` visible en UI con el embudo paso a paso.
- **PR #30**: Sacado el "REQUISITO DURO" del prompt de Claude que hacía pre-filtrar y devolver 0. Ahora Claude extrae todo y el código filtra después.
- **PR #31**: Mismo fix en prompt de Perplexity — sacado el "OBLIGATORIAMENTE" que hacía a Perplexity autocensurarse. Plus instrucciones de búsqueda más específicas (NADL, partner listings, top labs in [state]).
- **PR #32**: Retry relajado mantiene live check de LinkedIn (solo afloja `strict_region`) — sin esto entraban URLs alucinadas.
- **PR #33**: Botón "Eliminar" en company cards. Endpoint `DELETE /api/companies/[id]`. Útil para limpiar empresas con URLs alucinadas para que vuelvan a ser candidatas.
- **PR #34**: `lib/claude.ts` maxRetries 2→5 + manejo claro de 529 Overloaded en `/api/companies/recommend` (mensaje en español).
- **PR #35**: Fallback automático a Haiku 4.5 cuando Sonnet sigue overloaded después de retries. Helper `createMessageWithFallback`. UI muestra badge "modelo: Sonnet" vs "modelo: Haiku (fallback)".
- **PR #36**: `max_tokens` 4096→16384 en Claude para que extraiga las 16 empresas sin truncar el JSON. Bug causaba `Claude extrajo: 0` aunque Perplexity devolvía 8.5KB.
- **PR #37**: `maxDuration` 120→300s + AbortController en frontend (290s) para evitar spinner colgado.
- **PR #38**: Prompts de discovery con prioridad explícita exocad/inLab > 3Shape. Claude scorea 3Shape como `medium` por default (sube a `high` solo con 3+ señales fuertes adicionales).
- **PR #39**: Pre-filter prompt apretado significativamente:
  - Lista NO ampliada: Marketing, HR / People Ops / Talent, L&D / Training, IT / Software / Data, Legal / Compliance, Patient Services / Front Desk, Students.
  - "When in doubt, YES" → "When in doubt, NO" (mejor perder borderline que llenar Lemlist).
  - Detección de "former / ex- / previously" → NO (Clay Find People trae gente histórica con título antiguo).
- **PR #40**: Bulk delete por bucket en `/contactos`. Endpoint `POST /api/contacts/bulk-delete`. Botón rojo "Eliminar todos (N)" arriba a la derecha.
- **PR #41**: Pre-filter size-aware. `PrefilterInput` lleva `company_size`; el prompt cambia estrictez según banda (small ≤30 generoso, medium 31-100 estándar, large/DSO >100 estricto). Office Manager en DSO de 1000+ → NO; Lead Technician en lab de 10 → YES.
- **PR #42**: Aflojado el bracket Large para que "Operations Manager", "Production Manager", "Lab Manager", "CAD Manager" sean YES aunque sin contexto extra. Botón "Aprobar (recuperar)" en bucket Descartados.
- **PR #43**: Recovery desde Descartados va a Pendientes (no a En campaña). Diferencia explícita: manual_review approve → fit_action='enrich'; discarded recover → fit_action=null + status='pending'.
- **PR #44**: `lib/clayPushDecision.ts` que dispara webhook a Clay con `{wecad_contact_id, app_decision}`. Endpoint `decision` lo llama cuando approve viene de manual_review.
- **PR #45**: Fix bug del PR #43: no limpiar `clay_pushed_at` en approve desde manual_review (solo en recovery).
- **PR #46-49**: Pivot del webhook a Clay REST API (porque webhook sources de Clay no soportan upsert), pruebas múltiples URL patterns. **Resultado: bloqueado** — ver sección abajo.

**Investigación Clay API (sesión 2026-05-13 — resultado: API REST no expone row CRUD):**

El loop App → Clay para Revisión manual approvals se rompió en dos intentos:

1. **Webhook source (App Decision)**: Clay's webhook sources solo soportan INSERT, no UPSERT. Pruebas con el setup mapping no permitieron configurar reconciliación por `Wecad Contact Id`. Cada approval creaba una fila nueva con solo `app_decision` y `wecad_contact_id` llenos, en vez de actualizar la fila original.

2. **Clay REST API directa**: probado con `CLAY_API_TOKEN` válido contra todas las combinaciones razonables de URL:
   - `/v1/tables/{id}/rows` → 404 `"deprecated API endpoint"` (Clay tenía esto pero lo deprecaron)
   - `/v2/tables/{id}/rows` → 404 `"deprecated API endpoint"`
   - `/v3/tables/{id}/rows` → 404 `"NoMatchingURL"` (no existe en v3)
   - Mismos paths con `/workspaces/{ws}/` o `/workbooks/{wb}/` prefix → idéntico resultado
   - 4 variantes de query string (filter[], where[], directo, /search) — todas 404

   Conclusión: la API pública actual de Clay no expone CRUD de rows en tablas de usuario. Solo expone endpoints para webhooks, find-people-searches, y similar.

**Decisión (final, sesión 2026-05-13):** descartar el approach Clay para approvals → **bypass Clay con Lemlist API directa** desde la app. Próxima sesión arranca con esto.

**Hecho del Sprint 3 (fase 2 — Lemlist API direct, sesión 2026-05-13b):**

PR #52 mergeado. Cierra el loop manual_review → Lemlist sin pasar por Clay.

- Migración `supabase/contacts_lemlist_push_migration.sql` añade `lemlist_pushed_at` + `lemlist_push_error` a `contacts`. Pegar manual en SQL editor de Supabase una vez.
- `lib/lemlist.ts` — cliente para `POST https://api.lemlist.com/api/v2/campaigns/{id}/leads`. Auth Basic con usuario vacío + `LEMLIST_API_KEY` como password (forma documentada y estable de Lemlist). Sobre falla devuelve `debug.response` con el cuerpo crudo del API para diagnosticar shape.
- `lib/messageGenerator.ts` — genera icebreaker + email_subject + email_body con una sola llamada a Claude (Sonnet con fallback automático a Haiku 4.5 vía `createMessageWithFallback`). Reglas críticas hardcodeadas:
  - Icebreaker ≤ **180 chars** (LinkedIn corta a 200). Defensivo: clamp + regex que strippa cualquier saludo si Claude desobedece.
  - Icebreaker SIN "Hi {firstName}, " — la plantilla Lemlist del Día 3 ya lo agrega. Si lo incluyéramos doble sale "Hi Brittany , Brittany, …".
  - Email body SÍ arranca con "Hi {firstName},\\n\\n" porque la plantilla Day 5 espera solo `{{emailBody}}` sin saludo extra (ver `notas_arquitectura.md` §7).
  - Subject ≤ 7 palabras.
- `app/api/contacts/[id]/decision/route.ts` modificado: cuando approve viene de manual_review (no recovery) y `lemlist_pushed_at` está vacío:
  1. Si el contacto no tiene icebreaker/subject/body (manual_review NO los recibe de Clay porque la run condition es `action=enrich`), los genera con `messageGenerator` y los persiste en `contacts`.
  2. Empuja el lead a Lemlist con `addLeadToCampaign`.
  3. Devuelve `lemlist_push` en el response (con `messages_generated`, `model_used`, `lead_id` en caso ok; o `error` + `debug` en caso fail).
- UI `/contactos`:
  - Badge "en Lemlist ✓" cuando `lemlist_pushed_at` no es null (junto al "en Clay ✓").
  - Card surface `lemlist_push_error` persistido (prefijado "Lemlist:" para distinguir del "Clay:").
  - Panel debug amarillo cuando el push falla en runtime (similar al panel viejo de Clay, mostrando el JSON de Lemlist API).
- Variables de entorno requeridas en Vercel:
  - `LEMLIST_API_KEY` — token de Lemlist (Settings → Integrations → API)
  - `LEMLIST_CAMPAIGN_ID` — `cam_TrfWtYHwp6qBb4Z8B` (campaña "weCAD4you — Lab Digital Outreach v1")
- Limpieza completada:
  - Borrados `lib/clayApi.ts` y `lib/clayPushDecision.ts`.
  - En Clay tabla Contacts: borrada la columna `App Decision`, borrado el webhook source `CLAY_APPROVAL_WEBHOOK`, borradas las filas vacías.
  - Run conditions revertidas a `Lead Scoring action = "enrich"` en `LinkedIn Icebreaker`, `Email Personalizer`, `Add Lead to Campaign`. La de `Push score to App` quedó en `Lead Scoring action != ""` (permite que llegue al app la decisión de Clay para action=enrich, manual_review y discard).
  - Env vars obsoletas borradas en Vercel: `CLAY_APPROVAL_WEBHOOK_URL`, `CLAY_API_TOKEN`, `CLAY_CONTACTS_TABLE_ID`, `CLAY_WORKSPACE_ID`, `CLAY_WORKBOOK_ID`.

**Investigación Clay API (sesión 2026-05-13 — resultado: API REST no expone row CRUD):**

El loop App → Clay para Revisión manual approvals se rompió en dos intentos:

1. **Webhook source (App Decision)**: Clay's webhook sources solo soportan INSERT, no UPSERT. Pruebas con el setup mapping no permitieron configurar reconciliación por `Wecad Contact Id`. Cada approval creaba una fila nueva con solo `app_decision` y `wecad_contact_id` llenos, en vez de actualizar la fila original.

2. **Clay REST API directa**: probado con `CLAY_API_TOKEN` válido contra todas las combinaciones razonables de URL:
   - `/v1/tables/{id}/rows` → 404 `"deprecated API endpoint"`
   - `/v2/tables/{id}/rows` → 404 `"deprecated API endpoint"`
   - `/v3/tables/{id}/rows` → 404 `"NoMatchingURL"`
   - Mismos paths con `/workspaces/{ws}/` o `/workbooks/{wb}/` prefix → idéntico resultado
   - 4 variantes de query string (filter[], where[], directo, /search) — todas 404

   Conclusión: la API pública actual de Clay no expone CRUD de rows en tablas de usuario. NO recrear la integración a menos que Clay publique CRUD endpoints en el futuro.

**Estado del repositorio al cierre (sesión Sprint 3 fase 2):**

- Rama: `claude/continue-wecad4you-prospecting-YNgtt` (working tree clean, pusheada y mergeada).
- Último PR mergeado: #52 (`feat(lemlist): push manual_review approvals to Lemlist directly`).

**Estado en Clay al cierre (limpieza Sprint 3 fase 2 — TODO completado por el usuario):**

- Tabla Contacts tiene SOLO el webhook source original (1) "Pull in data from a Webhook" (el que alimenta `/api/clay/raw-contacts` con contactos de Find People).
- Run conditions vuelven al estado pre-sesión-Clay-API:
  - `LinkedIn Icebreaker`, `Email Personalizer`, `email_subject`, `email_body`, `Add Lead to Campaign` → `Lead Scoring action = "enrich"`.
  - `Push score to App` (HTTP API column hacia `/api/clay/scored-contacts`) → `Lead Scoring action != ""`.
- Las únicas dos integraciones App ↔ Clay que quedan vivas son: (a) `App → Clay`: push de empresas aprobadas (`/api/clay/push-company`) y push de contactos pre-filter YES (`/api/clay/push-contact`) vía webhooks de Clay; (b) `Clay → App`: webhook `raw-contacts` cuando Find People completa, y webhook `scored-contacts` cuando Lead Scoring completa.

**Estado en Supabase al cierre:**

- Migraciones aplicadas: `contacts_migration.sql`, `contacts_clay_push_migration.sql`, `contacts_manual_review_migration.sql`, **`contacts_lemlist_push_migration.sql`** (esta última pendiente de pegado manual al cerrar la sesión — confirmar que el usuario la corrió).
- Tabla `contacts` tiene varios registros con `human_decision='approved'` pero con `fit_action='enrich'` y `clay_pushed_at` no nulo, **sin `lemlist_pushed_at`** (los manual_review aprobados durante sesiones anteriores cuando el push a Clay fallaba). Esos contactos están en bucket "En campaña" en la UI pero **no llegaron realmente a Lemlist**. Posible futura mejora: botón "Re-empujar a Lemlist" o script bulk para procesar esos huérfanos con la nueva integración.

**Variables de entorno en Vercel (estado actual final):**
- `CLAY_COMPANIES_WEBHOOK_URL` — set ✅ (push de empresas a Clay)
- `CLAY_CONTACTS_WEBHOOK_URL` — set ✅ (push de contactos pre-filter YES a Clay)
- `CLAY_WEBHOOK_SECRET` — set ✅ (header en raw-contacts y scored-contacts)
- `ANTHROPIC_API_KEY` — set ✅
- `PERPLEXITY_API_KEY` — set ✅
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — set ✅
- `LEMLIST_API_KEY` — set ✅
- `LEMLIST_CAMPAIGN_ID` — `cam_TrfWtYHwp6qBb4Z8B` ✅
- Borradas: `CLAY_APPROVAL_WEBHOOK_URL`, `CLAY_API_TOKEN`, `CLAY_CONTACTS_TABLE_ID`, `CLAY_WORKSPACE_ID`, `CLAY_WORKBOOK_ID`.

**Gaps conocidos al cierre:**

1. ~~URGENTE — icebreaker excede 180 chars y duplica el nombre.~~ **Resuelto en la app** vía `lib/messageGenerator.ts` (clamp a 180 + regex strip de saludo). **Pendiente en Clay**: el prompt de la AI column `LinkedIn Icebreaker` para contactos `action=enrich` directo (que NO pasan por la app) sigue generando ~300 chars con "Hi {firstName}". El usuario tiene que editar ese prompt en Clay UI para alinearlo con las mismas reglas (≤180 chars, sin saludo).
2. Razones IA del Lead Scoring de Clay vienen en inglés. Solución: editar el prompt de Lead Scoring en Clay y agregar "Respond in Spanish (Latin American). The 'reason' field must be written in Spanish."
3. Clay Find People devuelve gente histórica (ya no trabaja en la empresa target) — el size-aware pre-filter + la detección de "former/ex-" mitiga la mayoría pero no 100%.
4. Empresas grandes tipo Aspen Dental (16k empleados) probablemente NO son fit real para el ICP (sweet spot 15-50). El usuario aceptó dejarla aprobada para validar el flujo.
5. Modern Dental Laboratory aprobada como ES pero LinkedIn apunta a HK (gap viejo, no resuelto).
6. **Contactos manual_review huérfanos**: ver sección "Estado en Supabase al cierre". Pueden re-empujarse con un endpoint/script si se quieren rescatar.

## Hecho del Sprint 4 fase 2 — phone enrichment + listas HubSpot (sesión 2026-05-13c)

Esta sesión cerró el bucle de teléfonos y agregó organización del SDR
en HubSpot. PRs #58 a #69.

### Phone enrichment — flujo final

**Lemlist auto (la mayoría de los teléfonos)**:
- `lib/lemlist.ts`: el push a Lemlist incluye `findPhone=true` en la
  query string (`ENRICHMENT_QUERY = "findEmail=true&verifyEmail=true&findPhone=true&linkedinEnrichment=true"`).
  Lemlist enriquece phone proactivo al insertar.
- Lemlist sincroniza automáticamente a HubSpot vía su integración
  nativa (sin código nuestro).
- Aplica tanto a manual_review approvals (donde la app llama
  `addLeadToCampaign`) como a auto-enrich vía Clay → "Add Lead to
  Campaign" — Lemlist enriquece todos los nuevos leads si el plan lo
  soporta (verificar en Lemlist Settings que phone enrichment esté
  habilitado a nivel workspace).

**Lusha manual (fallback cuando Lemlist no encuentra)**:
- Página `/telefonos` (sidebar SDR → Teléfonos): SDR pega LinkedIn
  URL → endpoint `POST /api/lusha-lookup` busca el contacto en
  Supabase (con fallback HubSpot por `hs_linkedinid`) → llama Lusha
  → PATCH a HubSpot + update Supabase.
- `lib/lusha.ts`: cliente para `/v2/person`. Prueba 3 URL/method
  patterns en orden (GET sincrónico, POST con `contacts` wrapper,
  POST flat) para tolerar variaciones del API de Lusha. Si todos
  devuelven sin phone, expone el raw response en el debug.
- Auth: header `api_key: <LUSHA_API_KEY>` (no Bearer).
- Idempotente: si el contacto ya tiene phone, no gasta crédito Lusha
  salvo que el SDR fuerce con `force: true` (botón "Buscar también
  con Lusha" en la UI cuando el contacto ya tenía phone de Lemlist).
- Cuando Lusha devuelve un phone diferente al existente de Lemlist,
  guardamos AMBOS en propiedades separadas (ver sección dual fields).

### Dual phone fields (Lemlist + Lusha lado a lado)

Cuando Lemlist y Lusha devuelven teléfonos diferentes (común porque
buscan en bases distintas), conservamos ambos para que el SDR pueda
comparar y elegir cuál llamar.

**Supabase** (`supabase/phone_dual_source_migration.sql`):
- `contacts.phone` — principal, último escrito.
- `contacts.phone_lemlist` — snapshot del phone que vino de Lemlist.
- `contacts.phone_lusha` — phone que vino de Lusha.
- `contacts.phone_source` — indica de qué fuente vino el principal.

**HubSpot** (creadas via `/configuracion/hubspot` → setup-lists endpoint):
- `phone` (estándar HubSpot) — principal.
- `wecad_phone_lemlist` (fieldType phonenumber).
- `wecad_phone_lusha` (fieldType phonenumber).
- `wecad_phone_source` — string lemlist/lusha.

**Lógica del endpoint Lusha**:
- Antes de sobreescribir phone con Lusha's value: si phone actual no
  es de Lusha y `phone_lemlist` está vacío → snapshot del phone
  existente a `phone_lemlist`. Asume que el phone preexistente vino
  de Lemlist (correcto para 99% de los casos).
- Después: phone = Lusha, phone_lusha = Lusha, phone_source = lusha.

### Listas dinámicas en HubSpot (organización SDR)

Reemplazo del approach Workflow webhook bloqueado (Marketing Hub Pro
NO incluye "Send a webhook" action — requiere Operations Hub Pro+).
En vez de triggers, usamos 7 listas dinámicas que se actualizan
automáticamente cuando cambian properties. SDR trabaja desde esas
listas en HubSpot, no necesita workflow.

**Las 7 listas** (creadas via `POST /api/hubspot/setup-lists`, definidas
en `lib/hubspotLists.ts`):

| Nombre | Filtro |
|---|---|
| weCAD · Hot por llamar (fit ≥ 8 + phone) | wecad_fit_score ≥ 8 AND phone ≠ "" AND hs_lead_status = NEW |
| weCAD · Hot sin teléfono (pedir Lusha) | wecad_fit_score ≥ 8 AND phone = "" AND hs_lead_status = NEW |
| weCAD · Warm por llamar (fit 5-7 + phone) | wecad_fit_score 5..7 AND phone ≠ "" AND hs_lead_status = NEW |
| weCAD · Warm sin teléfono (pedir Lusha) | wecad_fit_score 5..7 AND phone = "" AND hs_lead_status = NEW |
| weCAD · Reintentar (1er intento sin contacto) | hs_lead_status = ATTEMPTED_TO_CONTACT AND phone ≠ "" |
| weCAD · Callbacks de hoy | hs_lead_status = BAD_TIMING AND wecad_callback_date < today+1 |
| weCAD · En pipeline | hs_lead_status IN (CONNECTED, IN_PROGRESS, OPEN_DEAL) |

**Schema HubSpot Lists v3 — gotchas encontrados por iteración**:
- Root `filterBranch` siempre debe ser `OR` con sub-branches `AND`.
  Una AND-only condition se modela como `OR → [AND → [filters...]]`.
- STRING NO tiene `IS_KNOWN` / `HAS_PROPERTY` (a pesar de docs viejas).
  Operadores válidos: `IS_EQUAL_TO`, `IS_NOT_EQUAL_TO`, `CONTAINS`,
  `DOES_NOT_CONTAIN`, `STARTS_WITH`, `ENDS_WITH`, etc. Workaround
  para "phone existe": `IS_NOT_EQUAL_TO ""`.
- DATETIME usa `operationType: "TIME_POINT"` (no `DATETIME`), con
  campo `timePoint: <epoch ms>` (NO `timestamp`, NO ISO string).
- NUMBER `BETWEEN` da [value] required — usar GTE + LTE en filtros
  separados.

### Properties wecad_* nuevas

Definidas en `lib/hubspotProperties.ts`, creadas auto al push de
contactos (o forzadas via `/configuracion/hubspot`):
- `wecad_phone_lemlist`, `wecad_phone_lusha` (phonenumber)
- `wecad_phone_source`, `wecad_phone_enrichment_status` (string/enum)
- `wecad_callback_date` (datetime, para "Callbacks de hoy" list)
- `wecad_qualification_outcome` (enum: qualified / not_interested /
  wrong_persona / no_budget / competitor_locked / wrong_company /
  bad_data / other — para feedback loop ICP)

### Endpoints nuevos (vivos)

- `POST /api/lusha-lookup` — body `{linkedin_url, force?: boolean}`.
  Llamado desde `/telefonos`.
- `POST /api/hubspot/setup-lists` — one-shot. Crea properties + 7
  listas. Llamado desde `/configuracion/hubspot`. Idempotente.

### Lo que se intentó y NO funcionó (no recrear)

1. **HubSpot Workflow webhook action**: requiere Operations Hub Pro+,
   no disponible en Marketing Hub Pro del usuario. PR #62 borró toda
   la infraestructura asociada (`/api/hubspot/webhook/enrich-phone`,
   `/api/cron/enrich-phones`, `.github/workflows/enrich-phones.yml`).
   Si en el futuro suben de plan, se puede restaurar de git history
   pero por ahora no.
2. **GitHub Actions cron** para enrichment automático periódico:
   funcional pero borrado en el mismo pivot. Reemplazado por el
   flujo manual `/telefonos`.
3. **HubSpot Lists API operators viejos** (`IS_KNOWN`, `HAS_PROPERTY`,
   `NEQ`, `EQ`): documentados en algunas pages de HubSpot pero la API
   v3 actual no los acepta. Usar la lista que la API misma devuelve
   en errores 400.

### Variables de entorno en Vercel (estado actual)

- `LUSHA_API_KEY` — set ✅ (nuevo, requerido para `/telefonos`)
- Borrar: `CRON_SECRET` (ya no se usa, era para el cron borrado)
- El resto sin cambios (Clay/Lemlist/HubSpot/Anthropic/Perplexity/
  Supabase tokens).

### Estado en Supabase al cierre

Migraciones nuevas pendientes de pegar manualmente en SQL editor
(idempotentes con `if not exists`):
- `supabase/phone_enrichment_migration.sql` (status, source, timestamps)
- `supabase/phone_dual_source_migration.sql` (phone_lemlist, phone_lusha)

### Estado en HubSpot al cierre

- Custom properties wecad_* creadas (incluye las 6 nuevas del Sprint 4 fase 2).
- 7 listas dinámicas creadas — visible en HubSpot → CRM → Listas → buscar "weCAD".
- Lemlist sync nativa activa (sigue como estaba).
- Scope `crm.lists.write` agregado a la Private App (necesario para
  crear listas via API).

### Flujo SDR día a día (cómo se usa hoy)

1. **Empezar el día**: HubSpot → Listas → "weCAD · Hot por llamar".
   Llamás a los que están ahí.
2. **Si nadie contesta**: cambiás Lead status a "Attempted to contact"
   → cae automático a "Reintentar (1er intento sin contacto)".
3. **Si pide callback**: cambiás Lead status a "Bad timing" + completás
   `weCAD Callback Date` con la fecha agendada → cae automático a
   "Callbacks de hoy" el día agendado.
4. **Si fit alto sin phone**: aparece en "Hot sin teléfono". Copiás su
   LinkedIn URL → app `/telefonos` → click Buscar → Lusha levanta el
   phone → el contacto cae automático a "Hot por llamar".
5. **Cuando avanza a deal**: Lead status → "Connected" / "Open deal"
   → cae a "En pipeline" para tracking.

### Sidebar al cierre (cleanup)

- Removidos del sidebar (PR #69): "HubSpot setup" y "Revisión manual".
- La pantalla `/configuracion/hubspot` sigue existiendo (accesible via
  URL directa) por si hay que correr el setup endpoint otra vez.
- "Revisión manual" siempre estuvo disabled — era placeholder. La
  funcionalidad real vive en `/contactos` tab "Revisión manual".

### Gaps conocidos al cierre Sprint 4 fase 2

1. **NEQ "" workaround para phone existe**: el approach `STRING
   IS_NOT_EQUAL_TO ""` puede no matchear contactos con phone=null
   (vs ""). En la práctica Lemlist y Lusha escriben strings, no null,
   así que matchea. Si aparece un caso null → switch a otro shape.
2. **Lusha v2 API**: el shape del response que parseamos es defensivo
   con múltiples paths. Si Lusha cambia el shape, el parser puede
   fallar silencioso (devolver phone=null aunque haya). Mostrar siempre
   el raw response en debug ayuda a diagnosticar.
3. **No hay tracking de costos**: la app no muestra cuántos créditos
   Lemlist/Lusha consumió. El usuario monitorea desde los dashboards
   de Lemlist y Lusha.
4. Heredados de sesiones anteriores: Modern Dental Laboratory ES/HK
   mismatch, contactos manual_review huérfanos pre-PR-#52, prompts en
   inglés del Lead Scoring de Clay.

## Hecho del Sprint 5 fase 1 — Dashboard ejecutivo (sesión 2026-05-13d)

PR #70 mergeado. Primer módulo de visibilidad del pipeline.

### Archivos nuevos

- `lib/dashboardRanges.ts` — 8 presets de fecha con período "anterior"
  equivalente para deltas: Esta semana / Semana pasada / Este mes /
  Mes pasado / Este semestre (S1=ene-jun, S2=jul-dic) / Semestre
  pasado / Este año / Año pasado. ISO week (lunes-domingo) para
  semanas. Todas las fechas en UTC.
- `lib/dashboardQueries.ts` — agrega métricas Supabase. Cada Delta
  tiene `current`, `previous` y `pct_change` (null si previous=0).
  Funnel de 7 pasos: discovery → aprobado → contactos → YES →
  Lemlist → phone → HubSpot. Distribuciones, calidad del filtro,
  time series por día (bucketea a mes si rango > 180 días).
- `app/api/dashboard/route.ts` — GET con query param `range`
  (default `this_month`). Devuelve snapshot completo en un solo
  request.
- `app/dashboard/page.tsx` — UI con header + dropdown rango +
  4 KPI hero cards con delta ↑↓ + 4 mini cards de tasas con barra
  horizontal + funnel 7 pasos con gradient + 2-col distribuciones
  (donut-style stacked bar + leyenda) + 3-col calidad (action IA,
  manual review pending + % humano descartó, top razones descarte)
  + SVG sparkline 2-series para activity diaria.

### Cambios

- `app/page.tsx`: `/` redirige a `/dashboard` (antes redirigía a
  `/empresas`).
- `components/Sidebar.tsx`: "Dashboard" ya no está disabled.

### Diseño

Sigue el design system existente:
- `bg-canvas #F4F2FB`, `text-ink #1A1733`, `text-ink-muted #6B6884`.
- Cards: `card` class (rounded-card 12px, shadow-card sutil).
- Brand purple `#3D2878` (DEFAULT), `#7F77DD` (soft), `#EEEDFE` (tint).
- Status colors: success `#0F6E56`, warning `#854F0B`, info `#185FA5`,
  danger `#993C1D`.
- Sparkline en SVG inline (sin libs externas).
- Loading state con skeleton cards animadas.

### Fix pendiente al cierre de sesión

**PR todavía sin crear/mergear (MCP GitHub se desconectó):**

Commit `880efcf` en branch `claude/continue-wecad4you-prospecting-YNgtt`:

> fix(dashboard): origen de teléfonos solo cuenta contactos en Lemlist

El card "Origen de teléfonos" en `/dashboard` inflaba "Sin teléfono"
con contactos pre-filter descartados. El fix filtra a contactos
con `lemlist_pushed_at IS NOT NULL` (outreach activo). Subtítulo
actualizado para que se entienda el denominador.

Pasos para la próxima sesión:
1. Re-autenticar GitHub MCP (`mcp__github__authenticate`).
2. Crear PR del commit `880efcf` contra base
   `claude/wecad4you-prospecting-app-Hltfi`.
3. Mergear (squash).

### Gaps conocidos al cierre Sprint 5 fase 1

1. **Comparación de períodos contra "anterior equivalente"**: si
   estás a día 5 del mes, "este mes" compara contra mes pasado
   completo, lo cual es comparar 5 días contra 30. Próxima mejora:
   normalizar el período anterior a misma cantidad de días que el
   actual (ej. comparar día 1-5 de este mes vs día 1-5 del pasado).
2. **No hay drilldown desde cards**: clickear un KPI no lleva a la
   lista filtrada. Mejora futura: link a `/contactos?filter=...` o
   `/empresas?filter=...`.
3. **Cache**: cada refresh recarga toda la query. Si el dataset
   crece mucho, considerar:
   - Materialized views en Supabase actualizadas cada N min.
   - SWR/React Query con cache de 1 min en el cliente.
   - Pre-compute en cron y almacenar en una tabla `dashboard_snapshots`.
4. **No hay export**: el directorio puede querer PDF/PNG. Mejora
   futura: botón "Exportar PDF" usando `html2pdf` o similar.
5. **Time series con rango = año**: agrupa por mes en vez de día.
   Si la app tiene poca data, el chart puede verse vacío al inicio.

## Hecho del Sprint 5 fase 2 — Llamadas + transcripciones + coaching IA (sesión 2026-05-13e)

Pull de calls de HubSpot a Supabase con análisis automático de Claude
sobre la transcripción (o las notas si no hay transcripción). Para cada
llamada: clasifica la respuesta del cliente (interested / objection_*
/ callback_requested / not_interested / voicemail / gatekeeper / etc.),
da score 0-10 al SDR (overall + sub-scores apertura, descubrimiento,
manejo de objeciones, próximo paso), lista fortalezas y oportunidades
de mejora con citas textuales del transcript, y recomienda un próximo
paso concreto. Más reportería agregada (ranking SDRs, top áreas de
mejora, distribución de respuestas, sub-scores promedio).

### Archivos nuevos

- `supabase/calls_migration.sql` — tabla `calls` con columnas HubSpot
  (hubspot_call_id unique, direction, duration_ms, disposition_*,
  status, body, recording_url, transcription, has_transcription) +
  joins a contacts/companies + bloque de análisis (analyzed_at,
  analysis_model, customer_response_category/label/summary, los 5
  scores, sdr_strengths jsonb, sdr_improvements jsonb, recommended_
  next_step). Pegar manual en SQL editor.
- `lib/hubspotCalls.ts` — cliente HubSpot Calls API. searchCallsSince
  (paging hasta maxResults), batchReadCallAssociations (re-fetch con
  contacts/companies asociados — la search no los expone), caches en
  memoria (10min TTL) para getDispositionMap (hs_call_disposition GUID
  → label) y getOwnerMap (owner id → nombre).
- `lib/callAnalyzer.ts` — analyzeCall(input). createMessageWithFallback
  (Sonnet → Haiku 4.5 si overloaded). Output JSON estricto en español
  rioplatense. Categorías estables: interested, objection_price/timing/
  no_need/existing_solution/authority, callback_requested, not_interested,
  no_engagement, voicemail, wrong_number, gatekeeper, other.
- `lib/callsSync.ts` — orquesta search + batch read + resuelve maps
  + lookup contacts/companies en Supabase por hubspot_*_id + upsert
  por hubspot_call_id. Luego para los que tienen `analyzed_at IS NULL`
  corre analyzeCall en serie y persiste. Errores de análisis se
  guardan en `analysis_error` (no bloquea el sync).
- `app/api/calls/sync/route.ts` — `POST` con body opcional
  `{since_days?: 30, max_results?: 200, analyze?: true}`. maxDuration
  300s para soportar análisis serial de muchas calls.
- `app/api/calls/route.ts` — GET list con filtros range (8 presets +
  `all`), response (customer_response_category), owner, limit. Devuelve
  llamadas DESC + KPIs (total, avg_duration_sec, avg_sdr_score,
  interested_count/rate, callbacks_count).
- `app/api/calls/[id]/route.ts` — GET detalle con joins a contact
  (con company) y company. Incluye todos los campos de análisis.
- `app/api/calls/[id]/analyze/route.ts` — POST re-corre análisis.
- `app/api/calls/report/route.ts` — GET agregado para reportería:
  distribución de respuestas, ranking SDRs (avg_score, interested_rate),
  sub-scores promedio, top áreas de mejora (agregando `area` de
  sdr_improvements), time series diario.
- `app/llamadas/page.tsx` — lista agrupada por día con cards por
  llamada (contacto, empresa, direction, duration, disposition, score
  SDR badge, customer_response label, summary, próximo paso). Header
  con dropdown rango + botón "Sincronizar HubSpot" + link a reportería.
- `app/llamadas/[id]/page.tsx` — detalle: header con metadata +
  card "Respuesta del cliente" (badge + summary + próximo paso) +
  card "Evaluación SDR" con score grande + barras sub-scores +
  fortalezas + oportunidades de mejora con citas + secciones notas
  y transcripción. Botón "Re-analizar".
- `app/llamadas/reporte/page.tsx` — totals + distribución respuestas
  (barras horizontales) + sub-scores promedio (barras) + ranking SDRs
  (tabla con top badge) + top áreas de mejora (barras) + actividad
  diaria (bar chart con color por score promedio del día).

### Cambios

- `components/Sidebar.tsx`: "Llamadas" ya no está disabled, ícono
  cambiado a `IconPhoneCall` para distinguir de "Teléfonos".

### Flujo SDR día a día (cómo se usa Llamadas)

1. SDR registra llamadas en HubSpot como siempre (manualmente o vía
   integración de llamadas — Aircall, Kixie, dialer in-app de HubSpot,
   etc.). Si la llamada se graba, HubSpot puede generar transcripción
   automáticamente (depende del plan).
2. Coach/manager abre `/llamadas` y aprieta **"Sincronizar HubSpot"**.
   El sync pulla calls de los últimos 30 días, las upsertea en Supabase,
   y para cada una llama a Claude para analizar respuesta cliente +
   evaluar al SDR.
3. Manager revisa lista: ve qué llamadas terminaron mejor (interested,
   callbacks) y cuáles peor (objeciones repetidas, gatekeeper, no
   engagement). Cada card muestra el score IA y el customer response.
4. Click en una llamada → detalle con análisis completo. Lee
   transcripción + sugerencias de coaching personalizadas con citas
   del propio transcript del SDR.
5. `/llamadas/reporte` da la vista agregada: ranking de SDRs, top
   áreas de mejora recurrentes (ej. "Apertura" aparece 12×, "Manejo
   de objeción precio" 8× → próxima sesión de training).

### Sync semantics

- Idempotente: upsert por `hubspot_call_id`. Re-correr el sync no
  duplica.
- Análisis solo se corre cuando `analyzed_at IS NULL`. Para forzar
  re-análisis: botón "Re-analizar" en el detail page (llama a
  `/api/calls/[id]/analyze`).
- Falla de análisis individual no rompe el sync: el error se persiste
  en `calls.analysis_error` y aparece como badge rojo en la card.
- Resolución de FKs: contactos/empresas se linkean solo si fueron
  pusheadas previamente a HubSpot por la app (tienen `hubspot_*_id`
  no nulo). Llamadas a prospectos no enlazados muestran "(sin
  contacto vinculado)" pero aún se analizan con la info disponible.

### Variables de entorno en Vercel

No requiere nuevas. Usa `HUBSPOT_ACCESS_TOKEN` (mismo scope ya
configurado: `crm.objects.contacts.read`, `crm.objects.companies.read`
— ambos cubren calls API porque calls usa el mismo crm.objects scope
general) + `ANTHROPIC_API_KEY`. Si el typo de scopes en HubSpot da
401, agregar `crm.objects.calls.read` explícitamente y `crm.objects.
owners.read`.

### Gaps conocidos al cierre Sprint 5 fase 2

1. **Sync manual**: el botón "Sincronizar HubSpot" es manual. Para
   automatizarlo: webhook de HubSpot CRM (suscripción `object.creation`
   en calls), tarea cron de Vercel (Pro plan), o trigger en HubSpot
   Workflow (bloqueado por plan del cliente). Por ahora el flujo manual
   es suficiente.
2. **Transcripciones dependen del plan de HubSpot**: si la grabación
   no tiene transcript, Claude analiza con metadata + notas. La UI lo
   indica con badge "sin transcripción" implícito (no aparece el badge
   "transcripción").
3. **Sub-scores en voicemail/gatekeeper**: el prompt instruye que en
   esos casos opening/discovery/etc deben ser 0 (no había diálogo). El
   overall_score refleja calidad del mensaje dejado.
4. **No hay drilldown desde reporte → lista**: clickear una barra
   en distribución respuestas no filtra la lista. Mejora futura.
5. **Análisis en serie, no en paralelo**: para 200 calls con avg ~5s
   por análisis ≈ 17 min. El endpoint tiene `maxDuration: 300s` así
   que con muchas calls puede timeout. Workaround actual: bajar
   `max_results`. Futuro: paralelizar con `Promise.all` en chunks de
   5-10.

## Hecho del Sprint 5 fase 3 — Filtro SDR + KPIs ricos + drilldowns + hot leads (sesión 2026-05-14)

PR #75 mergeado. Iteración grande sobre `/llamadas` y `/llamadas/reporte`.

### Cambios

- **Contactos y empresas únicas en KPIs**: `kpis.unique_contacts` y
  `kpis.unique_companies` por rango. UI muestra "11 llamadas · 5
  contactos · 3 empresas".
- **Tasas de pickup**:
  - `PICKUP_CATEGORIES` en `lib/callAnalyzer.ts` (interested,
    objection_*, callback, not_interested, no_engagement).
  - `NO_PICKUP_CATEGORIES` (voicemail, gatekeeper, wrong_number).
  - Tasa pickup · llamada = atendidas / (atendidas + no_atendidas).
  - Tasa pickup · contacto = contactos únicos que atendieron al
    menos 1 vez / contactos únicos trabajados.
- **Filtro SDR** (`hubspot_owner_id`, el usuario que registró la
  call, no el owner del contacto): `GET /api/calls/owners` devuelve
  lista para el dropdown. Aplica en `/llamadas` y `/llamadas/reporte`.
- **Drilldown en respuestas del cliente**: cada categoría en
  `response_distribution` incluye `call_ids[]`. Click expande inline
  una lista compacta de calls (POST `/api/calls/by-ids` resuelve info
  ligera).
- **Drilldown en Top oportunidades de mejora**: `top_improvement_areas`
  incluye `top_suggestions` (dedup case-insensitive por 40 chars),
  `example_quotes` (con call_id), y `call_ids`.
- **Hot leads** (`GET /api/calls/hot-leads`): top 25 contactos
  rankeados por probabilidad de conversión. Heurística:
  - signal de respuesta: interested=50, callback=35, objection_timing=20, objection_price=10
  - + fit_score × 4 (0-40 pts)
  - + 5 pts cada uno: tiene phone, está en Lemlist, está en HubSpot
  - Excluye `status=discarded` o `human_decision=rejected`.

## Hecho del Sprint 5 fase 4 — Auto-import huérfanas + sub-scores drilldown + sanitize Lemlist (sesión 2026-05-14)

PR #76 mergeado. Tres cosas:

### 1. Mensajes Lemlist sin guion medio ni firma

- `lib/messageGenerator.ts` actualizado:
  - Prompt prohíbe explícitamente em-dash (—), en-dash (–) y hyphen
    como separador. Pedir comas, puntos, dos puntos.
  - Prompt prohíbe sign-off ("— Team weCAD4you", "Best,", "Saludos,").
    Lemlist appende firma automática.
- Defensa en código:
  - `stripAiDashes()`: reemplaza dashes con espacios alrededor por
    coma + espacio.
  - `stripSignature()`: remueve patrones comunes de firma al final
    del email body.

### 2. Vincular huérfanas ahora AUTO-IMPORTA desde HubSpot

`lib/callsLinkOrphans.ts` extendido con `importUnmatched` (default
true). Después del matching (wecad_id → hubspot_id → linkedin →
email), las huérfanas restantes se importan:

- `lib/hubspotContacts.ts`: agregamos `batchReadCompanies()` para
  traer info de las empresas.
- Para cada huérfana sin match: pedimos contact + company a
  HubSpot → creamos row en `companies` (status='approved') con
  name/domain/city/country/size/linkedin → creamos row en `contacts`
  (status='contacted') con firstname/lastname/jobtitle/email/phone/
  linkedin/hubspot_contact_id → vinculamos la call.
- Si HubSpot no tiene company asociada: creamos placeholder
  `"(sin empresa en HubSpot)"` para mantener FK NOT NULL de
  `contacts.company_id`.
- Mensaje del botón informa: "importados X contactos y Y empresas
  desde HubSpot".

### 3. Sub-scores drilldown en reportería

`app/api/calls/report/route.ts`: cada sub-score (opening, discovery,
objection_handling, next_step) ahora devuelve `worst_calls[]` con
top 5 calls peores en esa dimensión + suggestion + example_quote
del improvement cuya `area` matchea por keywords (apertura/discovery/
objec/próximo paso).

UI: sub-scores son clickables. Click expande lista de las 5 peores
calls con coaching específico para esa dimensión.

## Hecho del Sprint 5 fase 5 — Webhook HubSpot CRM real-time (sesión 2026-05-14)

PR #77 mergeado. Reemplaza el sync manual de calls por webhook
HubSpot CRM. **Análisis IA sigue manual** (botón "Analizar
pendientes") para controlar costo.

### Cambios técnicos

- `lib/callsSync.ts`: extraído `processCallIds(db, ids)` reutilizable.
  Hace el flujo batch read + maps + resolver FKs + upsert para un
  conjunto de hubspot_call_ids. `syncCalls()` lo llama internamente.
- `lib/hubspotWebhook.ts`: verifica firma HMAC-SHA256 v3 con
  timing-safe comparison. Rechaza requests con timestamp > 5 min
  de antigüedad (anti-replay).
- `POST /api/hubspot/webhook/calls`:
  - Lee raw body + headers `x-hubspot-signature-v3` + timestamp.
  - Reconstruye URL canónica (`x-forwarded-host` + `x-forwarded-proto`).
  - Verifica firma contra `HUBSPOT_APP_SECRET`. Sin envvar → 500.
  - Filtra eventos a `call.creation`, `call.propertyChange`,
    `call.deletion`. Dedup objectIds.
  - Upsert vía `processCallIds()`. Deletion → DELETE en Supabase.
  - Responde 200 OK rápido.

### Estimación de costos análisis IA

- Por llamada con transcripción (hasta 16k chars): ~$0.02 USD
  (Sonnet 4.6, ~4500 in + 500 out tokens).
- Por llamada sin transcripción (solo metadata + notas): ~$0.01 USD.
- Con fallback Haiku 4.5: ~1/3 del costo.
- 100 calls ≈ $1-2 USD. 500 calls/mes ≈ $5-10 USD.

### Configuración HubSpot (decisión final)

El usuario tiene **Service Key (BETA)** en HubSpot, no Private App
legacy. Service Keys (BETA) no exponen UI para crear webhook
subscriptions (solo tienen tab "Monitorización → Webhooks" que
muestra historial). Por eso usamos **arquitectura híbrida**:

- **Service Key `weCAD4you Prospecting App`** → da el
  `HUBSPOT_ACCESS_TOKEN`, se usa para todas las reads/writes
  (calls, contacts, companies, lists). NO TOCAR.
- **Private App legacy `weCAD4you Webhooks`** → dedicada solo
  para mandar webhooks firmados. Su Client Secret está en Vercel
  como `HUBSPOT_APP_SECRET`. Token de acceso de esta app no se usa.

### Estado de configuración al cierre Sprint 5 fase 5 (sesión 2026-05-14)

**Hecho por el usuario:**
- ✅ Creada Private App legacy `weCAD4you Webhooks` (vía
  "Aplicaciones anteriores → Crear aplicación antigua").
- ✅ Scope mínimo `crm.objects.contacts.read` agregado.
- ✅ URL de destino configurada:
  `https://wecad-prospecting.vercel.app/api/hubspot/webhook/calls`.
- ✅ Client Secret copiado a Vercel env var `HUBSPOT_APP_SECRET`.
- ✅ Redeploy de Vercel ejecutado.

**Pendiente al cierre (cuando el usuario retome mañana):**
- ⏸ Crear las **dos subscriptions** en el tab Webhooks de la app
  (no aparecen porque en el modal "Crear suscripción", el dropdown
  "¿Qué tipos de objetos?" no incluye "Llamada" por default —
  hay que activar el toggle BETA **"¿Usar la ampliación de la
  cantidad de objetos?"** que está arriba del modal para
  desbloquear más tipos de objeto incluyendo Llamada/Call).
- ⏸ Subscription 1: Llamada → Creado (object created).
- ⏸ Subscription 2: Llamada → Cambio de propiedad, con properties:
  `hs_call_body`, `hs_call_disposition`, `hs_call_status`,
  `hs_call_transcription`, `hs_call_duration`,
  `hs_call_recording_url`.
- ⏸ Activar las dos subscriptions.
- ⏸ Test end-to-end: registrar call en HubSpot → esperar 10s →
  refrescar `/llamadas` y confirmar que aparece sin tocar
  "Sincronizar HubSpot".

Sin las subscriptions creadas/activas, el botón "Sincronizar HubSpot"
manual en `/llamadas` sigue funcionando como fallback.

### Variables de entorno en Vercel (estado actual al cierre)

- `HUBSPOT_ACCESS_TOKEN` — set ✅ (Service Key, pat-na1-c7cba...)
- `HUBSPOT_APP_SECRET` — set ✅ (Client Secret de la Private App
  legacy `weCAD4you Webhooks`)
- Resto sin cambios respecto al cierre Sprint 4.

## Entregabilidad de email en Lemlist — RESUELTO (sesión 2026-05-14)

Decidido y armado: qué hacer con leads cuyo email viene
`Undeliverable` / `Risky` desde el enrichment de Lemlist.

### Criterio acordado

- **Undeliverable**: NO mandar email (hard bounce → daña reputación
  del dominio de envío para TODAS las campañas). Pero NO excluirlos
  del auto-launch, porque eso les mata también el toque de LinkedIn.
- **Risky**: incluir. "Risky" = verificador no está seguro (catch-all,
  role-based), no = malo. La cadencia multicanal hedgea el riesgo.
  Monitorear bounce rate; si >5%, ponerse estricto.
- **Not verified**: incluir (entra en la rama Yes).
- **Data de prueba**: `tom@wiand.example` (TLD reservado `.example`,
  no puede recibir mail) es el contacto de testing de Sprint 2 —
  sacarlo de la campaña real.

### Solución: bifurcación nativa en la secuencia Lemlist (cero código)

Lemlist **sí** soporta un paso de condición sobre email status
(`Has email address with status "Not verified, Deliverable, Risky"`).
El usuario armó la secuencia así (campaña "Clay + Claude weCAD4you
Outreach v1"):

1. Sequence start.
2. Visit profile (soft warming touch) — send immediately.
3. Wait 2 días → Invitation (connection request en LinkedIn).
4. **Condición: email status ∈ {Not verified, Deliverable, Risky}**
   - **Rama YES (email OK)** — full multicanal:
     - Wait 2 días → Email `{{emailSubject}}`.
     - Condición: "Accepted invite within 1 day" (LinkedIn).
       - YES → Wait 3 días → Chat message (LinkedIn).
       - NO → Wait 3 días → Email.
     - (merge) Wait 5 días → Email.
     - Wait 5 días → Email.
   - **Rama NO (undeliverable)** — solo LinkedIn:
     - Wait 1 día → Like last post (LinkedIn).
     - Wait 3 días → Chat message (LinkedIn).

Auto-launch: los 4 estados marcados (Not verified, Undeliverable,
Risky, Deliverable) → todos entran, la secuencia bifurca sola.

**No requirió cambios en la app.** `lib/lemlist.ts` y `lib/messageGenerator.ts`
quedan como están — Lemlist hace su propio enrichment de email al
insertar el lead y la condición de la secuencia se evalúa con eso.

### Mejora futura relacionada

Surfacear el estado de entregabilidad del email en `/contactos` para
visibilidad desde la app sin entrar a Lemlist. Encaja con el módulo
de Respuestas / Funnel.

## Hecho del Sprint 5 fase 6 — Discovery: más vías de entrada + calidad + contactos web (sesión 2026-05-14)

Iteración grande sobre `/empresas`. PRs #82 a #85. El objetivo: poder
avanzar con volúmenes de prospección, porque el discovery broad solo
rendía poco y con baja calidad.

### PR #82 — Buscar por nombre + Importar CSV

El panel "Recomendar empresas" pasa de 1 a **3 modos** (tabs):
- **Recomendación IA** — el discovery broad de siempre (por región/tamaño).
- **Buscar por nombre** — input de texto, la IA investiga esa empresa
  puntual y la deja en Pendientes.
- **Importar CSV** — subís un CSV con empresas objetivo, cada fila pasa
  por research.

Función compartida `lib/companyResearch.ts` → `researchOneCompany(hints, icp)`:
- Perplexity apuntado a UNA empresa + extracción Claude.
- **Siempre devuelve una tarjeta**, aunque sea low fit o fuera de rubro
  — el usuario eligió la empresa, no la silenciamos. El research_summary
  es honesto (si es un distribuidor o de otra industria, lo dice).
- Marca `off_target` cuando company_type sale "other".
- Si el usuario pasó un LinkedIn URL válido y la IA no encontró otro,
  usa el del usuario.

Endpoints:
- `POST /api/companies/research-one` — una empresa, dedup por nombre.
- `POST /api/companies/import` — batch (chunks paralelos de 3, máx 40
  filas), dedup contra base + dentro del CSV.

UI: parser CSV client-side robusto (comillas, comas embebidas, headers
normalizados). Columna obligatoria `company_name`; opcionales
`linkedin_url`, `website`, `city`, `country`. Si solo hay nombre
alcanza — la IA levanta el resto. Panel de ayuda con el formato +
ejemplo. Resumen post-import con detalle por empresa.

### PR #83 — Calidad y yield del discovery broad

El bug raíz: el pipeline de filtros NO filtraba por tipo ni tamaño,
solo nombre/dedup/LinkedIn/región. Por eso pasaban distribuidores y
empresas no-dentales (ej. "RyD Lab", biotecnología vegetal).

- **Filtro de fit en código** (`passesFit`): descarta `company_type
  "other"` y tamaños groseramente fuera de banda.
- **Prompts más estrictos** (Perplexity + Claude): lista explícita de
  qué NO incluir — distribuidores, fabricantes de equipos/materiales/
  software, proveedores, consultoras, centros de fresado que solo
  venden equipos, empresas de otras industrias aunque tengan "lab" en
  el nombre.
- **Salvataje de LinkedIn URL**: el mayor asesino de yield era que
  Claude dejaba `company_linkedin_url` en null porque Perplexity no la
  traía literal. Ahora, para empresas que pasaron el filtro de fit pero
  quedaron sin URL, se hace una 2da llamada a Perplexity dedicada solo
  a resolver esas URLs. Best-effort, matchea por nombre.
- **overshoot 2 → 3**: Perplexity recibe más pedido (cap sigue en 30).
- Diagnostics: nuevos pasos del embudo "Pasó filtro de fit" y
  "LinkedIn salvados".

### PR #84 — Fix micro-labs fuera de banda

"The Dental Lab" se coló: LinkedIn dice "2-10 employees", Claude
extrajo ~6, y el piso del filtro de fit era `size_min / 3` (=5 para
banda 15-50), así que un 6 pasaba. Esas páginas son fantasma (3
followers, 0 associated members → Clay no encuentra contactos).

- `passesFit`: piso de tamaño de `size_min / 3` → `size_min * 0.7`.
  Para 15-50 el piso pasa de 5 a 10.
- Prompts (Perplexity + Claude): instrucción explícita de NO incluir
  micro-labs (badge "2-10 employees", taller unipersonal) cuando el
  rango pedido es mayor.

**Limitación conocida no resuelta**: el caso "página fantasma con
tamaño self-reported alto pero 0 empleados reales" no es detectable
server-side (LinkedIn bloquea scraping, devuelve 999 / login wall).
El fix de fondo sería un **loop de feedback Clay → app**: cuando Clay
corre Find People y encuentra 0 contactos, que avise a la app para
marcar la empresa automáticamente. Requiere config en Clay (webhook
adicional). Pendiente.

### PR #85 — Contactos desde el sitio web de la empresa

Muchos labs tradicionales / familiares tienen su equipo publicado en
la web ("Our Team" / "Leadership") pero casi no usan LinkedIn, así que
Clay rinde cero. Caso real: The Dental Lab tiene COO, CFO y Director
of Operations con emails en thedentallab.net pero 0 en LinkedIn.

- `lib/websiteContacts.ts` → `scrapeCompanyContacts()`: Perplexity
  busca y lee la página de equipo del sitio, Claude extrae las
  personas (nombre, cargo, email, teléfono, linkedin si está linkeado).
- `POST /api/companies/[id]/scrape-contacts`: scrapea + mete los
  contactos por el pipeline de siempre (`intakeContactsForCompany` —
  pre-filter Claude + dedup + insert). Requiere `company_website`.
- `intakeContactsForCompany` ahora dedup **también por email** (los
  contactos de web suelen no tener LinkedIn URL pero sí email).
- UI: botón "Buscar contactos en la web" en la card de empresa
  (cuando tiene sitio web). Resumen: N encontradas, cuántas pasaron
  el pre-filtro, descartadas, duplicadas.
- Los contactos extraídos entran a `/contactos` y siguen el flujo
  normal. El email viene directo de la web → no gasta créditos Lusha.

### Confirmado: editar el ICP afecta discovery automáticamente

El usuario preguntó si editar el ICP en `/configuracion/icp` se
refleja en discovery. **Ya funciona así, no hubo que cambiar nada**:
- `POST /api/icp` crea una versión nueva activa (desactiva la anterior).
- Cada corrida de discovery (`/api/companies/recommend`) y el dropdown
  de tamaño leen el ICP activo fresco de la DB (sin caché — el cliente
  Supabase fuerza `no-store`, las rutas son `force-dynamic`).
- El ICP controla en discovery: org_types, signals_strong/medium,
  size_rules, competitors, notes. Lo hardcodeado en `lib/discovery.ts`
  (no viene del ICP): prioridad exocad/inLab > 3Shape, lista de "qué
  NO incluir", reglas de scoring high/medium/low.

### Gaps conocidos al cierre Sprint 5 fase 6

1. **Páginas LinkedIn fantasma**: ver PR #84. No detectable server-side;
   el fix real es el loop Clay → app cuando Find People da 0.
2. **Dedup del scrape web por email**: si la web no publica emails, los
   contactos scrapeados no tienen email ni LinkedIn → no hay clave de
   dedup, se duplican al re-scrapear. En la práctica las páginas de
   equipo suelen tener email. Si aparece el caso, agregar dedup por
   nombre completo.
3. **CSV, no XLSX**: la importación pide CSV (el usuario exporta su
   Excel como CSV) para no sumar la dependencia `xlsx`.

## Hecho del Sprint 5 fase 7 — Push directo a Lemlist + UX de contactos (sesión 2026-05-14)

PRs #87, #88, #89. Cierra el flujo de los contactos scrapeados de la
web y mejora la navegación de `/contactos`.

### PR #87 + #88 — Push directo a Lemlist (saltea Clay)

Los contactos scrapeados del sitio web (PR #85) ya tienen email pero
no LinkedIn URL. Pasarlos por Clay no aporta: Clay no puede Find
People (ya los tenemos) ni enriquecer (sin LinkedIn URL). Nuevo
camino directo:

- `POST /api/contacts/[id]/push-to-lemlist`: valida que el contacto
  sea pre-filter YES, tenga email, no esté ya en Clay ni en Lemlist.
  1. Reusa `pushApprovedToLemlist` (genera icebreaker + email_subject
     + email_body con Claude si faltan, pushea con `addLeadToCampaign`).
  2. Tras push OK marca `fit_action='enrich'` → el contacto pasa de
     "Pendientes" a "En campaña".
  3. **También sincroniza a HubSpot** (PR #88): `pushCompanyToHubSpot`
     (idempotente) para tener el `hubspot_company_id`, recarga el
     contacto (ya con los mensajes generados persistidos) y
     `pushContactToHubSpot` asociándolo a la empresa. Independiente
     del resultado de Lemlist.
  4. Response incluye `lemlist_push` + `hubspot_push`.
- UI `/contactos`: botón "Directo a Lemlist" en cards del bucket
  Pendientes cuando el contacto tiene email y no fue empujado a
  Clay/Lemlist. Convive con "Prospectar en Clay" — el usuario elige.

Flujo completo nuevo: `/empresas` → "Buscar contactos en la web" →
contactos entran a `/contactos` Pendientes con email → "Directo a
Lemlist" → contacto en Lemlist **y** en HubSpot, sin pasar por Clay.

### PR #89 — UX de `/contactos`: empresas colapsables + orden + buscador

- Las secciones por empresa ahora son **colapsables**: header
  clickable (chevron + nombre + contador), las tarjetas aparecen al
  expandir. Default colapsado. Botones "Expandir todo" / "Colapsar
  todo" cuando hay > 1 empresa.
- Empresas ordenadas de **más nuevas a más antiguas** (por el
  `created_at` del contacto más reciente de cada grupo).
- **Buscador** por nombre de empresa, nombre de contacto o cargo.
  Con búsqueda activa los grupos que matchean se auto-expanden.
- Búsqueda + estado de expansión se resetean al cambiar de bucket.
- Aplica a los 4 buckets.

### Gaps conocidos al cierre Sprint 5 fase 7

1. **Contactos pre-PR-#88 sin HubSpot**: los contactos que se
   empujaron "Directo a Lemlist" antes del PR #88 quedaron sin
   sincronizar a HubSpot. Se pueden re-sincronizar con el botón
   "Sincronizar a HubSpot" / "Resync HubSpot" que aparece en la card
   cuando el contacto está en "En campaña".
2. Heredados: páginas LinkedIn fantasma (loop Clay → app pendiente),
   dedup del scrape web sin email.

## Hecho del Sprint 6 fase 3 — Responder desde la app (Lemlist Inbox API) (sesión 2026-05-15)

El SDR ahora puede responder a un lead (LinkedIn o email) directamente
desde el módulo `/respuestas`, sin entrar a Lemlist ni a LinkedIn. La app
llama a la **API de Inbox de Lemlist** y Lemlist manda el mensaje por la
cuenta de LinkedIn / mailbox conectada del usuario. Además, Claude puede
sugerir un borrador de respuesta con el contexto del prospecto + la
propuesta de valor de weCAD4you.

### Por qué se pudo (contexto importante)

Sesiones previas concluyeron que la API de Lemlist no daba para mucho,
pero Lemlist agregó endpoints de **Inbox** que sí permiten esto:
- `POST /api/inbox/linkedin` — enviar mensaje de LinkedIn (params:
  `sendUserId`, `leadId`, `contactId`, `message`).
- `POST /api/inbox/email` — responder un email del hilo.
- `GET /api/inbox/{contactId}` — traer el hilo completo (no usado todavía).

Esto NO choca con la lista "NO RECREAR" — eso es Clay REST API y webhooks
de HubSpot, no Lemlist. El portal de docs de Lemlist bloquea fetch
automático (403), así que el shape exacto del body de `/inbox/email` no
está 100% confirmado: el cliente se construyó defensivo (prueba varios
shapes/URLs y captura el raw response en el debug), igual que `lib/lemlist.ts`.

### Archivos nuevos

- `supabase/lemlist_activities_outbound_replies_migration.sql` — añade
  `reply_sent_text`, `reply_sent_at`, `reply_send_error` a
  `lemlist_activities`. **Pegar manual en SQL editor de Supabase** una vez.
- `lib/lemlistInbox.ts` — cliente de la API de Inbox de Lemlist:
  - `sendLinkedinMessage()` → `POST /api/inbox/linkedin`.
  - `sendEmailReply()` → `POST /api/inbox/email` (prueba shapes
    `message` y `text+body`, más fallback `/v2`).
  - `resolveSendUserId()` — env var `LEMLIST_SEND_USER_ID` primero;
    fallback de conveniencia `GET /api/team` (si hay 1 usuario lo usa,
    si hay varios pide setear la env var).
  - `resolveInboxIds()` — saca `leadId` + `contactId` del payload crudo
    de la actividad; si falta `contactId`, consulta el lead en Lemlist
    (`getLemlistLeadById` / `getLemlistLeadByEmail`).
- `lib/replyDrafter.ts` — `draftReply()`: Claude genera UN borrador de
  respuesta (Sonnet con fallback Haiku). Adaptado al canal (LinkedIn
  corto sin saludo; email arranca con "Hi {firstName},"). Reglas por
  categoría (interested → propone call; objection → reframe; question →
  responde; not_interested/unsubscribe → 1 frase cortés). Reusa
  `stripAiDashes` / `stripSignature` (ahora exportados de
  `lib/messageGenerator.ts`).
- `app/api/respuestas/[id]/draft/route.ts` — POST: devuelve el borrador
  IA (no envía nada).
- `app/api/respuestas/[id]/reply/route.ts` — POST `{ message, subject? }`:
  envía vía Inbox API. Al OK marca `reply_handled_at` + guarda
  `reply_sent_text` / `reply_sent_at`. Al fallar persiste
  `reply_send_error` y devuelve `debug` con los intentos.

### Cambios

- `app/api/respuestas/route.ts` (GET) — expone `reply_sent_text`,
  `reply_sent_at`, `reply_send_error`.
- `app/respuestas/page.tsx` — cada card tiene un composer: botón
  "Responder por LinkedIn/email", textarea, "Sugerir con IA" (llena el
  textarea con el borrador de Claude), "Enviar". Card muestra
  "Respondido ✓" con el texto enviado cuando `reply_sent_at` no es null,
  y panel debug amarillo si el envío falla.

### Variable de entorno nueva en Vercel

- `LEMLIST_SEND_USER_ID` — ID del usuario de Lemlist que envía (cuenta
  de LinkedIn / mailbox conectada). Si el equipo tiene un solo usuario,
  la app lo resuelve sola vía `GET /api/team`; si falla o hay varios,
  hay que setearla a mano. El error del endpoint `reply` incluye el
  `debug` con la respuesta de `/api/team` para encontrar el ID.

### Para probar end-to-end (pendiente del usuario)

1. Pegar `supabase/lemlist_activities_outbound_replies_migration.sql` en
   el SQL editor de Supabase.
2. (Opcional) setear `LEMLIST_SEND_USER_ID` en Vercel + redeploy.
3. En `/respuestas`, sobre una respuesta real: "Sugerir con IA" →
   revisar el borrador → "Enviar". Confirmar que el mensaje aparece en
   la conversación de Lemlist / LinkedIn.
4. Si falla: el panel amarillo muestra los intentos contra la Inbox API
   (URL, status, body shape, respuesta cruda) — sirve para confirmar el
   shape exacto que espera `/inbox/email` y ajustar `lib/lemlistInbox.ts`.

### Gaps conocidos al cierre Sprint 6 fase 3

1. **Shape de `/inbox/email` sin confirmar**: el cliente prueba
   `message` y `text+body`. Si Lemlist espera otro shape, el debug del
   panel amarillo lo revela y se ajusta `sendEmailReply()`.
2. **`sendUserId` con equipo multi-usuario**: si `GET /api/team` no
   devuelve una lista de usuarios parseable, hay que setear
   `LEMLIST_SEND_USER_ID` a mano.
3. **Sin hilo completo**: la app no trae el thread de la conversación
   (`GET /api/inbox/{contactId}`); el borrador IA usa solo el último
   mensaje del prospecto (`reply_text`) + contexto del contacto. Si se
   quiere mejor contexto, agregar el fetch del thread.
4. **Respuestas sin `reply_text`**: si Lemlist no devolvió el texto, el
   botón "Sugerir con IA" queda deshabilitado, pero el SDR puede
   escribir y enviar a mano igual.

## Hecho del Sprint 6 fase 4 — Módulo Sales Navigator (sesión 2026-05-15)

Módulo nuevo `/sales-navigator` (sidebar → Prospección, después de
Contactos). Junta las empresas que Clay no pudo prospectar (Find People
= 0 contactos) para que el usuario las busque a mano en LinkedIn Sales
Navigator, pegue las URLs de los decision-makers fit, y la app las
importe + pre-filtre + mande directo a Lemlist. Si no hay contactos
fit, se marca la empresa para que salga de la cola.

### Se apoya en infra que ya existía

- **Loop Clay → app (PR #91)**: `POST /api/clay/company-no-contacts`
  marca `companies.clay_no_contacts_at` cuando Find People da 0. Sigue
  vivo como SEÑAL PRECISA, pero **crear la columna HTTP API en Clay que
  lo dispara quedó detrás del plan Growth** (las columnas HTTP API
  viejas — raw-contacts, scored-contacts — siguen andando porque están
  grandfathered del trial; columnas nuevas ya no se pueden sin upgrade).
  Por eso el módulo NO depende de eso — ver "Señal inferida" abajo.
- **`intakeContactsForCompany`** (lib/contactsIntake.ts): pipeline
  compartido de pre-filtro Claude + dedup + insert. Al insertar
  cualquier fila limpia `clay_no_contacts_at` + `sales_nav_status` →
  la empresa sale del módulo sola.
- **`/api/contacts/[id]/push-to-lemlist`**: el "Directo a Lemlist" que
  ya existía. Se relajó: antes exigía email; ahora acepta email **o**
  LinkedIn URL (los contactos de Sales Nav tienen LinkedIn, sin email;
  Lemlist enriquece el email al insertar el lead).

### Archivos nuevos

- `supabase/companies_sales_nav_migration.sql` — añade
  `sales_nav_status` (null = por revisar, 'no_fit' = sin contactos fit)
  y `sales_nav_checked_at` a `companies`. **Pegar manual en Supabase.**
- `lib/salesNavContactResearch.ts` — `researchContactFromLinkedin()`:
  Perplexity + Claude intentan sacar nombre + cargo de una URL de
  perfil. Best-effort (LinkedIn bloquea scraping); si no encuentra,
  devuelve el nombre tentativo del slug de la URL con `found=false`
  para que el usuario complete a mano.
- `app/api/sales-navigator/route.ts` — GET: empresas que necesitan
  revisión en Sales Navigator, separadas en `pending` / `no_fit`. Dos
  señales para `pending` (cada empresa trae `signal`):
  - `signal='clay'`: Clay avisó por webhook (`clay_no_contacts_at`).
  - `signal='inferred'`: la app lo dedujo — empresa empujada a Clay hace
    más de `CLAY_GRACE_HOURS` (24h) que sigue sin NINGÚN contacto en la
    base. Si Clay hubiera encontrado gente, el webhook raw-contacts ya
    habría creado las filas. Esto hace que el módulo funcione SIN
    necesidad de la columna HTTP API en Clay (que quedó plan-gated).
- `app/api/sales-navigator/research-contacts/route.ts` — POST
  `{ company_id, linkedin_urls[] }` → devuelve `drafts` (no inserta).
  Chunks paralelos de 3, cap 12 URLs.
- `app/api/sales-navigator/[id]/import/route.ts` — POST `{ contacts }`
  → `intakeContactsForCompany` → devuelve los contactos YES recién
  importados para mostrarlos inline.
- `app/api/sales-navigator/[id]/mark/route.ts` — POST `{ status }`:
  'no_fit' saca la empresa de la cola (sin rechazarla), null la
  reactiva.
- `app/sales-navigator/page.tsx` — UI: 2 tabs (Por revisar / Sin
  contactos fit). Cada card: info de la empresa + "Abrir en Sales
  Navigator" (deep link a búsqueda de gente por nombre de empresa) +
  textarea para pegar URLs + "Buscar con IA" → filas editables →
  "Importar" → contactos inline con "Directo a Lemlist".

### Cambios

- `lib/contactsIntake.ts` — el update post-insert ahora también limpia
  `sales_nav_status`.
- `app/api/contacts/[id]/push-to-lemlist/route.ts` — guard relajado
  (email **o** linkedin_url).
- `components/Sidebar.tsx` — item "Sales Navigator" (ícono Compass).

### Flujo del usuario

1. Clay corre Find People sobre una empresa aprobada y no encuentra a
   nadie → webhook marca `clay_no_contacts_at` → la empresa aparece en
   `/sales-navigator` "Por revisar".
2. El usuario abre la empresa, click "Abrir en Sales Navigator", busca
   decision-makers fit en LinkedIn.
3. Pega las URLs de perfil → "Buscar con IA" → revisa/corrige los
   nombres y cargos que la IA sacó → "Importar".
4. Los contactos YES aparecen inline con "Directo a Lemlist" (genera
   icebreaker + email con Claude, pushea, Lemlist enriquece email +
   teléfono). También quedan en `/contactos`. La empresa sale de la
   cola sola.
5. Si no hay nadie fit → "No hay contactos fit" → la empresa pasa a
   "Sin contactos fit" (reactivable).

### Para activarlo (pendiente del usuario)

1. Pegar `supabase/companies_sales_nav_migration.sql` en Supabase. ✅
   (hecho por el usuario en la sesión 2026-05-15).
2. **Nada en Clay.** Se intentó crear la columna HTTP API
   `company-no-contacts` pero las HTTP API Integrations de Clay quedaron
   detrás del plan Growth. El módulo funciona igual gracias a la señal
   inferida (ver arriba). Si en el futuro suben de plan, crear esa
   columna agrega la señal precisa además de la inferida — pero no es
   necesario.

### Cambio (sesión 2026-05-15b): import vía Campaña puente de Lemlist

Se reemplazó el flujo de "pegar URLs + research IA" por la **extensión de
Lemlist + una campaña puente**. Motivo: pegar URLs tenía fricción real
(las URLs de Sales Navigator `/sales/lead/...` no sirven, hay que ir al
perfil `/in/` — 2 clics extra por contacto) y el research por URL nunca
conseguía el cargo. La extensión de Lemlist scrapea la página de Sales
Nav directo, así que captura nombre **y cargo**.

Spike de la API de Lemlist: **no hay endpoint para leer listas**, pero sí
`GET /api/campaigns/{id}/leads` (documentado, v1). Por eso se usa una
**campaña** puente, no una lista.

Flujo nuevo:
1. El usuario crea en Lemlist una campaña SIN secuencia ("Campaña puente",
   `cam_5rYdqSzz8hvMCp3Ky`) — un buzón. Importante que no tenga pasos, si
   no empezaría a mandar con `{{icebreaker}}` vacío.
2. En `/sales-navigator`, por empresa: "Abrir en Sales Navigator" → busca
   los fit → con la extensión de Lemlist los manda a la Campaña puente.
3. "Importar desde Campaña puente" en la card → `POST /api/sales-navigator/[id]/import`
   (sin body) jala los leads de la campaña puente vía `getCampaignLeads`,
   filtra por match de nombre de empresa, y los pasa por
   `intakeContactsForCompany`. El dedup por linkedin_url/email hace que
   re-correrlo solo procese los **nuevos**.
4. Los contactos YES aparecen inline con "Directo a Lemlist" + botón bulk
   **"Enviar todos a Lemlist (N)"**.

Cambios de código:
- `lib/lemlist.ts` — nuevo `getCampaignLeads(campaignId)`: GET paginado,
  defensivo (rechaza HTML del SPA), normaliza el shape del lead.
- `app/api/sales-navigator/[id]/import/route.ts` — repurposed: ya no
  recibe `{ contacts }`, ahora jala de la campaña puente y matchea por
  nombre de empresa (`namesMatch`, laxo con piso de 4 chars).
- **Borrados**: `lib/salesNavContactResearch.ts` y
  `app/api/sales-navigator/research-contacts/route.ts` (el research por
  URL ya no se usa).
- `app/sales-navigator/page.tsx` — la card ya no tiene textarea de URLs;
  tiene instrucciones numeradas + botón "Importar desde Campaña puente" +
  botón bulk "Enviar todos a Lemlist".
- Nueva env var **`LEMLIST_STAGING_CAMPAIGN_ID`** (= `cam_5rYdqSzz8hvMCp3Ky`).

Salvedad: el endpoint `getCampaignLeads` no se pudo probar en vivo (no hay
API key en el entorno de dev). Está construido defensivo (varios patrones
de URL, captura debug) — el usuario lo prueba en prod y el error del
endpoint trae el `debug` si el shape no es el esperado.

### PR #108 — Botón "Incluir las recién mandadas a Clay"

El módulo espera 24h por defecto antes de mostrar una empresa (para no
listar las que Clay todavía está procesando). Nuevo toggle en
`/sales-navigator` → "Por revisar" que baja esa gracia a 0 y trae
todas las empresas que pasaron por Clay y siguen sin contactos, sin
importar cuán reciente sea el push. La UI marca con un aviso amarillo
las cards de empresas mandadas a Clay hace <24h ("puede que Clay siga
procesándola — verifica antes de buscar a mano"). El endpoint GET
`/api/sales-navigator` acepta `?include_recent=1`.

### PR #111 — Diagnóstico + escape hatch para el import desde Campaña puente

Iteración sobre el import: el match por nombre de empresa fallaba en
casos reales (ver "Pendiente abierto al cerrar 2026-05-15c" más abajo).
Cambios para diagnosticar y desbloquear:

- El endpoint `POST /api/sales-navigator/[id]/import` siempre devuelve
  `staged_leads` (hasta 30 leads de la Campaña puente con su
  `company_name` tal como Lemlist lo guarda, `job_title`, `linkedin_url`)
  y `matched_url` (qué URL del GET de leads efectivamente respondió).
- La UI, cuando hay leads en la puente pero ninguno matcheó por nombre,
  muestra la lista de leads + botón "Importar N de todas formas a esta
  empresa" (`?all=1`) — escape hatch que saltea el match.
- Si `staged_total === 0` la UI dice "no llegó ningún lead" y muestra
  el URL probado contra Lemlist, para diagnosticar si el shape del API
  es distinto al asumido.

### Gaps conocidos al cierre Sprint 6 fase 4

1. **Match por nombre de empresa poco confiable** — la extensión de
   Lemlist no captura `company_name` de forma consistente. Ver
   "Pendiente abierto al cerrar 2026-05-15c — fix del match en Sales
   Navigator" más abajo.
2. **Deep link a Sales Navigator**: el botón abre una búsqueda de
   gente filtrada por nombre de empresa
   (`/sales/search/people?keywords=...`). Si LinkedIn cambia el
   formato del query string, igual cae en Sales Nav y el usuario
   busca a mano.
3. **Sin API de Sales Navigator**: jalar resultados de búsqueda de
   Sales Nav no tiene API usable (LinkedIn lo bloquea). La búsqueda la
   hace el usuario en Sales Nav y los manda a la Campaña puente con la
   extensión de Lemlist; la app jala desde ahí.

## Chore — Español neutro LATAM (PR #110, sesión 2026-05-15c)

El equipo es chileno. Se convirtió todo el texto visible para el usuario
de voseo/rioplatense a tuteo neutro LATAM en 10 archivos (páginas y 2
mensajes de error de API). Ejemplos: `pegá→pega`, `buscá→busca`,
`volvé→vuelve`, `tocá→haz clic`, `tenés→tienes`, `querés→quieres`,
`acá→aquí`, `dale al botón→haz clic en el botón`, `ojo:→atención:`.

**Importante para futuras iteraciones**: cualquier texto NUEVO que se
agregue a la UI o a mensajes de error debe estar en **tuteo neutro
LATAM**, no en voseo argentino. Tampoco lenguaje muy regional chileno
("po", "cachái") — neutro para que sirva si el equipo crece más allá de
Chile. No se tocaron los comentarios del código (siguen como están).

## Pendiente abierto al cerrar 2026-05-15c — fix del match en Sales Navigator

El usuario testeó en vivo el flujo "Sales Nav → Campaña puente → app".
Probó con 4 leads y el match por nombre de empresa no funcionó. Mirando
los leads en la Campaña puente:

| Lead | `company_name` en Lemlist | `job_title` |
|---|---|---|
| Jeff Stimpson | **(vacío)** | Dental Laboratory Manager |
| Susan van Kinsbergen | "Artisan Dental Laboratory" | General Manager |
| karl koch | "artisan dental lab" (minúsculas, abreviado) | Owner |
| laurie langley | **(vacío)** | implant manager |

Dos problemas estructurales del match:

1. La extensión de Lemlist NO captura `company_name` de forma confiable
   (2 de 4 leads quedaron vacíos).
2. Cuando sí lo captura, hay variantes ("Artisan Dental Laboratory" vs
   "artisan dental lab" para la misma empresa).

**Decisión pendiente del usuario** (planteada al cierre, sin respuesta):

- **Opción A — Importar todo, sin match (simple):** "Importar desde
  Campaña puente" trae todos los leads de la puente a esta empresa, sin
  filtrar. El workflow es per-empresa (procesar una, importar, pasar a
  la siguiente). Riesgo: leftovers en la puente se asignan a la empresa
  equivocada. Mitigación manual: borrar contactos mal asignados desde
  `/contactos`, o limpiar la Campaña puente en Lemlist entre empresas.

- **Opción B — Confirmación con checkboxes (más control):** Click en
  "Importar desde Campaña puente" abre un preview con los N leads, todos
  chequeados por default; el usuario desmarca los que no son de esta
  empresa; click en "Importar N seleccionados". Un clic extra, cero
  riesgo de cross-contamination.

- **Adicional opcional (encima de A o B) — Auto-limpiar la puente:**
  Después de importar OK, la app le hace DELETE a esos leads vía la API
  de Lemlist (`DELETE /api/campaigns/{id}/leads/{email_o_id}`). La
  Campaña puente queda vacía sola, sin leftovers. Riesgo: si el DELETE
  falla, simplemente quedan leads en la puente (no rompe nada).

Mi recomendación al usuario fue: **Opción B + auto-limpiar.** Pero
quedó esperando su elección. **PRIMERA TAREA DE MAÑANA**: confirmar la
opción y construirla.

Mientras tanto el usuario tiene el escape hatch del PR #111 ("Importar
de todas formas") — funcional pero requiere 2 clics.

## Hecho del Sprint 7 — Régimen estricto de evidencia + cleanup completo (sesión 2026-05-16)

Sesión grande. El usuario destapó el caso Elite Dental Lab: una empresa
"fit high" con 6 señales operativas detalladas (3Shape inLab confirmado,
Cerec Primescan, ya externaliza con Evident, contratando CAM operator,
tutoriales en YouTube, 30 empleados) pero las 8 fuentes guardadas eran
PDFs académicos del rubro — NINGUNA nombraba a Elite. Sospecha confirmada:
todas las señales operativas estaban alucinadas. El research broad infería
señales del contexto genérico del rubro y las atribuía a empresas
específicas. PRs #114 a #123 cerraron este boquete.

### PR #114 — Endpoint diagnóstico (sin escribir nada)

`POST /api/companies/research-diagnostic` — re-corre Perplexity + Claude
sobre una empresa puntual con los MISMOS prompts de prod y devuelve TODO
crudo: contenido completo de Perplexity, respuesta completa de Claude,
citas, y matches de palabras clave dentro del texto de Perplexity (con
snippets de ±120 chars). No inserta nada.

UI `/diagnostico-empresa` (no en sidebar, URL directa): form con nombre +
hints opcionales + keywords extra → muestra los matches primero (rojo si
0 hits, ámbar si 1-2, verde si 3+), después las citas, después el dump
completo de Perplexity y Claude.

**Diagnóstico de Elite Dental Lab confirmó:** "CAM operator" → 0 hits,
"hiring" → 2 hits ambos en contexto de "no hay ofertas", todas las
señales operativas estaban inventadas. Las 6 citas de hoy son específicas
de Elite (Manta, About Us, Services) pero el contenido literal dice "no
hay información pública sobre software CAD ni escáner".

### PR #115 — Régimen estricto en discovery + research + outreach

Cero invención. Reescritura de los 3 prompts críticos + validación de
evidencia post-extracción.

**`lib/companyEvidence.ts` (nuevo helper compartido):**
- `citationNamesCompany(citation, name)`: una cita "nombra" a la empresa
  si su title/URL contienen las primeras 2 palabras significativas del
  nombre.
- `evidenceQuality(name, citations)`: clasifica `specific` / `generic` /
  `none`.
- `cleanFitSignals(fitSignals, name, sources)`: strippea señales
  operativas sin cita [N] que nombre la empresa específicamente.
- `validateCompanyEvidence(company)`: aplica todo el régimen — clean
  signals + nulea cad_software/scanner/competitor cuando no hay evidencia
  específica + baja fit_score a "low".

**`lib/discovery.ts` (broad):**
- Prompt reescrito con principio rector "honestidad sobre completitud".
- Cada hecho operativo requiere cita [N] que nombre a la empresa.
- Filtrado en código (`passed_evidence`): empresas sin evidencia específica
  quedan fuera del broad. El usuario puede sumarlas manualmente vía
  "Buscar por nombre".
- Priorización: el final ordena por (fit_score desc, signal_depth desc)
  antes de cortar a limit. Empresas con MÁS info ganan los slots.

**`lib/companyResearch.ts` (single):**
- Mismas reglas estrictas. Si no hay info pública, research_summary lo
  dice explícitamente: "Listada como [tipo] en [fuente]. No hay
  información pública sobre software CAD, escáner ni operación digital."

**`lib/messageGenerator.ts` (outreach):**
- Jerarquía estricta de personalización:
  - A) Fit signal operativo confirmado → úsalo.
  - B) cad_software / scanner_technology confirmado → úsalo.
  - C) LinkedIn headline con sustancia → úsalo.
  - D) Solo rol + tipo empresa → opener orientado a propuesta de valor
    weCAD4you (24h turnaround, exocad/inLab, 98.9% sin ajustes,
    scanner-agnostic, scale without hiring). Framing como observación del
    rubro, no como claim sobre la empresa específica. Ejemplos por rol.
- Prompt prohíbe explícitamente inventar: hiring, growth, expansion,
  funding, partnerships, software, scanners, customer base. Solo facts
  LITERAL en el input.
- Si el input dice "(no public information)", trata como UNKNOWN y pivota
  al perfil de la persona.
- Strip de citation markers [N] antes de output al prospecto.

**UI `/empresas`:**
- Badge "evidencia genérica" / "sin citas" en cards individuales.
- Botón "Re-verificar con IA" en footer de cada card → re-corre research
  honesto y reemplaza datos sospechosos. No toca status ni IDs de Clay/HubSpot.
- Funnel de discovery muestra paso "Con evidencia específica".

### PRs #116, #117, #118 — Bulk cleanup retroactivo

Para limpiar el legado de datos inventados antes de retomar Lemlist:

- `POST /api/companies/bulk-re-verify` (PR #116): itera empresas con
  evidence_quality != "specific", corre researchOneCompany honesto sobre
  cada una, reemplaza fit_signals/cad_software/scanner/fit_score con
  versión honesta. Chunks de 3 paralelos, cap de 10 por request. Repetir
  hasta `remaining=0`.
- `POST /api/contacts/bulk-regenerate-messages` (PR #116): regenera
  icebreaker + email_subject + email_body con el messageGenerator estricto.
  Cap 15 por request.
- PR #117: fix de TS "Type instantiation is excessively deep" en las
  cadenas de filtros de Supabase. Cast a `any`.
- PR #118: surface per-contact errors en el panel (antes solo decía
  "9 errores" sin detalle).

Resultado del usuario: del 100% de empresas con evidencia genérica, **97%
mejoraron a evidencia específica** después del bulk re-verify. Las 3
restantes son labs reales sin presencia digital pública — quedan con su
badge marcado.

### PRs #119, #120, #121 — Intentos fallidos de DELETE+ADD en Lemlist

Después del bulk regenerate, los mensajes nuevos están en Supabase pero
los leads viejos siguen en Lemlist con mensajes obsoletos. El plan
original era hacer DELETE + ADD para refrescar. Múltiples obstáculos:

1. **PR #119**: contactos con email=null no se pueden DELETE-by-email.
   Fix: precargar `getCampaignLeads(campaignId)` y buscar el lead.id en
   un mapa indexado por email + linkedin_url. Pero el snapshot devolvió 0
   leads — el parser no reconoció el shape.

2. **PR #120**: endpoint `GET /api/lemlist/diagnose-campaign` para
   inspeccionar la respuesta cruda de Lemlist. **Descubrimiento crítico:
   `GET /api/campaigns/{id}/leads` devuelve solo `{_id, state, contactId}`
   por lead** — NO trae email, linkedinUrl, firstName, etc. La campaña
   real tenía 16 leads pero todos minimalistas.

3. **PR #121**: nuevo helper `getCampaignLeadsWithDetails(campaignId)` en
   lib/lemlist.ts: lista los leads → para cada uno con `_id`, hace
   `GET /api/leads/{leadId}` en paralelo (chunks de 5) → mergea
   email/linkedinUrl/firstName/lastName/jobTitle/companyName. Si el
   detalle individual falla, conserva el lead con campos null sin romper.

Aun así seguía fallando para los contactos específicos del usuario —
posiblemente porque la detail call también devuelve shape minimalista en
algunos casos, o porque la campaña tiene leads "huérfanos" que ni el
detail API resuelve. **Después de 4-5 iteraciones, cambio de estrategia.**

### PR #122 — Clean slate path (la solución que funcionó)

En vez de seguir peleando con DELETE+ADD, plan de 3 pasos:
1. **Usuario** entra a Lemlist UI → selecciona TODOS los leads de la
   campaña → bulk delete (30 segundos, 1 click). Campaña queda vacía.
2. **App** corre `POST /api/contacts/bulk-push-to-lemlist-clean` que
   solo hace ADD (sin DELETE, sin lookup, sin snapshots). Selecciona
   contactos con icebreaker generado + human_decision='approved' OR
   fit_action='enrich' + status!='discarded'. Cap de 25 por request,
   paralelo en chunks de 3.
3. **Usuario** re-activa Lemlist.

Bonus: `lib/hubspot.ts` ahora extrae el mensaje real de error de HubSpot
(parsed.message + parsed.errors[].message + context). Antes solo decía
"HubSpot 400" sin detalle.

**Resultado: funcionó.** Los 16 leads viejos se borraron del lado de
Lemlist UI, el bulk push limpio empujó todos los contactos aprobados con
los mensajes nuevos sin errores. Lemlist ahora tiene la versión honesta.

### PR #123 — UI cleanup post-mortem

Borrados de `/empresas`:
- Banner amarillo "X empresas con evidencia genérica" + sus 2 botones bulk.
- Banner morado "Re-push limpio a Lemlist (clean slate)" + su botón.
- Summary panels asociados.
- State + funciones JS (runBulkReverify, runBulkRegenerate, runBulkLemlistClean).

Reemplazado por una nota chica recordando que la re-verificación
individual está disponible desde cada card.

Lo que se mantiene en UI:
- Badge "evidencia genérica" / "sin citas" en cards individuales.
- Botón "Re-verificar con IA" en footer de cada card.

Lo que se mantiene como endpoints dormant (no UI, accesibles vía curl):
- `/api/companies/bulk-re-verify`
- `/api/contacts/bulk-regenerate-messages`
- `/api/contacts/bulk-push-to-lemlist-clean`
- `/api/companies/research-diagnostic` + UI `/diagnostico-empresa`
- `/api/lemlist/diagnose-campaign`

### Endpoint nuevo `POST /api/companies/[id]/re-verify` (PR #115)

Re-verifica UNA empresa ya guardada usando researchOneCompany honesto.
Reemplaza fit_signals/cad_software/scanner/etc con la versión honesta.
No toca status ni IDs de integraciones. Idempotente. Es lo que llama
el botón "Re-verificar con IA" de cada card individual.

### Gotchas críticos descubiertos en esta sesión

1. **Lemlist's `GET /campaigns/{id}/leads` es minimalista.** Solo devuelve
   `{_id, state, contactId}` por lead. Para tener email/linkedinUrl/etc.,
   hay que hacer `GET /api/leads/{leadId}` por cada uno. **SIEMPRE usar
   `getCampaignLeadsWithDetails(campaignId)`, NO `getCampaignLeads(...)`
   directo** — la versión bare quedó solo para uso interno.

2. **Supabase TS type inference revienta con cadenas de filtros condicionales.**
   `let query = db.from(...).select(...); if (cond) query = query.not(...)`
   genera "Type instantiation is excessively deep". Workaround: `let query:
   any = ...`. En runtime es idéntico, solo destraba el build.

3. **Citas genéricas del rubro NO sirven como respaldo.** Una empresa
   puede tener 8 citas en `research_sources` pero si ninguna nombra a la
   empresa específicamente, todos los datos operativos son sospechosos.
   El régimen estricto los nulea por default y baja fit_score a "low".

4. **HubSpot v3 API devuelve errores detallados en `parsed.errors[]`.**
   No conformarse con `HubSpot ${status}` — extraer `parsed.message` +
   `parsed.errors[].message` + `context`.

### Estado al cierre de la sesión 2026-05-16

- Rama: `claude/continue-prospecting-dev-QjeVe` (mergeada toda).
- Producción: PR #123 mergeado, Vercel verde.
- Empresas: 97% con evidencia específica. 3 con evidencia genérica (sin
  presencia digital pública, no hay nada que recuperar).
- Lemlist: campaña limpia con leads nuevos (mensajes honestos generados
  por messageGenerator estricto).
- HubSpot: contactos sincronizados con las custom properties wecad_*
  actualizadas.

### Fix Sales Navigator import al cierre (PR #124)

Sales Navigator mostraba todos los leads de la Campaña puente como
"(sin nombre)" + "sin nombre de empresa en Lemlist" — el match por
nombre era imposible. Mismo issue raíz: `app/api/sales-navigator/[id]/
import/route.ts` usaba `getCampaignLeads(stagingId)` directo, que
devuelve solo `{_id, state, contactId}`. Swap a
`getCampaignLeadsWithDetails(stagingId)` y los leads vuelven con
firstName/lastName/company/linkedinUrl/jobTitle. El match por nombre
de empresa vuelve a funcionar (y los checkboxes del preview por
defecto chequeados también).

## Para retomar en una nueva sesión (prompt de arranque actualizado)

> Continúo weCAD4you-prospecting. Última sesión (2026-05-16) cerró
> Sprint 7 — Régimen estricto de evidencia (PRs #114 a #123) + cleanup
> retroactivo completo (97% de empresas mejoradas, Lemlist limpio con
> mensajes honestos, HubSpot resyncedo). Todo mergeado.
>
> Anteriormente (sesión 2026-05-15c) cerró
> Sprint 6 fases 3 y 4 (PRs #105 a #111) + chore de idioma. Todo
> mergeado. El usuario espera **terminar la app hoy**.
>
> ANTES DE CODEAR cualquier cosa nueva, leer CLAUDE.md completo,
> especialmente:
> - "Pendiente abierto al cerrar 2026-05-15c — fix del match en Sales
>   Navigator" (esta es la TAREA INMEDIATA).
> - "Hecho del Sprint 6 fase 3 — Responder desde la app (Lemlist Inbox
>   API)".
> - "Hecho del Sprint 6 fase 4 — Módulo Sales Navigator" + sus 3 sub-
>   secciones de iteraciones (Campaña puente, PR #108, PR #111).
> - "Chore — Español neutro LATAM (PR #110)" — **escribir en tuteo
>   neutro LATAM, no voseo argentino**, en todo texto nuevo de la UI.
>
> TAREA INMEDIATA al arrancar:
> - El usuario tiene que elegir Opción A (importar todo sin match) o B
>   (preview con checkboxes), con o sin auto-limpiar la Campaña puente.
>   Ver detalle completo en la sección "Pendiente abierto" del CLAUDE.md.
>   Mi recomendación fue B + auto-limpiar.
> - Una vez elegido, construirlo y mergear.
>
> Otras tareas pendientes (no tan urgentes, pero podrían cerrar la app):
> - Setup webhook HubSpot Calls — pendiente de hace varias sesiones.
>   Falta crear 2 subscriptions en la Private App legacy "weCAD4you
>   Webhooks" (Llamada → Creado + Llamada → Cambio de propiedad,
>   activando el toggle BETA "¿Usar la ampliación de la cantidad de
>   objetos?" para que aparezca "Llamada" en el dropdown). Properties
>   de la 2da: hs_call_body, hs_call_disposition, hs_call_status,
>   hs_call_transcription, hs_call_duration, hs_call_recording_url.
>   Mientras tanto, el botón "Sincronizar HubSpot" manual en /llamadas
>   sigue funcionando como fallback.
> - Probar end-to-end el flujo Sales Navigator después del fix del
>   match: ya hay env var LEMLIST_STAGING_CAMPAIGN_ID en Vercel
>   (cam_5rYdqSzz8hvMCp3Ky) y la migración companies_sales_nav está
>   aplicada en Supabase.
> - Probar end-to-end el flujo de respuestas (Lemlist Inbox API): falta
>   pegar supabase/lemlist_activities_outbound_replies_migration.sql en
>   Supabase y opcionalmente setear LEMLIST_SEND_USER_ID en Vercel. Si
>   no hay respuestas reales todavía, el módulo queda armado esperando.
>
> Estado vivo del producto:
> - /dashboard: ejecutivo con 8 presets de fecha.
> - /empresas: 3 modos para sumar empresas — Recomendación IA, Buscar
>   por nombre, Importar CSV. Discovery con filtro de fit + salvataje
>   de LinkedIn URL. Botón "Buscar contactos en la web" por card.
> - /contactos: pre-filter Claude + tabs (pendientes, manual review,
>   en campaña, descartados). Empresas colapsables, con buscador.
>   Botón "Directo a Lemlist" (acepta email O LinkedIn URL).
> - /sales-navigator (Sprint 6 fase 4): empresas que Clay no pudo
>   prospectar — detectadas por inferencia (clay_pushed_at + sin
>   contactos 24h+) o por webhook precíso de Clay. Importan desde la
>   Campaña puente de Lemlist (cam_5rYdqSzz8hvMCp3Ky) que el usuario
>   alimenta con la extensión de Lemlist desde Sales Nav. Botón bulk
>   "Enviar todos a Lemlist". Match por nombre actualmente roto — ver
>   "Pendiente abierto".
> - /telefonos: Lusha manual con dual phone fields.
> - /llamadas: webhook HubSpot real-time (en setup) o sync manual
>   fallback. Filtro SDR + KPIs + análisis IA + drilldowns + hot leads.
> - /respuestas (Sprint 6 fase 3): inbox de respuestas de Lemlist
>   clasificadas con IA. Composer por card para responder desde la app
>   vía Lemlist Inbox API (LinkedIn + email) con borrador IA opcional.
> - App → Lemlist con sanitizers em-dash y firmas. Entregabilidad de
>   email resuelta con bifurcación nativa en la secuencia Lemlist.
> - El ICP (/configuracion/icp) afecta discovery + pre-filtro
>   automáticamente — cada corrida lee la versión activa fresca.
> - **Idioma**: español neutro LATAM (tuteo). NO voseo argentino. NO
>   regionalismos chilenos demasiado marcados.
>
> Reglas operativas:
> - Yo (Claude) hago todo el ciclo: editar + commit + push + crear PR +
>   mergear (squash). El usuario no entra a terminal ni GitHub.
> - El usuario hace Clay / Vercel / Supabase / Lemlist / HubSpot UI.
> - Rama base default: claude/wecad4you-prospecting-app-Hltfi.
> - Si rebase falla post-merge: git fetch origin <base> && git rebase
>   origin/<base> && git push -f.
> - Si tengo dudas reales sobre alcance o riesgo, preguntar primero
>   con AskUserQuestion. Para decisiones obvias y cambios chicos,
>   shippear directo.
>
> NO RECREAR (todo intentado y descartado):
> - App → Clay vía REST API (no expone CRUD de rows).
> - HubSpot Workflow webhooks (requiere Operations Hub Pro).
> - Cron GitHub Actions para enrichment (PR #62).
> - Webhook config en Service Keys BETA de HubSpot (UI no lo expone;
>   usar Private App legacy).
> - **Columnas HTTP API nuevas en Clay** — quedaron detrás del plan
>   Growth. Las viejas siguen funcionando (grandfathered). Usar
>   webhooks de Clay → app o señal inferida en la app, NO HTTP API
>   columns nuevas.
> - **Listas de Lemlist como fuente** — la API no expone read-list.
>   Usar campañas (Campaña puente con `GET /api/campaigns/{id}/leads`).
>
> Próximos módulos sugeridos (post-fix del match):
> 1. **Funnel unificado** — pipeline visual end-to-end (descubrimiento →
>    contactos → outreach → respuestas → llamadas → deals).
> 2. **Entrenar modelo** — feedback loop ICP usando contact_feedback +
>    sdr_improvements agregados para refinar el pre-filtro.
> 3. **Mejoras varias en /respuestas** una vez que lleguen respuestas
>    reales (probar shape de /inbox/email, ajustar si falla).
>
> Avísame qué opción A/B/auto-clear elegís para el match, y arrancamos.

## Hecho del Sprint 8 — Reportería ejecutiva + Dashboard expandido (sesión 2026-05-17)

Sesión larga centrada en visibilidad. PRs #114 a #137 (incluyendo
fixes y rebases). Nuevo módulo `/reporteria` para mostrarle al
cliente + ampliación del `/dashboard` con coverage, usage, evolución
8 meses, embudo Clay, costos por proveedor.

### Sub-sesión 8a — Régimen estricto de evidencia + cleanup (PRs #114-#123)

Ver sección Sprint 7 arriba — esa sesión fue parte de este Sprint 8.

### Sub-sesión 8b — Sales Navigator + tracking de source (PRs #124-#131)

**PR #124 — Sales Nav muestra nombres reales:** swap a
`getCampaignLeadsWithDetails` en sales-navigator/import. Antes
mostraba "(sin nombre)" porque el list de Lemlist es minimalista.

**PRs #125, #126 — Diagnóstico Lemlist + helper de detail:**
descubrimos que `GET /api/leads/{leadId}` devuelve 404 (deprecated)
pero `GET /api/contacts/{contactId}` devuelve el objeto completo
(fullName, fields.firstName, fields.lastName, fields.jobTitle,
fields.companyName, linkedinUrl). `getCampaignLeadsWithDetails`
reescrito para fetchear del contact endpoint en vez del lead
endpoint.

**PR #127 — UX empresa: editar size + filtrar preview + auto-delete:**
- Edición inline del `company_size` en cards de `/empresas` (la IA
  a veces saca el número de Manta/BBB desactualizado).
- `PATCH /api/companies/[id]` que valida y persiste.
- Buscador en preview de Campaña puente (filter por nombre/empresa/
  cargo).
- Auto-delete real de leads de la puente post-import: extendido
  `deleteCampaignLead` para aceptar `contact_id` y probar 3 patterns
  adicionales (`/campaigns/{id}/leads/{contactId}`,
  `/campaigns/{id}/contacts/{contactId}`,
  `/contacts/{contactId}/campaigns/{id}`).
  Sales-nav import pasa el contact_id desde el snapshot enriquecido.

**PR #128 — LinkedIn employee count autoritativo:**
- Prompts en `lib/discovery.ts` y `lib/companyResearch.ts` ahora
  declaran que `company_size` SOLO viene del badge "X employees" de
  LinkedIn corporativo. NO ACEPTABLE: Manta, BBB, Yelp, ZoomInfo,
  Hoovers, Crunchbase rangos viejos. Si la única fuente es uno de
  esos directorios → null. "Mejor null que un número falso".
- Nuevo helper `salvageEmployeeCounts(items)` en `lib/discovery.ts`:
  pase dedicado de Perplexity con prompt específico para LinkedIn,
  prueba a verificar el badge real. Una llamada batch al final del
  discovery + en el research-one.

**PR #129 — Sales Nav 3 buckets:**
- `/api/sales-navigator` devuelve `no_contacts` / `one_contact` /
  `no_fit` con contact counts por empresa.
- UI con 3 tabs: "Empresas sin contactos" (antes "Por revisar"),
  "Con solo 1 contacto" (nuevo), "Sin contactos fit".
- Dashboard panel **CoverageCard** ("Cobertura de empresas totales ·
  Sales Navigator") con `total_in_clay`, `no_contacts`, `one_contact`,
  `two_plus_contacts`, `no_fit_marked`, `manually_worked`.

**PR #130, #131 — Source tracking:**
- Migración `supabase/contacts_source_migration.sql` agrega
  `contacts.source` (text). Valores: 'clay' | 'sales_navigator' |
  'web_scrape' | 'manual'.
- Los 4 callers de `intakeContactsForCompany` pasan el source
  correcto. Backfill heurístico: contactos en empresas con
  `clay_no_contacts_at != null` → sales_navigator; el resto → clay
  (caso dominante).
- Dashboard usa `source` para los breakdowns de "Uso del equipo"
  (clay_companies vs sales_nav_companies) y "Evolución mensual".

**Otros paneles del dashboard (Sprint 8b):**
- **UsageCard** (range-bound): empresas trabajadas, con resultado
  Clay, contactos por Clay, con resultado Sales Nav, contactos por
  Sales Nav, promedio por empresa.
- **EvolutionCard** (8 meses, no range-bound): empresas push a Clay
  por mes + contactos por fuente (Clay verde + Sales Nav amarillo).
  Reemplaza el FunnelCard viejo.
- **ProviderUsageCard** (PR #131): tabla con 6 proveedores externos
  estimados:
  - Anthropic: pre-filters + mensajes + análisis llamadas + research.
  - Perplexity: searches discovery + research one-shot.
  - Clay: ≈5 créditos/empresa = $0.20.
  - Lemlist: ver PR #133 abajo.
  - Lusha: 1 teléfono = 1 crédito ≈ $0.40.
  - HubSpot: gratis (rate limit).
  Total estimado al final.

### Sub-sesión 8c — Embudo Clay + Lemlist real + Reportería (PRs #132-#137)

**PR #132 — ClayFunnelCard en dashboard:**
- 5 pasos del flujo Clay (en `/dashboard`):
  1. Levantados por Clay (source='clay' en período)
  2. Marcados fit por Clay AI (fit_action='enrich') · % total
  3. En revisión manual (fit_action='manual_review') · % total
  4. Manual review aprobados · % del manual review (no del total)
  5. En campaña Lemlist · % total

**PR #133 — Lemlist cálculo real:**
- 27 créditos por contacto: 1 enrich + 1 validar email + 5 levantar
  email + 20 levantar teléfono.
- Plan incluye 7,000 créditos/mes gratis.
- Excedente: $0.01/crédito.
- Note dinámico en la fila: "X créditos consumidos. Bajo el límite
  gratis" / "Excede el límite gratis — facturable: Y × $0.01".

**PRs #134-#137 — Módulo /reporteria (vista ejecutiva al cliente):**

Nuevo módulo en sidebar (ANÁLISIS → Reportería). Vista pulida tipo
agencia, no operacional. Misma data que el dashboard pero curada y
contada para el cliente. Filtrado por el mismo range selector.

**Estructura final** (top to bottom):

1. **Highlight banner** (gradient morado): frase armada con los
   números del período. Lista para copiar/pegar al cliente.

2. **Hero KPIs (5 cards con delta)**:
   - Empresas prospectadas (`clay_pushed_at` en rango).
   - **Contactos fit generados** (`contacts_yes` = pasaron pre-filtro).
   - En outreach (Lemlist).
   - Conversaciones (calls + respuestas).
   - Hot leads (contactos únicos con engagement real).

3. **Embudo ejecutivo (7 pasos)**:
   Descubiertas → Aprobadas → **Contactos levantados (Clay, total
   crudo)** → **Contactos fit (pre-filter YES)** → En outreach →
   Conversaciones → Interesados/callbacks. Cada paso con % de
   conversión vs anterior. Números en blanco adentro de barras
   llenas, dark afuera cuando la barra es chica.

4. **Tres cards lado a lado**:
   - **Outreach activo**: leads en outreach (Correo + LinkedIn) +
     breakdown por canal (correos enviados, invitaciones LinkedIn,
     mensajes LinkedIn). Cuenta vía `lemlist_activities` con types
     `emailsSent`, `linkedinInvite`, `linkedinSend`.
   - **Llamadas**: total, conectadas + pickup rate, duración
     promedio, score SDR promedio.
   - **Respuestas**: total, positivas (%), negativas (%).

5. **Distribución de respuestas**: bar chart por categoría IA.

6. **Hot leads (top 10, alineado con Hero count)**:
   Tabla con Contacto · Empresa · Cargo · Señales (badges) · Score
   · LinkedIn. Solo entran contactos con engagement REAL (call
   interesado/callback en cualquier momento, o respuesta positiva
   en el período). El que solo tiene fit alto sin responder NO
   aparece. `<details>` expandible "¿Cómo se calcula el score?" con
   el breakdown completo:
     +50 call interesado, +35 callback, +30 respuesta positiva,
     +25 callback por respuesta, +20 objection timing,
     +fit_score × 4 (max 40), +5 c/u phone/Lemlist/HubSpot.

7. **Evolución mensual**: 8 meses de empresas prospectadas (recap,
   no range-bound).

**Stack técnico:**
- `lib/reporteriaQueries.ts` — `computeReporteria` reusa
  `computeDashboard` para datos base + agrega calls + respuestas +
  hot leads + highlight.
- `app/api/reporteria/route.ts` — endpoint range-aware.
- `app/reporteria/page.tsx` — UI ejecutiva (~800 líneas).
- `components/Sidebar.tsx` — ítem "Reportería" habilitado.

### Gotchas críticos descubiertos en Sprint 8

1. **Always `npx next build` local antes de commitear nuevas pages.**
   Vercel build es más estricto que `tsc --noEmit` sin
   `@types/react` instalados; los `JSX key` se trataban como prop
   extra bajo `exactOptionalPropertyTypes`.

2. **Cast de Supabase joins anidados**: `companies(company_name)` en
   un select puede ser inferido como `GenericStringError[]`. Cast
   por `unknown` primero: `(rows ?? []) as unknown as MyType[]`.

3. **Lemlist endpoints minimalistas**: `GET /campaigns/{id}/leads` y
   `GET /leads/{leadId}` devuelven shapes pobres o 404. SIEMPRE
   usar `getCampaignLeadsWithDetails` (que hace el fetch al
   `contact endpoint` por cada lead).

### Estado al cierre Sprint 8

- Rama: `claude/continue-prospecting-dev-QjeVe` (mergeada toda).
- Producción: Vercel verde.
- Migraciones pendientes para el usuario (pegar en SQL editor):
  - `supabase/contacts_source_migration.sql` (con backfill).
  - Anteriores ya aplicadas según se cerró sesión anterior.
- Módulos vivos: `/dashboard`, `/reporteria` (nuevo), `/empresas`,
  `/contactos`, `/sales-navigator` (3 buckets), `/telefonos`,
  `/llamadas`, `/respuestas`, `/configuracion/icp`,
  `/diagnostico-empresa`.
- Módulos disabled en sidebar: `/entrenar-modelo` (próximo
  Sprint 9).

### Pendiente abierto al cerrar Sprint 8 — módulo /entrenar-modelo

El usuario propuso enfoque distinto al original. Original era
"feedback loop ICP usando contact_feedback + sdr_improvements
agregados para refinar el pre-filtro". El usuario ahora plantea:

> "Con que tono debemos generar los mensajes de IA, sobre que
> escribirle a cada cargo o industria para usar de base, que cosas
> decir y que cosas nunca se deben decir"

O sea: editor de prompts y reglas para `messageGenerator` (lo que
hoy está hardcoded en `lib/messageGenerator.ts`). Permitir al
equipo iterar tono, talking points por rol, frases prohibidas, etc.
sin tocar código.

Detalles del diseño propuesto: ver respuesta en el chat de Sprint 8c.
