# Centro de prospección (`/centro-prospeccion`)

Migración del artifact de claude.ai **"Centro de prospección BullsEye"**
(`https://claude.ai/artifact/QhKSHM7hT3peqouVDZfVMN`) al portal. Mismas vistas
y mismo comportamiento: Resumen del equipo, Comparación 2025 vs 2026, Clientes,
Cuentas aprobadas, Plan semanal (Mi semana), Solicitudes de investigación,
Registro de avance, Efectividad de prospección, Mantenimiento y Cruce de
contactos HubSpot × Lemlist.

Es un módulo **nuevo y aislado**: no modifica ninguna pantalla, tabla ni API
existente del portal. Los únicos cambios fuera de sus carpetas son una entrada
en el menú (Prospección → Centro de prospección, `components/Sidebar.tsx`) y
la excepción del conector MCP en `middleware.ts`.

## Cómo está armado

| Pieza | Dónde |
|---|---|
| Página | `app/centro-prospeccion/page.tsx` |
| Lógica original del artifact | `components/centroProspeccion/legacy/app.js` (generado) |
| Marcado y estilos originales | `legacy/markup.ts`, `legacy/base.css` (generados, con alcance `.cp-root`) |
| Tema del portal (Outfit, morado, tarjetas, menú interno como Células SDR) | `legacy/theme.css` |
| Adaptador de datos (reemplaza `window.claude`) | `components/centroProspeccion/portalClaude.ts` |
| Chart.js, ExcelJS, PapaParse | desde cdnjs, mismas versiones del artifact (`loadLibs.ts`); no se agregaron dependencias |
| APIs (con sesión) | `app/api/centro/{me,sync,doc,write,profiles,assets,import}` |
| Conector MCP (tareas programadas y skill) | `app/api/centro/mcp/[secret]` |
| Datos | `lib/centroProspeccion/store.ts`, migración `supabase/20261103_centro_prospeccion_migration.sql` |
| Importación del respaldo | `/centro-prospeccion/importar` (solo administrador) |

Los archivos `legacy/*` se regeneran desde el HTML del artifact con
`python3 scripts/centro-prospeccion/build_legacy.py <index.html> components/centroProspeccion/legacy`.
El script falla si algún reemplazo no calza exactamente, para no romper la lógica.

## Datos

Tabla `centro_docs` = colección + id + JSON + versión (réplica 1:1 de la base
del artifact). Colecciones: `clientes`, `solicitudes`, `registro`, `plan`,
`cuentas`, `mantenimiento`, `docs_cliente`, `historial`, `vinculos`, `config`,
`adjuntos`, `resultados`. Cada escritura queda en `centro_docs_log` (quién,
desde dónde: portal / automation / migration). Archivos en el bucket privado
`centro-prospeccion` (tabla `centro_assets`, mismo id de 32 hex del artifact).

La página descarga las colecciones al abrir y luego pide cambios cada 15 s
(y al volver a la pestaña). Igual que el artifact, la página escribe sin
versión (la última escritura gana); el conector MCP exige `if_version`.

## Accesos

- Todo usuario del equipo con sesión del portal entra (los usuarios cliente no).
  Las prospectoras usan su correo corporativo y su contraseña de siempre.
- Administrador del Centro (equivale al dueño del artifact): `CENTRO_OWNER_EMAILS`
  en `lib/centroProspeccion/access.ts` (amadriz@). Ve todas las secciones y su
  vista inicial es el Resumen; el resto entra en "Mi semana".
- Líderes (aprueban plan y solicitudes de consumo alto): lista `LIDERES` dentro
  de la lógica original (amadriz@, ihincapie@).
- Identidad: quien ya tenía id de claude.ai (`vinculos`) lo conserva para que sus
  registros antiguos sigan siendo suyos; quien entra por primera vez usa su correo.

## Conector MCP

URL: `https://portal.bullseye-abm.com/api/centro/mcp/<clave>`. La clave la genera la app y queda en
`centro_settings` (o la variable de Vercel `CENTRO_MCP_SECRET` si existe); el administrador copia la URL en `/centro-prospeccion/importar`. Herramientas equivalentes a
ArtifactData: `centro_get`, `centro_list`, `centro_query`, `centro_set`,
`centro_update`, `centro_delete`, `centro_batch` y `centro_asset_url` (link de
1 h a un archivo de `docs_cliente`, para leer brochures en PDF).

Equivalencias para los prompts de las tareas programadas:

| Antes (artifact) | Ahora (conector) |
|---|---|
| ArtifactData `get` | `centro_get` |
| ArtifactData `list` | `centro_list` |
| ArtifactData `query` (where / order_by) | `centro_query` |
| ArtifactData `set` / `update` / `delete` | `centro_set` / `centro_update` / `centro_delete` |
| ArtifactData `batch` | `centro_batch` |
| Artifact `read` con `path = assetId` | `centro_asset_url` + WebFetch |

Tareas que lo usan: Cola de investigación (cada hora), Efectividad semanal
(lunes), Recordatorio a prospectoras (jueves), Propuesta semanal de
distribución (viernes), Feriados 2027 (1-dic) y el skill
`cargar-ficha-centro-prospeccion`.

## Unión con Empresas y Contactos (fase 1, nov-2026)

Decisión de la líder de prospección (amadriz@), con visto bueno de José Antonio
Karmy: la IA hace el volumen y las prospectoras el criterio. La fase 1 solo
agrega; no cambia el flujo de Empresas, Contactos, Dashboard ni Búsqueda manual.

- **Vínculo ficha ↔ cliente del portal** (`lib/centroProspeccion/portalLink.ts`):
  campo `portalCliente` de la ficha (id o slug del cliente del portal); si no
  está, nombre compacto (igual > prefijo; un empate deja la ficha sin vínculo).
  Fijado a mano para `ki` → `ki-technologies`, `otic-cchc` → `ccch` y
  `umine-agente` → `umine-agentes`. Nisum Chile / Colombia / Perú van al mismo
  cliente "nisum". Fichas en estado «Pausado» no se usan en la IA.
- **ICP del portal dentro de la ficha**: `GET /api/centro/icp?clienteId=` (solo
  lectura, `getClientIcpText`). Panel plegable bajo los campos de la ficha.
- **La IA lee la ficha** (`lib/centroProspeccion/fichaContext.ts`): el fit de
  empresas (`scoreCompanies` en `lib/wishlistFit.ts`) recibe exclusiones,
  industrias, zonas, perfil y un extracto del contexto; el puntaje de cargos
  (`scoreTitles` en `lib/wishlistContacts.ts`) recibe cargos, exclusiones y el
  extracto. El ICP manda si se contradicen; las exclusiones de la ficha dan fit
  0 sin marcar `existing_client`. No entra a ningún hash de caché: no reinicia
  recomendaciones ni fits ya calculados; lo usan las evaluaciones nuevas.
  Apagar: variable de Vercel `CENTRO_FICHA_EN_IA=off`. Si la ficha no se puede
  leer, la IA sigue sin ella.
- **Avance automático en el plan**: `GET /api/centro/portal-auto?semana=` cuenta
  por cliente + correo, en la semana de Chile: contactos revisados / aprobados
  (`wishlist_contacts.reviewed_by_email`), agregados a mano (`origin = manual`,
  `added_by_email`), empresas propuestas (`client_wishlist.origin = bullseye`,
  `requested_by_email`) y búsquedas manuales cerradas (`manual_status` done /
  no_contacts, `manual_by_email`). Columna «En el portal» del Plan semanal y
  línea en «Mi semana». No reemplaza el registro manual (sigue igual).
- **Enganches en el código del Centro**: `build_legacy.py` agrega marcadores
  vacíos (`data-cp-icp`, `data-cp-auto`) que completa
  `components/centroProspeccion/portalEnhancer.ts`. El HTML del artifact
  (borrado de claude.ai el 4-nov-2026) quedó en
  `scripts/centro-prospeccion/artifact-source.html` para poder regenerar:
  `python3 scripts/centro-prospeccion/build_legacy.py scripts/centro-prospeccion/artifact-source.html components/centroProspeccion/legacy`.
## Fases 2 y 3 (nov-2026)

Mismo principio: solo agrega y lee; lo único que escribe es el botón de pasar
cuentas, que usa el flujo de un listado subido por el cliente.

- **Un solo tablero** (Resumen del Centro, arriba): `GET /api/centro/portal-summary?days=30`
  reutiliza `computeAllClientsDashboard` del Dashboard (mismas cifras) + contactos
  IA por revisar (`wishlist_contacts.status = suggested`). KPIs y tabla por
  cliente con botones a Contactos / Empresas (abren el portal con el cliente
  elegido vía `localStorage.bullseye_client_id`). Con filtro de cliente muestra solo ese.
- **Una bandeja** (Solicitudes del Centro, arriba): pedidos de clientes desde el
  portal en 30 días (empresas pedidas o subidas en listado, `origin = client`, y
  propuestas rechazadas con su motivo).
- **Cola en el plan**: en «Mi semana», bajo cada cliente, contactos por revisar y
  búsquedas manuales pendientes con enlace directo.
- **Metas por resultado** (Plan semanal, al final): contactos aprobados (y % de
  los revisados), agregados a mano, búsquedas manuales cerradas y empresas
  propuestas de la semana, total y por prospectora. Métricas por defecto
  elegidas sin confirmación de la líder; ajustar si cambia el criterio.
- **Un universo de empresas** (Cuentas del Centro, con un cliente elegido):
  `GET /api/centro/cuentas-portal?clienteId=` cruza las cuentas aprobadas («Sí»)
  con la wishlist del portal (dominio o nombre). `POST` (solo administrador del
  Centro, botón con doble confirmación) pasa las que faltan en tandas de 20:
  `client_wishlist` origin client, status new, source manual,
  `source_ref = centro:<id>`, snapshot con lista / prioridad / motivos, envío a su
  Lemlist (`pushWishlistItemToLemlist`); el cron de contactos las toma. No toca
  las cuentas del Centro.
- **Ficha**: tarjeta «En el portal» (empresas en prospección, por revisar,
  búsqueda manual, esperando al cliente, aprobación 30 días).
- Marcadores nuevos en `build_legacy.py`: `data-cp-view` (uno por vista, lo ubica
  `portalSections.ts`), `data-cp-ficha` y `data-cp-queue`.
- **Pendiente de decisión**: retirar del menú las pantallas duplicadas (Dashboard,
  Búsqueda manual) cuando el equipo trabaje desde el Centro; hoy siguen igual.

## Fusión en un solo lugar (nov-2026)

Decisión de la líder de prospección: todo el trabajo de prospección en el
Centro. Sin tocar el código de las pantallas del motor de prospección.

- **Menú lateral**: Prospección queda con un solo ítem, «Centro de
  prospección» (`components/Sidebar.tsx`, `also` marca activo el ítem también
  en las rutas antiguas). `/dashboard`, `/empresas`, `/contactos` y
  `/busqueda-manual` siguen funcionando como rutas.
- **Pestañas dentro del Centro** (`components/centroProspeccion/CentroTabs.tsx`):
  Centro · Empresas · Contactos · Búsqueda manual · Dashboard. Las cuatro
  últimas son las páginas de esas rutas importadas tal cual (`next/dynamic`),
  con el selector de cliente del menú lateral. El Centro (código legacy) queda
  montado y oculto mientras se usa otra pestaña. `?tab=empresas|contactos|busqueda|dashboard`.
- **Botones del Centro** (tablero, ficha, cola de «Mi semana», bandeja) cambian
  de pestaña con el cliente elegido (evento `cp:go` que atiende
  `app/centro-prospeccion/page.tsx`); fuera del Centro navegan a la ruta.


## Motor automático: inteligencia de la semana (nov-2026)

Fusión del motor de prospección de José Antonio (Empresas → Recomendadas por IA, Contactos IA, señales de llamadas de Allo) con el Centro, siguiendo sus mismos patrones (cron con una invocación por cliente, IA con herramienta forzada y `logAiUsage`, cachés en `allo_response_cache`). Migración: `supabase/20261106_centro_inteligencia_migration.sql`.

| Cuándo | Qué | Dónde |
|---|---|---|
| Siempre | Checklist de preparación por cliente (requisitos: Maestra activo, ficha, ICP > 200 caracteres, Pulso sincronizado; opcionales: Pulso ≤ 2 días, key y campaña de Lemlist, números de Allo) | Centro → Clientes · `lib/centroProspeccion/intel/readiness.ts` |
| Viernes 12:00 / 13:30 Chile | Inteligencia de la semana por cliente listo | `/api/cron/centro-inteligencia` → `run.ts` + `analyze.ts` |
| Al decidir | Aprobar = se anota en la ficha (campo propuesto, con semana y quién aprobó); si toca el ICP → correo al KAM | `/api/centro/inteligencia/decision` |
| Domingo 20:00 Chile | Recomendaciones IA de empresas en la cantidad sugerida | `/api/cron/centro-recomendaciones` → `lib/wishlistRecommendations.ts` |
| L-V 8:30 Chile | Alertas (KAM, prospectoras, líder) y recordatorios a SDR + líder de célula | `/api/cron/centro-alertas` → `automations.ts` |
| Lunes 8:30 Chile | Plan de la semana (prospectoras + líder) y costo de IA (líder) | mismo cron |

Fuentes de la inteligencia (todas de solo lectura): último Pulso ABM (`numbers.ts`), llamadas y notas de HubSpot de 7 días asociadas a empresas/contactos del cliente (`hubspotFeed.ts`; se cachea el feed del HubSpot de BullsEye 2 días; HubSpot propio del cliente con su token), minutas diio cuyo texto nombra al cliente, `allo_call_signals` de 14 días, rechazos de la wishlist de 30 días, feedback y estado de reuniones de 30 días, ficha vigente e ICP. Se quitan correos y teléfonos antes de enviar a la IA (`scrubPii`).

Arranque: los correos del Centro no salen antes del lunes 16-nov-2026 (`CENTRO_ALERTS_START`, se puede cambiar en Vercel); la primera inteligencia corre el viernes 13.

Pruebas manuales (con `CRON_SECRET`): `?client_id=<uuid>` en cada cron; `centro-alertas?force=1&solo=alertas|lunes|costo`. Desde la ficha, la administración del Centro puede "Volver a generar" (mantiene las decisiones tomadas). Costo estimado: ~US$0,05–0,15 por cliente por semana en la inteligencia más las recomendaciones (ver el correo de costo de los lunes).
