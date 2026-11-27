# Plataforma ACTI · Fase 0: exploración y propuesta

> Informe previo a la implementación (27-nov-2026). No se escribió código de la aplicación.
> Referencias: `docs/acti/prompt_plataforma_acti.md` (encargo) y `docs/acti/mvp_red_negocios_acti.html` (prototipo navegable).
> **Espera aprobación antes de pasar a la Fase 1.**

---

## 1. Stack y arquitectura

| Tema | Hoy |
|---|---|
| Framework | Next.js 14 (App Router), TypeScript, React 18. Rutas API como route handlers en `app/api/**/route.ts`. |
| Base de datos | Supabase (PostgreSQL). El servidor consulta con **service role** (`supabaseAdmin()` en `lib/supabase.ts`). Toda tabla nueva lleva RLS activado. Migraciones SQL a mano en `supabase/*.sql` (se ejecutan en el SQL editor; no hay runner). |
| Configuración sin migración | Se usan filas jsonb en `sdr_cells_config` (`id = '<clave>'`) y la caché clave-valor `allo_response_cache`. |
| Autenticación | Supabase Auth + `middleware.ts` (`@supabase/ssr`). Dos tipos de usuario: **equipo interno** (sin rol, ve todo) y **cliente** (`app_metadata.role = "client"`, confinado a `/portal` y `/api/portal`). Permisos finos por listas de correos en código o en `sdr_cells_config` (líderes, Ingri, prospectoras…). No hay tabla de roles. |
| Despliegue | Vercel (producción en `portal.bullseye-abm.com`), crons en `vercel.json`, límite de 5 min por invocación. Peitho corre aparte en Railway. |
| Estilos y temas | Tailwind con tokens en `tailwind.config.ts` (sidebar `#251762`, acento `#62E0D8`, tipografía **Outfit**) y clases base en `app/globals.css` (`.card`, `.btn-primary`, `.input`…). Pulso ABM tiene su propio CSS acotado a `.ra-root` con claro/oscuro. **No hay un sistema de temas**: todo es un único tema global. |
| Pruebas | **No hay framework de pruebas** (solo `typecheck`, `lint` y `build`). |

## 2. Cómo se modela hoy un cliente

- **Tabla `clients`**: `id, name, slug, logo_url, is_active, status, onboarding_step, onboarding_completed_at, description, hubspot_owner_id`, campos de Clay y `feedback_token`.
- **Tabla `client_configs`** (1 a 1): Lemlist (campañas, API key propia), HubSpot (pipeline, owner, token propio), `peitho_enabled`.
- **Creación**: `/clientes/nuevo` → `POST /api/clients` (además crea carpeta y listas en HubSpot en segundo plano). **Edición**: onboarding `/clientes/[id]/onboarding` y **Configuración → Cliente** (`PATCH /api/clients/[id]` + subrutas).
- **"Activo" lo define la Maestra IA** (Google Sheet, columna Status Cliente), no la app. De eso dependen Pulso ABM, el selector de clientes del menú, el Centro de prospección, Células SDR, Dashboard SDR y Respuestas Lemlist.
- **Quién lo accede**: el equipo interno ve todos los clientes. Los usuarios del cliente están en `client_users` (varios por cliente, se crean en Configuración → Cliente → Portal del cliente — accesos).
- **Ficha del Centro de prospección ↔ ICP de Sistema → ICP**: la ficha vive en `centro_docs` (colección `fichas`: perfil, industrias, zonas, cargos, exclusiones, contexto) y se vincula al cliente por `portalCliente` (id o slug) o por nombre. La ficha **lee** el ICP del portal y la IA de fit y Contactos IA usan la ficha como contexto extra. La alineación automática ficha ← ICP (`icpSync.ts`) está apagada. Desde el 19-nov-2026 el **ICP oficial es el del proyecto de Claude de cada cliente**; el portal lo copia.

## 3. Dónde vive cada pieza a reutilizar

| Pieza | Dónde | Qué recibe / devuelve | ¿Por cliente? |
|---|---|---|---|
| **ICP** | `lib/icpStore.ts` (`loadIcpContent`, `saveIcpContent`), `lib/icp-form.ts` (`IcpFormData`, 37 campos, `serializeIcpForm` / `deserializeIcpForm`), `getClientIcpText` en `lib/wishlist.ts` | Texto serializado con etiquetas `[Campo]`. Se guarda en `client_ai_context` (`file_type = 'icp'`) o, en modo por industria, en `icp_industry_sections`. | Sí (`clientId`, opcional `industryId`). |
| **Buyer persona** | **No es una entidad aparte**: es la sección 4 del ICP (cargos decisores, influenciadores, a evitar, departamentos, seniority, perfil psicográfico). Derivados: `persona_title_scores` (caché de puntaje por cargo) y `client_persona_filters`. | Igual que el ICP. Un buyer persona por ICP (o por industria). | Sí. |
| **Motor de recomendaciones IA** | `lib/wishlistRecommendations.ts` → `runRecommendationRound(db, clientId, { reset })` | Traduce el ICP a filtros (`icpToUnifiedFilters`), busca en la base unificada, puntúa y guarda en `client_recommendations` las de fit ≥ 60 (pendientes). Cursor en `client_reco_state`. | Sí. **Ojo:** la API `/api/portal/wishlist/recommendations` responde 403 a usuarios cliente (decisión de BullsEye: las recomendaciones las prepara el equipo). |
| **Fit de empresa** | `lib/wishlistFit.ts` → `scoreCompanies(db, { clientId, icpText, source, candidates })` | `Map<key, { fit_score, fit_reason, existing_client }>`. Caché en `company_fit_scores` por hash del ICP. ~US$0,002–0,003 por empresa. | Sí. |
| **Fit de cargo / Contactos IA** | `lib/wishlistContacts.ts` → `scoreTitlesForClient`, `searchWishlistContacts`, `approveWishlistContact` | Puntaje por cargo único; búsqueda de personas en Lemlist + HubSpot de BullsEye. Devuelve **nombres, LinkedIn, correos y teléfonos** (no puede llegar al socio). | Sí. |
| **Base de empresas** | `hubspot_company_pool` (copia de HubSpot, lista cerrada de propiedades) + base de Lemlist con la key propia del cliente. `lib/unifiedSearch.ts` (`runUnifiedSearch`, `buildFilterCatalog`), `lib/unifiedFilterDefs.ts`, RPC `search_hubspot_pool`. | Tarjetas paginadas. Hoy **no** hay conteos por opción ni filtros de "señales de compra" o "fuente"; los filtros de área / nivel / cargo son de personas, no de empresas. | Exclusiones por cliente (`getClientExclusions`). |
| **Flujo de prospección (solicitudes)** | `client_wishlist` (`proposed → new → in_lemlist → in_progress → contacts_found`, `rejected_by_client`, `discarded`) + `contacts_status` + `manual_status` + lote en `snapshot.batch`; Contactos IA; luego HubSpot ("Status de la asignación - <cliente>") que lee Pulso ABM. Cron `/api/cron/wishlist-contacts`: toma empresas con `lemlist_status = ok`, **orden FIFO por `created_at`**, 10 por corrida. | | Sí. |
| **Reuniones** | Tabla `meetings`, **sincronizada desde la planilla "API Reuniones"** (`lib/syncMeetings.ts`): `realizado` Si / No / Reagendar / Pendiente, `client_id`, `cliente_nombre`, hora, origen, notas. | | Sí (`client_id`). |
| **Feedback de reunión** | `meeting_feedback` (1 por reunión: calificación 1–10, empresa/contacto calificado, propuesta comercial, comentarios), `/api/portal/feedback`, `components/feedback/ClientFeedbackBoard.tsx`; `lib/peithoFeedback.ts` evita pedirlo si Peitho ya la analizó. | | Sí. |
| **Peitho** | Backend externo (Railway). Proxy `lib/peithoIntegration.ts` (`forwardToPeitho`, lista cerrada `RULES`) vía `/api/portal/peitho/proxy/[...path]`; vistas portadas en `components/peitho/app/*` (`PeithoWorkspace`, `MeetingDetail`, `AnalysisView`…). Requiere `client_configs.peitho_enabled` y que Peitho reconozca al cliente por el ID de la Maestra, el slug o el nombre. Ya existe el filtro "Sales manager" (solo sus reuniones). | | Sí. |

## 4. ¿Existe un portal para el cliente final?

**Sí.** `/portal` con login propio (`client_users` + rol `client`), barra lateral (`components/portal/PortalShell.tsx`), Inicio, vistas de Pulso ABM, wishlist (pendientes de aprobación, subir listado, aprobadas, trabajadas, exclusiones), formulario de ICP como propuesta y Peitho. La autorización toma siempre el `client_id` de la sesión (`requirePortalUser`). El socio ACTI puede entrar con esta misma infraestructura de usuarios: no hay que construir un login nuevo, solo otra experiencia (shell, navegación, módulos y tema).

**Ojo con la privacidad:** varias vistas del portal actual muestran nombres de contactos (Pulso → Seguimientos, Detalle de reuniones y la transcripción de Peitho). La experiencia ACTI **no** debe reutilizar esas vistas tal cual.

## 5. Propuesta de diseño

### 5.1 Marca ACTI por cliente

Una **tabla nueva** `acti_members` (1 fila por cliente ACTI) en vez de columnas en `clients`: la tabla `clients` y sus `select` no cambian.

```
acti_members: client_id (PK, FK clients), plan (freemium|conecta|crece|acelera),
  status (activo|en_prueba|pausado|baja), joined_at, trial_start, trial_end,
  kam_email, notes, created_at, updated_at
```

Cliente ACTI = tiene fila en `acti_members`. Sin fila, todo sigue igual.

### 5.2 Configuración editable (planes y parámetros)

Tabla `acti_config` (clave → jsonb, con historial de quién cambió y cuándo): los 4 planes (base UF, UF por reunión, reuniones garantizadas, tope de empresas, búsquedas IA al mes) y los parámetros (conversión 15%, 6 intentos en 10 días hábiles, ventana Freemium 90 días, revenue share 10%, IVA 19%, cobro por reunión realizada o agendada). La edita el equipo desde una pantalla interna. **Los montos de cada mes se guardan "congelados"** al cerrar el mes, así un cambio de precio no reescribe la facturación pasada.

### 5.3 Rutas

| Quién | Rutas | Notas |
|---|---|---|
| Socio | `/acti/*` (Inicio, perfil, ICP, buscar, solicitudes, reuniones, eventos, facturación, mi plan) y `/api/acti/*` | Layout propio con tema ACTI. Cada API toma el `client_id` de la sesión (`requirePortalUser`) y además exige fila en `acti_members`. |
| Equipo BullsEye | `/acti-equipo/*` (socios y avance vs garantía, solicitudes con plan/prioridad/alta demanda, eventos, configuración de planes, facturación y revenue share) + etiqueta y filtro "ACTI" en `/clientes` y una sección "Socio ACTI" en la creación y en Configuración → Cliente | Ítem nuevo en el menú lateral. |
| Administrador ACTI | `/acti-gremio/*` + `/api/acti-gremio/*` | Rol nuevo `app_metadata.role = "acti_admin"`, solo datos agregados. |

### 5.4 Modelo de datos nuevo (todo en tablas nuevas, con RLS)

- `acti_members`, `acti_config` (arriba).
- `acti_requests`: cada empresa que el socio pide → enlace a la fila real de `client_wishlist` (`wishlist_id`), mes, cargos que pidió (tipos, no personas), prioridad por plan, estado de cola ACTI, reemplazo (`replaced_by`), `no_response_at`. El estado que ve el socio se **deriva** del flujo real (wishlist + contactos + status de HubSpot de Pulso + `meetings`), no se guarda en paralelo.
- `acti_usage`: búsquedas IA por mes (para el tope del plan).
- Alta demanda: vista o cálculo sobre `acti_requests` (misma empresa por dominio / nombre, pedida por más de un socio en el mes).
- `acti_meeting_feedback`: complemento de `meeting_feedback` solo para lo que no existe ("confirmo que se realizó"). La calificación y si es oportunidad se guardan en `meeting_feedback` (el mismo objeto que ya usan Pulso y la facturación).
- Eventos: `acti_events`, `acti_event_news`, `acti_event_registrations`, `acti_event_slots`, `acti_event_meetings` (ronda de negocios; no consume cupo).
- `acti_billing_months`: cierre mensual por socio (plan, base, realizadas, no-shows, variable, IVA, total UF, valor UF del día, total CLP, revenue share ACTI) + `acti_plan_change_requests` + `acti_news`.

### 5.5 Capa de integración (`lib/acti/`)

Servicios ACTI que **llaman** a lo existente sin modificarlo:

- `membership.ts` (`getActiMember`, `requireActiUser`), `plans.ts` (lee la configuración y calcula límites).
- `icp.ts` → `loadIcpContent` / `saveIcpContent` / `deserializeIcpForm` (mismo ICP, no una copia).
- `reco.ts` → `runRecommendationRound` (cuenta la búsqueda, aplica el tope del plan y baja la prioridad de las de alta demanda). Es una ruta nueva; la API actual que responde 403 al cliente no se toca.
- `search.ts` → `runUnifiedSearch` + `scoreCompanies`. Los conteos por opción salen de una **RPC nueva** de solo lectura sobre `hubspot_company_pool`.
- `requests.ts` → inserta en `client_wishlist` con la misma lógica de la ruta del portal (refactor mínimo: extraer la inserción a una función compartida sin cambiar su comportamiento, o duplicar solo la inserción en la capa ACTI).
- `meetings.ts` → lee `meetings` + `meeting_feedback` del socio y **quita** nombre, teléfono y correo del prospecto antes de responder.
- `peitho.ts` → `forwardToPeitho` con la misma lista de rutas, a través de una ruta proxy ACTI.
- `billing.ts` → funciones puras (base + variable + no-shows + IVA + revenue share), con pruebas.
- `privacy.ts` → sanitizadores únicos por los que pasan todas las respuestas `/api/acti/*`.

### 5.6 Tema ACTI

`components/acti/acti.css` acotado a `.acti-root` (variables CSS: `#251762`, `#62E0D8`, `#1FA39B`, Montserrat, base 14 px, títulos 24 px, negrita solo en títulos y números) con claro y oscuro, como en el prototipo. Montserrat se carga solo en el layout ACTI. **No se tocan** `tailwind.config.ts` ni `globals.css`. Logo BullsEye: `/brand/bullseye-logo-white.png`; espacio reservado para el logo de ACTI.

### 5.7 Riesgos de regresión y cómo se evitan

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | **`middleware.ts` afecta a todos.** Para que un usuario cliente entre a `/acti` y exista el rol `acti_admin` hay que tocarlo. | Cambio mínimo y aditivo: una función nueva `isActiRoute` y una rama nueva para `acti_admin`; la rama de `client` solo agrega `/acti` a lo permitido. Pruebas del middleware con usuarios interno, cliente normal, cliente ACTI y anónimo. **Necesito tu aprobación** (regla 4). Alternativa sin tocar el middleware: montar todo bajo `/portal/acti`, pero igual habría que tocar `app/portal/layout.tsx` para no mostrar el shell del portal. |
| R2 | `app/portal/layout.tsx`: un socio ACTI que entra a `/portal` debe ir a `/acti`. | Una sola rama: si el cliente tiene fila en `acti_members`, redirige. Sin fila, idéntico a hoy. **Requiere aprobación.** |
| R3 | **ICP**: hoy el cliente no edita directo (deja una propuesta que BullsEye aprueba) y el ICP oficial es el del proyecto de Claude. El encargo pide que el socio lo edite. | Ver pregunta 1. Los campos nuevos (señales de compra, regulaciones, ticket, ciclo…) se agregan como opcionales: el serializador omite los vacíos, así que el texto y el hash del ICP de los clientes actuales **no cambian** y la caché de fit no se invalida. |
| R4 | Las recomendaciones al cliente están bloqueadas a propósito (403). | Ruta ACTI nueva que llama a la librería; la API actual queda igual. |
| R5 | **Prioridad en la cola**: el cron de contactos es FIFO para todos. Cambiar su orden afecta a todos los clientes. | La capa ACTI retiene las solicitudes en `acti_requests` y las libera a `client_wishlist` por prioridad y cupo. El cron no se toca. |
| R6 | **El flujo exige Lemlist propio** (`lemlist_status = ok` para buscar contactos) y propiedades por cliente en HubSpot ("Status de la asignación - X", "SDR - X", "Wish List - X"). Con más de 100 socios eso no escala igual. | Ver preguntas 3 y 4. |
| R7 | **Maestra IA**: si los socios entran a la Maestra como "Activo", aparecen en Células SDR, Dashboard SDR, reportes, crons de Pulso, inteligencia semanal y recomendaciones del domingo (más costo y tiempo de cron). Si no entran, Pulso y Peitho no los reconocen. | Ver pregunta 2. Sugerencia: excluir a los socios ACTI de los crons automáticos con un chequeo en la capa ACTI y no en los crons, o con un estado distinto en la Maestra. |
| R8 | **Privacidad**: Contactos IA, Pulso y Peitho traen datos personales. | Las APIs ACTI no reutilizan vistas del portal; todo pasa por `privacy.ts`, con pruebas que fallan si una respuesta trae nombres, correos o teléfonos de prospectos. |
| R9 | Páginas compartidas que se tocan: `/clientes` (etiqueta y filtro), `/clientes/nuevo` y Configuración → Cliente (sección ACTI), `Sidebar.tsx` (ítem nuevo). | Componentes nuevos en `components/acti/` insertados con una línea; sin fila ACTI no renderizan nada. |
| R10 | No hay pruebas automatizadas. | Ver pregunta 10. |

## 6. Preguntas

1. **ICP del socio**: ¿lo edita directo (como pide el encargo) o deja una propuesta que BullsEye aprueba (como hoy el portal)? ¿Para los socios ACTI se mantiene la regla de que el ICP oficial vive en el proyecto de Claude, o el formulario ACTI pasa a ser la fuente?
2. **Maestra IA**: ¿los socios ACTI entran a la Maestra? ¿Con qué estado? ¿Deben aparecer en Células SDR, Dashboard SDR y Reporte SDR, y entrar a los crons automáticos (Pulso, inteligencia semanal, recomendaciones del domingo)?
3. **Lemlist**: ¿cada socio tendrá su propia cuenta y key de Lemlist o BullsEye opera con una cuenta compartida (por ejemplo, una campaña ACTI)? Hoy sin key propia no se buscan contactos ni se usa la base de Lemlist.
4. **HubSpot**: ¿los socios se trabajan en el HubSpot de BullsEye con las propiedades por cliente de siempre (una "Status de la asignación - <socio>" por socio) o con un esquema compartido para ACTI?
5. **Buyer persona**: hoy hay uno por ICP (o por industria). ¿El socio necesita varios perfiles (por ejemplo, decisor TI y decisor finanzas) en el mismo ICP?
6. **Contacto tras agendar**: para asistir a la reunión el socio necesita saber con quién se junta. ¿Desde "reunión agendada" ve el nombre y cargo del contacto (y la transcripción de Peitho), o tampoco?
7. **Búsqueda con IA**: ¿qué cuenta como una búsqueda para el tope de Freemium? Propuesta: cada "Buscar con IA" que trae una tanda de hasta 30 empresas evaluadas.
8. **Valor de la UF**: ¿de dónde se toma? Propuesta: API pública de mindicador.cl o CMF, del día de cierre del mes, editable a mano.
9. **Roles nuevos**: ¿quién del equipo puede editar planes y cargar eventos? ¿Lo hace cualquier interno o una lista de correos? ¿Cuántos usuarios "Administrador ACTI" habrá y quién los crea?
10. **Pruebas**: ¿apruebas agregar `vitest` como dependencia de desarrollo (para lógica pura: límites, facturación, privacidad, middleware) y un script de humo con Playwright para la no regresión de un cliente normal contra un deploy de preview?
11. **Cambios en archivos compartidos**: ¿apruebas los toques mínimos a `middleware.ts`, `app/portal/layout.tsx`, `Sidebar.tsx`, `/clientes`, `/clientes/nuevo` y Configuración → Cliente descritos en R1, R2 y R9?
12. **Eventos**: ¿los asistentes externos de una ronda de negocios (no socios) confirman reuniones por un link con token (como `/encuesta/[token]`) o solo agendan socios con socios?
13. **Mi perfil comercial**: lo que ya existe en el portal es la sección "Propuesta de valor", "Outreach" y "Clientes de referencia" del ICP más el Contexto IA. ¿Lo armamos sobre esos campos del ICP (más servicios, casos de éxito y "qué no ofrecer" como campos opcionales) o como un documento aparte que se suma al Contexto IA?

## 7. Plan por fases (sin cambios de alcance)

Igual al del encargo. Cada fase en su rama y PR, con datos demo de 3 socios (uno por tipo de plan, incluido Freemium) y una nota de prueba. La Fase 1 incluiría las migraciones `acti_members` y `acti_config`, la sección ACTI en el cliente, el tema, el shell, la navegación y el Inicio con datos reales de `meetings`.

---

## 8. Decisiones (respuestas del 27-nov-2026)

1. **ICP**: el socio ACTI lo edita directo y el cambio se ve al instante en Sistema → ICP. Solo para clientes ACTI; el resto sigue con propuesta y aprobación.
2. **Maestra IA**: los socios entran como **Activo** (para tener toda su información). Pulso ABM se muestra **por plan**: en los planes básicos, vistas básicas; en los más altos, todo lo que ve un cliente directo de BullsEye. La lista de vistas por plan va en la configuración editable de planes.
3. **Lemlist**: se usa la **cuenta de BullsEye** para ACTI (y para todos los clientes). Una cuenta propia solo si un cliente no ACTI paga un fee adicional.
4. **HubSpot → portal**: desde enero la gestión vive en el portal (propiedades, status y llamadas con Allo); HubSpot queda como respaldo. ACTI se construye así: **el estado de cada cuenta vive en tablas del portal** y se refleja en HubSpot mientras dure la transición. Coordinar con el nuevo dashboard SDR de Ingri.
5. **Buyer persona**: **varios por socio**.
6. **Contacto**: desde "reunión agendada" el socio ve nombre, cargo, **correo y teléfono** de ese contacto, y Peitho completo después de la reunión. Antes de eso, solo empresas y tipos de cargo.
7. **Búsquedas con IA**: el límite se define por las empresas necesarias para la meta de reuniones del plan, no por un número fijo de búsquedas. La IA recomienda **primero desde nuestra base** (pool de HubSpot) y **prioriza empresas con contactos con teléfono** (Base de contactos), porque su gestión es más barata.
8. **UF**: mindicador.cl, último día del mes, editable a mano antes del cierre.
9. **Permisos**:
   - Editar planes y precios: amadriz@, ihincapie@, jkarmy@.
   - Cargar eventos: administradores ACTI + jguajardo@, iarrieta@, ccontador@.
   - Crear administradores ACTI (desde Accesos): amadriz@, ihincapie@, ccontador@, jguajardo@, jkarmy@.
   - ACTI puede tener administradores ilimitados, que ven todo lo gestionado con las cuentas ACTI.
10. **Pruebas**: aprobado `vitest` (desarrollo) + prueba rápida con Playwright.
11. **Archivos compartidos**: aprobados los cambios mínimos (middleware, layout del portal, menú, /clientes, /clientes/nuevo, Configuración → Cliente).
12. **Rondas de negocios**: solo entre socios, dentro de la plataforma.
13. **Mi perfil comercial**: sobre los campos del ICP, más servicios, casos de éxito y "qué no ofrecer" como campos opcionales.
