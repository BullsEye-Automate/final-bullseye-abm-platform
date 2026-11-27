import { supabaseAdmin } from "@/lib/supabase";
import { readMonthCache, writeMonthCache } from "@/lib/celulasSdr/cache";
import {
  associateContactCompany, searchHSCompany, searchHSCompanyByDomain, searchHSContact,
  searchHSContactByLinkedinUrl, upsertHSCompany, upsertHSContact,
} from "@/lib/hubspot";
import { tagContactClient } from "@/lib/wishlistHubspot";
import { getReceptive } from "./signals";
import { saveDecision } from "./suggest";

// La prospectora carga un contacto receptivo al HubSpot de BullsEye para el
// cliente (mismo destino que Contactos IA): si el contacto ya existe no se pisan
// sus datos, solo se le agrega el cliente en «Cliente BullsEye» y se asocia a la
// empresa; si no existe se crea. Queda en la lista diaria «Prospección <cliente>»
// de las 18:00 (lib/listasHubspot.ts), que es la que llega a los SDR.

export const LOADED_KEY = "receptivos:cargados";
export type LoadedRow = { id: string; client_id: string; nombre: string; cargo: string; empresa: string; hs: string; at: string; by: string };

export async function loadReceptive(clientId: string, key: string, by: string): Promise<{ ok: boolean; hs?: string; error?: string }> {
  const db = supabaseAdmin();
  const { data: client } = await db.from("clients").select("id, name").eq("id", clientId).maybeSingle();
  if (!client) return { ok: false, error: "Cliente no encontrado" };
  const p = (await getReceptive()).find((x) => x.key === key);
  if (!p) return { ok: false, error: "El contacto ya no está en la lista de receptivos" };
  try {
    let hs = (p.email ? await searchHSContact(p.email) : null) ?? (p.linkedin ? await searchHSContactByLinkedinUrl(p.linkedin) : null);
    if (!hs) {
      const [firstname, ...rest] = (p.name ?? "").trim().split(/\s+/);
      hs = await upsertHSContact({
        firstname: firstname || null, lastname: rest.join(" ") || null, jobtitle: p.title, email: p.email,
        mobilephone: p.mobile, hs_linkedin_url: p.linkedin, company: p.company, bullseye_client_name: client.name,
      });
    }
    if (!hs) return { ok: false, error: "HubSpot no devolvió el contacto" };
    let co = (p.domain ? await searchHSCompanyByDomain(p.domain) : null) ?? (p.company ? await searchHSCompany(p.company) : null);
    if (!co && p.company) co = await upsertHSCompany({ name: p.company, domain: p.domain });
    if (co) await associateContactCompany(hs, co);
    const tag = await tagContactClient(hs, { id: clientId, name: client.name }).catch((e) => ({ ok: false, error: String(e) }));
    const at = new Date().toISOString();
    await saveDecision(clientId, key, { st: "cargado", by, at, hs, motivo: tag.ok ? null : `Cliente BullsEye: ${"error" in tag ? tag.error : ""}` });
    const list = (await readMonthCache<LoadedRow[]>(LOADED_KEY)) ?? [];
    list.push({ id: `rc:${clientId}:${key}`, client_id: clientId, nombre: p.name ?? "", cargo: p.title ?? "", empresa: p.company ?? "", hs, at, by });
    const cutoff = Date.now() - 30 * 86400_000;
    await writeMonthCache(LOADED_KEY, list.filter((r) => new Date(r.at).getTime() >= cutoff), 40 * 86400_000);
    return { ok: true, hs };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 300) };
  }
}
