// Plan de contingencia (nov-2026, pedido de BullsEye): cuando un cliente no
// alcanza a aprobar en su portal, la líder de prospección y las prospectoras
// pueden registrar su respuesta (dada por correo, reunión, WhatsApp…) o subir
// el listado de empresas que el cliente mandó. Queda trazado quién lo hizo y
// por qué medio (client_decision_by_email / requested_by_email + snapshot).
// CLIENT_PROXY_EMAILS (coma) reemplaza la lista por defecto.

const DEFAULT = ["amadriz@bullseye-abm.com", "gcondori@bullseye-abm.com", "jnazar@bullseye-abm.com", "nmoreno@bullseye-abm.com"];

export function clientProxyEmails(): string[] {
  const env = (process.env.CLIENT_PROXY_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return env.length ? env : DEFAULT;
}

export function canActForClient(email: string | null | undefined): boolean {
  return !!email && clientProxyEmails().includes(email.trim().toLowerCase());
}

export const PROXY_CHANNELS = ["correo", "reunión", "WhatsApp", "llamada", "otro"] as const;

export function proxyLabel(email: string, medio: string, nota?: string | null): string {
  const m = (PROXY_CHANNELS as readonly string[]).includes(medio) ? medio : "otro";
  return `${email} · en nombre del cliente (${m})${nota ? `: ${nota}` : ""}`.slice(0, 400);
}
