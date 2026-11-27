# ACTI · Fase 3 — cómo probarla

**Incluye:** Reuniones y feedback (próximas y realizadas, informe de Peitho con su diseño actual, pestaña "Tu feedback") y Facturación (detalle del mes, historial, cierre mensual, revenue share de ACTI y reuniones en revisión).

## Antes de probar

1. Correr `supabase/20261129_acti_fase3_migration.sql` (requiere las de las Fases 1 y 2). Solo tablas nuevas: `acti_meeting_feedback` y `acti_billing_months`. Probada en Postgres (PGlite) e idempotente.
2. Para ver Peitho, el socio debe estar en plan **Crece o Acelera** y el cliente tener **«Incluir Peitho» = Sí** en Configuración → Cliente (la sección Socio ACTI lo recuerda).

## Socio

- **Reuniones y feedback** (`/acti/reuniones`): las reuniones salen de la planilla de reuniones (tabla `meetings`).
  - *Próximas*: empresa, fecha, hora y contacto (nombre, cargo, correo y teléfono, porque ya están agendadas).
  - *Realizadas*: estado (realizada / no asistió / por confirmar / reagendada), si tiene análisis de Peitho y si falta el feedback.
  - **Análisis de Peitho**: el detalle de la reunión de Peitho (`MeetingDetail`, el mismo del portal) por un proxy de solo lectura (`/api/acti/peitho/proxy`: sin Panel de control, research ni reasignar ejecutivos). La reunión de la planilla se cruza con la de Peitho por fecha + empresa o contacto (`matchPeithoMeetings`, igual que el feedback manual). En Freemium y Conecta se invita a pasar a Crece.
  - **Tu feedback**: ¿se realizó?, calificación del perfil (1–5), ¿era el cargo que pidió? y ¿es oportunidad? (sí / aún no / falta otra reunión / no). Se guarda en `acti_meeting_feedback` y, si la reunión aún no tenía encuesta, también en `meeting_feedback` (la que leen Pulso ABM, el resumen de feedback y los Insights KAM; calificación ×2 para la escala 1–10).
  - Si el socio dice que **no se realizó** y la planilla dice que sí, la reunión queda **en revisión**: no se cobra hasta que el equipo la resuelva.
- **Facturación** (`/acti/facturacion`): base + reuniones realizadas × 4 UF, no-shows sin cargo, reuniones en revisión sin cargo, IVA 19% y total en UF y CLP (UF del día; al cierre, la del último día del mes). Detalle por reunión e historial. En Freemium muestra $0 y la invitación a cambiar de plan.

## Equipo BullsEye (Menú → ACTI → Red de Negocios → Facturación)

- Mes por socio (cerrado o en vivo): base, reuniones cobradas, no-shows, en revisión, total UF y CLP, y **revenue share de ACTI** (10% de la base, no del variable), con totales.
- **Cerrar el mes** (solo amadriz@, ihincapie@ y jkarmy@): congela los montos con los precios vigentes y la UF del último día del mes (mindicador.cl) o la que se ingrese. Se cierra solo los días 1 a 5 de cada mes (`/api/cron/acti-facturacion`, 12:10 UTC) si aún no estaba cerrado; se puede volver a cerrar con otra UF.
- **Reuniones en revisión**: «Sí se realizó: cobrar» o «No cobrar».

## Reglas de cobro (configurables en Planes y parámetros)

- Variable por reunión **realizada** (o **agendada**, por fecha de agendamiento). Los no-shows nunca se cobran.
- Pausado o dado de baja: sin base. Freemium: $0.
- Las reuniones de eventos de ACTI no se cobran ni consumen cupo (Fase 4; van en otra tabla).

## No regresión

- `npm test`: 49 pruebas (7 nuevas de facturación y estados). `npx tsc --noEmit`: sin errores nuevos. `next build`: OK.
- No se modificó ningún archivo compartido salvo `vercel.json` (1 cron nuevo). El feedback del socio solo inserta en `meeting_feedback` si la reunión no tenía encuesta (no pisa respuestas existentes).
- Pendiente: el valor de la UF desde mindicador.cl no se pudo probar desde este entorno (red bloqueada); si falla, el cierre queda sin CLP y se puede volver a cerrar con la UF ingresada a mano.
