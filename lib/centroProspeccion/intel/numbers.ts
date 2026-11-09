import type { RadarDataset } from "@/lib/radarAbm/types";

// Números de la cuenta para la Inteligencia de la semana, calculados del
// último informe del Pulso ABM (HubSpot + planilla de reuniones):
//  - stock: contactos asignados que los SDR aún no tocan y cuántos días de
//    trabajo son al ritmo de las últimas 2 semanas;
//  - segmentos: contactabilidad y reuniones por industria, área, seniority y
//    país (solo segmentos con muestra suficiente).

export type Segment = { dim: "industria" | "area" | "seniority" | "pais"; valor: string; trabajados: number; conectados: number; reuniones: number; tasaConexion: number; tasaReunion: number };
export type IntelNumbers = {
  corte: string | null;
  empresas: number;
  contactos: number;
  sinGestion: number;            // contactos sin ninguna actividad
  tocados14d: number;            // contactos con actividad en los últimos 14 días
  ritmoDiario: number;           // contactos nuevos tocados por día hábil (aprox.)
  diasStock: number | null;      // sinGestion / ritmoDiario
  reuniones30d: number;
  realizadas30d: number;
  empresasSinContacto: number;   // empresas asignadas sin contactos cargados
  mejores: Segment[];
  peores: Segment[];
  sdrs: string[];
};

const MIN_SAMPLE = 8;
const dayMs = 86_400_000;

function businessDaysBetween(from: Date, to: Date): number {
  let n = 0;
  for (let d = new Date(from); d <= to; d = new Date(d.getTime() + dayMs)) {
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return Math.max(1, n);
}

export function computeNumbers(ds: RadarDataset | null | undefined, today = new Date()): IntelNumbers | null {
  const c = ds?.client;
  if (!c) return null;
  const since14 = new Date(today.getTime() - 14 * dayMs).toISOString().slice(0, 10);
  const since30 = new Date(today.getTime() - 30 * dayMs).toISOString().slice(0, 10);
  const acts = c.activities ?? [];

  // Primera actividad por contacto (para contar contactos "nuevos" tocados)
  const firstAct = new Map<string, string>();
  const touched14 = new Set<string>();
  for (const a of acts) {
    if (a.ct == null || !a.d) continue;
    const k = String(a.ct);
    const prev = firstAct.get(k);
    if (!prev || a.d < prev) firstAct.set(k, a.d);
    if (a.d >= since14) touched14.add(k);
  }
  const hasActivity = (ct: { id: number | string; att?: number; calls?: number; wa?: number; li?: number; em?: number }) =>
    firstAct.has(String(ct.id)) || !!(ct.att || ct.calls || ct.wa || ct.li || ct.em);
  const sinGestion = c.contacts.filter((ct) => !hasActivity(ct)).length;
  const nuevos14 = Array.from(firstAct.values()).filter((d) => d >= since14).length;
  const ritmo = nuevos14 / businessDaysBetween(new Date(today.getTime() - 14 * dayMs), today);
  const diasStock = ritmo >= 0.5 ? Math.round(sinGestion / ritmo) : null;

  const coById = new Map(c.companies.map((co) => [String(co.id), co]));
  const ctWithMeeting = new Set(c.meetings.map((m) => String(m.ct)));
  const coWithMeeting = new Set(c.meetings.map((m) => String(m.co)));
  const contactsPerCo = new Map<string, number>();
  for (const ct of c.contacts) contactsPerCo.set(String(ct.co), (contactsPerCo.get(String(ct.co)) ?? 0) + 1);

  // Segmentos: sobre contactos trabajados (con al menos un intento o actividad)
  const seg = new Map<string, Segment>();
  const bump = (dim: Segment["dim"], valor: string | null | undefined, conn: boolean, mtg: boolean) => {
    const v = (valor ?? "").trim();
    if (!v || /^sin |^s\/i$|^otro/i.test(v)) return;
    const k = `${dim}|${v}`;
    const s = seg.get(k) ?? { dim, valor: v, trabajados: 0, conectados: 0, reuniones: 0, tasaConexion: 0, tasaReunion: 0 };
    s.trabajados++;
    if (conn) s.conectados++;
    if (mtg) s.reuniones++;
    seg.set(k, s);
  };
  for (const ct of c.contacts) {
    if (!hasActivity(ct)) continue;
    const co = coById.get(String(ct.co));
    const conn = (ct.conv ?? 0) > 0 || !!ct.fu;
    const mtg = ctWithMeeting.has(String(ct.id)) || (co ? coWithMeeting.has(String(co.id)) && conn : false);
    bump("area", ct.area, conn, mtg);
    bump("seniority", ct.sen, conn, mtg);
    bump("industria", co?.ind ?? null, conn, mtg);
    bump("pais", co?.pais ?? null, conn, mtg);
  }
  const all = Array.from(seg.values())
    .filter((s) => s.trabajados >= MIN_SAMPLE)
    .map((s) => ({ ...s, tasaConexion: Math.round((s.conectados / s.trabajados) * 100), tasaReunion: Math.round((s.reuniones / s.trabajados) * 1000) / 10 }));
  const score = (s: Segment) => s.tasaReunion * 3 + s.tasaConexion;
  const sorted = [...all].sort((a, b) => score(b) - score(a));

  const m30 = c.meetings.filter((m) => (m.agendada || m.fecha || "") >= since30);
  return {
    corte: ds?.generated ?? null,
    empresas: c.companies.length,
    contactos: c.contacts.length,
    sinGestion,
    tocados14d: touched14.size,
    ritmoDiario: Math.round(ritmo * 10) / 10,
    diasStock,
    reuniones30d: m30.length,
    realizadas30d: m30.filter((m) => m.st === "Realizada").length,
    empresasSinContacto: c.companies.filter((co) => !contactsPerCo.get(String(co.id))).length,
    mejores: sorted.slice(0, 6),
    peores: sorted.slice(-6).reverse().filter((s) => !sorted.slice(0, 6).includes(s)),
    sdrs: c.sdrs ?? [],
  };
}
