// Lectura de la planilla "Metas equipo BullsEye / reuniones / oportunidades"
// (la misma que sincroniza las reuniones — GOOGLE_SHEETS_MEETINGS_ID) para
// el módulo Células SDR:
// - Pestaña "Asignación": meta mensual de reuniones realizadas por SDR ×
//   cliente (la "meta interna", de disponibilidad del equipo).
// - Pestaña "Maestra IA": líderes de célula con sus integrantes (columnas O
//   y P) y el estado (Activo/Inactivo) de cada responsable.
import { getSheetValues } from "@/lib/googleSheets";
import { normalizeSdrName, resolveSdrKey } from "@/lib/sdrAnalytics";
import type { DataWarning } from "./types";

const ASSIGNMENT_TAB = "Asignación";
const MASTER_TAB = "Maestra IA";

// Apodos de las columnas de Asignación (y de la fila de líderes de la
// Maestra) que no se pueden deducir por el nombre de pila. Confirmados con
// BullsEye. Si aparece un apodo nuevo que no calza, se agrega una línea acá
// (la pantalla avisa cuáles columnas no se reconocieron).
const PERSON_NICKNAMES: Record<string, string> = {
  [normalizeSdrName("Nico N")]: "Nicolle Nazar",
  [normalizeSdrName("Nico")]: "Nicolle Nazar",
  [normalizeSdrName("Vanesa")]: "Vanessa Abarzua",
  [normalizeSdrName("Vane")]: "Vanessa Abarzua",
  [normalizeSdrName("Angeles")]: "María de los Ángeles Pérez",
  [normalizeSdrName("Lore")]: "Lorena Rosales",
  [normalizeSdrName("Cote")]: "María José",
  [normalizeSdrName("Consu")]: "Consuelo Contador",
};

// Columnas de la matriz de Asignación que no son SDR.
const NON_SDR_HEADER = /^(meta|ideal|#|%|sdr\s*\d*$|empresas|tasa|comentario|cumplim|agendad|realizad|total|peso|kam|nota)/;

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

function norm(s: string): string {
  return normalizeSdrName(s ?? "");
}

export type MasterData = {
  // Nombres completos conocidos (columna Responsable + integrantes de célula)
  people: { name: string; active: boolean | null }[];
  cells: { leader: string; members: string[] }[];
};

// Resuelve un nombre / apodo de la planilla al nombre completo de la
// Maestra: 1) apodo confirmado, 2) nombre exacto, 3) nombre de pila único.
export function makePersonResolver(people: { name: string; active: boolean | null }[]) {
  const byFull = new Map<string, string>();
  const byFirst = new Map<string, string[]>();
  for (const p of people) {
    const n = norm(p.name);
    if (!n) continue;
    byFull.set(n, p.name);
    const first = n.split(" ")[0];
    const list = byFirst.get(first) ?? [];
    if (!list.includes(p.name)) list.push(p.name);
    byFirst.set(first, list);
  }
  const activeOf = new Map(people.map((p) => [norm(p.name), p.active]));
  return (raw: string): { name: string; known: boolean } => {
    const n = norm(raw);
    if (!n) return { name: raw, known: false };
    if (PERSON_NICKNAMES[n]) return { name: PERSON_NICKNAMES[n], known: true };
    if (byFull.has(n)) return { name: byFull.get(n)!, known: true };
    const cands = byFirst.get(n.split(" ")[0]) ?? [];
    if (n.split(" ").length === 1 && cands.length >= 1) {
      if (cands.length === 1) return { name: cands[0], known: true };
      const active = cands.filter((c) => activeOf.get(norm(c)) === true);
      if (active.length === 1) return { name: active[0], known: true };
    }
    return { name: raw.trim(), known: false };
  };
}

export async function readMaster(spreadsheetId: string, warnings: DataWarning[]): Promise<MasterData> {
  const rows = await getSheetValues(spreadsheetId, `'${MASTER_TAB}'!A1:Z200`);
  const people: MasterData["people"] = [];

  // Columna Responsable / Status Responsable, ubicadas por su encabezado.
  const headerIdx = rows.findIndex((r) => r.some((c) => norm(c) === "responsable"));
  if (headerIdx >= 0) {
    const h = rows[headerIdx].map(norm);
    const cName = h.indexOf("responsable");
    const cStatus = h.indexOf("status responsable");
    for (const r of rows.slice(headerIdx + 1)) {
      const name = (r[cName] ?? "").replace(/​/g, "").trim();
      if (!name) continue;
      const st = norm(r[cStatus] ?? "");
      people.push({ name, active: st === "activo" ? true : st === "inactivo" ? false : null });
    }
  } else {
    warnings.push({ source: "Maestra IA", message: "No se encontró la columna \"Responsable\"." });
  }

  // Líderes de célula: columnas O y P. En cada columna, el primer nombre
  // bajo el encabezado "Lideres de celulas" es el líder y los siguientes
  // son los integrantes de su célula.
  const cellsRaw: { leader: string; members: string[] }[] = [];
  for (const col of [14, 15]) {
    const vals = rows.map((r) => (r[col] ?? "").replace(/​/g, "").trim()).filter(Boolean);
    const list = vals.filter((v) => !/^lideres? de c[eé]lulas?$/i.test(v.normalize("NFD").replace(/\p{Diacritic}/gu, "")));
    if (list.length === 0) continue;
    cellsRaw.push({ leader: list[0], members: list.slice(1) });
  }
  if (cellsRaw.length === 0) {
    warnings.push({ source: "Maestra IA", message: "No se encontraron líderes de célula en las columnas O y P." });
  }

  // Los integrantes de célula también son personas conocidas aunque no
  // estén en la columna Responsable (ej. Pamela Alveal).
  const known = new Set(people.map((p) => norm(p.name)));
  for (const c of cellsRaw) {
    for (const m of c.members) {
      if (!known.has(norm(m))) {
        people.push({ name: m, active: null });
        known.add(norm(m));
      }
    }
  }
  const resolve = makePersonResolver(people);
  const cells = cellsRaw.map((c) => ({
    leader: resolve(c.leader).name,
    members: c.members.map((m) => resolve(m).name),
  }));
  return { people, cells };
}

export type RawGoal = { month: string; person: string; client: string; goal: number };

// Parsea la matriz de "Asignación": bloques apilados, uno por mes
// ("Septiembre", "octubre 2026", ...), cada uno con una fila "Cliente |
// <apodo SDR> | ... " y una fila por cliente con la meta de cada SDR. Las
// filas "Meta", "Agendadas", "Realizadas" y "Cumplimiento" cierran el
// bloque. Columnas como "Meta interna", "Meta Cliente", "Ideal" o "#SDR"
// se ignoran: la meta del cliente es la suma de las metas de sus SDR.
export function parseAssignment(
  rows: string[][],
  resolve: (raw: string) => { name: string; known: boolean },
  warnings: DataWarning[],
  fallbackYear: number
): RawGoal[] {
  type Block = { monthIdx: number; year: number | null; header: string[]; rows: string[][]; label: string };
  const blocks: Block[] = [];
  let pending: { monthIdx: number; year: number | null; label: string } | null = null;
  let cur: Block | null = null;

  for (const r of rows) {
    const a = norm(r[0] ?? "");
    const mm = a.match(/^(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b\s*(\d{4})?/);
    if (mm && !(r[1] ?? "").trim()) {
      pending = { monthIdx: MONTHS[mm[1]], year: mm[2] ? Number(mm[2]) : null, label: (r[0] ?? "").trim() };
      cur = null;
      continue;
    }
    if (a === "cliente" && pending) {
      cur = { ...pending, header: r.map((c) => (c ?? "").trim()), rows: [] };
      blocks.push(cur);
      pending = null;
      continue;
    }
    if (!cur) continue;
    if (!a) continue;
    if (/^(meta|agendad|realizad|cumplim|total)/.test(a)) {
      cur = null;
      continue;
    }
    cur.rows.push(r);
  }

  // Año de cada bloque: el explícito ("octubre 2026") o, si no viene, el
  // deducido del orden cronológico de los bloques vecinos.
  const years: number[] = new Array(blocks.length).fill(NaN);
  const firstExplicit = blocks.findIndex((b) => b.year != null);
  if (firstExplicit === -1) {
    for (let i = blocks.length - 1; i >= 0; i--) {
      years[i] = i === blocks.length - 1 ? fallbackYear
        : blocks[i].monthIdx < blocks[i + 1].monthIdx ? years[i + 1] : years[i + 1] - 1;
    }
  } else {
    years[firstExplicit] = blocks[firstExplicit].year!;
    for (let i = firstExplicit - 1; i >= 0; i--) {
      years[i] = blocks[i].year ?? (blocks[i].monthIdx < blocks[i + 1].monthIdx ? years[i + 1] : years[i + 1] - 1);
    }
    for (let i = firstExplicit + 1; i < blocks.length; i++) {
      years[i] = blocks[i].year ?? (blocks[i].monthIdx >= blocks[i - 1].monthIdx ? years[i - 1] : years[i - 1] + 1);
    }
  }

  // Si un mes aparece dos veces, gana el último bloque de la hoja.
  const byMonth = new Map<string, RawGoal[]>();
  const unknownCols = new Set<string>();
  blocks.forEach((b, i) => {
    const month = `${years[i]}-${String(b.monthIdx).padStart(2, "0")}`;
    const sdrCols: { idx: number; person: string }[] = [];
    b.header.forEach((h, idx) => {
      if (idx === 0 || !h) return;
      if (NON_SDR_HEADER.test(norm(h))) return;
      const res = resolve(h);
      if (!res.known) unknownCols.add(`${b.label}: "${h}"`);
      sdrCols.push({ idx, person: res.name });
    });
    const out: RawGoal[] = [];
    for (const r of b.rows) {
      const client = (r[0] ?? "").trim();
      for (const { idx, person } of sdrCols) {
        const raw = (r[idx] ?? "").replace(",", ".").trim();
        if (!/^\d+(\.\d+)?$/.test(raw)) continue;
        const goal = Number(raw);
        if (goal > 0) out.push({ month, person, client, goal });
      }
    }
    byMonth.set(month, out);
  });
  if (unknownCols.size) {
    warnings.push({
      source: "Asignación",
      message: `Columnas de SDR que no calzan con la Maestra (se usan con el nombre tal cual): ${[...unknownCols].join(", ")}.`,
    });
  }
  return [...byMonth.values()].flat();
}

export async function readAssignment(
  spreadsheetId: string,
  resolve: (raw: string) => { name: string; known: boolean },
  warnings: DataWarning[],
  fallbackYear: number
): Promise<RawGoal[]> {
  const rows = await getSheetValues(spreadsheetId, `'${ASSIGNMENT_TAB}'!A1:AZ2000`);
  return parseAssignment(rows, resolve, warnings, fallbackYear);
}

export { resolveSdrKey };
