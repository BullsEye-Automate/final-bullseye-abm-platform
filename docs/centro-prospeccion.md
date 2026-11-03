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

URL: `https://portal.bullseye-abm.com/api/centro/mcp/<CENTRO_MCP_SECRET>`
(variable de Vercel, mínimo 32 caracteres). Herramientas equivalentes a
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
