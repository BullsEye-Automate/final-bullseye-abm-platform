# Recomendaciones y actualizaciones — BullsEye ABM Platform

> Documento vivo de hallazgos técnicos priorizados. No representa cambios de código —
> es un registro para decidir qué ejecutar y cuándo. Actualizar el estado de cada ítem
> (`Pendiente` / `En progreso` / `Hecho`) a medida que se resuelven, y agregar hallazgos
> nuevos al final de cada sección con la misma estructura.
>
> Última auditoría: 2026-07-28.

---

## Cómo usar este documento

Cada ítem tiene: **qué es**, **dónde está**, **por qué importa**, **esfuerzo estimado** y **estado**.
Los ítems están ordenados por prioridad dentro de cada categoría. Antes de ejecutar uno,
verificar que el hallazgo siga vigente (el código puede haber cambiado desde la auditoría).

---

## 🔴 Crítico

### 1. Next.js 14.2.15 vulnerable a CVE-2025-29927 (bypass de autenticación en middleware)
- **Dónde:** `package.json` — `"next": "14.2.15"`.
- **Por qué importa:** el CVE permite bypasear `middleware.ts` por completo inyectando el header
  `x-middleware-subrequest`. Como *toda* la autenticación de Supabase Auth de las rutas internas
  depende únicamente del middleware (no hay verificación de sesión redundante en los route
  handlers), este bug permite acceder a toda la app sin login.
- **Esfuerzo:** Bajo — actualizar Next.js a `>=14.2.25` (o evaluar salto a una versión más
  reciente de la serie 14.2.x).
- **Estado:** Pendiente.

---

## 🟠 Alto

### 2. Secreto `CLAY_WEBHOOK_SECRET` hardcodeado y expuesto en el bundle del cliente
- **Dónde:** `app/clientes/[id]/onboarding/page.tsx:513,530` (componente `"use client"`) y
  `CLAUDE.md:56,157` (texto plano en archivo versionado).
- **Por qué importa:** el valor real del secreto (`bullseye-clay-2026`) queda visible en el
  bundle JS que se sirve al navegador y en el historial de git. Cualquiera que lo obtenga puede
  forjar webhooks hacia `/api/clay/raw-contacts`, `/api/clay/scored-contacts`,
  `/api/clay/phone-enriched` y `/api/clay/company-no-contacts`, inyectando datos falsos que se
  sincronizan luego a HubSpot/Lemlist.
- **Esfuerzo:** Medio — rotar el secreto, mostrarlo enmascarado o solo server-side en el
  onboarding, y reemplazar el valor real en `CLAUDE.md` por una referencia genérica (ej. "ver
  Vercel env vars").
- **Estado:** Pendiente.

### 3. Validación de `CLAY_WEBHOOK_SECRET` / `CRON_SECRET` es "fail-open"
- **Dónde:** `app/api/clay/phone-enriched/route.ts:15-19`, `app/api/clay/raw-contacts/route.ts:104-105`,
  `app/api/clay/scored-contacts/route.ts:88-89`, `app/api/clay/company-no-contacts/route.ts:7-10`,
  `app/api/cron/refresh-lemlist/route.ts:42-48`, `app/api/cron/sync-meetings/route.ts:8-15`.
- **Por qué importa:** el patrón es `if (expected) { validar }` — si la env var no está seteada
  (typo, redeploy, preview de Vercel sin todas las env vars), estos 6 endpoints quedan
  **completamente públicos** en vez de rechazar la request.
- **Esfuerzo:** Bajo — invertir la lógica a "fail closed": si la env var no está seteada,
  devolver 401/500 en vez de dejar pasar.
- **Estado:** Pendiente.

---

## 🟡 Medio

### 4. `FORM_TOKEN_SECRET` con fallback hardcodeado, no documentado
- **Dónde:** `lib/form-token.ts:3` — `process.env.FORM_TOKEN_SECRET ?? "bullseye-forms-2026"`.
- **Por qué importa:** este secreto firma (HMAC-SHA256) los tokens de acceso público a
  `/forms/icp/[token]`. No aparece en `.env.example` ni en la lista de variables de Vercel de
  `CLAUDE.md`, lo que sugiere que nunca se seteó y en producción se está usando el valor default
  escrito en el código fuente — cualquiera que lea el repo y tenga/adivine un `client_id` puede
  generar tokens válidos.
- **Esfuerzo:** Bajo — setear `FORM_TOKEN_SECRET` real en Vercel y documentarlo.
- **Estado:** Pendiente.

### 5. Falta gate de `typecheck`/`lint` antes de desplegar
- **Dónde:** `.github/workflows/deploy.yml` — corre `vercel build --prod` + `vercel deploy --prod`
  sin ejecutar `npm run lint` ni `npm run typecheck` antes.
- **Por qué importa:** combinado con el punto 7 (`ignoreBuildErrors: true`), prácticamente nada
  bloquea un deploy roto a producción salvo un error de compilación real.
- **Esfuerzo:** Bajo — agregar un step de lint + typecheck que falle el workflow antes del deploy.
- **Estado:** Pendiente.

### 6. `CLAUDE.md` y `.env.example` desactualizados respecto al código real
- **Dónde:** `CLAUDE.md` (sección "ARQUITECTURA MULTI-TENANT" dice "a crear" y sección de env
  vars) y `.env.example`.
- **Por qué importa:**
  - La migración multi-tenant (`supabase/multi_tenant_migration.sql`) ya existe e implementa las
    tablas `clients`, `client_configs`, `client_ai_context` y las columnas `client_id`, y el código
    ya las usa extensivamente (116 archivos referencian `client_id`, tipos en `lib/supabase.ts`).
    La sección "a crear" de `CLAUDE.md` es información obsoleta que puede confundir a un futuro
    dev/agente y llevar a re-intentar algo ya hecho.
  - Variables usadas en código pero no documentadas en `CLAUDE.md`: `SUPABASE_SERVICE_ROLE_KEY`,
    `CRON_SECRET`, `FORM_TOKEN_SECRET`, `CLAY_COMPANIES_WEBHOOK_URL`, `CLAY_CONTACTS_WEBHOOK_URL`,
    `CLAY_CONTACTS_APPROVED_WEBHOOK_URL`, `CLAY_SDR_WATERFALL_WEBHOOK_URL`, `HUBSPOT_PORTAL_ID`,
    `CLAUDE_MODEL`, `CLAUDE_HAIKU_MODEL`, `PERPLEXITY_MODEL`, `GOOGLE_SERVICE_ACCOUNT_JSON`,
    `GOOGLE_SHEETS_MEETINGS_ID`, `NEXT_PUBLIC_APP_URL`.
  - `.env.example` tampoco incluye la mayoría de esas variables, dificultando el onboarding.
- **Esfuerzo:** Bajo — barrido directo de actualización de ambos archivos.
- **Estado:** Pendiente.

### 7. `schema.sql` no refleja la migración multi-tenant ya aplicada
- **Dónde:** `supabase/schema.sql` vs `supabase/multi_tenant_migration.sql`.
- **Por qué importa:** el schema "base" no tiene `client_id`, que vive solo en el archivo de
  migración separado — sugiere que se aplicó en Supabase pero nunca se consolidó de vuelta.
  Riesgo de que alguien reconstruya la DB desde `schema.sql` y le falten columnas críticas.
- **Esfuerzo:** Bajo — fusionar el contenido de la migración dentro de `schema.sql`.
- **Estado:** Pendiente.

### 8. Filtrado por `client_id` es opcional, no forzado — sin Row Level Security
- **Dónde:** `app/api/companies/route.ts:26,35,41`, `app/api/contacts/route.ts:24,41`,
  `app/api/icp/route.ts:17,38,45` — patrón `if (clientId) q = q.eq("client_id", clientId)`.
- **Por qué importa:** si se omite el query param `client_id`, la query devuelve datos de
  **todos** los clientes. No hay RLS en Supabase ni verificación de que la sesión tenga permiso
  sobre ese cliente — el aislamiento multi-tenant depende 100% de que el frontend siempre mande
  el `client_id` correcto. Puede ser una decisión de diseño aceptable (todo el equipo interno ve
  todos los clientes), pero hoy es implícita, no explícita.
- **Esfuerzo:** Medio/alto si se decide forzar aislamiento real vía RLS.
- **Estado:** Pendiente — requiere decisión de producto primero (¿todo el equipo debe ver todos
  los clientes o no?).

---

## 🟢 Bajo / mejora continua

### 9. `typescript.ignoreBuildErrors: true` en `next.config.js`
- **Dónde:** `next.config.js:5-7`.
- **Por qué importa:** el build de producción ignora errores de tipos — probable causa raíz de
  las 160 ocurrencias de `any`/`as any` en 64 archivos. Quitarlo de golpe probablemente revela
  errores acumulados.
- **Esfuerzo:** Bajo desactivarlo; Alto sanear los errores que aparezcan.
- **Estado:** Pendiente.

### 10. Manejo de errores inconsistente entre route handlers
- **Dónde:** de 135 archivos `route.ts`, 88 no tienen ningún `try/catch` (ej.
  `app/api/clay/push-contacts/route.ts`). Mensajes de error duplicados con copy distinto para el
  mismo caso (ej. "Se requiere client_id" / "client_id requerido" / "client_id es requerido").
- **Esfuerzo:** Medio — un wrapper común (`withErrorHandler`) para estandarizar.
- **Estado:** Pendiente.

### 11. Código duplicado entre rutas hermanas de Clay
- **Dónde:** `clay/push-contact` vs `push-contacts`, `clay/push-company` vs `push-companies`.
- **Esfuerzo:** Medio — unificar con un flag de batch o extraer lógica común a `lib/`.
- **Estado:** Pendiente.

### 12. Sin framework de testing ni tests automatizados
- **Dónde:** no existe `jest.config.*`, `vitest.config.*`, `playwright.config.*` ni archivos
  `*.test.ts`/`*.spec.ts` en todo el repo.
- **Esfuerzo:** Alto — construir desde cero. El punto 5 (gate de lint/typecheck en CI) es más
  barato y de alto impacto inmediato mientras no haya presupuesto para tests.
- **Estado:** Pendiente.

### 13. Posible duplicación del cron de `refresh-lemlist`
- **Dónde:** `vercel.json` (cron nativo diario 8am) y `.github/workflows/sync-engagement.yml`
  (cron externo cada 30 min) ambos llaman a `/api/cron/refresh-lemlist`.
- **Por qué importa:** confirmar que no se estén disparando ambos y duplicando writes.
- **Esfuerzo:** Bajo — verificar y, si aplica, eliminar uno de los dos triggers.
- **Estado:** Pendiente.

### 14. Dependencias a revisar
- `@supabase/supabase-js` (^2.45.0) y `@supabase/ssr` (^0.12.0, pre-1.0) — varios minors atrás.
- `eslint` (^8.57.1) — serie 8 en EOL, considerar migrar a ESLint 9 (flat config) cuando se
  actualice Next.
- `xlsx` (SheetJS, ^0.18.5) — el proyecto recomienda instalar parches de seguridad desde su
  propio CDN en vez de npm; verificar de dónde se instala en este repo.
- `pdf-parse` (^2.4.5) — historial de mantenimiento irregular, revisar vulnerabilidades
  transitivas.
- **Esfuerzo:** Medio (Next.js implica retestear `middleware.ts` y App Router).
- **Estado:** Pendiente.

---

## Resumen — orden sugerido de ejecución

1. Next.js → CVE-2025-29927 (crítico, bajo esfuerzo)
2. Fail-closed en validación de `CLAY_WEBHOOK_SECRET`/`CRON_SECRET` (alto, bajo esfuerzo)
3. Rotar y sacar del bundle `CLAY_WEBHOOK_SECRET` (alto, medio esfuerzo)
4. Setear `FORM_TOKEN_SECRET` real (medio, bajo esfuerzo)
5. Gate de lint/typecheck en `deploy.yml` (medio, bajo esfuerzo)
6. Actualizar `CLAUDE.md` + `.env.example` (medio, bajo esfuerzo)
7. Consolidar `schema.sql` con la migración multi-tenant (medio, bajo esfuerzo)
8. Decidir y, si aplica, forzar aislamiento por `client_id` (medio/alto)
9. Resto de ítems 🟢 según capacidad del equipo.
