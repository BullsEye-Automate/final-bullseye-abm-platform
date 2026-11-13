// Quién cumple cada rol en el Onboarding SDR. Se edita en la propia página
// (pestaña Configurar, solo administradores) y se guarda en la tabla
// sdr_cells_config, fila id = "onboarding_roles" (sin migración, igual que
// lib/mailRecipients.ts). Cualquier otra persona con sesión es "SDR" y ve
// solo su propio onboarding.
import { supabaseAdmin } from "@/lib/supabase";
import { cleanEmails } from "@/lib/mailRecipients";
import type { Role } from "../plan";

export type RoleLists = { lider: string[]; rrhh: string[]; hab: string[]; admin: string[] };
export const ROLE_KEYS: (keyof RoleLists)[] = ["lider", "rrhh", "hab", "admin"];

// Líderes de célula (las mismas de lib/celulasSdr/server/alertsMail.ts) y
// administradora. RRHH (JP) y habilitadora comercial (Tatiana) se agregan en
// la pestaña Configurar.
export const ROLE_DEFAULTS: RoleLists = {
  lider: ["nnazar@bullseye-abm.com", "vabarzua@bullseye-abm.com"],
  rrhh: [],
  hab: [],
  admin: ["ihincapie@bullseye-abm.com"],
};

const ROW_ID = "onboarding_roles";

export async function getRoleLists(): Promise<RoleLists> {
  let saved: Partial<RoleLists> = {};
  try {
    const { data } = await supabaseAdmin().from("sdr_cells_config").select("config").eq("id", ROW_ID).maybeSingle();
    saved = ((data?.config as Partial<RoleLists>) ?? {}) as Partial<RoleLists>;
  } catch (e) {
    console.warn("[onboarding-sdr] No se pudieron leer los roles:", e);
  }
  const out = {} as RoleLists;
  for (const k of ROLE_KEYS) out[k] = Array.isArray(saved[k]) ? cleanEmails(saved[k]) : ROLE_DEFAULTS[k];
  if (!out.admin.length) out.admin = ROLE_DEFAULTS.admin; // nunca queda sin administradora
  return out;
}

export async function setRoleLists(lists: Partial<RoleLists>, by: string): Promise<RoleLists> {
  const cur = await getRoleLists();
  const next = { ...cur } as RoleLists;
  for (const k of ROLE_KEYS) if (lists[k] !== undefined) next[k] = cleanEmails(lists[k]);
  if (!next.admin.length) throw new Error("Debe quedar al menos una administradora");
  const { error } = await supabaseAdmin()
    .from("sdr_cells_config")
    .upsert({ id: ROW_ID, config: next, updated_by: by, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw new Error(`No se pudieron guardar los roles: ${error.message}`);
  return next;
}

export type Viewer = { email: string; editorRoles: Role[]; admin: boolean };

// Roles de edición de una persona (líder / RRHH / habilitadora). La
// administradora tiene los tres.
export async function viewerFor(email: string): Promise<Viewer> {
  const lists = await getRoleLists();
  const e = email.toLowerCase();
  const admin = lists.admin.includes(e);
  const editorRoles: Role[] = admin
    ? ["lider", "rrhh", "hab"]
    : (["lider", "rrhh", "hab"] as const).filter((k) => lists[k].includes(e));
  return { email: e, editorRoles, admin };
}
