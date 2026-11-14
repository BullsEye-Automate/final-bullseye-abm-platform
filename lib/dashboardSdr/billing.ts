import { supabaseAdmin } from "@/lib/supabase";

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

// ── Dónde se guarda la marca ────────────────────────────────────────────
// En allo_response_cache (tabla que ya existe; sin migración), una fila por
// reunión: `dashboard_sdr_facturar:<meetings.id>` → { value, by, at }.
// Se conserva aunque se desmarque (value=false) para la trazabilidad.
const PREFIX = "dashboard_sdr_facturar:";
const TTL_MS = 5 * 365 * 86_400_000; // 5 años
export type BillingMark = { value: boolean; by: string; at: string };

export async function setBillingMark(meetingId: string, value: boolean, by: string): Promise<BillingMark> {
  const mark: BillingMark = { value, by, at: new Date().toISOString() };
  const { error } = await supabaseAdmin().from("allo_response_cache").upsert(
    { cache_key: PREFIX + meetingId, response: mark, expires_at: new Date(Date.now() + TTL_MS).toISOString() },
    { onConflict: "cache_key" }
  );
  if (error) throw new Error(`No se pudo guardar la marca: ${error.message}`);
  return mark;
}

export async function loadBillingMarks(): Promise<Map<string, BillingMark>> {
  const out = new Map<string, BillingMark>();
  const db = supabaseAdmin();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("allo_response_cache").select("cache_key, response")
      .like("cache_key", `${PREFIX}%`).range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) out.set(String(r.cache_key).slice(PREFIX.length), r.response as BillingMark);
    if (!data || data.length < 1000) break;
  }
  return out;
}
