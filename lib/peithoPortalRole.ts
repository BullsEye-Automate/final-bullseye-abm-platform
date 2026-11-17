// Rol de Peitho de cada usuario del portal de clientes (pedido de BullsEye
// nov-2026): un solo usuario (el del portal) con un rol dentro de Peitho.
//  - "admin": ve todo Peitho de su empresa (panel, reuniones futuras y pasadas).
//  - "sales_manager": ve todo Pulso ABM, pero en Peitho solo SUS reuniones
//    (research y feedback post reunión), sin Panel de control. "Sus" = las
//    del ejecutivo de la lista de ejecutivos de Peitho vinculado al usuario.
// Se guarda en app_metadata de Supabase Auth (solo editable con service role,
// sin migración): peitho_role, peitho_executive_id, peitho_executive_name.
// Sin valor = "admin" (lo que tenían todos antes de este cambio).

export type PeithoPortalRole = {
  role: "admin" | "sales_manager";
  executiveId: string | null;
  executiveName: string | null;
};

export function readPeithoRole(appMeta: Record<string, unknown> | null | undefined): PeithoPortalRole {
  const m = appMeta ?? {};
  const role = m.peitho_role === "sales_manager" ? "sales_manager" : "admin";
  return {
    role,
    executiveId: role === "sales_manager" && typeof m.peitho_executive_id === "string" && m.peitho_executive_id ? m.peitho_executive_id : null,
    executiveName: role === "sales_manager" && typeof m.peitho_executive_name === "string" && m.peitho_executive_name ? m.peitho_executive_name : null,
  };
}

export const PEITHO_ROLE_LABEL: Record<PeithoPortalRole["role"], string> = { admin: "Administrador", sales_manager: "Sales manager" };
