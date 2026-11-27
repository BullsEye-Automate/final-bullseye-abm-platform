# ACTI · Estado de las cuentas en el portal — propuesta para Operaciones (Ingri)

> Para revisar con Ingri antes de construir. Contexto: plataforma ACTI (fases 1 y 2 en `main`, PR #465) y la decisión de BullsEye de que desde enero la gestión viva en el portal y HubSpot quede como respaldo. Esta propuesta busca que ACTI sea el **primer cliente que funcione así**, usando lo mismo que ya construiste en el Dashboard SDR.

## 1. Qué necesita ACTI

1. **Avance de cada solicitud del socio** (Mis solicitudes): en cola → research → en contacto → reunión agendada → sin respuesta.
2. **"Sin respuesta" con regla clara**: 6 intentos en 10 días hábiles sin conversación (configurable), para **reemplazar** la cuenta en los planes pagados.
3. **Completar con IA**: si el socio pide menos empresas que su cupo del mes (reuniones ÷ 10%), el motor completa la lista.
4. **Vista del equipo**: solicitudes ACTI con plan, prioridad y "alta demanda" dentro del flujo normal.

## 2. Propuesta

### 2.1 Un solo status por cuenta, el de La Biblia

- Usar **los mismos status de empresa de La Biblia** que ya usan Pulso ABM y tu Dashboard SDR (`companyGroup` / `CO_LISTS` en `lib/dashboardSdr/compute.ts`). No inventamos estados nuevos para ACTI.
- La etapa que ve el socio sale de ese status:

| Etapa del socio | Status (tus listas) |
|---|---|
| En cola | (aún en la cola ACTI, sin asignar) |
| En research | Asignadas |
| En contacto | En gestión, En seguimiento |
| Reunión agendada | Reunión / oportunidad |
| Sin respuesta | Descartadas (sin comunicación / sin contactos fit), Nutridas |

### 2.2 Dónde vive el status (transición a enero)

- **Hasta enero:** el SDR sigue cambiando el status en HubSpot o con tu botón «Cambiar» / la Ficha. Para no crear 3 propiedades por cada uno de los +100 socios, en el HubSpot de BullsEye se crean **propiedades comunes**:
  - `bullseye_socio_acti` (texto o selección: nombre del socio).
  - `bullseye_status_acti` (mismas opciones que "Status de la asignación").
  - `bullseye_sdr_acti` (SDR asignado).
- **Desde enero:** el status vive en una tabla del portal (por ejemplo `account_status`: cliente, empresa, status, SDR, quién y cuándo) y HubSpot solo recibe una copia. Tu «Cambiar status» y la Ficha escribirían ahí primero.

### 2.3 Regla de "sin respuesta" y reemplazo

- Intentos = llamadas de Allo + correos + WhatsApp/LinkedIn registrados (lo que ya cuenta Pulso en `client.activities`), contados por empresa desde que se asignó.
- 6 intentos en 10 días hábiles sin llamada conectada ni respuesta → la cuenta pasa a "Sin respuesta" y, en planes pagados, el motor propone una de reemplazo (misma persona objetivo).

## 3. Preguntas para Ingri

1. ¿Te sirven las **propiedades comunes ACTI** en el HubSpot de BullsEye, o prefieres que los socios usen las propiedades por cliente de siempre mientras dure la transición?
2. ¿Quieres que el **status en el portal** (tabla propia) parta con ACTI y después se extienda a todos los clientes desde tu Dashboard SDR? ¿Algo de tu modelo (Mis listas, Ficha, Mi día) que debamos respetar?
3. ¿La regla de **6 intentos en 10 días hábiles** te parece bien? ¿Qué cuenta como intento (solo llamadas, o también correo y WhatsApp)?
4. ¿Qué SDR o célula atenderá a los socios ACTI? ¿Las metas de ACTI van en la pestaña "Asignación" como un cliente más o por socio?
5. ¿En qué orden prefieres que se construya: primero las propiedades comunes en HubSpot o directamente la tabla de status del portal?
