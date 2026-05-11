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

**Próximo paso (Sprint 2 fase B — cablear Clay HTTP):**

Reemplazar el paste manual de JSON por un botón "Buscar contactos en Clay" desde una empresa aprobada. El flujo:

1. **App → Clay Companies (push)**: el usuario ya generó el webhook entrante de la tabla Companies en Clay. La URL completa está guardada en Vercel como `CLAY_COMPANIES_WEBHOOK_URL`. Pendiente: crear `POST /api/clay/push-company` que POSTea a esa URL con `{company_name, company_website, company_city, company_size, company_type, cad_software, scanner_technology, fit_signals, fit_score, linkedin_url}` (las columnas que la tabla Companies en Clay espera — el usuario confirmó el schema en `docs/notas_arquitectura.md`).
2. **Clay corre "Find people at company"** automáticamente y enriquece columnas adicionales.
3. **Clay → App (raw contactos)**: pendiente crear webhook en Clay que cuando un row de Companies termine de procesar, mande los contactos encontrados a `/api/clay/raw-contacts` en nuestra app. La app corre pre-filter y persiste en Supabase.
4. **App → Clay Contacts (push YES)**: para los contactos pre-filter YES, POSTear a otro webhook (el de la tabla Contacts de Clay — todavía no generado, va igual que el de Companies). Variable de entorno futura: `CLAY_CONTACTS_WEBHOOK_URL`.
5. **Clay scorea y manda a Lemlist** automáticamente (lo configura Clay, no la app).

**Para retomar en una nueva sesión:**

> Continúo el Sprint 2 fase B de weCAD4you-prospecting. Lee `CLAUDE.md`, `docs/contexto_sistema.md` y `docs/notas_arquitectura.md`. El webhook de Clay Companies ya está en Vercel como `CLAY_COMPANIES_WEBHOOK_URL`. Próximo paso: construir `POST /api/clay/push-company` + botón "Empujar a Clay" en la pantalla de Empresas para empresas aprobadas.
