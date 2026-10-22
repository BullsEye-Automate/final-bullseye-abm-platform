// Correo diario de alertas para las líderes de célula (módulo Células SDR).
// Usa exactamente los mismos datos y fórmulas que la pantalla
// (lib/celulasSdr/engine.ts): metas de Asignación, células de la Maestra,
// reuniones de API Reuniones, llamadas/score de Allo y actividades de HubSpot.
//
// Cada líder recibe solo su célula: llamadas del día hábil anterior, agenda
// de hoy, no-show de ayer, rescates (Reagendar) y registros incompletos,
// cumplimiento del mes con ritmo necesario, calidad de llamadas y destacados.
import {
  attention, agg, buildAlerts, buildModel, callStreak, currentPeriod, div, endOf, fmt, forecast, makeFilter,
  ok, pct, periodFromRange, qBand, QBN, QCRIT, sdrFilter, sdrList, sem, COLORS, FC_TXT,
  type Alert, type Filters, type Model, type Sem,
} from "@/lib/celulasSdr/engine";
import { addDays, chileToday, dayLong, isBusinessDay, monthOf } from "@/lib/celulasSdr/calendar";
import type { AlloMonthResponse, CellLeader, HubspotMonthResponse } from "@/lib/celulasSdr/types";
import { loadBase } from "./base";
import { loadAlloMonth } from "./allo";
import { loadHubspotMonth } from "./hubspot";
import { loadConfig } from "./config";

export type LeaderDigest = {
  leader: CellLeader;
  subject: string;
  html: string;
  summary: { underGoal: number; meetingsToday: number; noShows: number; incomplete: number; critical: number };
};

export function previousBusinessDay(d: string): string {
  let x = addDays(d, -1);
  while (!isBusinessDay(x)) x = addDays(x, -1);
  return x;
}

export async function loadModelForDigest(today = chileToday()): Promise<{ M: Model; warnings: string[] }> {
  const month = today.slice(0, 7);
  const yesterday = previousBusinessDay(today);
  const months = [...new Set([monthOf(yesterday), month])];
  const warnings: string[] = [];
  const [base, cfg] = await Promise.all([loadBase(month), loadConfig()]);
  const allo: Record<string, AlloMonthResponse> = {};
  const hubspot: Record<string, HubspotMonthResponse> = {};
  for (const m of months) {
    try {
      allo[m] = await loadAlloMonth(m);
    } catch (e) {
      warnings.push(`No se pudieron leer las llamadas de Allo (${m}): ${(e as Error).message}`);
    }
  }
  await Promise.all(months.map(async (m) => {
    try {
      hubspot[m] = await loadHubspotMonth(m);
    } catch (e) {
      warnings.push(`No se pudieron leer las actividades de HubSpot (${m}): ${(e as Error).message}`);
    }
  }));
  return { M: buildModel(base, allo, hubspot, cfg), warnings };
}

// ─── HTML (tablas + estilos en línea: compatible con Gmail / Outlook) ───────
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const bold = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
const SEM_BG: Record<Sem, string> = { g: "#E1F5EE", y: "#FAEEDA", r: "#FAECE7", n: "#EEEDF5" };
const SEM_FG: Record<Sem, string> = { g: "#0F6E56", y: "#854F0B", r: "#993C1D", n: "#6B6884" };
const pill = (txt: string, s: Sem) =>
  `<span style="display:inline-block;padding:2px 8px;border-radius:99px;background:${SEM_BG[s]};color:${SEM_FG[s]};font-weight:600;font-size:12px">${esc(txt)}</span>`;
const th = (t: string, left = false) =>
  `<th style="text-align:${left ? "left" : "right"};padding:6px 8px;border-bottom:1px solid #ECEAF4;color:#6B6884;font-weight:500;font-size:12px;white-space:nowrap">${t}</th>`;
const td = (t: string, left = false, extra = "") =>
  `<td style="text-align:${left ? "left" : "right"};padding:6px 8px;border-bottom:1px solid #F1EFF7;font-size:13px;${extra}">${t}</td>`;
const section = (title: string, body: string, note = "") =>
  `<tr><td style="padding:18px 24px 4px"><div style="font-size:15px;font-weight:600;color:#1A1733;margin-bottom:8px">${title}</div>${body}${note ? `<div style="font-size:11.5px;color:#9794AC;margin-top:6px">${note}</div>` : ""}</td></tr>`;
const table = (head: string, rows: string[]) =>
  rows.length
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">${head}${rows.join("")}</table>`
    : `<div style="font-size:13px;color:#6B6884">Nada que reportar.</div>`;
const alertLine = (a: Alert) => {
  const c = a.lvl === "r" ? COLORS.r : a.lvl === "y" ? COLORS.y : COLORS.g;
  return `<div style="border-left:3px solid ${c};background:#F8F7FC;border-radius:8px;padding:8px 10px;margin-bottom:6px;font-size:13px;color:#1A1733">${bold(a.text)}<div style="font-size:11.5px;color:#9794AC;margin-top:2px">${esc(a.cat)}. ${esc(a.hint)}</div></div>`;
};

export function buildLeaderDigest(M: Model, leader: CellLeader, today: string, appUrl: string, warnings: string[]): LeaderDigest {
  const cfg = M.cfg;
  const f: Filters = { leader: leader.key, sdr: "", client: "", country: "" };
  const yesterday = previousBusinessDay(today);
  const month = today.slice(0, 7);
  const members = sdrList(M, f).filter((s) => !s.nodata && s.active !== false);
  const memberKeys = new Set(members.map((s) => s.key));
  const name = (k: string) => M.SD[k]?.name ?? k;
  const client = (id: string | null) => (id && M.CL[id] ? M.CL[id].name : "—");
  const hasAllo = M.alloMonths.has(monthOf(yesterday));

  // 1. Llamadas del día hábil anterior
  const Py = periodFromRange(yesterday, yesterday);
  const callRows = members.map((s) => {
    const a = agg(M, Py, sdrFilter(M, f, s.key));
    return { s, a, streak: callStreak(M, s.key, yesterday) };
  }).sort((x, y) => (x.a.callPct ?? 9) - (y.a.callPct ?? 9));
  const underGoal = callRows.filter((r) => r.a.callGoal > 0 && r.a.callsQ < cfg.callGoal);

  // 2. Reuniones
  const mine = M.meetings.filter((m) => memberKeys.has(m.sdr));
  const todayMtgs = mine.filter((m) => m.st === "pending" && m.md === today).sort((a, b) => name(a.sdr).localeCompare(name(b.sdr), "es"));
  const noShows = mine.filter((m) => m.st === "noshow" && m.md === yesterday);
  const heldY = mine.filter((m) => m.st === "held" && m.md === yesterday);
  const rescues = mine.filter((m) => m.st === "resch" && m.md && monthOf(m.md) === month && m.md < today);
  const incomplete = mine.filter((m) => m.st === "pending" && m.md && m.md < today).sort((a, b) => (a.md! < b.md! ? -1 : 1));

  // 3. Cumplimiento del mes
  const Pm = currentPeriod(M, "mes", month);
  const flCell = makeFilter(M, f);
  const fc = forecast(M, flCell, endOf(Pm));
  const monthRows = members.map((s) => {
    const fl = sdrFilter(M, f, s.key);
    const a = agg(M, Pm, fl);
    const sfc = forecast(M, fl, endOf(Pm));
    return { s, a, need: sfc.remaining > 0 ? sfc.need : null, goalM: sfc.goalM };
  }).filter((r) => r.goalM > 0).sort((x, y) => (x.a.compl ?? -1) - (y.a.compl ?? -1));

  // 4. Calidad (mes)
  const quality = monthRows
    .filter((r) => ok(r.a.qScore) && r.a.qN >= 3 && r.a.qScore! < cfg.qTarget)
    .map((r) => {
      const w = r.a.qCrit.map((v, i) => ({ v, i })).filter((x) => ok(x.v)).sort((x, y) => x.v! - y.v!)[0];
      return { ...r, weak: w ? `${QCRIT[w.i].s} (${fmt(w.v, 1)}/5)` : "—" };
    });

  // 5. Prioridades y destacados (mismas reglas que "Alertas de gestión")
  const alerts = buildAlerts(M, f, Pm).filter((a) => !a.sdr || memberKeys.has(a.sdr));
  const top = attention(alerts);
  const critical = alerts.filter((a) => a.lvl === "r").length;

  const dayTxt = dayLong(today);
  const yTxt = dayLong(yesterday);
  const subjectParts = [
    underGoal.length ? `${underGoal.length} bajo meta de llamadas` : null,
    `${todayMtgs.length} ${todayMtgs.length === 1 ? "reunión" : "reuniones"} hoy`,
    noShows.length ? `${noShows.length} no-show ayer` : null,
    incomplete.length ? `${incomplete.length} sin actualizar` : null,
  ].filter(Boolean);
  const subject = `Células SDR · Equipo ${leader.short} · ${dayTxt}: ${subjectParts.join(", ")}`;

  const link = `${appUrl.replace(/\/$/, "")}/analisis/celulas-sdr?leader=${encodeURIComponent(leader.key)}`;
  const fcSem: Sem = fc.st;

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#F4F2FB;font-family:Outfit,Arial,Helvetica,sans-serif;color:#1A1733">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F4F2FB;padding:20px 0"><tr><td align="center">
<table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#251762;padding:18px 24px;color:#fff">
  <div style="font-size:18px;font-weight:700">Bulls<span style="color:#62E0D8">Eye</span> · Células SDR</div>
  <div style="font-size:13px;color:#D9D4F2;margin-top:4px">Equipo ${esc(leader.name)} · ${esc(dayTxt[0].toUpperCase() + dayTxt.slice(1))}</div>
</td></tr>
${warnings.length ? `<tr><td style="padding:12px 24px 0"><div style="background:#FAEEDA;color:#854F0B;border-radius:8px;padding:8px 10px;font-size:12.5px">${warnings.map(esc).join("<br>")}</div></td></tr>` : ""}
<tr><td style="padding:16px 24px 0">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
    ${[
      ["Cumplimiento del mes", pct(div(fc.actual, fc.goalM)), `${fmt(fc.actual)} de ${fmt(fc.goalM)} reuniones`],
      ["Proyección de cierre", fmt(fc.proj), FC_TXT[fcSem]],
      ["Ritmo necesario", fc.remaining ? `${fmt(fc.need, 1)}/día` : "—", `actual ${fmt(fc.avg, 1)}/día`],
      ["Reuniones hoy", String(todayMtgs.length), `${fmt(fc.pending)} pendientes en agenda`],
    ].map(([l, v, sub]) => `<td width="25%" style="padding:4px"><div style="background:#F8F7FC;border-radius:10px;padding:10px"><div style="font-size:11.5px;color:#6B6884">${l}</div><div style="font-size:20px;font-weight:700;margin-top:2px">${esc(v)}</div><div style="font-size:11px;color:#9794AC">${esc(sub)}</div></div></td>`).join("")}
  </tr></table>
</td></tr>
${section("Prioridades del día", top.length ? top.map(alertLine).join("") : `<div style="font-size:13px;color:#6B6884">Sin situaciones críticas.</div>`)}
${section(
  `Llamadas de ayer · ${esc(yTxt)}`,
  hasAllo
    ? table(
      `<tr>${th("SDR", true)}${th("Llamadas")}${th("Meta")}${th("Conexión")}${th("Racha bajo meta")}</tr>`,
      callRows.map((r) => {
        const s: Sem = r.a.callGoal > 0 ? sem(M, r.a.callPct) : "n";
        return `<tr>${td(esc(r.s.name), true)}${td(`${fmt(r.a.callsQ)} ${r.a.callGoal > 0 ? pill(pct(r.a.callPct), s) : ""}`)}${td(fmt(cfg.callGoal))}${td(ok(r.a.conn) ? pct(r.a.conn, 1) : "—", false, ok(r.a.conn) && r.a.conn < cfg.connectMin ? `color:${COLORS.r};font-weight:600` : "")}${td(r.streak >= 2 ? pill(`${r.streak} días`, r.streak >= 3 ? "r" : "y") : "—")}</tr>`;
      })
    )
    : `<div style="font-size:13px;color:#854F0B">Las llamadas de Allo no estaban disponibles al generar este correo.</div>`,
  `Meta diaria ${cfg.callGoal} llamadas por SDR. Conexión mínima ${pct(cfg.connectMin)}.`
)}
${section(
  `Agenda de hoy (${todayMtgs.length})`,
  table(`<tr>${th("SDR", true)}${th("Cliente", true)}${th("Empresa", true)}</tr>`,
    todayMtgs.map((m) => `<tr>${td(esc(name(m.sdr)), true)}${td(esc(client(m.client)), true)}${td(esc(m.company || "—"), true)}</tr>`)),
  "Confirmar asistencia antes de la reunión reduce el no-show."
)}
${section(
  `Resultado de reuniones de ayer`,
  `<div style="font-size:13px;margin-bottom:6px">${heldY.length} realizadas · <b style="color:${noShows.length ? COLORS.r : "#1A1733"}">${noShows.length} no-show</b></div>` +
  (noShows.length ? table(`<tr>${th("SDR", true)}${th("Cliente", true)}${th("Empresa", true)}</tr>`, noShows.map((m) => `<tr>${td(esc(name(m.sdr)), true)}${td(esc(client(m.client)), true)}${td(esc(m.company || "—"), true)}</tr>`)) : "")
)}
${section(
  `Rescates y registros por actualizar`,
  table(`<tr>${th("SDR", true)}${th("Rescates (Reagendar) del mes")}${th("Pasadas aún en Pendiente")}</tr>`,
    members.map((s) => ({ s, r: rescues.filter((m) => m.sdr === s.key).length, i: incomplete.filter((m) => m.sdr === s.key).length }))
      .filter((x) => x.r || x.i)
      .map((x) => `<tr>${td(esc(x.s.name), true)}${td(x.r ? String(x.r) : "—")}${td(x.i ? pill(String(x.i), "y") : "—")}</tr>`)),
  incomplete.length ? `Las reuniones pasadas en "Pendiente" deben actualizarse en API Reuniones (Si / No / Reagendar). Más antigua: ${esc(dayLong(incomplete[0].md!))}.` : ""
)}
${section(
  `Cumplimiento del mes por SDR`,
  table(`<tr>${th("SDR", true)}${th("Realizadas / meta")}${th("Cumplimiento")}${th("Ritmo necesario")}${th("Pendientes")}</tr>`,
    monthRows.map((r) => `<tr>${td(esc(r.s.name), true)}${td(`${fmt(r.a.held)} / ${fmt(r.goalM)}`)}${td(pill(pct(div(r.a.held, r.goalM)), sem(M, div(r.a.held, r.goalM))))}${td(ok(r.need) ? `${fmt(r.need, 1)}/día` : "—")}${td(fmt(r.a.pending))}</tr>`)),
  `Cumplimiento contra la meta completa del mes (pestaña Asignación). Verde ≥ ${pct(cfg.green)}, amarillo ≥ ${pct(cfg.yellow)}.`
)}
${quality.length ? section(
  `Calidad de llamadas bajo la meta (${cfg.qTarget} pts)`,
  table(`<tr>${th("SDR", true)}${th("Puntaje")}${th("Evaluadas")}${th("Criterio a reforzar", true)}</tr>`,
    quality.map((r) => `<tr>${td(esc(r.s.name), true)}${td(pill(`${fmt(r.a.qScore)} · ${QBN[qBand(M, r.a.qScore!)]}`, qBand(M, r.a.qScore!) as Sem))}${td(fmt(r.a.qN))}${td(esc(r.weak), true)}</tr>`)),
  "Score de Desempeño SDR de Allo, llamadas conectadas del mes."
) : ""}
<tr><td style="padding:22px 24px 26px" align="center">
  <a href="${link}" style="display:inline-block;background:#3D2878;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px">Abrir Células SDR</a>
  <div style="font-size:11px;color:#9794AC;margin-top:12px">Correo automático de BullsEye. Datos: metas (Asignación), reuniones (API Reuniones, sincronizadas a diario), llamadas y score (Allo), actividades (HubSpot).</div>
</td></tr>
</table></td></tr></table></body></html>`;

  return {
    leader,
    subject,
    html,
    summary: { underGoal: underGoal.length, meetingsToday: todayMtgs.length, noShows: noShows.length, incomplete: incomplete.length, critical },
  };
}
