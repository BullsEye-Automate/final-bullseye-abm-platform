"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList,
} from "recharts";
import { COLORS, fmt, isExcludedSdr, makeFilter } from "@/lib/celulasSdr/engine";
import { MN, MNL } from "@/lib/celulasSdr/calendar";
import type { MonthlyMeetingsResponse } from "@/lib/celulasSdr/types";
import { Av, CardH, KGrid, Pending, useCells, type KCard } from "../components/ui";

const axis = { tick: { fontSize: 12 }, tickLine: false, axisLine: false } as const;
const mLabel = (m: string) => MN[Number(m.slice(5, 7)) - 1];

// ─── Evolutivo mensual ──────────────────────────────────────────────────────
// Reuniones agendadas por SDR mes a mes, de enero a la fecha. Promedio del
// mes = agendadas del mes / SDR que agendaron al menos una reunión ese mes.
// Agendadas por fecha de agendamiento; realizadas por fecha de la reunión.
// Respeta los filtros de célula, SDR, cliente y país (no el período: el
// evolutivo siempre es el año en curso). Datos propios (/api/celulas-sdr/monthly).
export function ViewEvo() {
  const { M, f, openSdr } = useCells();
  const [data, setData] = useState<MonthlyMeetingsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/celulas-sdr/monthly", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.error) throw new Error(j.error || `Error ${r.status}`);
        setData(j);
      })
      .catch((e) => setErr((e as Error).message));
  }, []);

  const d = useMemo(() => {
    if (!data) return null;
    const fl = makeFilter(M, f);
    const cur = data.today.slice(0, 7);
    const per = new Map<string, Map<string, { sched: number; held: number }>>(); // sdr → mes → conteo
    for (const r of data.rows) {
      if (isExcludedSdr(r.s) || !fl.sdrOk(r.s) || !fl.cOk(r.c, r.k)) continue;
      const bySdr = per.get(r.s) ?? new Map();
      const x = bySdr.get(r.m) ?? { sched: 0, held: 0 };
      x.sched += r.sched;
      x.held += r.held;
      bySdr.set(r.m, x);
      per.set(r.s, bySdr);
    }
    const months = data.months.map((m) => {
      let sched = 0, held = 0, n = 0;
      for (const bySdr of per.values()) {
        const x = bySdr.get(m);
        if (!x) continue;
        sched += x.sched;
        held += x.held;
        if (x.sched > 0) n++;
      }
      return { m, l: mLabel(m), sched, held, n, avg: n ? sched / n : null, partial: m === cur };
    });
    const sdrs = [...per.entries()]
      .map(([key, bySdr]) => {
        const vals = data.months.map((m) => bySdr.get(m)?.sched ?? 0);
        const active = vals.filter((v) => v > 0);
        const total = vals.reduce((a, b) => a + b, 0);
        const sd = M.SD[key];
        return {
          key, total, vals,
          avg: active.length ? total / active.length : 0,
          monthsActive: active.length,
          s: sd ?? { key, name: data.sdrNames[key] ?? key, color: COLORS.n, initials: "" },
          inRoster: !!sd,
        };
      })
      .filter((x) => x.total > 0)
      .sort((a, b) => b.avg - a.avg);
    // promedio del año: agendadas / SDR-mes con agendadas (sin el mes en curso, que va a medias)
    const closed = months.filter((x) => !x.partial);
    const sumS = closed.reduce((a, x) => a + x.sched, 0), sumN = closed.reduce((a, x) => a + x.n, 0);
    const yearAvg = sumN ? sumS / sumN : null;
    const best = closed.filter((x) => x.avg !== null).sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0))[0];
    const last = closed[closed.length - 1], prev = closed[closed.length - 2];
    return { months, sdrs, yearAvg, best, last, prev, closedN: closed.length };
  }, [data, M, f]);

  if (err) return <div className="cs-card"><Pending>No se pudo cargar el evolutivo: {err}</Pending></div>;
  if (!data || !d) return <div className="cs-card"><Pending>Cargando reuniones desde enero…</Pending></div>;

  const { months, sdrs, yearAvg, best, last, prev } = d;
  const cards: KCard[] = [
    { ic: "cal", l: `Promedio por SDR al mes (ene–${last ? mLabel(last.m) : "—"})`, v: fmt(yearAvg, 1), sub: "Agendadas por SDR en los meses cerrados", hl: true },
    { ic: "trend", l: `${last ? MNL[Number(last.m.slice(5, 7)) - 1] : "Último mes"} vs mes anterior`, v: last ? fmt(last.avg, 1) : "—", sub: last && prev && last.avg !== null && prev.avg !== null ? `${last.avg >= prev.avg ? "▲" : "▼"} ${fmt(Math.abs(last.avg - prev.avg), 1)} vs ${fmt(prev.avg, 1)} en ${mLabel(prev.m)}` : "" },
    { ic: "trophy", l: "Mejor mes", v: best ? `${MNL[Number(best.m.slice(5, 7)) - 1]}` : "—", sub: best ? `${fmt(best.avg, 1)} agendadas por SDR` : "" },
    { ic: "funnel", l: "Agendadas en el año", v: fmt(months.reduce((a, x) => a + x.sched, 0)), sub: `${fmt(months.reduce((a, x) => a + x.held, 0))} realizadas` },
  ];
  return (
    <>
      <KGrid cards={cards} />
      <div className="cs-card cs-mt">
        <CardH t="Reuniones agendadas: total y promedio por SDR" p={`Por fecha de agendamiento. Promedio = agendadas del mes ÷ SDR que agendaron al menos una. ${months.some((x) => x.partial) ? "El mes en curso va a medias." : ""}`} />
        <div className="cs-cw l">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={months} margin={{ top: 16, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={COLORS.border} />
              <XAxis dataKey="l" {...axis} />
              <YAxis yAxisId="t" {...axis} />
              <YAxis yAxisId="a" orientation="right" {...axis} />
              <Tooltip formatter={(v: any, n: any) => [n === "Promedio por SDR" ? fmt(Number(v), 1) : fmt(Number(v)), n]} labelFormatter={(_, p: any) => { const x = p?.[0]?.payload; return x ? `${MNL[Number(x.m.slice(5, 7)) - 1]}${x.partial ? " (en curso)" : ""} · ${x.n} SDR` : ""; }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="t" dataKey="sched" name="Agendadas" fill={COLORS.violet} fillOpacity={0.35} radius={[5, 5, 0, 0]} maxBarSize={40} />
              <Bar yAxisId="t" dataKey="held" name="Realizadas" fill={COLORS.teal} fillOpacity={0.35} radius={[5, 5, 0, 0]} maxBarSize={40} />
              <Line yAxisId="a" dataKey="avg" name="Promedio por SDR" stroke={COLORS.primary} strokeWidth={3} type="monotone" connectNulls>
                <LabelList dataKey="avg" position="top" fontSize={11} formatter={(v: any) => fmt(Number(v), 1)} />
              </Line>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="cs-card cs-mt">
        <CardH t="Agendadas por SDR, mes a mes" p="Promedio = agendadas ÷ meses con al menos una agendada. Ordenado por promedio" />
        <div className="cs-tw">
          <table>
            <thead><tr><th className="l">SDR</th>{months.map((x) => <th key={x.m}>{x.l}{x.partial ? "*" : ""}</th>)}<th>Total</th><th>Promedio</th></tr></thead>
            <tbody>
              {sdrs.map((r) => (
                <tr key={r.key} className={r.inRoster ? "click" : ""} onClick={() => r.inRoster && openSdr(r.key)}>
                  <td className="l"><div className="cs-who"><Av s={r.s} /><div><b>{r.s.name}</b></div></div></td>
                  {r.vals.map((v, i) => <td key={i} className={v ? "" : "cs-muted"}>{v || "—"}</td>)}
                  <td><b>{fmt(r.total)}</b></td>
                  <td><b>{fmt(r.avg, 1)}</b></td>
                </tr>
              ))}
              <tr className="tot">
                <td className="l"><b>Promedio por SDR</b></td>
                {months.map((x) => <td key={x.m}><b>{fmt(x.avg, 1)}</b></td>)}
                <td><b>{fmt(months.reduce((a, x) => a + x.sched, 0))}</b></td>
                <td><b>{fmt(yearAvg, 1)}</b></td>
              </tr>
            </tbody>
          </table>
        </div>
        {months.some((x) => x.partial) ? <p className="cs-note">* Mes en curso (no entra en el promedio del año).</p> : null}
      </div>
    </>
  );
}
