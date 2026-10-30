// Destinatarios de los correos automáticos del portal, editables desde la
// propia app (sin pasar por Vercel ni por un deploy). Se guardan en la tabla
// sdr_cells_config, en una fila aparte (id = "mail_recipients"), con una
// lista por reporte. Si un reporte no tiene lista guardada se usa su lista
// por defecto (definida acá). Las variables de Vercel PHONE_ALERTS_TO y
// REPORTE_SDR_TO ya no se usan.
import { supabaseAdmin } from "@/lib/supabase";

export type RecipientsKey = "phone_health" | "reporte_sdr" | "feriados";

export const RECIPIENT_DEFAULTS: Record<RecipientsKey, string[]> = {
  phone_health: ["amadriz@bullseye-abm.com", "ihincapie@bullseye-abm.com"],
  reporte_sdr: ["ihincapie@bullseye-abm.com", "jkarmy@bullseye-abm.com", "amadriz@bullseye-abm.com"],
  feriados: ["ihincapie@bullseye-abm.com", "vabarzua@bullseye-abm.com", "nnazar@bullseye-abm.com"],
};

export const RECIPIENT_KEYS = Object.keys(RECIPIENT_DEFAULTS) as RecipientsKey[];

const ROW_ID = "mail_recipients";
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

// Normaliza y valida: minúsculas, sin repetidos, solo correos válidos.
export function cleanEmails(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const raw of list) {
    const e = String(raw ?? "").trim().toLowerCase();
    if (EMAIL_RE.test(e) && !out.includes(e)) out.push(e);
  }
  return out;
}

async function readRow(): Promise<Partial<Record<RecipientsKey, string[]>>> {
  try {
    const { data } = await supabaseAdmin().from("sdr_cells_config").select("config").eq("id", ROW_ID).maybeSingle();
    return ((data?.config as any) ?? {}) as Partial<Record<RecipientsKey, string[]>>;
  } catch (err) {
    console.error("No se pudieron leer los destinatarios de correo:", err);
    return {};
  }
}

export async function getRecipients(key: RecipientsKey): Promise<string[]> {
  const saved = cleanEmails((await readRow())[key]);
  return saved.length ? saved : RECIPIENT_DEFAULTS[key];
}

export async function getAllRecipients(): Promise<Record<RecipientsKey, string[]>> {
  const row = await readRow();
  return Object.fromEntries(
    RECIPIENT_KEYS.map((k) => {
      const saved = cleanEmails(row[k]);
      return [k, saved.length ? saved : RECIPIENT_DEFAULTS[k]];
    })
  ) as Record<RecipientsKey, string[]>;
}

export async function setRecipients(key: RecipientsKey, emails: string[], updatedBy?: string): Promise<string[]> {
  const list = cleanEmails(emails);
  if (list.length === 0) throw new Error("Debe quedar al menos un destinatario");
  const row = await readRow();
  const { error } = await supabaseAdmin()
    .from("sdr_cells_config")
    .upsert(
      { id: ROW_ID, config: { ...row, [key]: list }, updated_by: updatedBy ?? null, updated_at: new Date().toISOString() },
      { onConflict: "id" }
    );
  if (error) throw new Error(`No se pudieron guardar los destinatarios: ${error.message}`);
  return list;
}
