import { supabaseAdmin } from "@/lib/supabase";
import { findMasterRow, readMasterClients } from "@/lib/radarAbm/server/masterClients";
import { ASSIGN_CATEGORIES, classifyReply, MIN_CONFIDENCE, type Category } from "./classify";
import { kamFor, normName, readMasterPeople, resolveSdr } from "./directory";
import { findLead, hubspotContactUrl, loadClientHubspot, markHotCalling, type ClientHubspot, type LeadInHubspot } from "./hubspot";
import { clientReplySources, fetchCampaignReplies, pauseLead, type LemlistReply } from "./lemlist";
import { sendKamMail, sendSdrMail, type ReplyMailData } from "./mail";

// Respuestas Lemlist → SDR asignado. Para cada cliente activo en la Maestra
// (misma regla que Pulso ABM): trae las respuestas nuevas de sus campañas,
// las clasifica, busca el SDR de la empresa en HubSpot y asigna o alerta al KAM.
//
// Modo (RESPUESTAS_LEMLIST_MODE): "activo" por defecto desde el 5-nov-2026
// (pedido de BullsEye) = Hot Calling en HubSpot, pausa en Lemlist y correo al
// SDR o al KAM. "sombra" = solo clasifica y registra, sin escribir en HubSpot,
// sin pausar en Lemlist y sin correos a SDR/KAM (solo el resumen de la corrida).
export const currentMode = (): Mode => (process.env.RESPUESTAS_LEMLIST_MODE === "sombra" ? "sombra" : "activo");

// Solo respuestas de las últimas N horas: al activar no se procesa el histórico
const LOOKBACK_HOURS = Number(process.env.RESPUESTAS_LEMLIST_LOOKBACK_HOURS) || 72;
// Tope por cliente y corrida (la siguiente corrida sigue con el resto)
const MAX_PER_CLIENT = 30;
// Clientes activos que no entran (decisión de BullsEye, nov-2026)
const EXCLUDED = (process.env.RESPUESTAS_LEMLIST_EXCLUDE ?? "xarvis").split(",").map((x) => normName(x)).filter(Boolean);

export type AppClient = { id: string; name: string; slug: string | null };

export async function listReplyClients(): Promise<{ clients: AppClient[]; skipped: { name: string; reason: string }[] }> {
  const db = supabaseAdmin();
  const { data } = await db.from("clients").select("id, name, slug");
  const master = await readMasterClients(true);
  const clients: AppClient[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const c of (data ?? []) as AppClient[]) {
    const row = findMasterRow(master, c);
    if (!row?.active) continue;
    if (EXCLUDED.some((x) => normName(c.name).startsWith(x) || normName(row.name).startsWith(x))) { skipped.push({ name: c.name, reason: "Excluido" }); continue; }
    clients.push(c);
  }
  return { clients, skipped };
}

export type ProcessedRow = {
  clientName: string; leadName: string; leadEmail: string; companyName: string;
  category: Category; summary: string; action: string; detail: string;
};
export type ClientRunResult = { client: string; fetched: number; fresh: number; processed: ProcessedRow[]; warnings: string[] };

export async function processClientReplies(client: AppClient, deadline: number): Promise<ClientRunResult> {
  const db = supabaseAdmin();
  const mode = currentMode();
  const warnings: string[] = [];
  const out: ClientRunResult = { client: client.name, fetched: 0, fresh: 0, processed: [], warnings };

  const src = await clientReplySources(db, client.id);
  if (src.warning) warnings.push(src.warning);
  if (!src.apiKey || !src.campaigns.length) return out;

  // Respuestas de todas sus campañas (de a 3 en paralelo)
  const replies: LemlistReply[] = [];
  for (let i = 0; i < src.campaigns.length && Date.now() < deadline; i += 3) {
    const batch = await Promise.all(src.campaigns.slice(i, i + 3).map((c) => fetchCampaignReplies(c, src.apiKey!).catch(() => [])));
    for (const b of batch) replies.push(...b);
  }
  out.fetched = replies.length;
  const since = Date.now() - LOOKBACK_HOURS * 3600_000;
  const recent = replies.filter((r) => !r.createdAt || new Date(r.createdAt).getTime() >= since);
  if (!recent.length) return out;

  const ids = Array.from(new Set(recent.map((r) => r.activityId)));
  const { data: seen } = await db.from("lemlist_replies").select("activity_id").in("activity_id", ids);
  const seenIds = new Set((seen ?? []).map((s: { activity_id: string }) => s.activity_id));
  const fresh = recent
    .filter((r, i, arr) => !seenIds.has(r.activityId) && arr.findIndex((x) => x.activityId === r.activityId) === i)
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))
    .slice(0, MAX_PER_CLIENT);
  out.fresh = fresh.length;
  if (!fresh.length) return out;

  // HubSpot y Maestra: se cargan una vez por cliente
  let hs: ClientHubspot | null = null;
  try {
    hs = await loadClientHubspot(client);
    warnings.push(...hs.warnings);
  } catch (e) {
    warnings.push(`HubSpot: ${(e as Error).message}`);
  }
  const people = await readMasterPeople();
  const kam = kamFor(client.name);

  for (const r of fresh) {
    if (Date.now() > deadline) { warnings.push("Se cortó por tiempo: el resto sigue en la próxima corrida."); break; }
    // Reserva la respuesta (activity_id único): si otra corrida la tomó, se salta
    const { error: insErr } = await db.from("lemlist_replies").insert({
      activity_id: r.activityId, client_id: client.id, client_name: client.name,
      campaign_id: r.campaignId, campaign_name: r.campaignName, channel: r.channel,
      lead_email: r.leadEmail, lead_name: r.leadName || null, company_name: r.companyName || null,
      reply_text: r.text || null, replied_at: r.createdAt, mode, action: "procesando",
    });
    if (insErr) { if (!/duplicate|unique/i.test(insErr.message)) warnings.push(`Supabase: ${insErr.message}`); continue; }

    const update: Record<string, unknown> = {};
    try {
      const cls = await classifyReply(r.text, { clientId: client.id, clientName: client.name });
      Object.assign(update, { category: cls.category, confidence: cls.confidence, summary: cls.summary, kam_email: kam });

      let lead: LeadInHubspot = { contactId: null, companyId: null, companyName: null, sdrValue: null, sdrFrom: null };
      if (hs) lead = await findLead(hs, r.leadEmail).catch((e) => { warnings.push(`HubSpot (${r.leadEmail}): ${(e as Error).message}`); return lead; });
      Object.assign(update, { hs_contact_id: lead.contactId, hs_company_id: lead.companyId, sdr_value: lead.sdrValue });
      if (lead.companyName && !r.companyName) update.company_name = lead.companyName;

      const mail: ReplyMailData = {
        clientName: client.name, leadName: r.leadName, leadEmail: r.leadEmail,
        companyName: lead.companyName || r.companyName, channel: r.channel, campaignName: r.campaignName,
        category: cls.category, summary: cls.summary, replyText: r.text,
        hubspotUrl: hs ? hubspotContactUrl(hs, lead.contactId) : null,
      };
      const live = mode === "activo";
      let action = "sin_accion";
      let detail = "";

      if (cls.category === "fuera_oficina" || cls.category === "no_interesado") {
        detail = cls.category === "fuera_oficina" ? "Respuesta automática: sin acción." : "No interesado: sin acción.";
      } else if (cls.category === "baja") {
        action = "baja";
        detail = "Pidió no ser contactado: se pausa en Lemlist.";
        if (live) { const p = await pauseLead(src.apiKey, r.campaignId, r.leadEmail); update.lemlist_paused = p.ok; if (!p.ok) detail += ` ${p.error}`; }
      } else if (cls.category === "sin_texto" || cls.category === "ambigua" || cls.confidence < MIN_CONFIDENCE) {
        action = "revision_kam";
        detail = `${cls.category === "ambigua" ? "Respuesta ambigua" : "Clasificación dudosa"}: revisión del KAM (${kam}).`;
        if (live) { await sendKamMail(kam, { ...mail, reason: detail }, "revision"); update.notified_to = [kam]; }
      } else if (ASSIGN_CATEGORIES.includes(cls.category)) {
        const sdr = lead.contactId ? resolveSdr(people, lead.sdrValue) : { ok: false as const, reason: "El contacto no está en HubSpot." };
        if (sdr.ok) {
          action = "asignada";
          detail = `Asignada a ${sdr.person.name} (SDR de la ${lead.sdrFrom}).`;
          Object.assign(update, { sdr_name: sdr.person.name, sdr_email: sdr.person.email });
          if (live) {
            const notes: string[] = [];
            if (hs && lead.contactId) { const h = await markHotCalling(hs, lead.contactId); update.hubspot_updated = h.ok; if (!h.ok) notes.push(h.error ?? "HubSpot no actualizado"); }
            const p = await pauseLead(src.apiKey, r.campaignId, r.leadEmail); update.lemlist_paused = p.ok; if (!p.ok) notes.push(p.error ?? "Lemlist no pausado");
            await sendSdrMail(sdr.person.email!, { ...mail, sdrName: sdr.person.name });
            update.notified_to = [sdr.person.email];
            if (notes.length) detail += ` Avisos: ${notes.join(" · ")}`;
          }
        } else {
          action = "alerta_kam";
          detail = `${sdr.reason} Alerta al KAM (${kam}).`;
          if ("person" in sdr && sdr.person) update.sdr_name = sdr.person.name;
          if (live) { await sendKamMail(kam, { ...mail, reason: sdr.reason }, "sin_sdr"); update.notified_to = [kam]; }
        }
      }
      Object.assign(update, { action, action_detail: detail });
      out.processed.push({ clientName: client.name, leadName: r.leadName, leadEmail: r.leadEmail, companyName: mail.companyName, category: cls.category, summary: cls.summary, action, detail });
    } catch (e) {
      Object.assign(update, { action: "error", error: (e as Error).message.slice(0, 500) });
      warnings.push(`${r.leadEmail}: ${(e as Error).message}`);
    }
    await db.from("lemlist_replies").update(update).eq("activity_id", r.activityId);
  }
  return out;
}
