# ACTI · Fase 2 — cómo probarla

**Incluye:** Mi ICP y Mi perfil comercial (el mismo ICP de Sistema → ICP, edición directa del socio, varias buyer personas), Buscar cuentas (Recomendadas por IA, Base de empresas con filtros y conteos, Guardadas), Mis solicitudes (cola ACTI por prioridad de plan → flujo real de prospección) y los límites de cada plan.

## Antes de probar

1. Correr `supabase/20261128_acti_fase2_migration.sql` (requiere la de la Fase 1). Solo tablas y funciones nuevas: `acti_company_people`, `acti_saved_companies`, `acti_requests`, `acti_pool_search`, `acti_pool_facets` y auxiliares `acti_*`. Probada en Postgres (PGlite) con datos de ejemplo e idempotente.
2. Correr una vez `GET /api/cron/acti-perfiles` (con `CRON_SECRET`) para llenar los perfiles por empresa desde la Base de contactos. Luego corre solo todos los días a las 10:35 UTC.
3. La cola ACTI se libera cada 15 min en horario hábil (`/api/cron/acti-cola`, 25 solicitudes por corrida, editable en `queueReleasePerRun`).

## Socio

- **Mi ICP** (`/acti/icp`): empresa objetivo, regulaciones, señales de compra, buyer persona principal + hasta 6 adicionales, clientes de referencia, ticket y ciclo. Al guardar cambia el ICP de Sistema → ICP al instante (queda un respaldo del anterior en `allo_response_cache`, `icp_respaldo:<cliente>:general:<fecha>`). Si el ICP del cliente está "por industria", el socio no lo edita y se le avisa.
- **Mi perfil comercial** (`/acti/perfil`): propuesta de valor, servicios, problemas, resultados, casos de éxito, diferenciadores, competidores, objeciones con respuesta y qué no ofrecer. Son campos del mismo ICP: los leen el fit, Contactos IA y el SDR.
- **Buscar cuentas** (`/acti/buscar`):
  - *Recomendadas por IA*: motor existente (`runRecommendationRound`) con el ICP del socio y la base de BullsEye. Orden: fit (tramos de 10 puntos) → empresas con perfiles con contacto directo (celular en la Base de contactos) → menor demanda. Acciones: Guardar, No me interesa (con motivo; sale de búsquedas y recomendaciones) y Quiero reunirme con ellos. "Buscar más con IA" solo si queda cupo y no hay demasiadas pendientes.
  - *Base de empresas*: filtros a la izquierda con conteos (industria, país, ciudad, tamaño, facturación, tecnologías, señal "con perfiles de contacto directo", área, nivel y cargo); listado paginado con el fit del motor actual (misma caché que Empresas). Primero las empresas con perfiles con celular.
  - *Guardadas*.
  - "¿No la encuentras? Pídela": solicitud manual (nombre + sitio web).
  - Cada empresa muestra los **tipos de cargo disponibles** (área / nivel, destacados los que calzan con el ICP) y si hay contacto directo. Nunca nombres ni datos de contacto.
- **Mis solicitudes** (`/acti/solicitudes`): tablero En cola / En research / En contacto / Reunión agendada / Sin respuesta, derivado del flujo real (`client_wishlist`, Contactos IA aprobados, planilla de reuniones). Se puede cancelar mientras está en cola.

## Reglas de plan

- Cupo: planes pagados = reuniones garantizadas ÷ conversión (10%) al mes; Freemium = 20 empresas o 2 reuniones en 90 días. Al llegar al tope, "Quiero reunirme" y "Buscar más con IA" se bloquean con un mensaje claro y la invitación a cambiar de plan.
- Prioridad: la cola ACTI se libera a la prospección por prioridad de plan (Acelera → Crece → Conecta → Freemium) y antigüedad. El orden de la cola de los demás clientes no cambia.
- Freemium no puede pedir en el mes una empresa que ya pidió un socio pagado. "Alta demanda" se muestra cuando otro socio pidió la misma empresa en el mes.

## Pendiente (necesita decisión o coordinación)

- **Lemlist**: la búsqueda de contactos del flujo actual exige la key de Lemlist propia del cliente. Para que las solicitudes ACTI avancen solas hay que decidir cómo usar la cuenta de BullsEye (ver nota en el PR).
- **HubSpot**: propiedades comunes ACTI ("Socio ACTI", "Status ACTI", "SDR ACTI") y estado de la cuenta en el portal, a coordinar con el Dashboard SDR de Ingri.
- **Reemplazo de cuentas sin respuesta** (6 intentos en 10 días hábiles) y **completar con IA** cuando el socio pide menos empresas que su cupo: dependen del estado de la cuenta en el portal (punto anterior).

## No regresión

- `npm test`: 39 pruebas. Entre ellas, el ICP de un cliente actual queda **idéntico byte a byte** (mismo texto y mismo hash de fit) con los campos nuevos, y una edición desde Sistema → ICP conserva lo que cargó el socio.
- `npx tsc --noEmit`: sin errores nuevos. `next build`: OK.
- Archivo compartido tocado: `lib/icp-form.ts` (campos opcionales nuevos; vacíos no se escriben). `vercel.json`: 2 crons nuevos.
