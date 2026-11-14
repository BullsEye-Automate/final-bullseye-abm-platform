import { supabaseAdmin } from "@/lib/supabase";
import { sendMail } from "@/lib/mailer";
import { readMaster } from "@/lib/celulasSdr/sheets";
import { isBusinessDay } from "@/lib/celulasSdr/calendar";
import { leaderEmail } from "@/lib/celulasSdr/server/alertsMail";
import { readMasterPeople, resolveSdr } from "@/lib/respuestasLemlist/directory";
import { chileNow, reconfWindow, type ReconfWindow } from "../rules";
import { readPilotMeetings, syncPilotReconfirmations, type PilotMeeting } from "./sheet";

// Reconfirmación — los 5 envíos de cada día hábil (hora de Chile), todos
// internos para el equipo SDR (el cliente no recibe correos: ve el estado en
// Pulso ABM):
//   08:30  cada SDR (y cada líder, su célula): reuniones a reconfirmar hoy
//   10:00  SDR: recordatorio de las reuniones PM de hoy
//   12:00  SDR + líder: PM de hoy que vencieron sin reconfirmar
//   16:00  SDR: recordatorio de las AM del próximo día hábil
//   18:00  SDR + líder: AM del próximo día hábil que vencieron sin reconfirmar
//
// Modo (RECONF_ALERTS_MODE): por defecto "activo" = envío real (desde el
// 13-nov-2026, pedido de BullsEye); "test" = todo a RECONF_ALERTS_TEST_TO
// (amadriz@) con los destinatarios reales en el cuerpo.
// Remitente: RECONF_ALERTS_FROM → CELULAS_ALERTS_FROM.

export type SlotId = "0830" | "1000" | "1200" | "1600" | "1800";
type Slot = { id: SlotId; time: string; leader: boolean; pick: (w: ReconfWindow) => boolean; title: string; intro: string };

export const SLOTS: Slot[] = [
  { id: "0830", time: "08:30", leader: true, pick: () => true, title: "Reuniones a reconfirmar hoy", intro: "Estas reuniones se reconfirman hoy con el prospecto. Márcalas en el Registro de reuniones del portal apenas las reconfirmes." },
  { id: "1000", time: "10:00", leader: false, pick: (w) => w.pm, title: "Recordatorio: reconfirma las reuniones de esta tarde", intro: "Se abrió la ventana para reconfirmar las reuniones PM de hoy. Plazo: 12:00." },
  { id: "1200", time: "12:00", leader: true, pick: (w) => w.pm, title: "Reuniones de esta tarde sin reconfirmar", intro: "Venció el plazo (12:00) y estas reuniones de hoy en la tarde siguen sin reconfirmar." },
  { id: "1600", time: "16:00", leader: false, pick: (w) => !w.pm, title: "Recordatorio: reconfirma las reuniones de mañana en la mañana", intro: "Se abrió la ventana para reconfirmar las reuniones AM del próximo día hábil. Plazo: 18:00." },
  { id: "1800", time: "18:00", leader: true, pick: (w) => !w.pm, title: "Reuniones de mañana en la mañana sin reconfirmar", intro: "Venció el plazo (18:00) y estas reuniones AM del próximo día hábil siguen sin reconfirmar." },
];

// Se envía en la corrida (cada 15 min) que cae entre la hora del envío y 75 min después
const SEND_WINDOW_MIN = 75;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export function dueSlot(time: string): Slot | null {
  const now = toMin(time);
  return SLOTS.find((s) => now >= toMin(s.time) && now < toMin(s.time) + SEND_WINDOW_MIN) ?? null;
}

const sentKey = (day: string, slot: SlotId) => `reconf_alert_sent:${day}:${slot}`;
async function wasSent(day: string, slot: SlotId): Promise<boolean> {
  const { data } = await supabaseAdmin().from("allo_response_cache").select("cache_key").eq("cache_key", sentKey(day, slot)).maybeSingle();
  return !!data;
}
async function markSent(day: string, slot: SlotId, info: unknown): Promise<void> {
  const { error } = await supabaseAdmin().from("allo_response_cache").upsert(
    { cache_key: sentKey(day, slot), response: { sentAt: new Date().toISOString(), ...(info as object) }, expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString() },
    { onConflict: "cache_key" }
  );
  if (error) console.error("Reconfirmación: no se pudo registrar el envío:", error.message);
}

type Item = { m: PilotMeeting; w: ReconfWindow };

// Reuniones pendientes, sin reconfirmar, cuya ventana es `day` y que calzan con el envío
export function itemsForSlot(meetings: PilotMeeting[], day: string, slot: Slot): Item[] {
  const out: Item[] = [];
  for (const m of meetings) {
    if (!m.pending || m.reconfirmed) continue;
    const w = reconfWindow(m.md, m.hour);
    if (!w || w.day !== day || !slot.pick(w)) continue;
    out.push({ m, w });
  }
  return out.sort((a, b) => a.w.deadline.localeCompare(b.w.deadline) || (a.m.md ?? "").localeCompare(b.m.md ?? "") || a.m.hour.localeCompare(b.m.hour));
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const dmy = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");
const REGISTRO_URL = `${process.env.NEXT_PUBLIC_APP_URL || "https://portal.bullseye-abm.com"}/analisis/celulas-sdr?vista=registro`;

function mailHtml(slot: Slot, items: Item[], greeting: string, showSdr: boolean, testNote: string): string {
  const th = 'style="text-align:left;padding:6px 8px;border-bottom:1px solid #ddd;font-size:12px;color:#555"';
  const td = 'style="padding:6px 8px;border-bottom:1px solid #eee;font-size:13px"';
  const rows = items.map(({ m, w }) => `<tr><td ${td}><b>${esc(w.deadline)}</b></td><td ${td}>${dmy(m.md)} ${esc(m.hour || "sin hora")}</td><td ${td}>${esc(m.company)}</td><td ${td}>${esc(m.contact || "—")}${m.title ? `<br><span style="color:#777">${esc(m.title)}</span>` : ""}</td><td ${td}>${esc(m.client)}</td>${showSdr ? `<td ${td}>${esc(m.sdr || "—")}</td>` : ""}</tr>`).join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:720px">
${testNote}<h2 style="color:#251762;font-size:18px;margin:0 0 8px">${esc(slot.title)}</h2>
<p style="font-size:14px">${esc(greeting)}: ${esc(slot.intro)}</p>
<table style="border-collapse:collapse;width:100%"><thead><tr><th ${th}>Reconfirmar antes de</th><th ${th}>Reunión</th><th ${th}>Empresa</th><th ${th}>Contacto</th><th ${th}>Cliente</th>${showSdr ? `<th ${th}>SDR</th>` : ""}</tr></thead><tbody>${rows}</tbody></table>
<p style="font-size:13px;margin-top:14px">Marca cada reunión como reconfirmada en el <a href="${REGISTRO_URL}">Registro de reuniones de Células SDR</a> (columna Reconfirmación, filtro "Solo por reconfirmar"). El cliente ve el estado en su portal (Pulso ABM).</p>
<p style="font-size:11px;color:#888">Piloto de reconfirmación de reuniones · BullsEye</p></div>`;
}

export type SlotResult = { slot: SlotId; day: string; mode: "test" | "activo"; meetings: number; mails: { to: string[]; cc: string[]; items: number; status: "sent" | "error"; error?: string }[]; synced?: number; note?: string };

// Lee la planilla, copia la reconfirmación a la base y, si toca un envío, lo manda.
// force = manda el envío `slotId` aunque no sea su hora ni día hábil (y aunque ya se haya enviado).
export async function runReconfirmation(opts: { slotId?: SlotId; force?: boolean; now?: Date } = {}): Promise<SlotResult | { day: string; time: string; synced: number; note: string }> {
  const { day, time } = chileNow(opts.now);
  const { meetings, hasColumns } = await readPilotMeetings(day);
  const sync = await syncPilotReconfirmations(meetings).catch((e) => ({ updated: 0, skipped: (e as Error).message }));

  const slot = opts.slotId ? SLOTS.find((s) => s.id === opts.slotId) ?? null : dueSlot(time);
  if (!slot) return { day, time, synced: sync.updated, note: sync.skipped ?? "Sin envío en este horario" };
  if (!opts.force) {
    if (!isBusinessDay(day)) return { day, time, synced: sync.updated, note: "No es día hábil en Chile" };
    if (await wasSent(day, slot.id)) return { day, time, synced: sync.updated, note: `El envío de las ${slot.time} ya se hizo` };
  }
  const mode: "test" | "activo" = process.env.RECONF_ALERTS_MODE === "test" ? "test" : "activo";
  const result: SlotResult = { slot: slot.id, day, mode, meetings: 0, mails: [], synced: sync.updated };
  if (!hasColumns) {
    result.note = "La planilla no tiene la columna Reconfirmada: no se envía nada.";
    return result;
  }
  const items = itemsForSlot(meetings, day, slot);
  result.meetings = items.length;
  if (!items.length) {
    await markSent(day, slot.id, { meetings: 0 });
    result.note = "Nada pendiente de reconfirmar";
    return result;
  }

  // Destinatarios: SDR por la Maestra (Responsable → Correo); líder por su célula
  const spreadsheetId = process.env.GOOGLE_SHEETS_MEETINGS_ID ?? "";
  const [people, master] = await Promise.all([readMasterPeople().catch(() => []), readMaster(spreadsheetId, []).catch(() => null)]);
  const allLeaders = Array.from(new Set((master?.cells ?? []).map((c) => leaderEmail(c.leader)).filter((x): x is string => !!x)));
  const bySdr = new Map<string, { email: string | null; name: string; leader: string | null; items: Item[] }>();
  for (const it of items) {
    const key = it.m.sdr || "Sin responsable";
    let g = bySdr.get(key);
    if (!g) {
      const res = resolveSdr(people, it.m.sdr);
      const name = res.ok ? res.person.name : key;
      const cell = master?.cells.find((c) => c.leader === name || c.members.includes(name));
      g = { email: res.ok ? res.person.email : null, name, leader: cell ? leaderEmail(cell.leader) : null, items: [] };
      bySdr.set(key, g);
    }
    g.items.push(it);
  }

  const from = process.env.RECONF_ALERTS_FROM || process.env.CELULAS_ALERTS_FROM || "onboarding@resend.dev";
  const testTo = (process.env.RECONF_ALERTS_TEST_TO || "amadriz@bullseye-abm.com").split(",").map((s) => s.trim()).filter(Boolean);
  const send = async (to: string[], cc: string[], subject: string, html: string, n: number) => {
    const realTo = mode === "activo" ? to : testTo;
    const realCc = mode === "activo" ? cc.filter((c) => !to.includes(c)) : [];
    const note = mode === "activo" ? "" : `<p style="background:#fff4d6;padding:8px 10px;font-size:12px;border-radius:6px">Modo prueba. En modo activo iría a: ${esc(to.join(", ") || "—")}${cc.length ? ` · copia ${esc(cc.join(", "))}` : ""}</p>`;
    try {
      await sendMail({ from, fromName: "BullsEye · Reconfirmación", to: realTo, cc: realCc, subject: (mode === "activo" ? "" : "[Prueba] ") + subject, html: html.replace("__TEST__", note) });
      result.mails.push({ to: realTo, cc: realCc, items: n, status: "sent" });
    } catch (e) {
      result.mails.push({ to: realTo, cc: realCc, items: n, status: "error", error: (e as Error).message });
    }
  };

  // Un correo por SDR (en los envíos con plazo vencido, con copia a su líder)
  for (const g of Array.from(bySdr.values())) {
    const to = g.email ? [g.email] : (g.leader ? [g.leader] : allLeaders);
    // Copia a la líder solo cuando vence un plazo (12:00 y 18:00); a las 08:30
    // la líder ya recibe el resumen de su célula (pedido de BullsEye, 13-nov-2026)
    const cc = slot.leader && slot.id !== "0830" && g.email && g.leader && g.leader !== g.email ? [g.leader] : [];
    const greeting = g.email ? `Hola ${g.name.split(" ")[0]}` : `Hola: no se encontró el correo de ${g.name} en la Maestra`;
    await send(to, cc, `${slot.title} (${g.items.length})`, mailHtml(slot, g.items, greeting, false, "__TEST__"), g.items.length);
  }
  // 08:30: además, cada líder recibe la lista de todo su equipo
  if (slot.id === "0830") {
    const byLeader = new Map<string, Item[]>();
    for (const g of Array.from(bySdr.values())) {
      const targets = g.leader ? [g.leader] : allLeaders;
      for (const l of targets) byLeader.set(l, [...(byLeader.get(l) ?? []), ...g.items]);
    }
    for (const [leader, its] of Array.from(byLeader.entries())) {
      await send([leader], [], `Reconfirmaciones de tu célula hoy (${its.length})`, mailHtml(slot, its, "Hola", true, "__TEST__"), its.length);
    }
  }
  if (result.mails.some((m) => m.status === "sent")) await markSent(day, slot.id, { meetings: items.length, mode });
  return result;
}
