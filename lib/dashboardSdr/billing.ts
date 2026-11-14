// Dashboard SDR — marca «Para facturar»: es solo una marca personal de Ingri
// para contar reuniones (no cambia nada en la facturación ni en la planilla).
// Solo estas personas ven el check y la pestaña Facturación; el resto no.
// DASHBOARD_FACTURAR_EMAILS (separados por coma) reemplaza la lista.
const DEFAULT_EMAILS = ["ihincapie@bullseye-abm.com"];

export function billingEmails(): string[] {
  const env = (process.env.DASHBOARD_FACTURAR_EMAILS ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return env.length ? env : DEFAULT_EMAILS;
}
export function canMarkBilling(email: string | null | undefined): boolean {
  return !!email && billingEmails().includes(email.trim().toLowerCase());
}
