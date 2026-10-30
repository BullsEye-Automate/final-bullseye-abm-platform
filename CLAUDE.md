# BullsEye — Contexto Maestro para Claude Code

> Este archivo es leído automáticamente por Claude Code en cada sesión.
> Mantenlo actualizado a medida que el proyecto evoluciona.

---

## Quiénes somos

**BullsEye** es una agencia de prospección B2B. La plataforma orquesta todo el pipeline de prospección: discovery de empresas, curación humana, búsqueda de contactos, pre-filtro IA, lead scoring, generación de copy personalizado, outreach multicanal y análisis de resultados.

**Arquitectura multi-tenant:** la app sirve a múltiples clientes (cada uno con su propio ICP, campañas de Lemlist, tablas de Clay y pipeline de HubSpot).

---

## Stack tecnológico

**Entorno local (Mac):**
- Node.js v20.20
- npm v11.11
- Vercel CLI v53
- Git v2.39

**Stack:**
- **Framework:** Next.js 14 (App Router)
- **Base de datos:** Supabase (PostgreSQL)
- **Deploy:** Vercel
- **Estilos:** Tailwind CSS + Outfit (Google Fonts)
- **Lenguaje:** TypeScript

**Producción:** https://portal.bullseye-abm.com (equipo y clientes entran por aquí).
El dominio anterior `https://bullseye-abm-platform-eq6f.vercel.app` sigue funcionando para las APIs (webhooks de Clay/HubSpot, crons); sus páginas redirigen al dominio nuevo cuando `APP_CANONICAL_HOST` está seteada (`middleware.ts`).

---

## Convenciones del proyecto

- Todo el código en **TypeScript**
- Comentarios en **español**
- Variables y funciones en **inglés** (estándar de código)
- Commits en español, descriptivos
- Nunca hardcodear credenciales — siempre usar `.env.local` o variables Vercel
- **Toda tabla nueva debe activar RLS** en su migración (`alter table ... enable row level security;`). La app consulta con service role desde el servidor; la anon key es pública y solo se usa para el login. Ver `supabase/enable_rls_all_tables_migration.sql`.
- Propiedades HubSpot usan prefijo `bullseye_` (no `wecad_`)
- IDs de Clay usan `bullseye_company_id` y `bullseye_contact_id`

---

## Variables de entorno configuradas en Vercel

```
SUPABASE_URL=https://ihxjjbbwldrdjhlvzkix.supabase.co
ANTHROPIC_API_KEY=configurada
PERPLEXITY_API_KEY=configurada
LEMLIST_API_KEY=configurada
HUBSPOT_ACCESS_TOKEN=configurada
LUSHA_API_KEY=configurada
CLAY_WEBHOOK_SECRET=bullseye-clay-2026
NEXT_PUBLIC_SUPABASE_URL=https://ihxjjbbwldrdjhlvzkix.supabase.co   -- requerido por el login (Supabase Auth)
NEXT_PUBLIC_SUPABASE_ANON_KEY=                                      -- ⚠️ verificar que esté seteada en Vercel
ALLO_API_KEY=                                                       -- ⚠️ pendiente: generar en Allo → Settings → API y setear en Vercel
APP_CANONICAL_HOST=portal.bullseye-abm.com                          -- redirige las páginas del dominio vercel.app al subdominio
NEXT_PUBLIC_APP_URL=https://portal.bullseye-abm.com                 -- URL pública (webhooks de Clay en onboarding, llamadas internas)
```

---

## Autenticación

Todas las rutas internas (todo excepto los links mágicos de abajo) requieren sesión de **Supabase Auth**. Se implementa en `middleware.ts` (raíz del repo) usando `@supabase/ssr`.

- **Crear un usuario del equipo:** Supabase Studio → Authentication → Users → "Add user" (email + password). No hay pantalla de signup pública a propósito — es una herramienta interna.
- **Login:** `/login`. **Logout:** botón al final del `Sidebar`.
- **Rutas públicas sin login** (protegidas por su propio token/secreto, no por sesión — ver lista exacta en `middleware.ts`):
  - `/feedback-cliente/[token]`, `/encuesta/[token]`, `/forms/icp/[token]`, `/review/empresas/[token]`, `/revision/[token]` — links que se comparten con clientes externos.
  - `/api/cron/*` (Vercel Cron, valida `CRON_SECRET`) y los webhooks entrantes de Clay (`x-webhook-secret`).
- Antes de agregar una ruta nueva a esa lista blanca, confirmar que valida un token o secreto propio — si no, queda expuesta sin sesión.
- `/api/clients` solo es público como `GET` exacto (lo usa `/chat`). Las subrutas `/api/clients/[id]/*` (config con API keys de Lemlist, contexto IA, borrar cliente…) requieren sesión.
- **Usuarios cliente** (portal): tienen `app_metadata.role = "client"` y el middleware los confina a `/portal` y `/api/portal`. Ver sección "Portal de clientes".

---

## ARQUITECTURA MULTI-TENANT

La app es usada por BullsEye para gestionar múltiples clientes (empresas que contratan prospección B2B).

### Tabla `clients` (a crear en Supabase)

```sql
create table clients (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text not null unique,           -- para URLs amigables
  logo_url text,
  is_active boolean default true,
  created_at timestamptz default now()
);
```

### Configuración por cliente (tabla `client_configs`)

```sql
create table client_configs (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) not null,
  lemlist_campaign_id text,            -- campaña principal de outreach
  lemlist_staging_campaign_id text,    -- campaña puente Sales Nav
  clay_companies_table_id text,        -- tabla Companies en Clay
  clay_contacts_table_id text,         -- tabla Contacts en Clay
  hubspot_pipeline_id text,            -- pipeline de HubSpot asignado
  hubspot_owner_id text,               -- SDR asignado (owner HubSpot)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

### Columna `client_id` en tablas existentes

Agregar `client_id uuid references clients(id)` a:
- `companies`
- `contacts`
- `icp_config`

### Contexto IA por cliente (tabla `client_ai_context`)

```sql
create table client_ai_context (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) not null,
  file_name text not null,
  file_type text,                      -- pdf, docx, txt, etc.
  content text,                        -- texto extraído
  storage_path text,                   -- path en Supabase Storage
  uploaded_at timestamptz default now()
);
```

---

## Branding

- **Colores sidebar:** fondo `#251762`, acento `#62E0D8`
- **Tipografía:** Outfit (Google Fonts) — weights 300, 400, 500, 600, 700
- **Logo:** "Bulls" en blanco + "Eye" en `#62E0D8`
- **Active nav item:** fondo `rgba(98,224,216,0.15)` + texto `#62E0D8`

---

## Lo que se intentó y NO funcionó

_(Sección para registrar aprendizajes negativos — no recrear estas rutas)_

- Clay REST API no expone CRUD de rows — solo usamos webhooks entrantes y salientes.
- Las properties de HubSpot deben crearse como `bullseye_*` (no `wecad_*`).

---

## Integraciones

### Clay

- IDs de reconciliación: `bullseye_company_id` y `bullseye_contact_id` en todos los payloads.
- Clay serializa campos usando el display name (ej. "Bullseye Company Id") — la app normaliza keys en `raw-contacts/route.ts`.
- Webhooks de Clay usan header `x-webhook-secret: bullseye-clay-2026`.
- **Tabla "Contacts Approved"** (`t_0tgc3pmHrUCGUPq4QEf`): recibe contactos aprobados por humano para enriquecer teléfono móvil con waterfall **LeadMagic (2cr) → People Data Labs (3cr) → upcell (3.5cr) → Clay Enrichments (4cr) → Wiza (5cr)**. Máximo ~17.5 créditos por contacto. Disparado automáticamente desde `bulk-approve-enrich` y manualmente desde `/telefonos`.
- Env var del webhook outbound (app → Clay): `CLAY_CONTACTS_APPROVED_WEBHOOK_URL` (actual: `pull-in-data-from-a-webhook-4bb3d54f-e1cc-49cb-a64d-1169af606af4`).
- Webhook inbound (Clay → app): `/api/clay/phone-enriched` actualiza `phone_clay`, `clay_phone_provider` en Supabase y empuja `bullseye_telefono_clay` + `bullseye_clay_phone_provider` a HubSpot.

### HubSpot

- Propiedades custom con prefijo `bullseye_`.
- Webhook de calls: `/api/hubspot/webhook/calls`.

### Lemlist

- Campaña principal: `LEMLIST_CAMPAIGN_ID` (por cliente en `client_configs`).
- Campaña puente: `LEMLIST_STAGING_CAMPAIGN_ID` (por cliente en `client_configs`).

### Allo (gestión telefónica)

- Plataforma de telefonía/AI receptionist. BullsEye compra **un número por cliente por país**; cada SDR usa el número de la cuenta que tiene asignada para que la reportería quede unificada por cliente.
- API base: `https://api.withallo.com`. Auth: header `Authorization: $ALLO_API_KEY` **sin** prefijo `Bearer` (Allo devuelve 401 si se manda con `Bearer `). Cliente server-side en `lib/allo.ts`.
- Tabla `client_allo_numbers`: mapea `client_id` → uno o más `allo_number` (E.164) con su `allo_number_name`. Un mismo número solo puede estar asignado a un cliente a la vez (índice único en `allo_number`) para que la reportería no se mezcle.
- En **Configuración → Cliente** hay una sección "Allo" con un desplegable buscable (fetch en vivo a `/api/allo/numbers`) para asignar/quitar números al cliente seleccionado (`/api/clients/[id]/allo-numbers`).
- Pendiente (próximo paso): usar estos números asignados para filtrar la reportería de Allo (actividades, tasa de conexión sin voicemail, reuniones agendadas, agrupación por tags) en el dashboard de SDR.

### Módulo Células SDR (`/analisis/celulas-sdr`)

Centro de mando del equipo SDR (14 vistas: Dirección / Operación / Análisis), réplica del prototipo `Dashboard-SDR-BullsEye.html` con datos reales. Todos los usuarios ven toda la información.

- **Metas:** pestaña "Asignación" de la planilla de metas (`GOOGLE_SHEETS_MEETINGS_ID`), meta interna por SDR × cliente × mes. Formato actual: una tabla "Mes | Cliente | N° mes | <SDR>… | Total meta interna…" (sin año: se asume el año del período); el formato anterior por bloques sigue soportado. Columnas de SDR que no calzan con la Maestra se omiten. La meta del cliente = suma de las metas de sus SDR. Solo lectura (no se editan en la app). Parser en `lib/celulasSdr/sheets.ts`; apodos de columnas ("Nico N", "Cote", "Angeles", "Lore"…) en `PERSON_NICKNAMES`.
- **Células:** pestaña "Maestra IA", columnas O y P (primer nombre = líder, siguientes = integrantes). Los líderes tienen meta propia que **no** suma a su célula (grupo "Líderes").
- **Reuniones:** tabla `meetings` (API Reuniones; sync completo 6:00 Chile + incremental `?sinceDays=45` cada hora 8:00–20:00 L-V). Todas las de cualquier origen, atribuidas a "Responsable de la reunión". Realizado: Si = realizada, No = no-show, Reagendar = reprogramada (rescate), Pendiente = agendada por realizarse. Agendadas por fecha de agendamiento; realizadas/no-show/reprogramadas por fecha de reunión. Oportunidad = realizada con Propuesta/Oportunidad en los valores elegidos en Configurar (por defecto "Si").
- **Llamadas, contactados y puntaje:** Allo (`/api/celulas-sdr/allo?month=`), contactado = etapa "Conversación" del embudo de Allo; puntaje = "Score de Desempeño SDR" del summary (`lib/callScoreCard.ts`). País de llamadas = prefijo telefónico del número de Allo; país de reuniones = columna País.
- **Email / WhatsApp / LinkedIn:** HubSpot. Cada actividad se registra en el HubSpot del cliente que se trabaja (el de BullsEye o el propio del cliente), sin duplicados, y se suman todas. HubSpot propio del cliente: token de app privada de solo lectura en `client_configs.hubspot_access_token` (migración `supabase/20261023_client_hubspot_token.sql`), se conecta en **Configuración → Cliente → HubSpot del cliente** (`/api/clients/[id]/hubspot`, prueba el token antes de guardar y nunca lo devuelve al navegador). Sus actividades traen el cliente (`ChannelDay.c`), así que con filtro de ese cliente se muestran sus canales; las del HubSpot de BullsEye no tienen cliente (con filtro de un cliente no conectado o de país se muestran solo llamadas). SDR por nombre del usuario de HubSpot (`resolveSdrKey`). Lógica en `lib/celulasSdr/server/hubspot.ts`. "Otras" y "empresas/contactos trabajados": pendientes de conexión.
- **Líderes de célula (Nicolle, Vanessa):** sin meta diaria de llamadas/actividades. Sus llamadas suman al total, pero no a la meta ni al cumplimiento de actividad (`callDays` / `callsQ` en `engine.ts`).
- **Fecha de la reunión manda** (confirmado con BullsEye): "Reuniones" del Ranking = todas las con fecha de reunión en el período completo (mes/semana entero, cualquier estado); Pendientes = las de ese conjunto con Realizado = Pendiente (`mtgTotal` / `fullEnd` en `engine.ts`). "Agendadas" (embudo, KPIs) sigue contando por fecha de agendamiento.
- **Evolutivo mensual** (vista en Análisis, `views/Evolutivo.tsx`, datos de `/api/celulas-sdr/monthly` → `lib/celulasSdr/server/monthly.ts`): reuniones agendadas (por fecha de agendamiento) y realizadas (por fecha de reunión) de enero a la fecha, agregadas por mes × SDR × cliente × país. Promedio del mes = agendadas ÷ SDR con al menos una agendada ese mes; promedio del año solo con meses cerrados. Respeta filtros de célula/SDR/cliente/país, no el período.
- **Excluidos de la reportería:** Adolfo Madriz y José Pablo Alvarez (`EXCLUDED_PEOPLE` en `lib/celulasSdr/engine.ts`): no aparecen y no suman metas, reuniones ni actividad.
- **Días hábiles:** lunes a viernes menos feriados de Chile (`lib/celulasSdr/calendar.ts`, agregar los de cada año nuevo).
- **Configurar:** global en la tabla `sdr_cells_config` (migración `supabase/20261016_sdr_cells_config.sql`), editable por cualquier usuario con sesión.
- **Resend centralizado (oct-2026):** los tres correos del portal (Células SDR, Reporte SDR, Salud de números) usan la cuenta de Resend del equipo de jkarmy@, con el subdominio verificado `notificaciones.bullseye-abm.com` (en la misma cuenta está `peithob2b.com`). `RESEND_API_KEY` de esa cuenta y remitente `CELULAS_ALERTS_FROM = alertas@notificaciones.bullseye-abm.com` (los otros remitentes caen a este). El remitente DEBE ser `@notificaciones.bullseye-abm.com`, no `@bullseye-abm.com`.
- **Destinatarios editables desde el portal** (`lib/mailRecipients.ts`, `/api/mail-recipients` con sesión, componente `components/MailRecipientsEditor.tsx`): fila `id = 'mail_recipients'` de la tabla `sdr_cells_config` (sin migración nueva), una lista por reporte (`phone_health`, `reporte_sdr`); sin lista guardada se usa `RECIPIENT_DEFAULTS`. Las variables de Vercel `PHONE_ALERTS_TO` y `REPORTE_SDR_TO` ya no se usan. Los destinatarios de Células SDR (líderes) siguen fijos en `alertsMail.ts`.
- **Correo diario a las líderes** (`/api/cron/celulas-sdr-alerts`, lunes a viernes 11:30 UTC ≈ 8:30 Chile): cada líder recibe su célula (llamadas de ayer, agenda de hoy, no-show, rescates, registros por actualizar, cumplimiento del mes, calidad). Destinatarios en `lib/celulasSdr/server/alertsMail.ts` (Nicolle → nnazar@, Vanessa → vabarzua@, copia ihincapie@). Envío por **Resend** (`RESEND_API_KEY`, `lib/mailer.ts`); sin esa variable cae a Gmail con delegación de dominio (`lib/gmail.ts`). Mientras `bullseye-abm.com` no esté verificado en Resend solo se puede enviar desde `onboarding@resend.dev` al dueño de la cuenta (modo prueba). Envío real **activado** por defecto (va a cada líder con copia); `CELULAS_ALERTS_MODE=test` lo vuelve a modo prueba (todo solo a ihincapie@). En Alertas de gestión, "Enviar ahora a <líder>" manda el correo real en el momento. Remitente: `CELULAS_ALERTS_FROM`. Las variables nuevas de Vercel solo aplican en un deploy nuevo: si el botón "Redeploy" no está disponible, cualquier push/merge a `main` dispara el deploy de producción. Vista previa y "Enviarme prueba" en Alertas de gestión (`/api/celulas-sdr/alerts-preview`).
- Datos de servidor reutilizables en `lib/celulasSdr/server/` (base, allo, hubspot, config, digest); las rutas `/api/celulas-sdr/*` son envoltorios finos.
- Cálculo (agg / derive / forecast / alertas) en el navegador: `lib/celulasSdr/engine.ts`. Allo y HubSpot se cachean por mes en `allo_response_cache`.

---

### Reporte SDR diario por correo (`lib/reporteSdr/`)

Correo automático con un **PNG vertical** (1080 px, para reenviar por WhatsApp) de las llamadas del día por SDR + reuniones agendadas hoy. **Lunes a viernes hábiles a las 13:00 y 18:30 de Chile.**

- **Datos:** reutiliza tal cual `GET /api/analisis/sdr?client_id=__all__&rangeKey=today` (mismos números que Análisis → SDR → Ranking SDR). Reuniones agendadas = lista del día por fecha de agendamiento (la de "Origen de Reuniones"), asignadas a cada SDR por nombre normalizado (`lib/reporteSdr/data.ts`). Excluidos: Adolfo Madriz y José Pablo Alvarez (mismo criterio que Células SDR).
- **Imagen:** `next/og` (Satori) en el servidor, fuente Outfit local en `lib/reporteSdr/fonts/` (incluida en el bundle vía `outputFileTracingIncludes` en `next.config.js`). Regla de Satori: todo `<div>` con más de un hijo necesita `display:flex`.
- **Envío:** `sendMail` de `lib/mailer.ts` (Resend, con `attachments`; el fallback Gmail también los soporta). Destinatarios editables en Análisis → SDR → tarjeta "Reporte SDR por correo" (clave `reporte_sdr` de `lib/mailRecipients.ts`; por defecto ihincapie@, jkarmy@ y amadriz@). Remitente: `REPORTE_SDR_FROM`, si no `CELULAS_ALERTS_FROM`.
- **Reintento y aviso de falla (oct-2026):** el 29-oct el corte de 13:00 no se envió (armar el reporte con Allo lento superó los 120 s). Ahora las rutas tienen 300 s, `vercel.json` agenda también la hora UTC siguiente (16,17,18 y 21,22,23 UTC) y, si el envío de la hora del corte no quedó registrado (`markReportSent` / `wasReportSent`, clave `reporte_sdr_sent:<día>:<slot>` en `allo_response_cache`), se reintenta una hora después; si el reintento también falla, `sendReportFailureNotice` avisa por correo a los destinatarios con el motivo.
- **Cron:** `/api/cron/reporte-sdr?slot=13|18`. Vercel agenda en UTC y Chile cambia de horario, así que `vercel.json` dispara cada corte en las dos horas UTC posibles (16/17 y 21/22 UTC) y la ruta envía solo la que coincide con la hora real de `America/Santiago`. `?force=1` (con `CRON_SECRET`) se salta el chequeo de hora y día hábil.
- **Vista previa / envío manual** (requiere sesión): `GET /api/reporte-sdr?corte=18:30` devuelve el PNG con los datos de ese momento; `POST` lo envía en el momento a los destinatarios. En Análisis → SDR, sección "Reporte SDR por correo", el botón **"Enviar ahora"** (`app/analisis/sdr/components/EnviarReporteSdr.tsx`) hace ese POST con el corte según la hora de Chile (desde las 18:30 = 18:30, antes = 13:00), con confirmación.
- Alias agregado en `SDR_NAME_ALIASES`: "Pamela Alveal" (planilla de reuniones) = "Pamela Aveal" (Allo). Antes sus reuniones no calzaban en el Ranking SDR.

---

### Salud de números — Alertas de Números (`lib/phoneHealth/`, `/analisis/salud-numeros`)

Detección proactiva de números de Allo que caen en spam o pierden conectividad. **Página propia** `/analisis/salud-numeros` (menú Análisis → "Salud de números"): tarjetas de conteo y números agrupados por acción (Reemplazar / Revisar esta semana / Vigilar / Sanos / Sin volumen, los tres últimos plegados); cada fila muestra un motivo corto (`summary` del engine) y al hacer clic el detalle (número, cliente, desde cuándo, todos los motivos, acción). En Análisis → SDR solo queda una **franja de una línea** con los conteos y "Ver detalle" (`app/analisis/sdr/components/AlertasNumeros.tsx`). + correo diario.

- **Caché del reporte:** calcularlo toma ~45 s, así que el último reporte se guarda en `allo_response_cache` (clave `phone_health_report:v1`, 6 h; `getPhoneHealthReport` en `server.ts`). El cron de las 8:00 lo deja listo; la franja y la página lo leen al instante; "Actualizar" usa `?fresh=1`. Etiquetas del nivel por acción (`LEVEL_LABEL`: Reemplazar / Revisar / Vigilar / Sano / Sin volumen), también en el correo, que enlaza a `/analisis/salud-numeros`.

- **Métrica:** % de llamadas que contesta una persona = etapa "Conversación" del embudo de Allo (`fetchAlloConnectedCallIds`), por número asignado en `client_allo_numbers`. Ventanas móviles que terminan ayer (día de Chile): actual = últimos 7 días, anterior = 7 días previos, base = 28 días previos a la actual.
- **Reglas** (`engine.ts`, `THRESHOLDS`): se evalúa con ≥ 50 llamadas en 7 días (si no, "Sin volumen") y se compara con la base si tiene ≥ 100. **Rojo:** bajo 5% dos semanas seguidas o caída ≥ 40% vs su base → reemplazar el número. **Amarillo:** caída 25–40%, bajo 5% solo esta semana, > 60% a buzón, o conexiones "contestadas" sin conversación de < 15 s ≥ 30% y +10 pts vs base (posibles cortes / "no se oye") → llamada de prueba y escuchar grabaciones. **Vigilar:** ≥ 400 llamadas en 7 días → rotación preventiva. Cada número se compara contra su propio historial (validado con datos ago–oct 2026: habría marcado Crossnet Argentina y Grupo Tress MX semanas antes).
- **Conversaciones de Allo vacías (oct-2026):** `/v2/api/analytics/outbound` (etapa CONVERSATION) responde 200 pero sin items para todo el período. `fetchAlloConnectedCallIds` (`lib/allo.ts`) devuelve `null` cuando no hay ninguna y registra la estructura recibida (`describeShape`) en los logs de Vercel; los reportes usan el respaldo por duración (contestada ≥ 60 s). Afecta también Ranking SDR, horarios y Salud Telefónica, que antes mostraban 0 conectadas. Pendiente: revisar el log y corregir el formato con soporte de Allo.
- **Resguardo de datos:** si Allo no devuelve ninguna "Conversación" con ≥ 200 llamadas, `dataWarning` y NO se envía correo (es una falla de API, no de los números).
- **Correo** (`mail.ts`, cron `/api/cron/alertas-numeros`, 11 y 12 UTC L-V, corre solo el que cae a las 8:00 de Chile; `?force=1` con `CRON_SECRET` lo fuerza): **lunes 8:00 siempre** (resumen semanal completo) y **martes a viernes solo si un número pasa a "Reemplazar"** (rojo nuevo o amarillo → rojo); lo demás queda para el lunes. Estado en la tabla `phone_health_alerts` (migración `supabase/20261028_phone_health_alerts_migration.sql`) para no repetir el mismo aviso. Destinatarios editables en la página (tarjeta "Correo automático", clave `phone_health` de `lib/mailRecipients.ts`; por defecto amadriz@ e ihincapie@), remitente `PHONE_ALERTS_FROM` → `CELULAS_ALERTS_FROM`.
- **API con sesión:** `GET /api/analisis/alertas-numeros` (semáforo + `since` de cada alerta), `POST` envía el correo en el momento sin tocar el estado (botón "Enviarme el correo ahora").

---

### Pulso ABM — antes "Radar ABM" (`/analisis/radar-abm` y portal `/portal/radar`)

Nombre visible: **Pulso ABM** (se cambió por conflicto de nombre). El código, las URLs (`radar-abm`, `/portal/radar`), `lib/radarAbm/` y las tablas `radar_abm_*` mantienen el nombre interno "radar".

**Vistas (`PARTS` / `PART_SLUGS` en `render.ts`):** Visión ejecutiva · **Cuentas objetivo** (cobertura + el módulo Wishlist `WishlistWorkspace`, modo operador en la vista interna; `/portal/wishlist` redirige aquí). Menú del portal = Inicio + vistas de Pulso ABM (sin bloque "Mi cuenta"); el formulario `/portal/icp` se abre desde "ICP del proyecto") · **Avance en cuentas** (funnel, profundidad, multi-threading, estados, contactabilidad, conversaciones, seguimientos, referrals) · **Reuniones** (KPIs + "Detalle de reuniones" con todos los campos de la planilla) · **Feedback manual** (§17 "Completar feedback" = el formulario de `/feedback-cliente/<token>` embebido en el portal vía `components/feedback/ClientFeedbackBoard.tsx` + `/api/portal/feedback`; en la vista interna se muestra el mismo tablero —el equipo también puede completar el feedback— con el link para compartir arriba; slug `feedback-manual`, el antiguo `feedback-comercial` redirige) · **Resumen feedback** (§18 resumen de `meeting_feedback`: calificación, empresa/contacto calificado, propuesta, probabilidad de cierre; §19 calidad de reuniones) · **Peitho** (`components/peitho/PeithoPanel.tsx`: con "Incluir Peitho" = Sí la app Peitho, si no la landing comercial; en el portal lee `/api/portal/peitho`, en la vista interna `/api/clients/[id]/peitho`) · **Voz del mercado** (objeciones, señales, **Score de desempeño SDR** de Allo, descartadas, ajuste al ICP) · **ICP del proyecto** (ICP y buyer persona vigentes de `icpStore`, `IcpPanel` + `/api/portal/radar/icp` / `/api/radar-abm/icp`; "Lo que estamos trabajando" por industria, país, tamaño, área y seniority) · Segmentos · Evolución y stock · Recomendaciones · **Inteligencia (KAM)** y Anexo solo internos (`INTERNAL_PARTS`) · Tablas maestras. Slugs antiguos redirigen (`partIndex`). Secciones armadas con React: `REACT_SECTIONS` (el CSS genérico de tablas de `radar.css` excluye `.ra-plain`). Cuentas objetivo, ICP, Feedback manual y Peitho funcionan en el portal aunque el informe no esté sincronizado. Las tablas maestras se detectan por slug (`tablas-maestras`), no por numeral romano.
- **Modo "Cliente BullsEye"** (`universeMode` en `radar_abm_clients.properties`, automático para el cliente llamado BullsEye; se cambia en Configuración → Cliente → Pulso ABM → "Universo del informe"): no usa "Status de la asignación" ni "Asignación BullsEye por llamar". Universo = empresas con "Cliente BullsEye Empresa" (`cliente_bullseye_empresa`) = valor del cliente (o "Cliente BullsEye" de la config; por defecto el nombre) y sus contactos con "Cliente BullsEye" (`cliente_bullseye`) = ese valor. Etapa de empresa = ciclo de vida (Customer → Clientes, Opportunity → En conversaciones con <cliente>, Other → Nutrir) y, si es Lead o vacío, por actividad: reunión de la planilla → Reunión Agendada, contacto que conversó/respondió → En seguimiento, actividad → En gestión, nada → Asignada. Contacto: reunión → Reunión Agendada, llamada conectada o correo respondido → Hacer Seguimiento, actividad sin respuesta → No Contestó, sin actividad → Por gestionar. Lo usan `sync.ts` y `check.ts`.
- **Titular de la cuenta en todos los clientes:** además del status de asignación, el universo exige "Cliente BullsEye Empresa" (`cliente_bullseye_empresa`) = el cliente y los contactos "Cliente BullsEye" (`cliente_bullseye`) = el cliente (valor = "Cliente BullsEye" de la config o el nombre; la opción se busca sin espacios y por prefijo: "Acid Labs" ↔ "AcidLab"). Las dos propiedades se ven y se pueden cambiar en Configuración → Cliente → Pulso ABM ("Cliente de la empresa (titular)" / "Cliente del contacto (titular)", claves `universeCompanyClient` / `universeContactClient` en `PROPERTY_DEFS`), junto al "Valor del cliente". Si el HubSpot no tiene esas propiedades (HubSpot propio del cliente) no se filtra; si no existe la opción, se avisa y no se filtra. **Contactos de la cuenta** = los asociados a las empresas del universo con "Cliente BullsEye" = el cliente (aunque no tengan "Asignación BullsEye por llamar") + los con status de asignación sin titular; se excluyen los con titular de otro cliente. Los que no tienen status de asignación toman uno por actividad (reunión → Reunión Agendada, conversó/respondió → Hacer Seguimiento, actividad sin respuesta → No Contestó, sin actividad → Por gestionar). Así contactos, áreas y profundidad por empresa reflejan la penetración real. El sync avisa cuántos se incluyeron sin status y cuántos se excluyeron por ser de otro cliente.
- **Industria de la empresa:** "Industria BullsEye" (`industria_bullseye`, clave `companyIndustry` en `PROPERTY_DEFS`, se detecta por etiqueta y se puede fijar en la configuración global); si viene vacía o no existe se usa la estándar `industry`.
- **Casos de éxito del cliente:** el sync copia los "Clientes de referencia" del ICP (`mejores_clientes`, `loadClientIcps`) a `client.refCases`; la recomendación "Casos por industria" usa esos casos en vez de proponer crearlos.
- **Listas al hacer clic** (`companyLists` / `coListHtml` en `render.ts`): funnel, empresas descartadas y cobertura (universo y por industria: trabajadas / sin gestión). Cuentas recuperables se ordenan por cercanía a volver (Retomar primero, Nutrir al final).
- **Score de desempeño SDR**: en el sync, `loadAlloMonth` (mismo caché de Células SDR) por cada mes del período, solo evaluaciones del `client_id` (números de Allo asignados al cliente) → `client.callEvals` (`{d, s, score, crit, nivel}`, sin datos del prospecto ni textos de coaching). Tope de 2 min.

Informe ABM integral **por cliente** (cuenta → contactos → actividad → conversación → interés → reunión → seguimiento → oportunidad). Port del prototipo `Radar_ABM_BullsEye_BETA.html` + prompt maestro: 13 vistas, secciones §1–§34 y anexo A1–A4. No compara clientes entre sí. Migración `supabase/20261026_radar_abm_migration.sql` (`radar_abm_config`, `radar_abm_clients`, `radar_abm_snapshots`).

- **Cálculo** (`lib/radarAbm/engine.ts`, `render.ts`): port 1:1 de `compute/health/seg/segCo/insights/learnings/recsBE/recsCli/annex`; corre en el navegador. Con los datos demo da exactamente las cifras del prototipo en los 20 clientes (Nisum Chile: 119/130 trabajadas, 118 efectivos en 79 empresas, 25 agendadas, 14 realizadas, 88%). El HTML de las secciones se genera como string (todo dato pasa por `esc()`) y se estiliza con `components/radar/radar.css` bajo `.ra-root` (tarjetas = `.rcard`, no `.card` global). Tema claro/oscuro.
- **Derivados** (`lib/radarAbm/derive.ts`): tamaño por tramos, área/seniority desde el cargo (tabla editable), profundidad, prioridad de cuenta, próximo paso por contacto. Reproduce los campos precalculados del demo.
- **Datos**: sync desde HubSpot (`lib/radarAbm/server/sync.ts`, solo lectura): empresas con la propiedad de status del cliente → contactos con "Asignación BullsEye por Llamar" → llamadas/correos/comunicaciones/reuniones (v4 batch associations) y negocios. Los nombres internos se detectan por etiqueta y se pueden fijar a mano. Lo que no existe queda como "Sin información disponible". Snapshot en `radar_abm_snapshots`; cron diario `/api/cron/radar-abm-sync` (10:15 UTC) + botón "Actualizar".
- **Status de empresa = una propiedad por cliente** ("Status de la asignación - DSAC", "… - SDR AcidLab", "… - Apply"; nombres internos `status_de_la_asignacion_*`). `detectProperties(…, clientName)` lista todas (`candidates`) y elige la que calza con el nombre del cliente (`matchClientProperty`: igual > una contiene a la otra > primera palabra; empate = ninguna). Se confirma o cambia en **Configuración → Cliente → Radar ABM** (`radar_abm_clients.properties.companyStatus`); nunca se toma del mapeo global. Universo del cliente = empresas con esa propiedad con algún valor (`HAS_PROPERTY`); "Cliente BullsEye" ya no es necesario (si se configura un valor, se suma como filtro).
- **También por cliente:** status de contacto "Asignación BullsEye por llamar - <cliente>" (contactos del universo = los asociados a sus empresas con esa propiedad con valor) y SDR "SDR - <cliente>" (empresa) / "SDR Asignado - <cliente>" o "SDR - <cliente>" (contacto; `alsoPrefixes`, ej. Coderslab usa "SDR - Coderslab" en contactos; si existen ambas manda "SDR Asignado"). Mismo mecanismo (`perClient` en `PROPERTY_DEFS`, prefijo de etiqueta con guion: "SDR -" no toma "SDR Score"). Sin SDR por cliente se usa el propietario del registro; una empresa sin SDR toma el más frecuente de sus contactos. Los cuatro se eligen en Configuración → Cliente → Radar ABM y nunca salen del mapeo global.
- **Filtros del informe** (`filterDataset` en `engine.ts`, barra de `RadarReport.tsx`, interno y portal): SDR, País, **Industria** ("Sin industria" si falta), **Wishlist** y **Fechas** (Todo el período / Mes / Semana lun–dom / Día). SDR/País/Industria/Wishlist recortan empresas y todo lo que cuelga de ellas. Fechas recorta solo lo fechado: reuniones (por fecha de la reunión), actividades (y con ellas los conteos por contacto) y negocios; el status de empresas y contactos es el actual (el snapshot no guarda historia). Las series de evolución pasan a días (rango ≤ 14 días), semanas (≤ 92) o meses (`buildBuckets`, tramos recortados al rango). La tendencia del Health Score (§24) usa **siempre meses completos** del período, aunque se elija mes/semana/día (`trendBase`). Sin filtros el cálculo es idéntico al prototipo. "Cobertura por industria" (§4) es un desplegable de una industria a la vez (`data-ra-pick` / `data-ra-panel`, lo alterna `RadarReport`).
- **Wishlist = propiedad por cliente** "Wish List - <cliente>" (`companyWishlist`; etiquetas con o sin espacio: "WishList - SOVOS", "Wishlist Webfleet", "Wish list - Acid Labs" → el prefijo ignora espacios internos). Se elige en Configuración → Cliente → Radar ABM junto a las otras por cliente (`PER_CLIENT_KEYS`). Su valor va en `company.wl` (AcidLab: "Si" / "Q2"); sin valor = "Fuera de la wishlist". El filtro y la columna "Wishlist" de la tabla maestra solo aparecen si alguna empresa tiene valor.
- **Reuniones = planilla de reuniones** (tabla `meetings`, la misma del Excel de metas y de Células SDR), no HubSpot, para todos los clientes (`lib/radarAbm/server/sheetMeetings.ts`): las del `client_id` (y de otros registros de cliente con nombre equivalente, ej. "Coders Lab" / "Coderslab Chile": nombre compacto igual o prefijo) con fecha de reunión o de agendamiento en el período; el sync avisa el total leído y, si suma varios registros, cuántas trae cada uno. Se asocian a la empresa del universo por nombre normalizado (sin razón social), dominio del correo o nombre compacto único, y al contacto por nombre (si no, `ct = "mt:…"` y `ctn` con el nombre de la planilla). Realizado Si / No / Reagendar / Pendiente → Realizada / No-show / Reprogramada / Pendiente; Propuesta/Oportunidad = Si → resultado Oportunidad; la encuesta `meeting_feedback` completa ICP, contacto correcto, resultado y feedback. Las que no calzan con ninguna empresa del universo **igual se cuentan** en Reuniones (`co = "nc:<empresa>"`, `emp` = empresa de la planilla) para que los totales calcen con el Excel de metas; quedan fuera del funnel y de los cálculos por empresa, y el sync las avisa con su nombre. **Total de la planilla** (`meetingsTotal`, por ahora solo AcidLab, automático; configurable en Configuración → Cliente → Pulso ABM → "Reuniones con filtros de empresa"): las reuniones no se recortan por wishlist ni industria, solo por fechas, SDR (responsable) y país, para que calcen con el Excel de metas. Con filtro de fechas manda la **fecha de la reunión** (como el Excel de metas y Células SDR): solo entran las reuniones con fecha de reunión en el rango, en cualquier estado (`M.agM`).
- **Funnel ABM (§7) por Status de la asignación**: asignadas → en gestión → con respuesta → interés / avance → con reunión agendada → con reunión realizada → con oportunidad (acumulativo). Bajo cada etapa, los status que "se quedan aquí"; clic en una etapa muestra la lista de sus empresas (`data-ra-stage` / `data-ra-stage-list`, lo maneja `RadarReport`).
- **Base de conocimiento ("La Biblia")**: definiciones oficiales de cada status de empresa y contacto en `docs/radar-abm/biblia-propiedades-*.csv`, cargadas como `CO_DEFS` / `CT_DEFS` y **editables** en Configuración del Radar ABM (`config.definitions`, para el nuevo modelo de trabajo); se muestran en §8 y en el tooltip de §9. **Equivalencias** (`config.companyAliases` / `config.contactAliases`, editables; por defecto las de La Biblia `CO_ALIASES` / `CT_ALIASES` y, una vez guardadas en Configuración, manda la lista guardada): etiquetas antiguas o propias de un cliente → status oficial, o "Excluir del informe" (`EXCLUDE`). Vistas en AcidLab: "No gestionar - Cliente" (≈400 empresas ya clientes) se excluye del universo; "Gestionado por Linkedin" → Gestionada por LinkedIn; contactos "Seguimiento por Whatsapp" → Hacer Seguimiento, "Seguimiento por Linkedin" → En Gestión LinkedIn (confirmado), "Refiere con TD" → Refiere…, "REAGENDAR" sin equivalencia (se conserva tal cual, confirmado), "Ya no labora en la empresa - Desasociar" → se excluye. El sync avisa cuántos excluyó y qué etiquetas no tienen equivalencia. Llamadas con "Tipo de llamada" (`hs_activity_type`) WhatsApp/LinkedIn cuentan como ese canal, no como intento; "Resultado de la llamada" Conectada/Conectado - … = llamada conectada (`contact.conv`).
- **Actividades = profundidad ABM** (`lib/radarAbm/server/activities.ts`): llamadas, correos y comunicaciones (WhatsApp / LinkedIn; BullsEye no trabaja SMS: otras comunicaciones no cuentan) asociadas a las empresas (las notas NO son actividades) del universo **y** a sus contactos con status, una sola vez por id (atribuida al contacto; las que solo están en la empresa suman a la cuenta). Se guardan en `client.activities` (`{id,k,co,ct?,d?,in?,conn?}`) y de ahí salen los conteos por contacto (intentos = llamadas telefónicas). El informe muestra "Profundidad por canales" en §5 (actividades por empresa, empresas multicanal, canales y contactos tocados por empresa, mezcla y cobertura por canal, % con reunión según canales, correos respondidos, llamadas conectadas), "Actividades por mes y canal" en §24 y columnas Actividades / Canales en la tabla maestra de empresas (`activityDepth` en `engine.ts`). Con datos demo se calcula desde los conteos por contacto. Tope 60.000 actividades por sync.
- **Solo clientes activos** (`lib/radarAbm/server/masterClients.ts`): planilla `GOOGLE_SHEETS_MEETINGS_ID`, pestaña "Maestra IA", columnas A–C "Cliente | ID Cliente | Status Cliente" (encabezado ubicado por nombre). El cliente se busca por ID Cliente (= id o slug de la app) y si no por nombre. Sin Status Cliente = "Activo" (o si no figura) el sync falla con el motivo, el cron lo salta (`skipped`) y el portal no muestra el informe ni el resumen del inicio; si la Maestra no se puede leer, tampoco se muestra. Caché de 10 min. Configuración → Cliente → Radar ABM y Análisis → Radar ABM muestran el estado en la Maestra.
- **HubSpot propio del cliente** (`hubspot_source = 'client'`): usa el token de `client_configs.hubspot_access_token`. Universo = empresas con "Status de la asignación - SDR" (o, si se fija un valor, también "Cliente BullsEye"). Su mapeo de propiedades es propio (`radar_abm_clients.properties`, migración `supabase/20261027_radar_abm_client_properties.sql`) y no hereda el global. "Probar HubSpot del cliente" (`/api/clients/[id]/radar/check`, `lib/radarAbm/server/check.ts`) hace una llamada mínima por cada objeto que lee el sync, muestra los permisos que pide HubSpot en los 403 y cuenta empresas/contactos con status; no guarda nada.
- **Datos demo** (`lib/radarAbm/demo/raw.json`, se carga con `require`, no `import`: con import el typecheck se queda sin memoria): solo vista interna, siempre con badge "Datos demo". El portal nunca los muestra.
- **Configuración**: global en `/analisis/radar-abm/configuracion` (pesos/metas del Health Score, tramos, período, propiedades HubSpot, tabla de cargos). Por cliente en **Configuración → Cliente → Radar ABM** (HubSpot de origen, valor de "Cliente BullsEye", pipeline, tipo de cartera, visible en portal).
- **Portal**: `/portal/radar?vista=<slug>` vía `/api/portal/radar` (client_id de la sesión; sin avisos internos ni anexo A). El inicio del portal muestra el resumen (Health Score y KPIs).
- **Pendiente**: las propiedades del Anexo A4 (objeción, señal, referido por, tier ICP, resultado/feedback de reunión) aún no existen en HubSpot; el sync no se ha probado contra el HubSpot real.

## Limpieza y prospección v3 (oct-2026)

Migración `supabase/20261030_prospeccion_v3_migration.sql` (sin ella el dashboard avisa y la búsqueda manual no guarda).

- **Módulos eliminados:** Solicitudes clientes (`/solicitudes-clientes`), Contactos calientes (`/sdr/calientes`), Señales comerciales (`/sdr/senales`), Respuestas (`/respuestas`), Reportería (`/reporteria`), Diagnóstico empresa (`/diagnostico-empresa`) y la búsqueda manual anterior (Sales Navigator → campaña puente de Lemlist), con las APIs que solo ellos usaban. De Solicitudes clientes se conservó: **Propuestas de ICP** → Sistema → ICP ("Propuestas del portal del cliente", `components/portalAdmin/IcpRequestsPanel.tsx`); **Base HubSpot** (sync del pool + diagnóstico Lemlist) → Config. cliente (`HubspotPoolPanel.tsx`); **Accesos al portal** ya estaba en Config. cliente; reintento de envío a Lemlist → Dashboard (`/api/portal-admin/wishlist/[id]`). Un usuario interno que entra a `/portal` va a `/empresas`.
- **Menú lateral:** se oculta / muestra con un clic (estado en `localStorage`, `components/AppShell.tsx`). Logo oficial en `public/brand/` (PNG del manual de marca, versión blanca para el sidebar). Subtítulo "B2B ABM Platform".
- **Dashboard de prospección** (`/dashboard`, `lib/prospectingDashboard.ts`, `/api/dashboard?range=&client_id=`): con cliente → recomendadas por IA (`client_recommendations`), propuestas (`client_wishlist.origin = bullseye`), aprobadas / rechazadas (por `client_decision_at`), pedidas por el cliente, empresas prospectadas (`contacts_searched_at`, done / few_contacts), contactos automáticos y promedio por empresa (`contacts_found`), contactos manuales (`wishlist_contacts.origin = manual`), aprobados con email/teléfono; pendientes actuales (esperando aprobación, por prospectar, búsqueda manual, sin Lemlist con reintento) y evolución de 6 meses. Con "Todos los clientes" → resumen general + una tarjeta por cliente (clic = elige el cliente). El dashboard anterior (`lib/dashboardQueries.ts`) sigue usándose en Análisis.
- **Búsqueda manual** (`/busqueda-manual`, `lib/manualProspecting.ts`, `/api/busqueda-manual`): empresas aprobadas con `contacts_status = few_contacts` (menos de `FEW_CONTACTS` contactos fit en la búsqueda automática), ordenadas por fit y tiempo en cola, con links a LinkedIn (empleados de la página de empresa, Sales Navigator, búsqueda de personas). El prospector agrega contactos (nombre, cargo, LinkedIn, email/teléfono opcionales) → `wishlist_contacts` origin `manual`, `lead_id = manual:<linkedin>` y se aprueban con `approveWishlistContact` (Lemlist del cliente + HubSpot + enriquecimiento). Estado de la empresa en `client_wishlist.manual_status` (pending / in_progress / done / no_contacts).
- **Peitho** (Oportunidades → Peitho, `/oportunidades/peitho`): switch "Incluir Peitho" en Config. cliente (`client_configs.peitho_enabled`, `/api/clients/[id]/peitho`). No, vacío o sin cliente elegido = landing comercial (`components/peitho/PeithoLanding.tsx`, contenido del deck "Peitho – BullsEye 2026" y del one pager 2026-2027; video, portada, logos y PDF en `public/peitho/`; CTA "Quiero activar Peitho" pendiente de conectar); Sí = vista de la app Peitho con el feedback automático de reuniones (integración pendiente). "Feedback" pasó a llamarse "Feedback manual".

## Portal de clientes (`/portal`)

Vista para que los clientes de BullsEye entren con su propio login. Layout con barra lateral (`components/portal/PortalShell.tsx`): Mi cuenta (Inicio, ICP, Wishlist) + Radar ABM (12 vistas). Fases: (1) accesos + ICP ✅, (2) wishlist de empresas ✅ (empresas → lista Lemlist del cliente ✅; contactos a campaña: pendiente), (3) recomendaciones por señales de llamadas, (4) reportería (se integra con el módulo de Ingri).

- **Accesos:** varios usuarios por cliente, sin límite. Se crean desde **Configuración → Cliente → Portal del cliente — accesos** (componente `components/portalAdmin/PortalAccessManager.tsx`) con contraseña temporal que se muestra una sola vez; el cliente la cambia en `/portal/cuenta`. Tabla `client_users` (migración `supabase/client_portal_migration.sql`) + `app_metadata.role = "client"` en Supabase Auth. Desactivar = `ban_duration` en Auth + `is_active = false`.
- **Autorización:** las APIs `/api/portal/*` toman el `client_id` SIEMPRE de `client_users` vía `requirePortalUser()` (`lib/portalAuth.ts`), nunca de la request. En `/portal` no se monta `ClientProvider` (descargaría la lista de todos los clientes).
- **ICP y buyer persona:** el cliente NO edita directo. `/portal/icp` reutiliza `IcpPublicForm` (modo `embedded`) y crea una propuesta en `icp_change_requests` (una pendiente por cliente + industria; reenviar la reemplaza). BullsEye aprueba o rechaza en Sistema → ICP ("Propuestas del portal del cliente") viendo el diff por campo contra el ICP vigente; aprobar escribe con `saveIcpContent()` (`lib/icpStore.ts`). El link público `/forms/icp/[token]` (onboarding) sigue guardando directo.
- **Wishlist (`/portal/wishlist`, fase 2)** — migración `supabase/client_wishlist_migration.sql`:
  - **Fuentes:** (1) **Base BullsEye** = empresas de HubSpot copiadas a `hubspot_company_pool` (sync por tramos desde **Config. cliente → Base de empresas para la wishlist**, `lib/hubspotPool.ts`); (2) **Base Lemlist** con la API key **propia** del cliente (`client_configs.lemlist_api_key`, sin fallback a la key de BullsEye — `lib/lemlistDatabase.ts`).
  - **Qué se copia de HubSpot: LISTA CERRADA** (`POOL_PROPERTIES` en `lib/hubspotPool.ts`): industria, grupo de industria, empleados, facturación anual, tecnologías (`web_technologies`), país (`pais_g`, propiedad propia "País" con ~95% de cobertura — no la estándar `country`), región, ciudad, año de fundación (filtros) + descripción, sitio web y LinkedIn (solo tarjeta). ⚠️ NO usar "todo el grupo companyinformation": en HubSpot hay propiedades custom de prospección creadas en ese grupo (Wish List - <cliente>, SDR - <cliente>, Status de la asignación, Razones del Lost…) y el pool lo ven todos los clientes. El código además filtra por la lista al mostrar, filtrar y armar prompts (`pickAllowed`, `isFilterableProperty`). Para filtros de texto (país, ciudad) las opciones son los 300 valores más frecuentes del pool.
  - **Búsqueda:** RPC `search_hubspot_pool(filters, query, exclude_domains, exclude_names, limit, offset)` — SQL estático, solo service role. Filtros `in` / `range` / `contains` / `exists`.
  - **Búsqueda unificada (v3, migración `supabase/client_portal_v3_migration.sql`):** el cliente NO elige base ni ve de dónde viene cada empresa. Un solo set de filtros en español, panel a la izquierda estilo Lemlist (`lib/unifiedFilterDefs.ts`: grupos Información de la empresa / Ubicación / Tamaño y finanzas / Tecnologías / Ofertas de empleo). `lib/unifiedSearch.ts` traduce cada filtro a la base HubSpot (país → `pais_g` con variantes en español, tramos de empleados/facturación → rangos, industria Lemlist → industria HubSpot vía IA cacheada en `industry_value_map`, tecnologías con variantes) y a Lemlist (filterIds). Paginación: primero HubSpot y, al agotarse, Lemlist (cursor `{phase, hsOffset, lemPage}`); dedupe por dominio en el navegador. Si el cliente usa un filtro que HubSpot no tiene (región, ofertas de empleo, semántica…) se salta HubSpot (salvo en modo IA). Valores de Lemlist traducidos al español con IA y cacheados en `lemlist_value_labels`. Las tarjetas viajan con una `ref` opaca (`encodeRef`/`decodeRef`), sin la fuente. Sin key de Lemlist del cliente: solo HubSpot y sus filtros.
  - **Dos modos:** "Buscar empresas" (filtros del cliente; **el fit NO es automático**: el cliente lo pide con "Ver fit" en una tarjeta o selecciona varias y pulsa "Calcular fit" → `/api/portal/wishlist/score`) y "Recomendadas por IA" (`icpToUnifiedFilters` traduce el ICP a filtros unificados —incluye búsqueda semántica—, todo se puntúa y **solo se guardan/muestran empresas con fit ≥ 60%**; ver "Recomendaciones IA persistentes"). Fit en lotes de 8 en paralelo (`SCORE_BATCH`). Ambos tienen "Ordenar por: Relevancia / Mayor fit" (las sin fit van al final). Fit cacheado con `source = 'unified'`.
  - **Solicitar empresa:** si no aparece, el cliente la pide a mano (nombre + sitio o LinkedIn + comentario) → `client_wishlist.source = 'manual'`, también se envía a Lemlist.
  - **Empresas trabajadas** (`/api/portal/worked`): `companies` del cliente con status approved/client_approved + wishlist en in_progress/contacts_found. Solo nombre, sitio, país, estado y fecha.
  - **Lista de exclusión del cliente** (`client_exclusions`, `/api/portal/exclusions`): empresas (a mano o Excel/CSV, columnas "Empresa"/"Dominio" detectadas en el navegador con `xlsx`) y palabras clave (excluyen si el nombre las contiene). Se aplican siempre en búsquedas y recomendaciones (`getClientExclusions` + `p_exclude_keywords` de `search_hubspot_pool`). Las empresas se copian también a `excluded_companies` para la prospección interna.
  - **Recomendaciones IA persistentes** (migración `supabase/client_portal_v5_migration.sql`, `/api/portal/wishlist/recommendations`): las empresas evaluadas con fit ≥ 60% quedan en `client_recommendations` como `pending` hasta que el cliente las agrega (`added`) u omite (`omitted`); al recargar siguen ahí y no se vuelven a pagar. Quitar de la wishlist o restaurar una omitida la devuelve a `pending`. Filtros generados desde el ICP + cursor en `client_reco_state`: cada "Generar más" sigue donde quedó; si cambia el ICP (hash) se parte de cero y las pendientes del ICP anterior no se muestran. El cliente elige cuántas buscar (10/25/50/100/200): el navegador pide tandas de 30 (una por llamada, límite 60 s) hasta juntar esa cantidad, con barra de progreso y "Detener" (lo encontrado queda guardado). Tope de tandas ≈ cantidad/5 + 2; corta tras 4 tandas seguidas sin empresas buenas. 200 empresas ≈ 10–15 min y ~US$1,5–3 de IA. En "Buscar empresas" los fits ya calculados (caché) se muestran gratis.
  - **Fit:** 0–100 + razón en español, cacheado en `company_fit_scores` por (cliente, fuente, empresa, hash del ICP). Cambiar el ICP —o `FIT_PROMPT_VERSION` en `lib/wishlistFit.ts`— invalida el caché. **Clientes actuales:** si el ICP menciona la empresa como cliente actual/pasado, el fit la marca `existing_client` (fit 0; en el caché va como prefijo `[CLIENTE_ACTUAL]` de la razón) y `excludeDetectedClients()` la agrega a la Lista de exclusión del cliente (motivo "Ya es cliente (detectado en el ICP)") y a `excluded_companies`.
  - **Omitir** (migración `supabase/client_portal_v4_migration.sql`): botón en cada tarjeta → `client_omitted_companies`; no vuelve a aparecer en búsquedas ni recomendaciones (`getClientExclusions`). A diferencia de la lista de exclusión NO se copia a `excluded_companies`. Pestaña "Empresas omitidas" para restaurar.
  - **Costo IA del fit** (Sonnet, lotes de 15): ~US$0,002–0,003 por empresa puntuada (~US$0,06 por página de 24); cacheado por empresa + ICP, así que repetir búsquedas no vuelve a cobrar. Se ve en `/admin/uso-ia` como `portal_wishlist_fit`. Buscar en la base de Lemlist no consume créditos según su OpenAPI.
  - **Exclusión:** no vuelven a aparecer las empresas de `client_wishlist`, `excluded_companies` y `companies` del cliente, ni las cuentas que BullsEye ya trabaja con el cliente en HubSpot (universo del último sync de Pulso ABM: nombre + dominio `dom`; snapshots sin dominio se cruzan por id con `hubspot_company_pool` si vienen del HubSpot de BullsEye) — por dominio normalizado y nombre, `getClientExclusions()` en `lib/wishlist.ts`. Aplica también a las recomendaciones ya guardadas como pendientes.
  - **Al agregar:** fila en `client_wishlist` (status `new`) → se ve en **Empresas** (vista del equipo); los errores de envío a Lemlist se reintentan desde el Dashboard. El cliente puede quitarla solo mientras está `new`. Alertas: pendientes.
  - **Lemlist — endpoints** (OpenAPI oficial en GitHub: `l3mpire/mintlify` → `api-reference/openapi/v2.json`, accesible vía raw.githubusercontent.com): búsqueda `POST /database/companies` con `{filters:[{filterId, in:[], out:[]}], page, size}` — exige al menos un filtro y **`in` y `out` en cada filtro** (si falta, 400 "Parameter filters is invalid"); texto libre = filtro `keywordInCompany`; la IA usa `semanticSearch`. Campos de respuesta: `company_name`, `company_domain`, `company_linkedin_url`, `company_industry`/`company_subindustry`, `company_size`, `company_employee_count`, `revenue_bucket`, `company_headquarters_city`/`company_headquarters_country` (usar estos: `company_location` a veces no calza con la sede), `technologies` (en la respuesta real; la doc dice `techno_used_array`, viene con repetidos), `business_business_customer`… Dominios técnicos (cloudfront.net, amazonaws.com…) se descartan. El portal usa por ahora filtros select / autocomplete / text (slider/static sin confirmar). Diagnóstico: "Probar con <cliente>" en Config. cliente → Base de empresas para la wishlist.
  - **Envío a Lemlist al agregar** (`lib/wishlistLemlist.ts`): `POST /companies?updateStrategy=fillEmptyOnly` (upsert por dominio/LinkedIn en el CRM Lemlist del cliente → `cpn_xxx`) → busca o crea la lista estática **"Wishlist BullsEye"** (`/companies/lists`) → `POST /companies/lists/{id}/entities`. Resultado en `lemlist_status` (ok / error / sin_key / pendiente) y `lemlist_error`; si sale bien el estado pasa a `in_lemlist`. Reintento manual desde Empresas solicitadas. No pasa por Clay.
  - **Contactos IA (prueba, migración `supabase/wishlist_contacts_migration.sql`, `lib/wishlistContacts.ts`):** en **Contactos → Contactos IA** (`components/portalAdmin/WishlistContactsTab.tsx`) prospección elige empresas de la wishlist y la app busca sus empleados en la base de personas de Lemlist del cliente (`POST /database/people`, sin créditos, cupo diario `limitation`). La empresa se identifica por `currentCompanyWebsiteUrl` → `currentCompanyLinkedInUrl` → `currentCompany` y se valida con la experiencia actual de cada persona. Empresas de más de 200 empleados: pre-filtro de seniority/área derivado del buyer persona (IA, cacheado en `client_persona_filters`); máx. 200 candidatos. La IA puntúa **cargos únicos**, no personas, entendiendo el contexto y la propuesta de valor (caché `persona_title_scores` por cliente + versión): una empresa grande no multiplica el costo. Fit ≥ 60, máx. 8 por empresa → `wishlist_contacts` `suggested`; con menos de 2 la empresa queda "Pocos contactos → Sales Navigator". Revisión humana: aprobar crea el contacto en el Lemlist del cliente (ligado a la empresa, lista "Contactos Wishlist BullsEye") y en el **HubSpot de BullsEye** (`lib/wishlistHubspot.ts`: empresa = registro del pool si vino de HubSpot, si no por dominio/nombre o se crea; contacto por LinkedIn con `bullseye_*`, owner del cliente y asociado; email/teléfono se agregan al llegar; botón de reintento si falla) y pide email + teléfono (`POST /enrich`, créditos del cliente; la pantalla consulta `GET /enrich/{id}` cada 20 s). **País:** la misma llamada del pre-filtro saca los países objetivo del ICP; a quien está fuera de ellos (según ubicación + país de Lemlist) se le restan 30 puntos de fit (sin ubicación no se castiga). Aprendizaje: las últimas 40 revisiones van como ejemplos al prompt y cada 10 revisiones se recalculan los cargos. **Dos fuentes:** además de Lemlist se leen los contactos asociados a la empresa en el **HubSpot de BullsEye** (empresa = `hubspot_company_id` / registro del pool / dominio / nombre; máx. 200, `lead_id = 'hs:<id>'`); vienen con email/teléfono, se fusionan con Lemlist por LinkedIn o nombre y se marcan "De nuestro HubSpot". Al aprobar uno que ya trae email y teléfono no se gastan créditos de enriquecimiento. **Automático:** el cron `/api/cron/wishlist-contacts` (cada 15 min) busca contactos de las empresas con `lemlist_status = ok` y `contacts_status = pending` (máx. 10 por corrida); también hay botón manual. **Pendiente:** asignar empresas a prospectores (Maestra) y cargar a campaña.
  - **Vista del equipo — Empresas y Contactos (prospección v2, migración `supabase/prospeccion_v2_migration.sql`):** `/empresas` usa el mismo componente del portal (`components/wishlist/WishlistWorkspace.tsx`) en **modo operador** para el cliente elegido: Recomendadas por IA, Buscar empresas, Pendientes de aprobación, Aprobadas para prospectar (wishlist aprobada + `companies` approved del flujo anterior), Rechazadas por el cliente, Descartadas y Lista de exclusión. Las APIs `/api/portal/*` de la wishlist aceptan a un usuario interno con `?client_id=` (`requireWishlistActor` en `lib/portalAuth.ts`; el cliente siempre usa su propio client_id). Lo que agrega el operador queda como **propuesta**: `client_wishlist.origin = 'bullseye'`, `status = 'proposed'`, sin Lemlist. El cliente la ve en su portal en "Propuestas de BullsEye" y aprueba (→ `new`, se envía a Lemlist y el cron busca contactos) o rechaza (→ `rejected_by_client` + motivo) vía `POST /api/portal/wishlist/[id]`. Sin respuesta queda pendiente. **Recomendaciones IA: solo el equipo** (la API responde 403 al cliente): el cliente ya no genera recomendaciones; su portal abre en "Propuestas de BullsEye" (aprobar/rechazar) y conserva Buscar empresas / solicitar una puntual. En Empresas el operador tiene "Proponer todas al cliente". `/contactos` = Contactos IA + "Contactos anteriores" (tabla `contacts`, solo lectura). Las pantallas viejas siguen en `/empresas/anterior` y `/contactos/anterior` (no se borró código ni datos: Campañas, Teléfonos y webhooks de Clay siguen usando `companies`/`contacts`).
  - Bonus pendiente (fase 3): recomendaciones por señales de llamadas, solo con llamadas del MISMO cliente.

---

## Estructura de carpetas

```
bullseye-abm-platform/
├── CLAUDE.md
├── REPLICATE.md
├── app/
│   ├── api/
│   │   ├── clay/
│   │   ├── companies/
│   │   ├── contacts/
│   │   ├── icp/
│   │   └── clientes/          ← (a crear)
│   ├── clientes/              ← (a crear — CRUD de clientes)
│   ├── configuracion/
│   │   ├── icp/
│   │   └── cliente/           ← (a crear — config por cliente)
│   ├── empresas/
│   ├── contactos/
│   └── layout.tsx
├── components/
│   └── Sidebar.tsx
├── lib/
└── supabase/
    ├── schema.sql
    └── *_migration.sql
```
