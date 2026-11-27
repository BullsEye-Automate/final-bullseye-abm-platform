// ACTI · quién puede hacer qué (equipo BullsEye). Decisión de BullsEye 27-nov-2026.
// Correos en minúscula. Las variables de entorno, si existen, reemplazan la lista.

const list = (env: string | undefined, def: string[]) =>
  (env ? env.split(",") : def).map((e) => e.trim().toLowerCase()).filter(Boolean);

// Editar planes y precios
export const PLAN_EDITORS = list(process.env.ACTI_PLAN_EDITORS, [
  "amadriz@bullseye-abm.com",
  "ihincapie@bullseye-abm.com",
  "jkarmy@bullseye-abm.com",
]);

// Cargar eventos (además de los administradores ACTI)
export const EVENT_EDITORS = list(process.env.ACTI_EVENT_EDITORS, [
  "jguajardo@bullseye-abm.com",
  "iarrieta@bullseye-abm.com",
  "ccontador@bullseye-abm.com",
]);

// Crear administradores ACTI (desde el módulo de accesos)
export const ACTI_ADMIN_CREATORS = list(process.env.ACTI_ADMIN_CREATORS, [
  "amadriz@bullseye-abm.com",
  "ihincapie@bullseye-abm.com",
  "ccontador@bullseye-abm.com",
  "jguajardo@bullseye-abm.com",
  "jkarmy@bullseye-abm.com",
]);

const has = (l: string[], email: string | null | undefined) => !!email && l.includes(email.trim().toLowerCase());

export const canEditPlans = (email: string | null | undefined) => has(PLAN_EDITORS, email);
export const canEditEvents = (email: string | null | undefined) => has(EVENT_EDITORS, email);
export const canCreateActiAdmins = (email: string | null | undefined) => has(ACTI_ADMIN_CREATORS, email);
