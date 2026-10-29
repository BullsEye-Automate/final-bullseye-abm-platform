import { supabaseAdmin } from "@/lib/supabase";
import type { RadarMeeting } from "../types";

// Pulso ABM — reuniones desde la planilla de reuniones (tabla meetings, la
// misma de Células SDR y del Excel de metas), no desde HubSpot: hay clientes
// con varias reuniones por empresa y la planilla es la fuente oficial.
// Cada reunión se asocia a una empresa del universo por nombre (normalizado,
// sin razón social) o por el dominio del correo del contacto, y al contacto
// por nombre. Las que no calzan con ninguna empresa se informan aparte.

const LEGAL = /\b(s\.?a\.?s?|s\.?p\.?a|spa|ltda|limitada|s\.?a\.?c|sac|inc|llc|corp|corporation|s\.?r\.?l|sl|sa de cv|cia|y cia|group|grupo|chile|peru|colombia|mexico)\b\.?/g;
const GENERIC_MAIL = new Set(["gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "live.com", "icloud.com"]);

export const normCompany = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(LEGAL, " ").replace(/[^a-z0-9]+/g, " ").trim();
const normPerson = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]+/g, " ").trim();
const rootDomain = (d: string | null | undefined) => (d ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].trim();

function meetingState(realizado: string | null | undefined): string {
  const v = (realizado ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  if (v === "si") return "Realizada";
  if (v === "no") return "No-show";
  if (v === "reagendar") return "Reprogramada";
  return "Pendiente";
}

// Resultado de la reunión: Propuesta/Oportunidad de la planilla y, si no, la
// encuesta de feedback del cliente
function meetingResult(opp: string | null | undefined, propuesta: string | null | undefined): string | undefined {
  const o = (opp ?? "").trim().toLowerCase();
  if (o === "si" || o === "sí" || o.startsWith("oportunidad") || o.startsWith("propuesta")) return "Oportunidad";
  switch (propuesta) {
    case "Si": return "Oportunidad";
    case "Falta otra reunión":
    case "No aún": return "Seguimiento";
    case "No": return "Sin avance";
    default: return undefined;
  }
}

export async function loadSheetMeetings(input: {
  clientId: string;
  start: string;
  companies: { id: string | number; n: string; domain?: string | null }[];
  contacts: { id: string | number; co: string | number; n: string }[];
  sdrOf: (co: string | number) => string;
}): Promise<{ meetings: RadarMeeting[]; unmatched: { empresa: string; n: number }[]; total: number; byClient: { name: string; n: number }[] }> {
  const supabase = supabaseAdmin();
  // La planilla puede tener el mismo cliente bajo otro registro con nombre
  // equivalente ("Coderslab" / "Coders Lab" / "CodersLab Chile"): se suman
  // las reuniones de todos los clientes cuyo nombre compacto calza
  const { data: allClients } = await supabase.from("clients").select("id, name");
  const compactName = (s: string | null | undefined) => normCompany(s).replace(/ /g, "");
  const own = (allClients ?? []).find((c: any) => c.id === input.clientId);
  const ownKey = compactName(own?.name);
  const clientIds = new Set<string>([input.clientId]);
  if (ownKey.length >= 4) {
    for (const c of allClients ?? []) {
      const k = compactName(c.name);
      if (k.length >= 4 && (k.startsWith(ownKey) || ownKey.startsWith(k))) clientIds.add(c.id);
    }
  }
  const nameOf = new Map((allClients ?? []).map((c: any) => [c.id, c.name as string]));
  const rows: any[] = [];
  const PAGE = 1000;
  for (let offset = 0; offset < 100000; offset += PAGE) {
    const { data, error } = await supabase
      .from("meetings")
      .select("id, client_id, empresa, contacto_nombre, contacto_cargo, correo, fecha_agendamiento, fecha_reunion, realizado, propuesta_oportunidad, responsable, sdr_nombre, origen, pais")
      .in("client_id", [...clientIds])
      .or(`fecha_reunion.gte.${input.start},fecha_agendamiento.gte.${input.start}`)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`No se pudieron leer las reuniones de la planilla: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  // Encuesta de feedback del cliente (calidad de la reunión, §7)
  const feedback = new Map<string, any>();
  const ids = rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabase
      .from("meeting_feedback")
      .select("meeting_id, calificacion, empresa_calificada, contacto_calificado, propuesta_comercial, comentarios_adicionales, probabilidad_cierre")
      .in("meeting_id", ids.slice(i, i + 300));
    for (const f of data ?? []) feedback.set(f.meeting_id, f);
  }

  // Índices de empresas: nombre exacto, dominio y nombre compacto
  const byName = new Map<string, (string | number)[]>();
  const byDomain = new Map<string, string | number>();
  const compact = input.companies.map((c) => ({ id: c.id, k: normCompany(c.n).replace(/ /g, "") })).filter((x) => x.k.length >= 4);
  for (const c of input.companies) {
    const k = normCompany(c.n);
    if (k) byName.set(k, [...(byName.get(k) ?? []), c.id]);
    const d = rootDomain(c.domain);
    if (d) byDomain.set(d, c.id);
  }
  const matchCompany = (empresa: string, correo: string | null): string | number | null => {
    const k = normCompany(empresa);
    const exact = byName.get(k);
    if (exact?.length === 1) return exact[0];
    const dom = rootDomain((correo ?? "").split("@")[1]);
    if (dom && !GENERIC_MAIL.has(dom) && byDomain.has(dom)) return byDomain.get(dom)!;
    const kc = k.replace(/ /g, "");
    if (kc.length >= 4) {
      const hits = compact.filter((x) => x.k.startsWith(kc) || kc.startsWith(x.k));
      if (hits.length === 1) return hits[0].id;
    }
    return null;
  };
  const ctByCo = new Map<string, { id: string | number; n: string }[]>();
  for (const k of input.contacts) {
    const key = String(k.co);
    ctByCo.set(key, [...(ctByCo.get(key) ?? []), { id: k.id, n: normPerson(k.n) }]);
  }

  const meetings: RadarMeeting[] = [];
  const unmatched = new Map<string, number>();
  for (const r of rows) {
    const empresa = (r.empresa ?? "").trim();
    const matched = matchCompany(empresa, r.correo);
    // Sin empresa en el universo igual cuenta como reunión (los totales deben
    // calzar con el Excel de metas); solo queda fuera de los cálculos por empresa
    if (matched == null) unmatched.set(empresa || "(sin empresa)", (unmatched.get(empresa || "(sin empresa)") ?? 0) + 1);
    const co = matched ?? `nc:${normCompany(empresa) || r.id}`;
    const fecha = r.fecha_reunion ?? r.fecha_agendamiento;
    const agendada = r.fecha_agendamiento ?? r.fecha_reunion;
    if (!fecha || !agendada) continue;
    const pn = normPerson(r.contacto_nombre);
    const ct = pn ? (ctByCo.get(String(co)) ?? []).find((k) => k.n === pn || k.n.startsWith(pn + " ") || pn.startsWith(k.n + " "))?.id : undefined;
    const st = meetingState(r.realizado);
    const f = feedback.get(r.id);
    const res = meetingResult(r.propuesta_oportunidad, f?.propuesta_comercial);
    const fb = f ? [f.calificacion != null ? `Calificación ${f.calificacion}/10` : "", (f.comentarios_adicionales ?? "").trim()].filter(Boolean).join(" · ") : "";
    meetings.push({
      id: r.id,
      // Sin contacto en HubSpot: un id propio para no fusionar interlocutores
      ct: ct ?? `mt:${pn || r.id}`,
      ...(empresa ? { emp: empresa } : {}),
      ...(r.contacto_nombre ? { ctn: String(r.contacto_nombre).trim() } : {}),
      // Datos completos de la planilla (vista Reuniones)
      ...(r.contacto_cargo ? { cargo: String(r.contacto_cargo).trim() } : {}),
      ...(r.origen ? { org: String(r.origen).trim() } : {}),
      ...(r.pais ? { pais: String(r.pais).trim() } : {}),
      ...(r.propuesta_oportunidad ? { oppv: String(r.propuesta_oportunidad).trim() } : {}),
      // Encuesta del cliente (vista Feedback comercial)
      ...(f ? { fbk: 1 as const } : {}),
      ...(f?.calificacion != null ? { cal: Number(f.calificacion) } : {}),
      ...(f?.probabilidad_cierre != null ? { prob: Number(f.probabilidad_cierre) } : {}),
      ...(f?.propuesta_comercial ? { prop: String(f.propuesta_comercial) } : {}),
      ...(f?.comentarios_adicionales?.trim() ? { com: String(f.comentarios_adicionales).trim().slice(0, 600) } : {}),
      co,
      sdr: (r.responsable || r.sdr_nombre || "").trim() || input.sdrOf(co),
      agendada, fecha, st,
      ...(st === "Reprogramada" ? { reprog: true } : {}),
      ...(f?.empresa_calificada != null ? { icpfit: !!f.empresa_calificada } : {}),
      ...(f?.contacto_calificado != null ? { okct: !!f.contacto_calificado } : {}),
      ...(res ? { res } : {}),
      ...(f?.propuesta_comercial === "Falta otra reunión" ? { next: true } : {}),
      ...(fb ? { fb } : {}),
    });
  }
  const perClient = new Map<string, number>();
  for (const r of rows) perClient.set(r.client_id, (perClient.get(r.client_id) ?? 0) + 1);
  return {
    byClient: Array.from(perClient.entries()).map(([id, n]) => ({ name: nameOf.get(id) ?? id, n })),
    meetings,
    unmatched: Array.from(unmatched.entries()).map(([empresa, n]) => ({ empresa, n })).sort((a, b) => b.n - a.n),
    total: rows.length,
  };
}
