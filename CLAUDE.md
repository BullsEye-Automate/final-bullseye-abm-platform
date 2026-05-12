# Reglas del proyecto

## Flujo de despliegue

- Hago todo el ciclo end-to-end yo: editar → commit → push → **crear PR si no existe → mergear el PR yo mismo** (squash) sin pedirle al usuario que entre a GitHub.
- El usuario no usa terminal y prefiere no entrar a GitHub. Después del merge, basta con esperar a que Vercel redespliegue (1-2 min) y probar en `wecad-prospecting.vercel.app`.
- Rama de trabajo: `claude/fix-icp-display-bn9Fg`. Base por defecto: `claude/wecad4you-prospecting-app-Hltfi` (no hay `main`).

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
| 2 | En curso | Contactos: pre-filter Claude + import desde Clay + UI |
| 3 | Pendiente | Cola revisión manual (score 5-7) + feedback loop completo |
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

**Estado exacto donde quedó la sesión del 12 may 2026:**

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

**Para retomar en una nueva sesión:**

> Continúo el Sprint 2 fase B de weCAD4you-prospecting. Lee `CLAUDE.md`, `docs/contexto_sistema.md` y `docs/notas_arquitectura.md`. Quedé en medio de configurar en Clay la enrichment "Find people" sobre la tabla Companies + la columna HTTP que dispara a `/api/clay/raw-contacts`. El próximo bloque es validar el shape de "Find people" y armar el body del webhook saliente.
