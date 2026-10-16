"use client";

import { useMemo } from "react";
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, Area, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Legend,
  Cell, ScatterChart, Scatter, ReferenceLine, LabelList,
} from "recharts";
import {
  COLORS, QBN, QCRIT, agg, buildAlerts, div, endOf, fmt, lastWeeks, leaderColor, leaderLabel, makeFilter, ok, pct,
  periodFromRange, qBand, qColor, sdrFilter, sdrList, sdrRows, sem, sgn, slopeRel, trendDays, weekPeriod,
  type Agg, type Sem,
} from "@/lib/celulasSdr/engine";
import { DN, dayLong, dayMonthShort, dayShort, parseDay } from "@/lib/celulasSdr/calendar";
import {
  AlertItem, Av, CardH, Ic, KGrid, Pending, Pill, QChip, Seg, Who, crit5Color, dPct, useCells, type KCard,
} from "../components/ui";

const pctTick = (v: number) => `${Math.round(v * 100)}%`;
const legend = <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />;
const axis = { tick: { fontSize: 12 }, tickLine: false, axisLine: false } as const;

// ─── Calendario de desempeño ────────────────────────────────────────────────
export function ViewCal() {
  const { M, f, P, S, setS } = useCells();
  const cfg = M.cfg;
  const days = useMemo(() => {
    if (P.bdays.length >= 5) return P.bdays;
    const w = lastWeeks(M, endOf(P), 1)[0];
    return w ? w.days : P.bdays;
  }, [M, P]);
  const Mx: Record<string, [string, (a: Agg) => [number | null, number | null], (v: number) => string]> = {
    calls: ["Llamadas vs meta", (a) => [a.calls, a.callPct], (v) => fmt(v)],
    acts: ["Actividades vs meta", (a) => [a.acts, a.actPct], (v) => fmt(v)],
    sched: ["Agendadas vs meta diaria", (a) => [a.sched, div(a.sched, a.schedGoal)], (v) => fmt(v)],
    conn: ["Conexión vs objetivo", (a) => [a.conn, div(a.conn, cfg.connectTarget)], (v) => pct(v)],
    qual: ["Puntaje de llamadas vs meta", (a) => [a.qScore, div(a.qScore, cfg.qTarget)], (v) => fmt(v)],
  };
  const m = Mx[S.heatM] ?? Mx.calls;
  const d = useMemo(() => {
    const list = sdrList(M, f).filter((s) => !s.nodata);
    const grid = list.map((s) => {
      const fl = sdrFilter(M, f, s.key);
      const cells = days.map((x) => {
        const [v, p] = m[1](agg(M, periodFromRange(x, x), fl));
        return { v, p, st: sem(M, p) };
      });
      const ps = cells.map((c) => c.p).filter(ok);
      const mu = ps.reduce((a, b) => a + b, 0) / (ps.length || 1);
      const sd = Math.sqrt(ps.reduce((a, b) => a + (b - mu) ** 2, 0) / (ps.length || 1));
      const n = { g: 0, y: 0, r: 0 };
      cells.forEach((c) => { if (c.st !== "n") n[c.st]++; });
      return { s, cells, cv: mu ? sd / mu : 0, n };
    });
    const fl = makeFilter(M, f);
    const tot = days.map((x) => {
      const [v, p] = m[1](agg(M, periodFromRange(x, x), fl));
      return { v, p, st: sem(M, p) };
    });
    return { grid, tot };
  }, [M, f, days, S.heatM]);
  const { grid, tot } = d;
  const cellBg = (c: { st: Sem; p: number | null }) => {
    if (c.st === "n") return { background: "#F8F7FC", color: COLORS.n };
    const base = c.st === "g" ? cfg.green : c.st === "y" ? cfg.yellow : 0;
    const k = Math.round(28 + Math.min(1, Math.abs((c.p || 0) - base) * 1.5) * 40);
    return { background: `color-mix(in srgb, ${COLORS[c.st]} ${k}%, #F8F7FC)`, color: COLORS.text };
  };
  const lbl = (cv: number): [string, string] => (cv < 0.15 ? ["Consistente", "g"] : cv < 0.3 ? ["Variable", "y"] : ["Inconsistente", "r"]);
  const worst = tot.map((c, k) => ({ c, k })).filter((x) => ok(x.c.p)).sort((a, b) => (a.c.p ?? 0) - (b.c.p ?? 0))[0];
  return (
    <div className="cs-card">
      <CardH t="Desempeño diario por SDR" p={`${m[0]}. ${days.length} días hábiles del período. Pasa el cursor para ver el % de la meta`} right={<Seg value={S.heatM} opts={[["calls", "Llamadas"], ["acts", "Actividades"], ["sched", "Agendadas"], ["conn", "Conexión"], ["qual", "Puntaje"]]} onChange={(v) => setS({ heatM: v })} />} />
      <div className="cs-tw">
        <table className="hm">
          <thead>
            <tr>
              <th className="l">SDR</th>
              {days.map((x) => { const p = parseDay(x); return <th key={x}>{DN[p.getUTCDay()]}<br /><span className="cs-muted">{p.getUTCDate()}/{p.getUTCMonth() + 1}</span></th>; })}
              <th>🟢</th><th>🟡</th><th>🔴</th><th className="l">Patrón</th>
            </tr>
          </thead>
          <tbody>
            {grid.map((g) => {
              const L = lbl(g.cv);
              return (
                <tr key={g.s.key}>
                  <td className="l" style={{ paddingRight: 10 }}><Who s={g.s} /></td>
                  {g.cells.map((c, i) => <td key={i}><div className="cs-cell" style={cellBg(c)} title={`${pct(c.p)} de la meta`}>{ok(c.v) ? m[2](c.v) : "—"}</div></td>)}
                  <td><b className="cs-gt">{g.n.g}</b></td><td><b className="cs-yt">{g.n.y}</b></td><td><b className="cs-rt">{g.n.r}</b></td>
                  <td className="l"><span className={`cs-tag ${L[1]}`}>{L[0]}</span></td>
                </tr>
              );
            })}
            <tr>
              <td className="l"><b>Equipo</b></td>
              {tot.map((c, i) => <td key={i}><div className="cs-cell" style={cellBg(c)} title={`${pct(c.p)} de la meta`}>{ok(c.v) ? m[2](c.v) : "—"}</div></td>)}
              <td colSpan={4} />
            </tr>
          </tbody>
        </table>
      </div>
      <div className="cs-legend" style={{ marginTop: 14 }}>
        <span><i style={{ background: COLORS.g }} />≥ {pct(cfg.green)} de la meta</span>
        <span><i style={{ background: COLORS.y }} />{pct(cfg.yellow)}–{pct(cfg.green - 0.01)}</span>
        <span><i style={{ background: COLORS.r }} />&lt; {pct(cfg.yellow)}</span>
        {worst ? <span style={{ marginLeft: "auto" }}>Día más bajo del equipo: <b>{dayLong(days[worst.k])}</b> ({pct(worst.c.p)} de la meta)</span> : null}
      </div>
    </div>
  );
}

// ─── Tendencia semanal ──────────────────────────────────────────────────────
export function ViewTrend() {
  const { M, f, P } = useCells();
  const d = useMemo(() => {
    const fl = makeFilter(M, f);
    const wk = lastWeeks(M, endOf(P), 8);
    const ws = wk.map((w) => agg(M, weekPeriod(M, w), fl));
    return { wk, ws };
  }, [M, f, P]);
  const { wk, ws } = d;
  const MET: [keyof Agg, string, string, boolean, boolean][] = [["calls", "Llamadas", COLORS.primary, false, false], ["contacted", "Contactados", COLORS.sky, false, false], ["sched", "Reuniones agendadas", COLORS.violet, false, false], ["held", "Reuniones realizadas", COLORS.teal, false, false], ["noshow", "No-show", COLORS.r, true, false], ["opps", "Oportunidades", COLORS.magenta, false, false], ["compl", "% cumplimiento", COLORS.g, false, true]];
  const info = MET.map(([k, l, c, inv, isP]) => {
    const v = ws.map((x) => (x[k] as number) || 0);
    const sl = slopeRel(v.slice(-4));
    const st = sl > 0.04 ? (inv ? "down" : "up") : sl < -0.04 ? (inv ? "up" : "down") : "flat";
    return { k: String(k), l, c, inv, isP, v, st, cur: v[v.length - 1], prv: v[v.length - 2] };
  });
  const TS: Record<string, [string, string, string]> = { up: ["📈", "Mejorando", "g"], flat: ["➡️", "Estable", ""], down: ["📉", "Cayendo", "r"] };
  const ups = info.filter((x) => x.st === "up").length, downs = info.filter((x) => x.st === "down").length;
  const overall = ups > downs + 1 ? TS.up : downs > ups + 1 ? TS.down : TS.flat;
  const big = wk.map((w, i) => ({ l: `Sem ${w.short}`, compl: ws[i].compl, conn: ws[i].conn, attend: ws[i].attend, m2o: ws[i].m2o }));
  return (
    <>
      <div className="cs-card" style={{ marginBottom: 16 }}>
        <div className="cs-who"><span style={{ fontSize: 30 }}>{overall[0]}</span><div><b style={{ fontSize: 16, whiteSpace: "normal" }}>El equipo está {overall[1].toLowerCase()}</b><small>{ups} métricas mejorando, {downs} cayendo y {info.length - ups - downs} estables, según la pendiente de las últimas 4 semanas</small></div></div>
      </div>
      <div className="cs-tcards">
        {info.map((x) => {
          const t = TS[x.st];
          const ch = x.isP ? (ok(x.cur) && ok(x.prv) ? sgn((x.cur - x.prv) * 100, 1) + " pp" : "—") : x.prv ? sgn(((x.cur - x.prv) / x.prv) * 100, 0) + "%" : "—";
          const up = x.cur > x.prv, good = x.inv ? !up : up;
          return (
            <div className="cs-card cs-tc" key={x.k} style={{ padding: 14 }}>
              <div className="top-l"><h4>{x.l}</h4><span className={`cs-tag ${t[2]}`}>{t[0]} {t[1]}</span></div>
              <div className="v">{x.isP ? pct(x.cur) : fmt(x.cur)}</div>
              <span className={`cs-dl ${x.cur === x.prv ? "n" : good ? "good" : "bad"}`}>{up ? "▲" : x.cur === x.prv ? "■" : "▼"} {ch} <em>vs semana anterior</em></span>
              <div className="cs-cw">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={x.v.map((v, i) => ({ v, l: wk[i]?.label }))}>
                    <Tooltip formatter={(v: any) => (x.isP ? pct(Number(v)) : fmt(Number(v)))} labelFormatter={(_, p: any) => `Semana ${p?.[0]?.payload?.l ?? ""}`} />
                    <Bar dataKey="v" radius={[5, 5, 0, 0]} maxBarSize={22}>
                      {x.v.map((_, i) => <Cell key={i} fill={x.c} fillOpacity={i === x.v.length - 1 ? 0.95 : 0.35} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })}
      </div>
      <div className="cs-card cs-mt">
        <CardH t="Ritmo de desempeño" p="Tasas clave semana a semana, últimas 8 semanas" />
        <div className="cs-cw l">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={big} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={COLORS.border} />
              <XAxis dataKey="l" {...axis} />
              <YAxis tickFormatter={pctTick} {...axis} />
              <Tooltip formatter={(v: any) => pct(Number(v), 1)} />
              {legend}
              <Area dataKey="compl" name="Cumplimiento" stroke={COLORS.teal} fill={COLORS.teal} fillOpacity={0.14} strokeWidth={3} type="monotone" connectNulls />
              <Line dataKey="conn" name="Tasa de conexión" stroke={COLORS.sky} strokeWidth={2} type="monotone" connectNulls />
              <Line dataKey="attend" name="Asistencia" stroke={COLORS.violet} strokeWidth={2} type="monotone" connectNulls />
              <Line dataKey="m2o" name="Reunión → opp" stroke={COLORS.magenta} strokeWidth={2} type="monotone" connectNulls />
              <ReferenceLine y={M.cfg.green} stroke={COLORS.n} strokeDasharray="5 4" label={{ value: "Umbral verde", fontSize: 11, position: "insideTopRight" }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
}

// ─── Indicadores de eficiencia ──────────────────────────────────────────────
export function ViewEff() {
  const { M, f, P, S, setS, openSdr } = useCells();
  const d = useMemo(() => {
    const t = agg(M, P, makeFilter(M, f));
    const rows = sdrRows(M, f, P, null).filter((r) => r.a.calls > 0);
    return { t, rows };
  }, [M, f, P]);
  const { t } = d;
  const cols: [keyof Agg, string, number | "p"][] = [["callsPerDay", "Llamadas/día", 0], ["actsPerDay", "Actividades/día", 0], ["mtgPerDay", "Reuniones/día", 2], ["cp100", "Contactados/100 llamadas", 1], ["mp100", "Reuniones/100 llamadas", 2], ["op100", "Opps/100 reuniones", 0], ["conn", "Llamada → contacto", "p"], ["c2m", "Contacto → reunión", "p"], ["m2o", "Reunión → opp", "p"]];
  const k = S.effSort as keyof Agg;
  const rows = [...d.rows].sort((x, y) => ((y.a[k] as number) || 0) - ((x.a[k] as number) || 0));
  const fm = (v: number | null, c: number | "p") => (c === "p" ? pct(v, 1) : fmt(v, c));
  const tint = (v: number | null, avg: number | null) => {
    if (!ok(v) || !ok(avg) || !avg) return undefined;
    const r = v / avg;
    return r >= 1.1 ? { background: "#E1F5EE" } : r <= 0.9 ? { background: "#FAECE7" } : undefined;
  };
  const ax = t.callsPerDay ?? 0, ay = t.mp100 ?? 0;
  const ins: [string, string][] = [];
  rows.forEach((r) => {
    const x = r.a.callsPerDay ?? 0, y = r.a.mp100 ?? 0;
    if (x > ax * 1.08 && y < ay * 0.88) ins.push(["r", `**${r.s.name}** hace muchas llamadas (${fmt(x)}/día) pero convierte poco: ${fmt(y, 2)} reuniones por 100 llamadas vs ${fmt(ay, 2)} del equipo.`]);
    else if (x < ax * 0.95 && y > ay * 1.12) ins.push(["g", `**${r.s.name}** hace menos llamadas (${fmt(x)}/día) pero tiene excelente conversión: ${fmt(y, 2)} reuniones por 100 llamadas.`]);
    else if (x < ax * 0.92 && y < ay * 0.92) ins.push(["y", `**${r.s.name}** está bajo el promedio en volumen y en conversión.`]);
  });
  const kc: KCard[] = ([["phone", "Llamadas por día", fmt(t.callsPerDay), "Productividad por SDR"], ["act", "Actividades por día", fmt(t.actsPerDay), "Productividad por SDR"], ["cal", "Reuniones agendadas por día", fmt(t.mtgPerDay, 2), "Productividad por SDR"], ["users", "Contactados por 100 llamadas", fmt(t.cp100, 1), "Eficiencia"], ["target", "Reuniones por 100 llamadas", fmt(t.mp100, 2), "Eficiencia"], ["star", "Oportunidades por 100 reuniones", fmt(t.op100), "Eficiencia"], ["wifi", "Llamada → contacto", pct(t.conn, 1), "Conversión"], ["split", "Contacto → reunión", pct(t.c2m, 1), "Conversión"], ["zap", "Reunión → oportunidad", pct(t.m2o), "Conversión"]] as const).map(([i, l, v, s]) => ({ ic: i, l, v, sub: s }));
  const Rich = ({ t: tx }: { t: string }) => <>{tx.split("**").map((p, i) => (i % 2 ? <b key={i}>{p}</b> : <span key={i}>{p}</span>))}</>;
  return (
    <>
      <KGrid cards={kc} />
      <div className="cs-g21 cs-mt">
        <div className="cs-card">
          <CardH t="Cantidad vs calidad de actividad" p="Cada burbuja es un SDR; el tamaño indica sus oportunidades. Líneas: promedio del equipo" />
          <div className="cs-cw" style={{ height: 400 }}>
            {rows.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 18, right: 16, left: 0, bottom: 14 }}>
                  <CartesianGrid stroke={COLORS.border} />
                  <XAxis type="number" dataKey="x" name="Llamadas por día" domain={[(v: number) => Math.max(0, Math.floor(v * 0.9)), (v: number) => Math.ceil(v * 1.05)]} {...axis} label={{ value: "Llamadas por día (volumen)", position: "insideBottom", offset: -8, fontSize: 11 }} />
                  <YAxis type="number" dataKey="y" name="Reuniones/100 llamadas" {...axis} />
                  <ZAxis type="number" dataKey="z" range={[80, 500]} />
                  <ReferenceLine x={ax} stroke={COLORS.n} strokeDasharray="5 5" label={{ value: "Alto volumen →", position: "insideTopRight", fontSize: 10.5, fill: COLORS.n }} />
                  <ReferenceLine y={ay} stroke={COLORS.n} strokeDasharray="5 5" label={{ value: "Alta eficiencia ↑", position: "insideTopLeft", fontSize: 10.5, fill: COLORS.n }} />
                  <Tooltip formatter={(v: any, n: any) => [fmt(Number(v), 2), n]} labelFormatter={() => ""} />
                  <Scatter data={rows.map((r) => ({ x: r.a.callsPerDay, y: r.a.mp100, z: r.a.opps + 1, name: r.s.short, key: r.s.key }))} onClick={(x: any) => openSdr(x.key)} cursor="pointer">
                    {rows.map((r) => <Cell key={r.s.key} fill={r.s.color} fillOpacity={0.6} />)}
                    <LabelList dataKey="name" position="top" style={{ fontSize: 11 }} />
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            ) : <Pending>Sin llamadas de Allo en el período</Pending>}
          </div>
        </div>
        <div className="cs-card">
          <CardH t="Lectura automática" p="Casos que el promedio esconde" />
          <div className="cs-att">
            {ins.length ? ins.map(([l, tx], i) => <div key={i} className="cs-insight" style={{ borderLeft: `3px solid ${COLORS[l as Sem]}` }}><Rich t={tx} /></div>) : <p className="cs-muted">No hay casos atípicos en este período.</p>}
          </div>
        </div>
      </div>
      <div className="cs-card cs-mt">
        <CardH t="Indicadores de eficiencia por SDR" p="Verde: 10% o más sobre el promedio del equipo. Rojo: 10% o más bajo el promedio. Clic en un encabezado para ordenar" />
        <div className="cs-tw">
          <table>
            <thead><tr><th className="l">SDR</th>{cols.map(([c, l]) => <th key={String(c)} className={`s ${k === c ? "on" : ""}`} onClick={() => setS({ effSort: String(c) })}>{l}{k === c ? " ▾" : ""}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.s.key} className="click" onClick={() => openSdr(r.s.key)}>
                  <td className="l"><Who s={r.s} /></td>
                  {cols.map(([c, , dd]) => <td key={String(c)} style={tint(r.a[c] as number | null, t[c] as number | null)}>{fm(r.a[c] as number | null, dd)}</td>)}
                </tr>
              ))}
              <tr className="tot"><td className="l"><b>Promedio equipo</b></td>{cols.map(([c, , dd]) => <td key={String(c)}><b>{fm(t[c] as number | null, dd)}</b></td>)}</tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ─── Ficha individual ───────────────────────────────────────────────────────
export function ViewFicha() {
  const { M, f, P, Pp, ptype, S, setS, go } = useCells();
  const list = sdrList(M, { ...f, sdr: "" });
  const key = f.sdr || (list.find((s) => s.key === S.ficha) ? S.ficha : list.find((s) => !s.nodata)?.key ?? list[0]?.key);
  const d = useMemo(() => {
    if (!key) return null;
    const s = M.SD[key];
    const fl = sdrFilter(M, f, key);
    const a = agg(M, P, fl), b = Pp ? agg(M, Pp, fl) : null;
    const all = M.sdrs.filter((x) => !x.nodata).map((x) => ({ s: x, a: agg(M, P, sdrFilter(M, { ...f, leader: "" }, x.key)) })).sort((x, y) => (y.a.compl ?? -1) - (x.a.compl ?? -1));
    const rank = all.findIndex((x) => x.s.key === key) + 1;
    const tm = all.filter((x) => (s.group === "cell" ? x.s.leaderKey === s.leaderKey : x.s.group === s.group));
    const rankT = tm.findIndex((x) => x.s.key === key) + 1;
    const team = agg(M, P, makeFilter(M, { ...f, sdr: "", leader: "" }));
    const al = buildAlerts(M, { ...f, leader: "" }, P).filter((x) => x.sdr === key);
    const wk = lastWeeks(M, endOf(P), 4).map((w) => ({ w, x: agg(M, weekPeriod(M, w), fl) }));
    const clientIds = [...new Set(M.goals.filter((g) => g.sdr === key && [...P.dates].some((x) => x.startsWith(g.month))).map((g) => g.client))];
    const ev = M.evals.filter((e) => e.s === key && P.dates.has(e.d)).sort((x, y) => (y.d > x.d ? 1 : -1)).slice(0, 5);
    return { s, a, b, all, rank, tm, rankT, team, al, wk, clientIds, ev };
  }, [M, f, P, Pp, key]);
  if (!d) return <div className="cs-card"><p className="cs-muted">No hay SDR con este filtro.</p></div>;
  const { s, a, b, all, rank, tm, rankT, team, al, wk, clientIds, ev } = d;
  const cfg = M.cfg;
  const R2 = (l: string, v: React.ReactNode, extra: React.ReactNode = "") => <div><span>{l}</span><b>{v}{extra}</b></div>;
  const cmp: [string, number | null, number | null, (v: number | null) => string][] = [["Llamadas por día", a.callsPerDay, team.callsPerDay, (v) => fmt(v)], ["Contactados por 100 llamadas", a.cp100, team.cp100, (v) => fmt(v, 1)], ["Reuniones por 100 llamadas", a.mp100, team.mp100, (v) => fmt(v, 2)], ["Oportunidades por 100 reuniones", a.op100, team.op100, (v) => fmt(v)], ["Asistencia", a.attend, team.attend, (v) => pct(v)]];
  const groupTxt = s.group === "cell" ? `Equipo ${M.LD[s.leaderKey!]?.name ?? ""}` : s.group === "leader" ? "Líder de célula (meta propia, fuera de su célula)" : "Sin célula";
  const w4 = wk.map((x) => x.x.qScore);
  const qc = ok(a.qScore) ? qColor(qBand(M, a.qScore)) : COLORS.n;
  const pdl = b ? dPct(ptype, a.held, b.held) || "—" : "—";
  return (
    <>
      <div className="cs-chips" style={{ marginBottom: 14 }}>
        {list.map((x) => (
          <button key={x.key} className={`cs-chip ${x.key === key ? "on" : ""}`} onClick={() => setS({ ficha: x.key })} disabled={!!f.sdr && x.key !== f.sdr}>
            <Av s={x} z={22} />{x.short}
          </button>
        ))}
      </div>
      <div className="cs-card">
        <div className="cs-fhead">
          <Av s={s} z={64} />
          <div>
            <h2>{s.name}</h2>
            <p className="cs-muted" style={{ margin: "2px 0 0" }}>{groupTxt}. Clientes: {clientIds.map((c) => M.CL[c]?.name ?? c).join(", ") || "sin meta asignada en el período"}</p>
            {s.nodata ? <span className="cs-tag y" style={{ marginTop: 6 }}>Sin datos aún</span> : null}
          </div>
          <div className="cs-badges">
            <div className="cs-bigbadge"><b style={{ color: COLORS[sem(M, a.compl)] }}>{pct(a.compl)}</b><small>Cumplimiento</small></div>
            <div className="cs-bigbadge"><b>{rank ? `#${rank}` : "—"}<span className="cs-muted" style={{ fontSize: 13 }}> de {all.length}</span></b><small>Ranking general</small></div>
            <div className="cs-bigbadge"><b>{rankT ? `#${rankT}` : "—"}<span className="cs-muted" style={{ fontSize: 13 }}> de {tm.length}</span></b><small>{s.group === "cell" ? "En su célula" : "En su grupo"}</small></div>
            <div className="cs-bigbadge"><b>{fmt(a.opps)}</b><small>Oportunidades</small></div>
            <div className="cs-bigbadge"><b style={{ color: qc }}>{fmt(a.qScore)}</b><small>Puntaje llamadas</small></div>
          </div>
        </div>
      </div>
      <div className="cs-mt" style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))" }}>
        <div className="cs-card"><CardH t={<><Ic n="act" s={16} /> Actividad</>} right={<Pill v={a.actPct} />} /><div className="cs-rows">{R2("Llamadas", fmt(a.calls), ` / ${fmt(a.callGoal)}`)}{R2("Emails", fmt(a.emails))}{R2("WhatsApp", fmt(a.wa))}{R2("LinkedIn", fmt(a.li))}{R2("Otras", <span className="cs-muted">Pendiente de conexión</span>)}{R2("Total actividades", fmt(a.acts), a.chUnavailable ? "" : ` / ${fmt(a.actGoal)}`)}{R2("Cumplimiento de actividad", pct(a.actPct))}</div></div>
        <div className="cs-card"><CardH t={<><Ic n="bld" s={16} /> Prospección</>} right={<Pill v={div(a.conn, cfg.connectTarget)} s={!ok(a.conn) ? "n" : a.conn >= cfg.connectTarget ? "g" : a.conn >= cfg.connectMin ? "y" : "r"} />} /><div className="cs-rows">{R2("Empresas trabajadas", <span className="cs-muted">En desarrollo</span>)}{R2("Contactos trabajados", <span className="cs-muted">En desarrollo</span>)}{R2("Contactados", fmt(a.contacted))}{R2("Tasa de conexión", pct(a.conn, 1))}{R2("Contacto → reunión", pct(a.c2m, 1))}</div></div>
        <div className="cs-card"><CardH t={<><Ic n="cal" s={16} /> Reuniones</>} right={<Pill v={div(a.attend, cfg.attendTarget)} />} /><div className="cs-rows">{R2("Agendadas", fmt(a.sched))}{R2("Realizadas", fmt(a.held))}{R2("Pendientes", fmt(a.pending))}{R2("Reprogramadas (rescates)", fmt(a.resch))}{R2("No-show", fmt(a.noshow))}{R2("Tasa de asistencia", pct(a.attend))}</div></div>
        <div className="cs-card"><CardH t={<><Ic n="star" s={16} /> Resultado</>} right={<Pill v={a.compl} />} /><div className="cs-rows">{R2("Oportunidades", fmt(a.opps))}{R2("Reunión → oportunidad", pct(a.m2o))}{R2("Meta de reuniones", fmt(a.goal, 1))}{R2("Cumplimiento de meta", pct(a.compl))}{R2("Variación realizadas", pdl)}{R2(s.group === "cell" ? "Ranking en la célula" : "Ranking en su grupo", rankT ? `#${rankT} de ${tm.length}` : "—")}</div></div>
      </div>
      <div className="cs-g2 cs-mt">
        <div className="cs-card">
          <CardH t={<><Ic n="mic" s={16} /> Calidad de llamadas</>} p={`${fmt(a.qN)} llamadas evaluadas en el período`} right={<QChip v={a.qScore} />} />
          <div className="cs-qhead">
            <div className="cs-qbig" style={{ ["--c" as any]: qc, background: `color-mix(in srgb, ${qc} 10%, transparent)` }}><b>{fmt(a.qScore)}</b><small>de 100</small></div>
            <div className="cs-rows" style={{ flex: 1 }}>
              <div><span>Meta de puntaje</span><b>{cfg.qTarget} pts</b></div>
              <div><span>Promedio del equipo</span><b>{fmt(team.qScore)} pts</b></div>
              <div><span>Últimas 4 semanas</span><b>{w4.map((v) => (ok(v) ? fmt(v) : "—")).join(" → ")}</b></div>
              <div><span>Buenas</span><b>{pct(a.qHi)}</b></div>
            </div>
          </div>
          <div className="cs-cmp" style={{ marginTop: 12 }}>
            {QCRIT.map((c, i) => {
              const v = a.qCrit[i], t = team.qCrit[i];
              const good = (v || 0) >= (t || 0);
              return (
                <div key={c.n}>
                  <div className="r1"><span>{c.n}</span><b className={good ? "cs-gt" : "cs-rt"}>{fmt(v, 1)} <small className="cs-muted">vs {fmt(t, 1)}</small></b></div>
                  <div className="cs-dual"><i style={{ width: `${((v || 0) / 5) * 100}%`, background: ok(v) ? crit5Color(v) : COLORS.n }} /><u style={{ left: `${((t || 0) / 5) * 100}%` }} /></div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="cs-card">
          <CardH t="Últimas llamadas evaluadas" p="Calificación y retroalimentación de la IA de Allo" right={<button className="cs-btn" onClick={() => go("qual")}>Ver calidad</button>} />
          <div className="cs-qlog">
            {ev.length ? ev.map((e) => (
              <div className="cs-qli" key={e.id}>
                <div className="cs-qs" style={{ background: qColor(qBand(M, e.score)) }}>{e.score}</div>
                <div>
                  <p><b>{QBN[qBand(M, e.score)]}</b> · {e.c && M.CL[e.c] ? M.CL[e.c].name : "—"} · {dayShort(e.d)} {dayMonthShort(e.d).split(" ")[1]} · {fmt(e.dur / 60, 1)} min</p>
                  <small>{e.improve ? <><b>A mejorar:</b> {e.improve}</> : e.nivel ?? ""}</small>
                </div>
              </div>
            )) : <p className="cs-muted">Sin llamadas evaluadas en este período.</p>}
          </div>
        </div>
      </div>
      <div className="cs-g21 cs-mt">
        <div className="cs-card">
          <CardH t="Tendencia de las últimas 4 semanas" p="Reuniones y oportunidades (barras) vs llamadas (línea)" />
          <div className="cs-cw l">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={wk.map(({ w, x }) => ({ l: `Sem ${w.short}`, sched: x.sched, held: x.held, opps: x.opps, calls: x.calls }))} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={COLORS.border} />
                <XAxis dataKey="l" {...axis} />
                <YAxis yAxisId="y" {...axis} allowDecimals={false} />
                <YAxis yAxisId="y1" orientation="right" {...axis} />
                <Tooltip />
                {legend}
                <Bar yAxisId="y" dataKey="sched" name="Agendadas" fill={COLORS.violet} radius={[6, 6, 0, 0]} maxBarSize={28} />
                <Bar yAxisId="y" dataKey="held" name="Realizadas" fill={COLORS.teal} radius={[6, 6, 0, 0]} maxBarSize={28} />
                <Bar yAxisId="y" dataKey="opps" name="Oportunidades" fill={COLORS.magenta} radius={[6, 6, 0, 0]} maxBarSize={28} />
                <Line yAxisId="y1" dataKey="calls" name="Llamadas" stroke={COLORS.primary} strokeWidth={2.5} dot={{ r: 4 }} type="monotone" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="cs-stack">
          <div className="cs-card">
            <CardH t="Eficiencia vs equipo" p="La marca negra es el promedio del equipo" />
            <div className="cs-cmp">
              {cmp.map(([l, v, t, fm]) => {
                const mx = Math.max(v || 0, t || 0) * 1.25 || 1;
                const good = (v || 0) >= (t || 0);
                return (
                  <div key={l}>
                    <div className="r1"><span>{l}</span><b className={good ? "cs-gt" : "cs-rt"}>{fm(v)} <small className="cs-muted">vs {fm(t)}</small></b></div>
                    <div className="cs-dual"><i style={{ width: `${((v || 0) / mx) * 100}%`, background: good ? COLORS.g : COLORS.r }} /><u style={{ left: `${((t || 0) / mx) * 100}%` }} /></div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="cs-card">
            <CardH t={`Alertas de ${s.short}`} />
            <div className="cs-att">{al.length ? al.map((x, i) => <AlertItem key={i} a={x} />) : <p className="cs-muted">Sin alertas en este período.</p>}</div>
          </div>
        </div>
      </div>
    </>
  );
}

export { leaderColor, leaderLabel };
