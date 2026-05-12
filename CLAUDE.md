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
- No retroactivo: las empresas ya aprobadas en Supabase con URLs falsas (ej. DLP Dental Laboratory) hay que rechazarlas/limpiarlas manualmente. Próximas corridas de discovery ya no las dejarán pasar.

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
