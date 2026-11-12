"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { COLORS, fmt, isExcludedSdr, makeFilter } from "@/lib/celulasSdr/engine";
import type { ReturnRow, ReturnsResponse } from "@/lib/celulasSdr/types";
import { Av, CardH, KGrid, Pending, Seg, useCells, type KCard } from "../components/ui";

// ─── Devoluciones ───────────────────────────────────────────────────────────
// Empresas y contactos que los SDR devuelven a prospección (pedido de
// BullsEye, nov-2026: lo miden las líderes de célula). Datos de los informes
// de Pulso ABM ya sincronizados (/api/celulas-sdr/devoluciones). Respeta los
// filtros de célula, SDR, cliente y país; el período es el de esta vista
// (mes de la última actividad de la empresa), no el del módulo: Pulso guarda
// el status actual, no cuándo cambió.

type Range = "mes" | "3m" | "anio";
const RANGES: [Range, string][] = [["mes", "Este mes"], ["3m", "Últimos 3 meses"], ["anio", "Este año"]];

type Agg = { w: number; r: number; rn: number; rr: Record<string, number>; ct: number; cr: number; crn: number; cs: Record<string, number> };
const empty = (): Agg => ({ w: 0, r: 0, rn: 0, rr: {}, ct: 0, cr: 0, crn: 0, cs: {} });
function add(a: Agg, x: ReturnRow) {
  a.w += x.w; a.r += x.r; a.rn += x.rn; a.ct += x.ct; a.cr += x.cr; a.crn += x.crn;
  for (const [k, v] of Object.entries(x.rr)) a.rr[k] = (a.rr[k] ?? 0) + v;
  for (const [k, v] of Object.entries(x.cs)) a.cs[k] = (a.cs[k] ?? 0) + v;
}
const pct = (n: number, d: number) => (d ? `${fmt((n / d) * 100)}%` : "—");

function fromMonth(today: string, range: Range): string {
  if (range === "anio") return `${today.slice(0, 4)}-01`;
  if (range === "mes") return today.slice(0, 7);
  const d = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 2);
  return d.toISOString().slice(0, 7);
}

const COMPANY_REASONS = ["No califica", "Sin contactos fit", "Sin comunicación", "Nutrir", "Sin contactos (ya nutrida)"];
const CONTACT_REASONS = ["Sin información de contacto", "No fit"];

export function ViewDevoluciones() {
  const { M, f, openSdr } = useCells();
  const [data, setData] = useState<ReturnsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState<Range>("anio");

  const load = useCallback((fresh: boolean) => {
    setBusy(true);
    setErr(null);
    fetch(`/api/celulas-sdr/devoluciones${fresh ? "?fresh=1" : ""}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.error) throw new Error(j.error || `Error ${r.status}`);
        setData(j);
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setBusy(false));
  }, []);
  useEffect(() => { load(false); }, [load]);

  const d = useMemo(() => {
    if (!data) return null;
    const fl = makeFilter(M, f);
    const from = fromMonth(data.today, range);
    const tot = empty();
    const bySdr = new Map<string, Agg>();
    const byClient = new Map<string, Agg>();
    for (const x of data.rows) {
      if (x.m < from || isExcludedSdr(x.s) || !fl.sdrOk(x.s) || !fl.cOk(x.c, x.k)) continue;
      add(tot, x);
      const a = bySdr.get(x.s) ?? empty(); add(a, x); bySdr.set(x.s, a);
      const ck = x.c ?? "";
      const b = byClient.get(ck) ?? empty(); add(b, x); byClient.set(ck, b);
    }
    const sdrs = [...bySdr.entries()]
      .map(([key, a]) => ({ key, a, s: M.SD[key] ?? { key, name: data.sdrNames[key] ?? key, color: COLORS.n, initials: "" }, inRoster: !!M.SD[key] }))
      .filter((x) => x.a.w > 0 || x.a.cr > 0)
      .sort((x, y) => y.a.r - x.a.r || y.a.cr - x.a.cr);
    const clients = [...byClient.entries()]
      .map(([key, a]) => ({ key, a, name: M.CL[key]?.name ?? data.clientNames[key] ?? (key || "Sin cliente") }))
      .filter((x) => x.a.w > 0)
      .sort((x, y) => y.a.r - x.a.r);
    return { tot, sdrs, clients };
  }, [data, M, f, range]);

  const head = (
    <CardH
      t="Devoluciones de empresas y contactos"
      p="Empresas con actividad del SDR en el período (por su última actividad) y su status actual en HubSpot, según los informes de Pulso ABM."
      right={
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Seg value={range} opts={RANGES} onChange={setRange} />
          <button className="cs-btn" disabled={busy} onClick={() => load(true)}>{busy ? "Calculando…" : "Actualizar"}</button>
        </div>
      }
    />
  );

  if (err) return <div className="cs-card">{head}<Pending>No se pudieron calcular las devoluciones: {err}</Pending></div>;
  if (!data || !d) return <div className="cs-card">{head}<Pending>Leyendo los informes de Pulso ABM de cada cliente… (la primera vez del día puede tardar 1–2 minutos)</Pending></div>;

  const { tot, sdrs, clients } = d;
  const cards: KCard[] = [
    { ic: "bld", l: "Empresas devueltas", v: fmt(tot.r), sub: `${pct(tot.r, tot.w)} de ${fmt(tot.w)} trabajadas`, hl: true },
    { ic: "alert", l: "Devueltas sin ningún llamado", v: fmt(tot.rn), sub: `${pct(tot.rn, tot.r)} de las devueltas` },
    { ic: "users", l: "Contactos devueltos", v: fmt(tot.cr), sub: `${pct(tot.cr, tot.ct)} de ${fmt(tot.ct)} contactos de esas empresas` },
    { ic: "phone", l: "Contactos devueltos sin intentos", v: fmt(tot.crn), sub: `${pct(tot.crn, tot.cr)} de los devueltos` },
  ];
  const reasons = (rec: Record<string, number>, list: string[]) => list.map((k) => rec[k] ?? 0);

  return (
    <>
      <div className="cs-card">{head}</div>
      <div className="cs-mt"><KGrid cards={cards} /></div>

      <div className="cs-g2 cs-mt">
        <div className="cs-card">
          <CardH t="Empresas devueltas por motivo" p="Status de la asignación actual" />
          <div className="cs-rows">
            {COMPANY_REASONS.map((k) => <div key={k}><span>{k}</span><b>{fmt(tot.rr[k] ?? 0)}</b></div>)}
          </div>
        </div>
        <div className="cs-card">
          <CardH t="Contactos devueltos por motivo" p="Asignación BullsEye por llamar actual" />
          <div className="cs-rows">
            {CONTACT_REASONS.map((k) => <div key={k}><span>{k}</span><b>{fmt(tot.cs[k] ?? 0)}</b></div>)}
            <div><span>…de ellos, sin ningún intento de contacto</span><b>{fmt(tot.crn)}</b></div>
          </div>
        </div>
      </div>

      <div className="cs-card cs-mt">
        <CardH t="Por SDR" p="Empresas: SDR de la empresa. Contactos: SDR del contacto. Ordenado por empresas devueltas" />
        <div className="cs-tw">
          <table>
            <thead>
              <tr>
                <th className="l">SDR</th><th>Trabajadas</th><th>Devueltas</th><th>%</th><th>Sin llamado</th>
                {COMPANY_REASONS.map((k) => <th key={k}>{k}</th>)}
                <th>Contactos devueltos</th><th>Sin intentos</th>
              </tr>
            </thead>
            <tbody>
              {sdrs.map(({ key, a, s, inRoster }) => (
                <tr key={key} className={inRoster ? "click" : ""} onClick={() => inRoster && openSdr(key)}>
                  <td className="l"><div className="cs-who"><Av s={s} /><div><b>{s.name}</b></div></div></td>
                  <td>{fmt(a.w)}</td>
                  <td><b>{fmt(a.r)}</b></td>
                  <td>{pct(a.r, a.w)}</td>
                  <td className={a.rn ? "" : "cs-muted"}>{a.rn || "—"}</td>
                  {reasons(a.rr, COMPANY_REASONS).map((v, i) => <td key={i} className={v ? "" : "cs-muted"}>{v || "—"}</td>)}
                  <td>{fmt(a.cr)}</td>
                  <td className={a.crn ? "" : "cs-muted"}>{a.crn || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="cs-card cs-mt">
        <CardH t="Por cliente" p="Ordenado por empresas devueltas" />
        <div className="cs-tw">
          <table>
            <thead>
              <tr><th className="l">Cliente</th><th>Trabajadas</th><th>Devueltas</th><th>%</th><th>Sin llamado</th><th>Contactos devueltos</th><th>Sin información</th><th>No fit</th><th>Sin intentos</th></tr>
            </thead>
            <tbody>
              {clients.map(({ key, a, name }) => (
                <tr key={key}>
                  <td className="l"><b>{name}</b></td>
                  <td>{fmt(a.w)}</td>
                  <td><b>{fmt(a.r)}</b></td>
                  <td>{pct(a.r, a.w)}</td>
                  <td>{fmt(a.rn)}</td>
                  <td>{fmt(a.cr)}</td>
                  <td>{fmt(a.cs["Sin información de contacto"] ?? 0)}</td>
                  <td>{fmt(a.cs["No fit"] ?? 0)}</td>
                  <td>{fmt(a.crn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="cs-note">
          Definiciones (La Biblia): empresa devuelta = No califica, Gestionada - sin contactos fit, Gestionada - sin comunicación, Nutrir o
          Sin contactos (ya nutrida). Contacto devuelto = Contacto No Fit para gestión o Sin Información de Contacto. &quot;Sin llamado&quot; /
          &quot;sin intentos&quot; = ninguna llamada registrada. El status es el actual: una empresa trabajada en el período que hoy está devuelta
          cuenta como devuelta. Prospección ve las mismas cifras por carga en Centro de prospección → Calidad de carga.
          {data.missing.length ? ` Sin informe de Pulso ABM: ${data.missing.join(", ")}.` : ""}
          {` Calculado ${new Date(data.generated).toLocaleString("es-CL", { timeZone: "America/Santiago", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.`}
        </p>
      </div>
    </>
  );
}
