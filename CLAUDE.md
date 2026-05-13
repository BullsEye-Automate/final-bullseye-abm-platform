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

## Para retomar en una nueva sesión (prompt de arranque actualizado)

> Continúo weCAD4you-prospecting. Sprint 5 fase 1 (Dashboard ejecutivo)
> cerrado en código pero queda 1 commit sin mergear: `880efcf` en
> branch `claude/continue-wecad4you-prospecting-YNgtt` (fix denominador
> "Origen de teléfonos" — solo cuenta contactos en Lemlist). **PRIMER
> PASO**: re-autenticar GitHub MCP, crear PR y mergear ese commit
> contra base `claude/wecad4you-prospecting-app-Hltfi`.
>
> Antes de codear nada nuevo, leer `CLAUDE.md` completo (especialmente
> "Hecho del Sprint 5 fase 1" y "Hecho del Sprint 4 fase 2"),
> `docs/contexto_sistema.md` y `docs/notas_arquitectura.md`.
>
> Estado vivo del producto:
> - Discovery → Empresas: `/empresas` con cards aprobado/rechazado.
> - Pre-filter Claude → Contactos: `/contactos` con tabs (pendientes,
>   manual review, en campaña, descartados).
> - App → Lemlist (manual_review approvals): vía Lemlist API direct.
> - Lemlist enriquece phone+email automático (findPhone=true en push).
> - Lusha manual: `/telefonos` con dual phone fields (Lemlist + Lusha).
> - HubSpot: 7 listas dinámicas SDR creadas (Hot/Warm/Reintentar/etc.).
> - Dashboard ejecutivo: `/dashboard` con 8 presets de fecha, KPIs,
>   funnel, distribuciones, sparkline.
>
> Reglas: vos hacés código/PR/merge, yo Clay/Vercel/Supabase/Lemlist/
> HubSpot UI. Próximos módulos a activar (recomendación de la sesión
> anterior): Respuestas (Lemlist replies tracking) → Llamadas (call
> logging from HubSpot).
>
> NO recrear: integración App → Clay vía REST API (no expone CRUD),
> HubSpot Workflow webhooks (requiere Operations Hub Pro), cron de
> GitHub Actions (abandonado en PR #62).
