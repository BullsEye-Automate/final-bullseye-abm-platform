import type { SupabaseClient } from "@supabase/supabase-js";

// ACTI · Lemlist (decisión de BullsEye 27-nov-2026): los socios ACTI no tienen
// cuenta propia de Lemlist; se trabajan con la cuenta de BullsEye, con listas
// propias por socio para no mezclarlos. Los demás clientes no cambian: siguen
// con su key propia y las listas de siempre.

export async function isActiClient(db: SupabaseClient, clientId: string): Promise<boolean> {
  const { data, error } = await db.from("acti_members").select("client_id").eq("client_id", clientId).maybeSingle();
  return !error && !!data;
}

// Key de BullsEye para socios ACTI (ACTI_LEMLIST_API_KEY, si no LEMLIST_API_KEY)
export function actiLemlistKey(): string | null {
  return process.env.ACTI_LEMLIST_API_KEY?.trim() || process.env.LEMLIST_API_KEY?.trim() || null;
}

export function actiListNames(clientName: string) {
  const n = clientName.replace(/\s+/g, " ").trim().slice(0, 80) || "Socio";
  return { companies: `ACTI · ${n} · Empresas`, contacts: `ACTI · ${n} · Contactos` };
}
