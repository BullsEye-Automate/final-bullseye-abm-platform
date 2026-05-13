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
| 3 | En curso · fase 1 cerrada, fase 2 = Lemlist API direct (próxima sesión) | Cola revisión manual + feedback loop + Lemlist API directa para approvals |
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

**Variables de entorno en Vercel (estado actual):**
- `CLAY_COMPANIES_WEBHOOK_URL` — set ✅ (push de empresas a Clay)
- `CLAY_CONTACTS_WEBHOOK_URL` — set ✅ (push de contactos pre-filter YES a Clay)
- `CLAY_WEBHOOK_SECRET` — set ✅ (header `x-webhook-secret` en raw-contacts y scored-contacts)
- `ANTHROPIC_API_KEY` — set ✅
- `PERPLEXITY_API_KEY` — set ✅
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — set ✅
- **A borrar al hacer switch a Lemlist API direct (Sprint 3 fase 2):**
  - `CLAY_APPROVAL_WEBHOOK_URL` (obsoleta)
  - `CLAY_API_TOKEN` (obsoleta — Clay no expone row CRUD)
  - `CLAY_CONTACTS_TABLE_ID` (obsoleta)
  - `CLAY_WORKSPACE_ID` (obsoleta)
  - `CLAY_WORKBOOK_ID` (obsoleta)
- **Pendientes a generar (Sprint 3 fase 2):**
  - `LEMLIST_API_KEY` ⚠️
  - `LEMLIST_CAMPAIGN_ID` ⚠️

**Cableado de App → Clay para Revisión manual (cierra el loop con Clay REST API):**

Cuando un humano aprueba un contacto en Revisión manual de la app, hay que actualizar la columna "App Decision" en Clay para que `Add Lead to Campaign` lo mande a Lemlist. Usamos la **Clay REST API** directamente (los webhook sources de Clay no soportan upsert por key, sólo inserts).

1. **En Clay**:
   - Settings → Account → API key: copiar el token → setear en Vercel como `CLAY_API_TOKEN`.
   - Tabla Contacts: copiar el `table_id` de la URL (`https://app.clay.com/workspaces/{ws}/workbooks/{wb}/tables/{table_id}/...`) → setear en Vercel como `CLAY_CONTACTS_TABLE_ID`.
   - Crear columna manual **"App Decision"** (Text, sin source).
   - Actualizar la run condition de **Add Lead to Campaign** y opcionalmente de **LinkedIn Icebreaker**, **Email Personalizer**, **email_subject**, **email_body** a:
     ```
     Lead Scoring action = "enrich" OR App Decision = "approved"
     ```
   - Esto evita gastar créditos enriqueciendo contactos en manual_review y los habilita al aprobar.

2. **Flujo end-to-end después del setup**:
   - Contacto YES → push App → Clay → Lead Scoring → action `manual_review` → AI columns y Lemlist NO corren.
   - Usuario aprueba en `/contactos` Revisión manual → endpoint `/api/contacts/[id]/decision` actualiza Supabase y llama a Clay REST API: `GET /v3/tables/{id}/rows?filter[Wecad Contact Id]={uuid}` → `PATCH /v3/tables/{id}/rows/{row_id}` con `{App Decision: "approved"}`.
   - Clay setea App Decision = "approved" → run conditions matchean → AI columns corren si faltaban → Add Lead to Campaign empuja a Lemlist.

3. **Si la Clay REST API responde con error**, el response del endpoint `/api/contacts/[id]/decision` incluye `clay_push_decision.debug` con el payload de respuesta de Clay. Útil para diagnosticar si el filter pattern de la query no matchea con la API real.

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

**Sprint 3 fase 2 → Lemlist API direct (próxima sesión):**

Para que un contacto en manual_review aprobado termine en la campaña de Lemlist, la app va a llamar a Lemlist API directamente sin pasar por Clay. Plan de implementación:

1. **Env vars en Vercel** (pendiente, el usuario las consigue):
   - `LEMLIST_API_KEY` — token de Lemlist (Settings → Integrations → API → Generate)
   - `LEMLIST_CAMPAIGN_ID` — id de la campaña "weCAD4you — Lab Digital Outreach v1" (de la URL del campaign editor en Lemlist)

2. **Código nuevo**:
   - `lib/lemlist.ts` — cliente para Lemlist API: `addLeadToCampaign(campaignId, lead)` que POST a `/api/v2/campaigns/{id}/leads`. Auth con Bearer.
   - `lib/messageGenerator.ts` — generador de icebreaker + email_subject + email_body con Claude, usando los prompts que ya viven en Clay (los copiamos a `lib/contactsPrompts.ts`). Lee datos del contacto + de la empresa de Supabase.
   - Modificar `app/api/contacts/[id]/decision/route.ts`: cuando approve viene de manual_review y `clay_pushed_at` está set:
     1. Llamar al messageGenerator → guardar icebreaker / subject / body en `contacts`.
     2. Llamar a Lemlist API → push lead con los mensajes generados.
     3. Devolver el resultado en `lemlist_push` (similar al ya viejo `clay_push_decision`).
   - UI `/contactos`: surface el `lemlist_push` debug si falla (igual mecanismo que ya hicimos para `clay_push_decision`).

3. **Limpieza simultánea**:
   - `lib/clayApi.ts` — borrar (no se usa más).
   - `lib/clayPushDecision.ts` — borrar.
   - Borrar webhook source "CLAY_APPROVAL_WEBHOOK" en Clay tabla Contacts (no se usa).
   - Borrar env vars obsoletas en Vercel: `CLAY_APPROVAL_WEBHOOK_URL`, `CLAY_API_TOKEN`, `CLAY_CONTACTS_TABLE_ID`, `CLAY_WORKSPACE_ID`, `CLAY_WORKBOOK_ID`.
   - En Clay tabla Contacts, las run conditions de Add Lead to Campaign vuelven a `Lead Scoring action = "enrich"` (sin el OR de App Decision). Las run conditions de icebreaker/email idem.

4. **Trade-off conocido**: para contactos en manual_review, Clay NO genera icebreaker/email/etc (run condition restringe a `action=enrich`). La app los genera por su cuenta cuando aprobamos. Eso aumenta el uso de tokens Claude en la app pero no consume créditos AI de Clay. Para enrich-action contacts el flujo Clay → Lemlist sigue intacto.

5. **Validación end-to-end Sprint 3 fase 2**:
   - Aprobar un contacto en `/contactos` Revisión manual → ver en Lemlist que aparece con icebreaker + email generados.
   - Verificar que Lemlist enriquece email/phone con sus créditos cuando solo le mandamos LinkedIn URL.

**Estado del repositorio al cierre:**

- Rama: `claude/validate-prospecting-loop-IRiLL` (working tree clean, pusheada).
- Último PR mergeado: #49 (`fix(clayApi): try multiple URL patterns…`).
- Total PRs en la sesión: 26-49 (24 PRs, todos squash-mergeados a `claude/wecad4you-prospecting-app-Hltfi`).

**Estado en Clay al cierre:**

- Tabla Contacts tiene dos webhook sources (Pull in data from a Webhook (1) y (2)). El (2) "CLAY_APPROVAL_WEBHOOK" fue creado durante esta sesión para el flujo App → Clay App Decision. **Se va a borrar al cambiar a Lemlist API direct.**
- Filas duplicadas vacías en tabla Contacts creadas por el webhook (2) cuando intentamos upsert: **se borran al cierre**.
- Columna `App Decision` (Text manual) creada en tabla Contacts: **se borra al cambiar a Lemlist API direct, o se deja sin uso si el usuario prefiere**.
- Run conditions actuales en Clay incluyen `OR App Decision = "approved"` en Add Lead to Campaign y AI columns: **revertir a solo `Lead Scoring action = "enrich"` al hacer el switch a Lemlist API direct**.

**Estado en Supabase al cierre:**

- Migraciones aplicadas: `contacts_migration.sql`, `contacts_clay_push_migration.sql`, `contacts_manual_review_migration.sql`. No hay migraciones nuevas pendientes para Sprint 3 fase 2.
- Tabla `contacts` tiene varios registros con `human_decision='approved'` pero con `fit_action='enrich'` y `clay_pushed_at` no nulo (los manual_review aprobados durante esta sesión). Esos contactos están en bucket "En campaña" en la UI pero **no llegaron realmente a Lemlist** porque el push a Clay falló. Cuando esté lista la integración Lemlist API direct, posible re-correr para ellos.

**Gaps conocidos al cierre:**

1. Razones IA del Lead Scoring de Clay vienen en inglés. Solución: editar el prompt de Lead Scoring en Clay y agregar "Respond in Spanish (Latin American). The 'reason' field must be written in Spanish."
2. Clay Find People devuelve gente histórica (ya no trabaja en la empresa target) — el size-aware pre-filter + la detección de "former/ex-" mitiga la mayoría pero no 100%.
3. Empresas grandes tipo Aspen Dental (16k empleados) probablemente NO son fit real para el ICP (sweet spot 15-50). El usuario aceptó dejarla aprobada para validar el flujo.
4. Modern Dental Laboratory aprobada como ES pero LinkedIn apunta a HK (gap viejo, no resuelto).

**Para retomar en una nueva sesión (prompt de arranque):**

> Continúo weCAD4you-prospecting. En la sesión anterior cerramos Sprint 3 fase 1 (cola Revisión manual + botones Aprobar/Rechazar/Recuperar + bulk delete + size-aware pre-filter + CAD priority + Haiku fallback + funnel diagnostics + delete companies/contacts). En el final intentamos cerrar el loop App → Clay para que las aprobaciones de Revisión manual dispararan Lemlist, pero **Clay API REST no expone row CRUD** (todas las URLs devuelven 404 "deprecated API endpoint" en /v1-v2 y "NoMatchingURL" en /v3, ver detalle en CLAUDE.md). Decisión final: bypaseamos Clay para approvals y vamos a integrar **Lemlist API directa** desde la app. Rama: `claude/validate-prospecting-loop-IRiLL`. Base: `claude/wecad4you-prospecting-app-Hltfi`. Antes de codear lee `CLAUDE.md` completo (especialmente la sección "Sprint 3 fase 2 → Lemlist API direct" que tiene el plan paso a paso), `docs/contexto_sistema.md` y `docs/notas_arquitectura.md`. Reglas: vos hacés código/PR/merge, yo Clay/Vercel/Supabase/Lemlist UI. Plan de hoy: implementar Lemlist API direct (1 lib client + 1 generador de mensajes con Claude + modificar decision endpoint + UI surface). Antes de codear pedime las dos env vars que voy a generar en Lemlist: `LEMLIST_API_KEY` y `LEMLIST_CAMPAIGN_ID`. Mientras tanto podés ir leyendo los docs y armando el plan.
