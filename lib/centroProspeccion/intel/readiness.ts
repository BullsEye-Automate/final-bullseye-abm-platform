import { supabaseAdmin } from "@/lib/supabase";
import { getClientIcpText } from "@/lib/wishlist";
import { getClientOwnLemlistKey } from "@/lib/lemlistDatabase";
import { findMasterRow, readMasterClients } from "@/lib/radarAbm/server/masterClients";
import { loadClientLinks } from "../portalLink";

// Preparación de cada cliente para el motor de prospección (Empresas,
// Contactos y la Inteligencia de la semana). El piloto del motor partió con
// BullsEye y Crossnet; este checklist dice qué le falta a cada cliente activo
// para entrar. Solo lee.

export type ReadinessCheck = { key: string; label: string; ok: boolean; detail: string; required: boolean };
export type ClientReadiness = {
  clientId: string;
  cliente: string;
  fichas: string[];
  estado: "listo" | "parcial" | "falta";
  resumen: string;
  checks: ReadinessCheck[];
};

const DAY = 86_400_000;

export async function computeReadiness(): Promise<ClientReadiness[]> {
  const db = supabaseAdmin();
  const [links, master, snaps, configs, campaigns, allo, wish] = await Promise.all([
    loadClientLinks(),
    readMasterClients().catch(() => []),
    db.from("radar_abm_snapshots").select("client_id, synced_at"),
    db.from("client_configs").select("client_id, lemlist_campaign_id"),
    db.from("client_lemlist_campaigns").select("client_id"),
    db.from("client_allo_numbers").select("client_id"),
    db.from("client_wishlist").select("client_id, status").limit(50000),
  ]);
  const synced = new Map((snaps.data ?? []).map((s: { client_id: string; synced_at: string | null }) => [s.client_id, s.synced_at]));
  const campaign = new Set([
    ...(configs.data ?? []).filter((c: { lemlist_campaign_id: string | null }) => !!c.lemlist_campaign_id).map((c: { client_id: string }) => c.client_id),
    ...(campaigns.data ?? []).map((c: { client_id: string }) => c.client_id),
  ]);
  const alloCount = new Map<string, number>();
  for (const a of allo.data ?? []) alloCount.set(a.client_id, (alloCount.get(a.client_id) ?? 0) + 1);
  const wishCount = new Map<string, number>();
  for (const w of wish.data ?? []) if (!["rejected_by_client", "discarded", "removed"].includes(w.status)) wishCount.set(w.client_id, (wishCount.get(w.client_id) ?? 0) + 1);

  // Clientes activos en la Maestra + los que tienen ficha en el Centro
  const candidates = links.clients.filter((c) => {
    const row = findMasterRow(master, c);
    return row?.active || links.fichasByClient.has(c.id);
  });

  const out: ClientReadiness[] = [];
  for (const c of candidates) {
    const row = findMasterRow(master, c);
    const fichas = (links.fichasByClient.get(c.id) ?? []).map((f) => String(f.data.nombre || f.id));
    const [icp, key] = await Promise.all([
      getClientIcpText(db, c.id).catch(() => ""),
      getClientOwnLemlistKey(db, c.id).catch(() => null),
    ]);
    const s = synced.get(c.id);
    const ageDays = s ? Math.floor((Date.now() - new Date(s).getTime()) / DAY) : null;
    const checks: ReadinessCheck[] = [
      { key: "maestra", label: "Activo en la Maestra", ok: !!row?.active, required: true, detail: row ? row.status || "sin status" : "no figura" },
      { key: "ficha", label: "Ficha en el Centro", ok: fichas.length > 0, required: true, detail: fichas.join(", ") || "sin ficha vinculada" },
      { key: "icp", label: "ICP cargado en el portal", ok: icp.trim().length > 200, required: true, detail: icp.trim() ? `${icp.trim().length.toLocaleString("es-CL")} caracteres` : "sin ICP" },
      { key: "pulso", label: "Pulso ABM sincronizado", ok: ageDays != null, required: true, detail: ageDays == null ? "nunca sincronizado" : ageDays === 0 ? "hoy" : `hace ${ageDays} días` },
      { key: "pulsoDia", label: "Pulso ABM al día (≤ 2 días)", ok: ageDays != null && ageDays <= 2, required: false, detail: ageDays == null ? "–" : ageDays <= 2 ? "al día" : `atrasado ${ageDays} días: revisar el sync` },
      { key: "lemlist", label: "API key de Lemlist del cliente", ok: !!key, required: false, detail: key ? "conectada" : "sin key: los contactos solo salen de nuestro HubSpot" },
      { key: "campana", label: "Campaña de Lemlist asignada", ok: campaign.has(c.id), required: false, detail: campaign.has(c.id) ? "asignada" : "sin campaña" },
      { key: "allo", label: "Números de Allo asignados", ok: (alloCount.get(c.id) ?? 0) > 0, required: false, detail: `${alloCount.get(c.id) ?? 0} números` },
      { key: "wishlist", label: "Empresas en el motor", ok: (wishCount.get(c.id) ?? 0) > 0, required: false, detail: `${(wishCount.get(c.id) ?? 0).toLocaleString("es-CL")} en la wishlist` },
    ];
    const missingReq = checks.filter((x) => x.required && !x.ok);
    const missingOpt = checks.filter((x) => !x.required && !x.ok && x.key !== "wishlist");
    const estado: ClientReadiness["estado"] = missingReq.length ? "falta" : missingOpt.length ? "parcial" : "listo";
    const resumen = missingReq.length
      ? `Falta: ${missingReq.map((x) => x.label.toLowerCase()).join(", ")}`
      : missingOpt.length
        ? `Funciona con límites: ${missingOpt.map((x) => x.label.toLowerCase()).join(", ")}`
        : "Listo para el motor";
    out.push({ clientId: c.id, cliente: c.name, fichas, estado, resumen, checks });
  }
  const rank = { listo: 0, parcial: 1, falta: 2 } as const;
  return out.sort((a, b) => rank[a.estado] - rank[b.estado] || a.cliente.localeCompare(b.cliente));
}

// Clientes que entran a la inteligencia semanal: sin requisitos faltantes
export async function readyClientIds(): Promise<string[]> {
  return (await computeReadiness()).filter((r) => r.estado !== "falta").map((r) => r.clientId);
}
