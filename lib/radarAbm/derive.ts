import type { RadarClientData, RadarCompany, RadarConfig, RadarContact, RadarDeal, RadarMeeting } from "./types";
import { EFF, PEND, PAUSA } from "./dictionaries";
import { dmy } from "./engine";

// Pulso ABM — campos derivados (§3.2, §5 y §7 del prompt maestro).
// El sync de HubSpot entrega registros "planos" y acá se calculan los mismos
// campos que el prototipo trae precalculados en sus datos demo: tamaño,
// área / seniority desde el cargo, conteos por empresa, profundidad,
// prioridad de cuenta y próximo paso de cada contacto.

export type FlatCompany = Omit<RadarCompany, "size" | "nct" | "nmg" | "neff" | "areas" | "msch" | "mheld" | "fu" | "opp" | "depth" | "prio" | "why"> & {
  employees: number | null;
};
export type FlatContact = Omit<RadarContact, "area" | "sen" | "ps" | "fu"> & { area?: string; sen?: string };

const strip = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function sizeFromEmployees(n: number | null, tiers: RadarConfig["sizeTiers"]): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "Sin dato";
  if (n <= tiers.pymeMax) return "Pyme";
  if (n <= tiers.midMax) return "Mid-market";
  return "Enterprise";
}

// Área y seniority desde el cargo con la tabla de equivalencias editable.
// Palabras clave cortas (ti, it, vp…) solo calzan como palabra completa.
export function classifyTitle(title: string | undefined | null, rules: RadarConfig["titleRules"]): { area: string; sen: string } {
  const t = ` ${strip(title ?? "").replace(/[^a-z0-9]+/g, " ").trim()} `;
  let area = "", sen = "";
  if (t.trim()) {
    for (const r of rules) {
      const kw = strip(r.kw).trim();
      if (!kw) continue;
      const hit = kw.length <= 3 ? t.includes(` ${kw} `) : t.includes(kw);
      if (!hit) continue;
      if (r.area && !area) area = r.area;
      if (r.sen && !sen) sen = r.sen;
      if (area && sen) break;
    }
  }
  return { area: area || "Sin área", sen: sen || (t.trim() ? "Especialista" : "Sin seniority") };
}

// Próximo paso por contacto (§7). Mismos textos que los datos demo.
function nextStep(k: FlatContact & { fu?: string }, meeting: RadarMeeting | undefined, referred: FlatContact | undefined, today: string): string {
  switch (k.st) {
    case "Hot Calling 🔥": return "Llamar hoy (Hot Calling)";
    case "Por gestionar": return k.att ? `Continuar intentos (${k.att}/10)` : "Primer intento pendiente";
    case "Buscar": return "Búsqueda masiva de teléfono";
    case "Hacer Seguimiento":
      if (!k.next) return "Sin próxima acción: definir fecha";
      return k.next < today ? `Seguimiento vencido desde ${dmy(k.next)}` : `Seguimiento el ${dmy(k.next)}`;
    case "Reunión Agendada":
      if (!meeting) return "Registrar la reunión en HubSpot";
      if (meeting.st === "Realizada") return meeting.res ? `Post-reunión: ${meeting.res}` : "Reunión realizada: registrar feedback";
      if (meeting.st === "No-show") return "Reagendar (no-show)";
      if (meeting.st === "Cancelada") return "Reagendar (cancelada)";
      if (meeting.st === "Reprogramada") return `Reprogramada al ${dmy(meeting.fecha)}`;
      return `Reunión el ${dmy(meeting.fecha)}`;
    case "Refiere con el Tomador de Decisiones":
      return referred ? `Referido creado: ${referred.st}` : "Crear y contactar al decisor referido";
    case "En Gestión LinkedIn": return "Continuar gestión LinkedIn";
    case "No Contestó": return "Pausar; reintentar por otro canal";
    case "Sin Información de Contacto": return "Enriquecer datos de contacto";
    case "NO gestionar": return "No volver a contactar";
    case "Gestionado - No Interesado": return "Cerrado; revisar en próximo ciclo";
    case PAUSA: return "En pausa por reunión de la empresa";
    default: return "—";
  }
}

const NO_PRIO = (st: string) => st === "No califica" || st === "Clientes" || st.startsWith("En conversaciones");

export function deriveClientData(input: {
  name: string;
  universe?: number | null;
  deep?: boolean;
  pipeline: boolean;
  companies: FlatCompany[];
  contacts: FlatContact[];
  meetings: RadarMeeting[];
  deals: RadarDeal[];
  cfg: RadarConfig;
  today: string;
}): RadarClientData {
  const { cfg, today } = input;

  // Tipo de seguimiento: conversación existente del cliente, retomar (hay
  // objeción de momento o proyecto futuro) o interés activo
  const coStatus = new Map(input.companies.map((c) => [c.id, c.st]));
  const contacts: RadarContact[] = input.contacts.map((k) => {
    const cls = k.area && k.sen ? { area: k.area, sen: k.sen } : classifyTitle(k.cargo, cfg.titleRules);
    const fu: RadarContact["fu"] = k.st !== "Hacer Seguimiento" ? undefined
      : (coStatus.get(k.co) ?? "").startsWith("En conversaciones") ? "conv"
      : k.obj || k.sig === "Indica proyecto futuro" ? "retomar" : "interes";
    return { ...k, area: cls.area, sen: cls.sen, fu, ps: "" };
  });
  const ctById = new Map(contacts.map((k) => [k.id, k]));
  const referredBy = new Map<string | number, RadarContact>();
  for (const k of contacts) if (k.refBy != null && !referredBy.has(k.refBy)) referredBy.set(k.refBy, k);
  // Reunión más reciente por contacto (la que define el próximo paso)
  const lastMeeting = new Map<string | number, RadarMeeting>();
  for (const m of input.meetings) {
    const prev = lastMeeting.get(m.ct);
    if (!prev || (m.fecha || "") > (prev.fecha || "")) lastMeeting.set(m.ct, m);
  }
  for (const k of contacts) k.ps = nextStep(k, lastMeeting.get(k.id), referredBy.get(k.id), today);

  const ctByCo = new Map<string | number, RadarContact[]>();
  for (const k of contacts) {
    const arr = ctByCo.get(k.co) ?? [];
    arr.push(k);
    ctByCo.set(k.co, arr);
  }
  const mtByCo = new Map<string | number, RadarMeeting[]>();
  for (const m of input.meetings) {
    const arr = mtByCo.get(m.co) ?? [];
    arr.push(m);
    mtByCo.set(m.co, arr);
  }
  const openDealCo = new Set(input.deals.filter((d) => d.stage !== "Perdido").map((d) => d.co));

  const companies: RadarCompany[] = input.companies.map((c) => {
    const K = ctByCo.get(c.id) ?? [];
    const M = mtByCo.get(c.id) ?? [];
    const eff = K.filter((k) => EFF.has(k.st));
    const areas = Array.from(new Set(eff.map((k) => k.area).filter((a) => a && a !== "Sin área")));
    const held = M.filter((m) => m.st === "Realizada");
    const depth = eff.length >= 3 || (eff.length >= 2 && areas.length >= 2) ? "Profunda" : eff.length >= 2 ? "Multi-thread" : eff.length === 1 ? "Single-thread" : "Sin contacto efectivo";
    const opp = held.some((m) => m.res === "Oportunidad") || openDealCo.has(c.id);

    // Prioridad de cuenta (§7)
    let pts = 0;
    const why: string[] = [];
    if (!NO_PRIO(c.st)) {
      const add = (n: number, w: string) => { pts += n; why.push(w); };
      if (held.some((m) => m.res === "Oportunidad" || m.res === "Seguimiento")) add(3, "reunión realizada con avance");
      if (M.some((m) => (m.st === "Pendiente" && m.fecha >= today) || m.st === "Reprogramada")) add(2, "reunión próxima");
      if (K.some((k) => k.fu === "interes")) add(2, "interés activo");
      if (K.some((k) => k.st === "Refiere con el Tomador de Decisiones" && !referredBy.has(k.id))) add(2, "referral sin trabajar");
      if (K.some((k) => k.refBy != null && PEND.has(k.st))) add(1, "referido pendiente");
      if (c.st === "Sin interés ahora - Retomar" || K.some((k) => k.fu === "retomar" || k.sig === "Indica proyecto futuro")) add(1, "proyecto futuro / retomar");
      if (eff.length >= 2) add(1, "varios interlocutores");
      if (pts > 0 && c.icp === "A") add(1, "ICP A");
    }
    const prio = pts >= 4 ? "Alta" : pts >= 2 ? "Media" : pts === 1 ? "Baja" : "";

    return {
      id: c.id, n: c.n, ind: c.ind, pais: c.pais, size: sizeFromEmployees(c.employees, cfg.sizeTiers), icp: c.icp, sdr: c.sdr,
      asg: c.asg, st: c.st, ...(c.wl ? { wl: c.wl } : {}), ...(c.next ? { next: c.next } : {}),
      nct: K.length, nmg: K.filter((k) => !PEND.has(k.st) && k.st !== PAUSA).length, neff: eff.length, areas,
      msch: M.length, mheld: held.length, fu: K.some((k) => k.st === "Hacer Seguimiento"), opp, depth, prio, why: why.join(", "),
    };
  });

  // Reuniones: completar ICP y "contacto correcto" para la calidad (§7)
  const coById = new Map(companies.map((c) => [c.id, c]));
  const meetings = input.meetings.map((m) => {
    const c = coById.get(m.co), k = ctById.get(m.ct);
    const seniorOk = k ? ["C-Level", "Director", "Gerente"].includes(k.sen) : false;
    const areaOk = k ? ["Tecnología", "Operaciones", "Gerencia General"].includes(k.area) : false;
    return {
      ...m,
      icpfit: m.icpfit ?? (c && ["A", "B"].includes(c.icp) ? true : c && c.icp === "C" ? false : undefined),
      okct: m.okct ?? (k ? seniorOk && areaOk : undefined),
    };
  });

  const sdrs = Array.from(new Set(companies.map((c) => c.sdr).filter((s) => s && s !== "Sin SDR"))).sort();
  return {
    name: input.name,
    universe: input.universe || companies.length,
    sdrs,
    pipeline: input.pipeline,
    deep: input.deep ?? companies.length <= 40,
    companies,
    contacts,
    meetings,
    deals: input.deals,
  };
}
