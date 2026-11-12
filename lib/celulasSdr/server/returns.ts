import { supabaseAdmin } from "@/lib/supabase";
import { resolveSdrKey } from "@/lib/sdrAnalytics";
import { readMaster, readAssignment, makePersonResolver } from "@/lib/celulasSdr/sheets";
import { buildClientDirectory } from "./clientAccounts";
import { canonicalCountry } from "@/lib/celulasSdr/country";
import { chileToday } from "@/lib/celulasSdr/calendar";
import { readMonthCache, writeMonthCache } from "@/lib/celulasSdr/cache";
import { loadAllDatasets } from "@/lib/radarAbm/server/store";
import { findMasterRow, readMasterClients } from "@/lib/radarAbm/server/masterClients";
import type { DataWarning, ReturnRow, ReturnsResponse } from "@/lib/celulasSdr/types";

// Módulo Células SDR — Devoluciones (nov-2026, a pedido de BullsEye: lo miden
// las líderes de célula). Lee los informes ya sincronizados de Pulso ABM de
// cada cliente activo (no consulta HubSpot) y cuenta, por SDR y cliente:
//  - empresas trabajadas = con alguna actividad (llamada, correo, WhatsApp o
//    LinkedIn); el mes es el de su última actividad,
//  - empresas devueltas = status de La Biblia que devuelven la cuenta a
//    prospección (COMPANY_RETURN), y cuántas sin ningún llamado,
//  - contactos devueltos de esas empresas = "Contacto No Fit para gestión" o
//    "Sin Información de Contacto", y cuántos sin ningún intento.
// El status es el actual (Pulso no guarda cuándo cambió). Solo conteos: sin
// nombres de empresas ni de contactos.

const norm = (v: string | null | undefined) =>
  (v ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");

// status normalizado → etiqueta que se muestra
export const COMPANY_RETURN: Record<string, string> = {
  [norm("No califica")]: "No califica",
  [norm("Gestionada - sin contactos fit")]: "Sin contactos fit",
  [norm("Gestionada - sin comunicación")]: "Sin comunicación",
  [norm("Nutrir")]: "Nutrir",
  [norm("Sin contactos - (ya nutrida)")]: "Sin contactos (ya nutrida)",
};
export const CONTACT_RETURN: Record<string, string> = {
  [norm("Contacto No Fit para gestión")]: "No fit",
  [norm("Contacto No Fit para Llamada")]: "No fit",
  [norm("Sin Información de Contacto")]: "Sin información de contacto",
};

const CACHE_TTL = 6 * 3600_000;
const MONTHS_BACK = 12;

export async function loadReturns(fresh = false): Promise<ReturnsResponse> {
  const today = chileToday();
  const key = `celulas_devoluciones:v1:${today}`;
  if (!fresh) {
    const hit = await readMonthCache<ReturnsResponse>(key);
    if (hit) return hit;
  }

  const spreadsheetId = process.env.GOOGLE_SHEETS_MEETINGS_ID;
  if (!spreadsheetId) throw new Error("GOOGLE_SHEETS_MEETINGS_ID no configurado");
  const warnings: DataWarning[] = [];
  const master = await readMaster(spreadsheetId, warnings);
  const resolvePerson = makePersonResolver(master.people);
  const db = supabaseAdmin();
  const { data: clientRows } = await db.from("clients").select("id, name, slug");
  const clients = (clientRows ?? []) as { id: string; name: string; slug: string | null }[];
  const rawGoals = await readAssignment(spreadsheetId, resolvePerson, warnings, Number(today.slice(0, 4))).catch(() => []);
  const dir = buildClientDirectory(clients as any, rawGoals);

  // Solo clientes activos en la Maestra (misma regla que Pulso ABM)
  const masterRows = await readMasterClients();
  const active = clients.filter((c) => findMasterRow(masterRows, c)?.active);
  const { data: snaps } = await db.from("radar_abm_snapshots").select("client_id");
  const withSnap = new Set((snaps ?? []).map((x: { client_id: string }) => x.client_id));

  const minMonth = (() => {
    const d = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - (MONTHS_BACK - 1));
    return d.toISOString().slice(0, 7);
  })();

  const byKey = new Map<string, ReturnRow>();
  const sdrNames: Record<string, string> = {};
  const clientNames: Record<string, string> = {};
  const sources: ReturnsResponse["sources"] = [];
  const missing: string[] = [];
  const row = (m: string, s: string, c: string | null, k: string | null): ReturnRow => {
    const id = `${m}|${s}|${c ?? ""}|${k ?? ""}`;
    let r = byKey.get(id);
    if (!r) { r = { m, s, c, k, w: 0, r: 0, rn: 0, rr: {}, ct: 0, cr: 0, crn: 0, cs: {} }; byKey.set(id, r); }
    return r;
  };
  const sdrKey = (raw: string | null | undefined) => {
    const person = resolvePerson((raw || "Sin SDR asignado").trim()).name;
    const s = resolveSdrKey(person);
    sdrNames[s] = sdrNames[s] ?? person;
    return s;
  };

  // De a uno: los informes grandes (Crossnet) pesan decenas de MB
  for (const cl of active) {
    if (!withSnap.has(cl.id)) { missing.push(cl.name); continue; }
    let sets: Awaited<ReturnType<typeof loadAllDatasets>>;
    try { sets = await loadAllDatasets(cl.id); } catch { missing.push(cl.name); continue; }
    for (const { sub, dataset, syncedAt } of sets) {
      sources.push({ client: sub || cl.name, syncedAt });
      const d = dataset.client;
      // última actividad y llamados por empresa / contacto
      const lastAct = new Map<string, string>();
      const calledCo = new Set<string>();
      const calledCt = new Set<string>();
      for (const a of d.activities ?? []) {
        const co = String(a.co);
        if (a.d && (lastAct.get(co) ?? "") < a.d) lastAct.set(co, a.d);
        if (a.k === "call") { calledCo.add(co); if (a.ct != null) calledCt.add(String(a.ct)); }
      }
      const ctByCo = new Map<string, typeof d.contacts>();
      for (const ct of d.contacts) {
        const co = String(ct.co);
        const list = ctByCo.get(co) ?? [];
        list.push(ct);
        ctByCo.set(co, list);
        if (ct.last && (lastAct.get(co) ?? "") < ct.last) lastAct.set(co, ct.last);
      }
      for (const co of d.companies) {
        const id = String(co.id);
        const m = (lastAct.get(id) ?? "").slice(0, 7);
        if (!m || m < minMonth) continue; // sin actividad (no trabajada) o muy antigua
        const k = canonicalCountry(co.pais);
        const c = dir.toAccount(cl.id, sub ?? null, k);
        if (c && !clientNames[c]) clientNames[c] = sub || cl.name;
        const cts = ctByCo.get(id) ?? [];
        const r = row(m, sdrKey(co.sdr), c, k);
        r.w++;
        const reason = COMPANY_RETURN[norm(co.st)];
        if (reason) {
          r.r++;
          r.rr[reason] = (r.rr[reason] ?? 0) + 1;
          const tried = calledCo.has(id) || cts.some((x) => (x.att ?? x.calls ?? 0) > 0);
          if (!tried) r.rn++;
        }
        for (const ct of cts) {
          const rc = row(m, sdrKey(ct.sdr || co.sdr), c, k);
          rc.ct++;
          const cr = CONTACT_RETURN[norm(ct.st)];
          if (!cr) continue;
          rc.cr++;
          rc.cs[cr] = (rc.cs[cr] ?? 0) + 1;
          if (!calledCt.has(String(ct.id)) && !((ct.att ?? ct.calls ?? 0) > 0)) rc.crn++;
        }
      }
    }
  }

  const out: ReturnsResponse = { generated: new Date().toISOString(), today, rows: [...byKey.values()], sdrNames, clientNames, sources, missing };
  await writeMonthCache(key, out, CACHE_TTL);
  return out;
}
