"use client";

import { useMemo } from "react";
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, Area, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Legend,
  Cell, PieChart, Pie, ScatterChart, Scatter, ReferenceLine, LabelList,
} from "recharts";
import {
  COLORS, QBN, QCRIT, agg, buckets, callStreak, clientRows, div, endOf, fmt, lastWeeks, leaderColor, leaderLabel,
  makeFilter, ok, pct, qBand, qColor, qSt, sdrFilter, sdrList, sdrRows, sem, sgn, trendDays, weekPeriod, periodFromRange,
  type Agg, type Model,
} from "@/lib/celulasSdr/engine";
import { addDays, dayShort, dayMonthShort, monthLabel, monthOf, businessDaysBetween, monthStart, monthEnd, MNL } from "@/lib/celulasSdr/calendar";
import {
  AlertItem, CardH, Crit5, Ic, KGrid, Mini, Pending, Pill, QChip, QNum, Sec, Seg, Who, crit5Color, dPP, dPct, dPts,
  useCells, type KCard,
} from "../components/ui";
import { Funnel } from "./Direccion";

const pctTick = (v: number) => `${Math.round(v * 100)}%`;
const legend = <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />;
const axis = { tick: { fontSize: 12 }, tickLine: false, axisLine: false } as const;

const CHANNEL_NOTE = "Emails, WhatsApp y LinkedIn vienen de HubSpot: por cliente solo se muestran si el cliente tiene su HubSpot conectado (Configuración → Cliente); con filtro de país solo se muestran las llamadas.";

// ─── Actividad SDR ──────────────────────────────────────────────────────────
export function ViewAct() {
  const { M, f, P, Pp, ptype } = useCells();
  const d = useMemo(() => {
    const fl = makeFilter(M, f);
    const a = agg(M, P, fl), b = Pp ? agg(M, Pp, fl) : null;
    const td = trendDays(M, P).map((x) => ({ d: x, a: agg(M, periodFromRange(x, x), fl) }));
    const rows = sdrRows(M, f, P, null).map((r) => ({ ...r, st: callStreak(M, r.s.key, endOf(P)) }));
    return { a, b, td, rows };
  }, [M, f, P, Pp]);
  const { a, b, td, rows } = d;
  const cfg = M.cfg;
  const nS = P.bdays.length ? a.callDays / P.bdays.length : 0;
  const cards: KCard[] = [
    { ic: "flag", l: "Meta diaria de llamadas", v: fmt(cfg.callGoal), sub: `Por SDR. Equipo filtrado: ${fmt(cfg.callGoal * nS)} al día` },
    { ic: "phone", l: "Llamadas realizadas", v: fmt(a.calls), of: fmt(a.callGoal), prog: a.callPct, dl: dPct(ptype, a.calls, b?.calls) },
    { ic: "split", l: "Diferencia vs meta", v: sgn(a.calls - a.callGoal), sub: a.calls >= a.callGoal ? "Sobre la meta de llamadas" : "Llamadas faltantes en el período", sem: a.calls >= a.callGoal ? "g" : sem(M, a.callPct) },
    { ic: "act", l: "Promedio diario por SDR", v: fmt(a.callsPerDay), of: fmt(cfg.callGoal), prog: div(a.callsPerDay, cfg.callGoal), dl: dPct(ptype, a.callsPerDay, b?.callsPerDay) },
    { ic: "cal", l: "Promedio semanal por SDR", v: fmt(ok(a.callsPerDay) ? a.callsPerDay * 5 : null), of: fmt(cfg.callGoal * 5), prog: div(a.callsPerDay, cfg.callGoal) },
    a.chUnavailable
      ? { ic: "grid", l: "Total de actividades", v: "—", sub: "Solo llamadas con este filtro", hl: true }
      : { ic: "grid", l: "Total de actividades", v: fmt(a.acts), of: fmt(a.actGoal), prog: a.actPct, dl: dPct(ptype, a.acts, b?.acts), hl: true },
  ];
  const ch: [string, string, number | null, number | null | undefined, string][] = [
    ["phone", "Llamadas", a.calls, b?.calls, COLORS.primary],
    ["mail", "Emails", a.emails, b?.emails, COLORS.sky],
    ["msg", "WhatsApp", a.wa, b?.wa, COLORS.teal],
    ["link", "LinkedIn", a.li, b?.li, COLORS.violet],
  ];
  const daily = td.map(({ d: x, a: y }) => ({ l: dayShort(x), calls: y.calls, emails: y.emails, wa: y.wa, li: y.li, actGoal: +y.actGoal.toFixed(0), callGoal: +y.callGoal.toFixed(0) }));
  const mix = ch.filter((c) => ok(c[2]) && (c[2] as number) > 0).map((c) => ({ name: c[1], value: c[2] as number, col: c[4] }));

  return (
    <>
      <KGrid cards={cards} />
      <Sec t="Actividad por canal" p="Actividad realizada vs actividad esperada" />
      {a.chUnavailable ? <div className="cs-banner info"><Ic n="eye" s={15} /><span>{CHANNEL_NOTE}</span></div> : null}
      <div className="cs-kgrid">
        {ch.map(([i, l, v, pv, c]) => (
          <div className="cs-kpi" key={l}>
            <div className="cs-kpi-h"><span className="cs-kic" style={{ background: `color-mix(in srgb, ${c} 13%, transparent)`, color: c }}><Ic n={i} s={15} /></span><span>{l}</span></div>
            <div className="cs-kv">{fmt(v)}</div>
            <div className="cs-ksub">{ok(v) && !a.chUnavailable ? `${pct(div(v, a.acts))} del total. ` : ""}{ok(v) ? `${fmt(div(v, a.callDays), 1)} por SDR al día` : "No disponible con este filtro"}</div>
            <div>{dPct(ptype, v, pv) || <span className="cs-dl n">Sin período anterior comparable</span>}</div>
          </div>
        ))}
        <div className="cs-kpi">
          <div className="cs-kpi-h"><span className="cs-kic" style={{ background: "#FDEBDD", color: COLORS.orange }}><Ic n="grid" s={15} /></span><span>Otras</span></div>
          <div className="cs-kv">—</div>
          <div className="cs-ksub">Datos pendientes de conexión</div>
        </div>
      </div>
      <div className="cs-g21 cs-mt">
        <div className="cs-card">
          <CardH t="Tendencia diaria de actividad" p="Barras apiladas por canal. Las líneas marcan la actividad esperada y la meta de llamadas" />
          <div className="cs-cw l">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={daily} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={COLORS.border} />
                <XAxis dataKey="l" {...axis} />
                <YAxis {...axis} />
                <Tooltip formatter={(v: any) => fmt(Number(v))} />
                {legend}
                <Bar dataKey="calls" name="Llamadas" stackId="a" fill={COLORS.primary} maxBarSize={40} />
                {!a.chUnavailable ? <Bar dataKey="emails" name="Emails" stackId="a" fill={COLORS.sky} maxBarSize={40} /> : null}
                {!a.chUnavailable ? <Bar dataKey="wa" name="WhatsApp" stackId="a" fill={COLORS.teal} maxBarSize={40} /> : null}
                {!a.chUnavailable ? <Bar dataKey="li" name="LinkedIn" stackId="a" fill={COLORS.violet} maxBarSize={40} radius={[3, 3, 0, 0]} /> : null}
                {!a.chUnavailable ? <Line dataKey="actGoal" name="Actividad esperada" stroke={COLORS.text} strokeDasharray="5 4" dot={false} strokeWidth={1.5} /> : null}
                <Line dataKey="callGoal" name="Meta de llamadas" stroke={COLORS.magenta} strokeDasharray="2 3" dot={false} strokeWidth={1.5} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="cs-card">
          <CardH t="Mezcla de canales" p="Distribución de la actividad del período" />
          <div className="cs-cw l">
            {mix.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={mix} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="85%" paddingAngle={2} stroke="none">
                    {mix.map((m) => <Cell key={m.name} fill={m.col} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => fmt(Number(v))} />
                  {legend}
                </PieChart>
              </ResponsiveContainer>
            ) : <Pending>Sin actividad en el período</Pending>}
          </div>
        </div>
      </div>
      <Sec t="Actividad por SDR" p={`Meta de ${cfg.callGoal} llamadas y ${cfg.actGoal} actividades por día`} />
      <div className="cs-card">
        <div className="cs-tw">
          <table>
            <thead><tr><th className="l">SDR</th><th>Llamadas</th><th>Meta</th><th>% llamadas</th><th>Diferencia</th><th>Prom. diario</th><th>Emails</th><th>WhatsApp</th><th>LinkedIn</th><th>Otras</th><th>Total</th><th>% actividad</th><th>Racha bajo meta</th></tr></thead>
            <tbody>
              {rows.map(({ s, a: x, st }) => (
                <tr key={s.key}>
                  <td className="l"><Who s={s} sub={leaderLabel(M, s)} /></td>
                  <td><b>{fmt(x.calls)}</b></td><td>{fmt(x.callGoal)}</td>
                  <td><Pill v={x.callPct} /><Mini v={x.callPct} /></td>
                  <td className={x.calls >= x.callGoal ? "cs-gt" : "cs-rt"}>{sgn(x.calls - x.callGoal)}</td>
                  <td>{fmt(x.callsPerDay)}</td><td>{fmt(x.emails)}</td><td>{fmt(x.wa)}</td><td>{fmt(x.li)}</td><td className="cs-muted">—</td>
                  <td><b>{fmt(x.acts)}</b></td><td><Pill v={x.actPct} /></td>
                  <td>{s.nodata ? "—" : st ? <span className={`cs-tag ${st >= 3 ? "r" : "y"}`}>{st} {st === 1 ? "día" : "días"}</span> : <span className="cs-tag g">Al día</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="cs-note">&quot;Otras&quot; actividades: datos pendientes de conexión. El total de actividades suma llamadas (Allo) y emails, WhatsApp y LinkedIn (HubSpot).</p>
      </div>
    </>
  );
}

// ─── Promedio diario de actividad ───────────────────────────────────────────
type AvgB = { l: string; s: string; days: string[]; partial: boolean; tot: number; a: Agg; v: Record<string, number | null>; nS: number; gC: number; gA: number; pC: number | null; pA: number | null };

function avgBuckets(M: Model, by: string, endD: string, fl: ReturnType<typeof makeFilter>, team: boolean): AvgB[] {
  const raw: { l: string; s: string; days: string[]; partial: boolean; tot: number }[] = by === "mes"
    ? M.months.map((m) => {
      const all = businessDaysBetween(monthStart(m), monthEnd(m));
      const days = all.filter((x) => x <= endD && M.days.includes(x));
      return { l: monthLabel(m), s: MNL[Number(m.slice(5)) - 1].slice(0, 3), days, partial: days.length < all.length, tot: all.length };
    })
    : M.weeks.map((w) => ({ l: `Sem ${w.label}`, s: `Sem ${w.short}`, days: w.days.filter((x) => x <= endD), partial: addDays(w.mon, 4) > endD, tot: w.days.length }));
  return raw.filter((b) => b.days.length).map((b) => {
    const a = agg(M, { dates: new Set(b.days), bdays: b.days, fullGoal: false }, fl);
    const dv = team ? a.nd : a.callDays;
    const nS = a.nd ? a.callDays / a.nd : 0;
    // Promedios de actividad sin los líderes (no tienen meta diaria)
    const ch = a.chUnavailable;
    const v = { calls: div(a.callsQ, dv), emails: ch ? null : div(a.emailsQ, dv), wa: ch ? null : div(a.waQ, dv), li: ch ? null : div(a.liQ, dv), acts: div(a.actsQ, dv), contacted: div(a.contacted, team ? a.nd : a.sdrDays), sched: div(a.sched, team ? a.nd : a.sdrDays) };
    const gC = M.cfg.callGoal * (team ? nS : 1), gA = M.cfg.actGoal * (team ? nS : 1);
    return { ...b, a, v, nS, gC, gA, pC: div(v.calls, gC), pA: div(v.acts, gA) };
  });
}

export function ViewAvg() {
  const { M, f, P, S, setS } = useCells();
  const team = S.avgBase === "team";
  const endD = endOf(P);
  const d = useMemo(() => {
    const fl = makeFilter(M, f);
    const B = avgBuckets(M, S.avgBy, endD, fl, team);
    const cur = B[B.length - 1];
    const sdrs = sdrList(M, f).filter((s) => !s.nodata && s.group !== "leader"); // líderes: sin meta diaria
    const under = cur ? sdrs.filter((s) => {
      const x = agg(M, { dates: new Set(cur.days), bdays: cur.days, fullGoal: false }, sdrFilter(M, f, s.key));
      return ok(x.callsPerDay) && x.callsPerDay < M.cfg.callGoal;
    }) : [];
    const allDays = B.flatMap((b) => b.days);
    const met = S.avgMet;
    const SR = sdrs.map((s) => {
      const sf = sdrFilter(M, f, s.key);
      const vals = B.map((b) => { const x = agg(M, { dates: new Set(b.days), bdays: b.days, fullGoal: false }, sf); return div(met === "calls" ? x.callsQ : x.actsQ, x.callDays); });
      const all = agg(M, { dates: new Set(allDays), bdays: allDays, fullGoal: false }, sf);
      return { s, vals, avg: div(met === "calls" ? all.callsQ : all.actsQ, all.callDays) };
    });
    const ta = agg(M, { dates: new Set(allDays), bdays: allDays, fullGoal: false }, fl);
    return { B, cur, prv: B[B.length - 2], under, nAct: sdrs.length, SR, ta };
  }, [M, f, endD, S.avgBy, S.avgMet, team]);
  const { B, cur, prv, under, nAct, SR, ta } = d;
  const cfg = M.cfg;
  const unit = team ? "del equipo al día" : "por SDR al día";
  const per = S.avgBy === "mes" ? "mes" : "semana";
  const pl = S.avgBy === "mes" ? "vs mes anterior" : "vs semana anterior";
  const dd = (x: number | null | undefined, y: number | null | undefined) => {
    if (!ok(x) || !ok(y) || !y) return undefined;
    const v = (x - y) / y;
    return <span className={`cs-dl ${v > 0.005 ? "good" : v < -0.005 ? "bad" : "n"}`}>{v > 0.005 ? "▲" : v < -0.005 ? "▼" : "■"} {sgn(v * 100, 0)}% <em>{pl}</em></span>;
  };
  const cards: KCard[] = cur ? [
    { ic: "act", l: `Actividades ${unit}`, v: fmt(cur.v.acts), of: fmt(cur.gA), prog: cur.pA, dl: prv ? dd(cur.v.acts, prv.v.acts) : undefined, hl: true, progTxt: `${pct(cur.pA)} de la meta. ${cur.l}${cur.partial ? " (en curso)" : ""}` },
    { ic: "phone", l: `Llamadas ${unit}`, v: fmt(cur.v.calls), of: fmt(cur.gC), prog: cur.pC, dl: prv ? dd(cur.v.calls, prv.v.calls) : undefined, hl: true, progTxt: `${pct(cur.pC)} de la meta de ${fmt(cur.gC)}` },
    { ic: "users", l: `Contactados ${unit}`, v: fmt(cur.v.contacted, 1), sub: `Conexión ${pct(cur.a.conn, 1)}`, dl: prv ? dd(cur.v.contacted, prv.v.contacted) : undefined },
    { ic: "cal", l: `Reuniones agendadas ${unit}`, v: fmt(cur.v.sched, team ? 1 : 2), sub: `${fmt(cur.a.sched)} en la ${per}`, dl: prv ? dd(cur.v.sched, prv.v.sched) : undefined },
    { ic: "alert", l: "SDR bajo la meta de llamadas", v: `${under.length}`, of: `${nAct}`, sem: under.length === 0 ? "g" : under.length <= nAct / 3 ? "y" : "r", sub: under.length ? under.map((s) => s.short).join(", ") : "Todo el equipo cumple" },
  ] : [];
  const gM = S.avgMet === "calls" ? cfg.callGoal : cfg.actGoal;
  const tv = B.map((b) => div(S.avgMet === "calls" ? b.a.callsQ : b.a.actsQ, b.a.callDays));
  const tavg = div(S.avgMet === "calls" ? ta.callsQ : ta.actsQ, ta.callDays);
  const cell = (v: number | null) => {
    if (!ok(v)) return "—";
    const c = COLORS[sem(M, div(v, gM))];
    return <span className="cs-qc" style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)` }}>{fmt(v)}</span>;
  };
  const trnd = (vals: (number | null)[]) => {
    const x = vals.filter(ok);
    if (x.length < 2) return "—";
    const fst = x.slice(0, Math.min(2, x.length - 1)), lst = x.slice(-2);
    const dv = lst.reduce((p, c) => p + c, 0) / lst.length / (fst.reduce((p, c) => p + c, 0) / fst.length) - 1;
    return dv > 0.05 ? <span className="cs-gt">📈 {sgn(dv * 100, 0)}%</span> : dv < -0.05 ? <span className="cs-rt">📉 {sgn(dv * 100, 0)}%</span> : <span className="cs-muted">➡️ {sgn(dv * 100, 0)}%</span>;
  };
  const chart = B.map((b) => ({ l: b.s + (b.partial ? "*" : ""), calls: b.v.calls, emails: b.v.emails, wa: b.v.wa, li: b.v.li, gA: +b.gA.toFixed(1), gC: +b.gC.toFixed(1), pA: b.pA, pC: b.pC }));
  const unavailable = B[0]?.a.chUnavailable;

  return (
    <>
      <div className="cs-card" style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", justifyContent: "space-between", padding: "14px 18px", marginBottom: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <small className="cs-muted">Ver por</small>
          <Seg value={S.avgBy} opts={[["sem", "Semana"], ["mes", "Mes"]]} onChange={(v) => setS({ avgBy: v })} />
          <small className="cs-muted">Promedio</small>
          <Seg value={S.avgBase} opts={[["sdr", "Por SDR"], ["team", "Del equipo"]]} onChange={(v) => setS({ avgBase: v })} />
        </div>
        <small className="cs-muted">{team ? "Total del equipo dividido por días hábiles" : "Total dividido por días hábiles trabajados por cada SDR"}. Respeta los filtros de líder, SDR, cliente y país.</small>
      </div>
      {unavailable ? <div className="cs-banner info"><Ic n="eye" s={15} /><span>{CHANNEL_NOTE}</span></div> : null}
      <KGrid cards={cards} />
      <div className="cs-g21 cs-mt">
        <div className="cs-card">
          <CardH t={`Promedio diario de actividad por ${per}`} p={`Promedio ${unit} por canal. Líneas: meta de actividades y de llamadas${B.some((b) => b.partial) ? ". * período en curso" : ""}`} />
          <div className="cs-cw l">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={COLORS.border} />
                <XAxis dataKey="l" {...axis} />
                <YAxis {...axis} />
                <Tooltip formatter={(v: any) => fmt(Number(v), 1)} />
                {legend}
                <Bar dataKey="calls" name="Llamadas" stackId="a" fill={COLORS.primary} maxBarSize={S.avgBy === "mes" ? 90 : 46} />
                <Bar dataKey="emails" name="Emails" stackId="a" fill={COLORS.sky} maxBarSize={S.avgBy === "mes" ? 90 : 46} />
                <Bar dataKey="wa" name="WhatsApp" stackId="a" fill={COLORS.teal} maxBarSize={S.avgBy === "mes" ? 90 : 46} />
                <Bar dataKey="li" name="LinkedIn" stackId="a" fill={COLORS.violet} maxBarSize={S.avgBy === "mes" ? 90 : 46} />
                <Line dataKey="gA" name="Meta de actividades" stroke={COLORS.text} strokeDasharray="6 4" dot={false} strokeWidth={1.6} />
                <Line dataKey="gC" name="Meta de llamadas" stroke={COLORS.primary} strokeDasharray="3 3" dot={false} strokeWidth={1.6} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="cs-card">
          <CardH t="Cumplimiento de la meta diaria" p={`Promedio diario vs meta, ${per} a ${per}`} />
          <div className="cs-cw l">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={COLORS.border} />
                <XAxis dataKey="l" {...axis} />
                <YAxis tickFormatter={pctTick} {...axis} />
                <Tooltip formatter={(v: any) => pct(Number(v))} />
                {legend}
                <Area dataKey="pA" name="Actividades vs meta" stroke={COLORS.primary} fill={COLORS.primary} fillOpacity={0.12} strokeWidth={3} type="monotone" connectNulls />
                <Line dataKey="pC" name="Llamadas vs meta" stroke={COLORS.teal} strokeWidth={2.5} type="monotone" connectNulls />
                <ReferenceLine y={1} stroke={COLORS.text} strokeDasharray="5 4" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <Sec t={`Detalle por ${per}`} p={`Promedio ${unit} de cada canal`} />
      <div className="cs-card">
        <div className="cs-tw">
          <table className="qm">
            <thead><tr><th className="l">{S.avgBy === "mes" ? "Mes" : "Semana"}</th><th>Días hábiles</th><th>SDR activos</th><th>Llamadas</th><th>Emails</th><th>WhatsApp</th><th>LinkedIn</th><th>Otras</th><th>Total actividades</th><th>Actividad vs meta</th><th>Llamadas vs meta</th><th>Var. vs {per} anterior</th></tr></thead>
            <tbody>
              {B.map((b, i) => {
                const p = B[i - 1];
                const dv = p && ok(b.v.acts) && p.v.acts ? b.v.acts / p.v.acts - 1 : null;
                return (
                  <tr key={b.l}>
                    <td className="l"><b>{b.l}</b>{b.partial ? <> <span className="cs-tag p">En curso</span></> : null}</td>
                    <td>{b.days.length}{b.partial ? ` de ${b.tot}` : ""}</td><td>{fmt(b.nS, 1)}</td>
                    <td>{fmt(b.v.calls, 1)}</td><td>{fmt(b.v.emails, 1)}</td><td>{fmt(b.v.wa, 1)}</td><td>{fmt(b.v.li, 1)}</td><td className="cs-muted">—</td>
                    <td><b>{fmt(b.v.acts, 1)}</b></td><td><Pill v={b.pA} /></td><td><Pill v={b.pC} /></td>
                    <td className={!ok(dv) ? "" : dv >= 0 ? "cs-gt" : "cs-rt"}>{ok(dv) ? `${dv >= 0 ? "▲ " : "▼ "}${sgn(dv * 100, 0)}%` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <Sec t={`Promedio diario por SDR y ${per}`} p={`${S.avgMet === "calls" ? "Llamadas" : "Actividades"} por día hábil. Color según la meta diaria de ${fmt(gM)}. Haz clic en un SDR para abrir su ficha`} />
      <div className="cs-card">
        <CardH t="Matriz de actividad diaria" p={`Verde ≥ ${pct(cfg.green)} de la meta, amarillo ≥ ${pct(cfg.yellow)}, rojo bajo ${pct(cfg.yellow)}`} right={<Seg value={S.avgMet} opts={[["acts", "Actividades"], ["calls", "Llamadas"]]} onChange={(v) => setS({ avgMet: v })} />} />
        <div className="cs-tw">
          <table className="qm">
            <thead><tr><th className="l">SDR</th><th className="l">Líder</th>{B.map((b) => <th key={b.l}>{b.s}{b.partial ? "*" : ""}</th>)}<th>Promedio</th><th>Tendencia</th></tr></thead>
            <tbody>
              {SR.map((r) => (
                <tr key={r.s.key}>
                  <td className="l"><Who s={r.s} /></td>
                  <td className="l"><span className="cs-tag" style={{ color: leaderColor(M, r.s) }}>{leaderLabel(M, r.s)}</span></td>
                  {r.vals.map((v, i) => <td key={i}>{cell(v)}</td>)}
                  <td>{cell(r.avg)}</td><td>{trnd(r.vals)}</td>
                </tr>
              ))}
              <tr className="tot"><td className="l"><b>Promedio del equipo</b></td><td />{tv.map((v, i) => <td key={i}>{cell(v)}</td>)}<td>{cell(tavg)}</td><td>{trnd(tv)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <p className="cs-note">Meta diaria por SDR: {fmt(cfg.callGoal)} llamadas y {fmt(cfg.actGoal)} actividades en total (llamadas, emails, WhatsApp y LinkedIn). Se ajustan en Configurar. Los SDR sin datos no se consideran en el promedio.</p>
    </>
  );
}

// ─── Tasa de conexión ───────────────────────────────────────────────────────
export function ViewConn() {
  const { M, f, P, Pp, ptype, S, setS, openSdr } = useCells();
  const d = useMemo(() => {
    const fl = makeFilter(M, f);
    const a = agg(M, P, fl), b = Pp ? agg(M, Pp, fl) : null;
    const rows = sdrRows(M, f, P, null).filter((r) => r.a.calls > 0).sort((x, y) => (y.a.conn || 0) - (x.a.conn || 0));
    const wk = lastWeeks(M, endOf(P), 2);
    const wa = wk.length ? agg(M, weekPeriod(M, wk[wk.length - 1]), fl) : null;
    const wb = wk.length > 1 ? agg(M, weekPeriod(M, wk[0]), fl) : null;
    const daily = trendDays(M, P).map((x) => ({ l: dayShort(x), conn: agg(M, periodFromRange(x, x), fl).conn }));
    const bk = buckets(M, f, S.connDim, P).filter((x) => x.a.calls > 0);
    return { a, b, rows, wa, wb, daily, bk };
  }, [M, f, P, Pp, S.connDim]);
  const { a, b, rows, wa, wb, daily, bk } = d;
  const cfg = M.cfg;
  const best = rows[0], worst = rows[rows.length - 1];
  const cc = (v: number | null) => (!ok(v) ? COLORS.n : v >= cfg.connectTarget ? COLORS.g : v >= cfg.connectMin ? COLORS.y : COLORS.r);
  const cards: KCard[] = [
    { ic: "phone", l: "Llamadas", v: fmt(a.calls), of: fmt(a.callGoal), prog: a.callPct, dl: dPct(ptype, a.calls, b?.calls) },
    { ic: "users", l: "Contactados", v: fmt(a.contacted), of: fmt(a.contGoal), prog: div(a.contacted, a.contGoal), dl: dPct(ptype, a.contacted, b?.contacted) },
    { ic: "wifi", l: "Tasa de conexión", v: pct(a.conn, 1), of: pct(cfg.connectTarget), prog: div(a.conn, cfg.connectTarget), dl: dPP(ptype, a.conn, b?.conn), hl: true },
    { ic: "trend", l: "Variación semanal", v: wb && wa && ok(wa.conn) && ok(wb.conn) ? sgn((wa.conn - wb.conn) * 100, 1) + " pp" : "—", sub: `Última semana ${pct(wa?.conn, 1)} vs ${wb ? pct(wb.conn, 1) : "—"} la anterior`, sem: wb && wa && ok(wa.conn) && ok(wb.conn) ? (wa.conn >= wb.conn ? "g" : "r") : "n" },
    { ic: "trophy", l: "Mejor conexión", v: best ? pct(best.a.conn, 1) : "—", sub: best ? best.s.name : "", sem: "g" },
    { ic: "alert", l: "Conexión más baja", v: worst ? pct(worst.a.conn, 1) : "—", sub: worst ? worst.s.name : "", sem: worst && (worst.a.conn ?? 0) < cfg.connectMin ? "r" : "y" },
  ];
  const dims: [string, string][] = [["client", "Cliente"], ["country", "País"], ["dow", "Día de la semana"], ["week", "Semana"], ["sdr", "SDR"]];
  const rankData = rows.map((r) => ({ l: r.s.name, v: r.a.conn, calls: r.a.calls, cont: r.a.contacted, key: r.s.key }));
  return (
    <>
      <KGrid cards={cards} />
      <div className="cs-g2 cs-mt">
        <div className="cs-card">
          <CardH t="Ranking de SDR por conexión" p="Contactados / llamadas realizadas × 100" />
          <div className="cs-cw l" style={{ height: Math.max(260, rankData.length * 30 + 40) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rankData} layout="vertical" margin={{ top: 4, right: 36, left: 0, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke={COLORS.border} />
                <XAxis type="number" tickFormatter={pctTick} {...axis} />
                <YAxis type="category" dataKey="l" width={150} {...axis} />
                <Tooltip formatter={(v: any, _n, p: any) => [`${pct(Number(v), 1)} (${fmt(p.payload.cont)} de ${fmt(p.payload.calls)} llamadas)`, "Conexión"]} />
                <Bar dataKey="v" radius={[0, 6, 6, 0]} maxBarSize={22} onClick={(x: any) => openSdr(x.key)} cursor="pointer">
                  {rankData.map((r) => <Cell key={r.key} fill={cc(r.v)} fillOpacity={0.85} />)}
                  <LabelList dataKey="v" position="right" formatter={(v: any) => pct(Number(v), 1)} style={{ fontSize: 11 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="cs-card">
          <CardH t="Conexión diaria" p={`Objetivo ${pct(cfg.connectTarget)} y mínimo ${pct(cfg.connectMin)}`} />
          <div className="cs-cw l">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={daily} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={COLORS.border} />
                <XAxis dataKey="l" {...axis} />
                <YAxis tickFormatter={pctTick} {...axis} />
                <Tooltip formatter={(v: any) => pct(Number(v), 1)} />
                {legend}
                <Area dataKey="conn" name="Conexión" stroke={COLORS.sky} fill={COLORS.sky} fillOpacity={0.15} strokeWidth={2.5} type="monotone" connectNulls />
                <ReferenceLine y={cfg.connectTarget} stroke={COLORS.g} strokeDasharray="5 4" label={{ value: "Objetivo", fontSize: 11, fill: COLORS.g, position: "insideTopRight" }} />
                <ReferenceLine y={cfg.connectMin} stroke={COLORS.r} strokeDasharray="2 3" label={{ value: "Mínimo", fontSize: 11, fill: COLORS.r, position: "insideBottomRight" }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <div className="cs-card cs-mt">
        <CardH t="Análisis de conexión" p="Barras: tasa de conexión. Línea: volumen de llamadas" right={<Seg value={S.connDim} opts={dims} onChange={(v) => setS({ connDim: v })} />} />
        <div className="cs-cw l">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={bk.map((x) => ({ l: x.l, conn: x.a.conn, calls: x.a.calls }))} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={COLORS.border} />
              <XAxis dataKey="l" {...axis} interval={0} angle={bk.length > 8 ? -25 : 0} textAnchor={bk.length > 8 ? "end" : "middle"} height={bk.length > 8 ? 60 : 30} />
              <YAxis yAxisId="y" tickFormatter={pctTick} {...axis} />
              <YAxis yAxisId="y1" orientation="right" {...axis} />
              <Tooltip formatter={(v: any, n: any) => (n === "Llamadas" ? fmt(Number(v)) : pct(Number(v), 1))} />
              {legend}
              <Bar yAxisId="y" dataKey="conn" name="Tasa de conexión" radius={[8, 8, 0, 0]} maxBarSize={44}>
                {bk.map((x, i) => <Cell key={i} fill={cc(x.a.conn)} fillOpacity={0.85} />)}
              </Bar>
              <Line yAxisId="y1" dataKey="calls" name="Llamadas" stroke={COLORS.primary} strokeWidth={2} dot={{ r: 3 }} type="monotone" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      <p className="cs-note">Contactado = llamada en la etapa &quot;Conversación&quot; del embudo de Allo (la definición de Allo de una conversación real: excluye buzón de voz y cortes). País de las llamadas = código telefónico del número de Allo.</p>
    </>
  );
}

// ─── Calidad de llamadas ────────────────────────────────────────────────────
export function ViewQual() {
  const { M, f, P, Pp, ptype, S, setS, openSdr } = useCells();
  const d = useMemo(() => {
    const fl = makeFilter(M, f);
    const a = agg(M, P, fl), b = Pp ? agg(M, Pp, fl) : null;
    const rows = sdrRows(M, f, P, Pp).map((r) => ({ ...r, q: r.a.qScore, qp: r.b?.qScore ?? null }));
    const w8 = lastWeeks(M, endOf(P), 8);
    const ser = (ff: typeof fl) => w8.map((w) => agg(M, weekPeriod(M, w), ff).qScore);
    const teamSer = ser(fl);
    const cellSer = f.sdr ? [] : M.leaders.filter((l) => !f.leader || l.key === f.leader).map((l) => ({ l, v: ser(makeFilter(M, { ...f, leader: l.key, sdr: "" })) }));
    const trend = w8.map((w, i) => {
      const o: Record<string, any> = { l: `Sem ${w.short}`, team: teamSer[i] };
      cellSer.forEach((c) => (o[c.l.key] = c.v[i]));
      return o;
    });
    return { a, b, rows, trend, cellSer };
  }, [M, f, P, Pp]);
  const { a, b, rows, trend, cellSer } = d;
  const cfg = M.cfg;
  const rated = rows.filter((r) => ok(r.q));
  const best = [...rated].sort((x, y) => (y.q ?? 0) - (x.q ?? 0))[0];
  const wk = a.qCrit.map((v, i) => ({ v, i })).filter((x) => ok(x.v)).sort((x, y) => x.v! - y.v!)[0];
  const cards: KCard[] = [
    { ic: "mic", l: "Puntaje promedio", v: fmt(a.qScore), of: fmt(cfg.qTarget), sem: qSt(M, a.qScore), prog: a.qPct, progTxt: ok(a.qScore) ? `${QBN[qBand(M, a.qScore)]}. Meta ${cfg.qTarget} pts` : "Sin evaluaciones", dl: dPts(ptype, a.qScore, b?.qScore), hl: true },
    { ic: "phone", l: "Llamadas evaluadas", v: fmt(a.qN), sub: `${pct(div(a.qN, a.contacted), 1)} de las llamadas contactadas`, dl: dPct(ptype, a.qN, b?.qN, "n") },
    { ic: "star", l: "Buenas", v: pct(a.qHi), sem: ok(a.qHi) ? (a.qHi >= 0.75 ? "g" : a.qHi >= 0.6 ? "y" : "r") : "n", prog: a.qHi, progTxt: `${fmt(a.qb.g)} llamadas con ${cfg.qGood} pts o más`, dl: dPP(ptype, a.qHi, b?.qHi) },
    { ic: "x", l: "Deficientes", v: fmt(a.qb.r), sem: ok(a.qLo) ? (a.qLo <= 0.05 ? "g" : a.qLo <= 0.12 ? "y" : "r") : "n", prog: ok(a.qLo) ? Math.min(1, a.qLo / 0.2) : null, progTxt: `${pct(a.qLo, 1)} de las evaluadas, bajo ${cfg.qReg} pts`, dl: dPct(ptype, a.qb.r, b?.qb.r, true) },
    { ic: "trophy", l: "Mejor puntaje", v: best ? best.s.short : "—", sub: best ? `${fmt(best.q)} pts. ${QBN[qBand(M, best.q!)]}` : "" },
    { ic: "alert", l: "Criterio más débil", v: wk ? QCRIT[wk.i].s : "—", sub: wk ? `${fmt(wk.v, 1)} / 5 promedio del equipo` : "" },
  ];
  const band = S.qBand;
  const fl = makeFilter(M, f);
  const log = M.evals
    .filter((e) => P.dates.has(e.d) && fl.sdrOk(e.s) && fl.cOk(e.c, e.k) && (band === "all" || qBand(M, e.score) === band))
    .sort((x, y) => (y.d > x.d ? 1 : y.d < x.d ? -1 : 0))
    .slice(0, 14);
  const srt = [...rated].sort((x, y) => (y.q ?? 0) - (x.q ?? 0));
  const dist = rated.map((r) => ({ l: r.s.short, g: div(r.a.qb.g, r.a.qN), y: div(r.a.qb.y, r.a.qN), r: div(r.a.qb.r, r.a.qN) }));
  const pts = rated.filter((r) => ok(r.a.mp100));
  const mx = pts.reduce((x, r) => x + (r.q ?? 0), 0) / (pts.length || 1);
  const my = pts.reduce((x, r) => x + (r.a.mp100 ?? 0), 0) / (pts.length || 1);

  if (!M.evals.length && !a.qN) {
    return (
      <>
        <KGrid cards={cards} k6 />
        <div className="cs-card cs-mt"><Pending>Todavía no hay llamadas con &quot;Score de Desempeño SDR&quot; de Allo en el período cargado.</Pending></div>
      </>
    );
  }
  return (
    <>
      <KGrid cards={cards} k6 />
      <div className="cs-g2 cs-mt">
        <div className="cs-card">
          <CardH t="Puntaje por SDR" p={`Promedio de las llamadas evaluadas. La línea marca la meta de ${cfg.qTarget} pts`} />
          <div className="cs-cw l" style={{ height: Math.max(240, srt.length * 30 + 50) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={srt.map((r) => ({ l: r.s.name, v: r.q, key: r.s.key }))} layout="vertical" margin={{ top: 18, right: 36, left: 0, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke={COLORS.border} />
                <XAxis type="number" domain={[0, 100]} {...axis} />
                <YAxis type="category" dataKey="l" width={150} {...axis} />
                <Tooltip formatter={(v: any) => [`${fmt(Number(v), 1)} pts. ${QBN[qBand(M, Number(v))]}`, "Puntaje"]} />
                <ReferenceLine x={cfg.qTarget} stroke={COLORS.text} strokeDasharray="5 4" label={{ value: `Meta ${cfg.qTarget}`, position: "top", fontSize: 11, fill: COLORS.text }} />
                <Bar dataKey="v" radius={[0, 6, 6, 0]} maxBarSize={22} onClick={(x: any) => openSdr(x.key)} cursor="pointer">
                  {srt.map((r) => <Cell key={r.s.key} fill={qColor(qBand(M, r.q!))} />)}
                  <LabelList dataKey="v" position="right" formatter={(v: any) => fmt(Number(v))} style={{ fontSize: 11 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="cs-card">
          <CardH t="Calificación de las llamadas" p={`Distribución por SDR: buena ≥ ${cfg.qGood}, regular ≥ ${cfg.qReg}, deficiente < ${cfg.qReg}`} />
          <div className="cs-cw l" style={{ height: Math.max(240, dist.length * 30 + 60) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dist} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke={COLORS.border} />
                <XAxis type="number" domain={[0, 1]} tickFormatter={pctTick} {...axis} />
                <YAxis type="category" dataKey="l" width={100} {...axis} />
                <Tooltip formatter={(v: any) => pct(Number(v))} />
                {legend}
                <Bar dataKey="g" name="Buena" stackId="q" fill={COLORS.g} maxBarSize={22} />
                <Bar dataKey="y" name="Regular" stackId="q" fill={COLORS.y} maxBarSize={22} />
                <Bar dataKey="r" name="Deficiente" stackId="q" fill={COLORS.r} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <Sec t="Puntaje por criterio" p="Promedio de cada ítem de la pauta de Allo (escala 1 a 5). Haz clic en un SDR para abrir su ficha" />
      <div className="cs-card">
        <div className="cs-tw">
          <table className="qm">
            <thead><tr><th className="l">SDR</th><th className="l">Líder</th><th>Evaluadas</th>{QCRIT.map((c) => <th key={c.n} title={c.n}>{c.s}</th>)}<th>Puntaje</th><th className="l">Calificación</th><th>Var.</th><th className="l">A trabajar</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const A = r.a;
                const wi = A.qCrit.map((v, i) => ({ v, i })).filter((x) => ok(x.v)).sort((x, y) => x.v! - y.v!)[0];
                const dv = ok(r.q) && ok(r.qp) ? r.q - r.qp : null;
                return (
                  <tr key={r.s.key} className="click" onClick={() => openSdr(r.s.key)}>
                    <td className="l"><Who s={r.s} /></td>
                    <td className="l"><span className="cs-tag" style={{ color: leaderColor(M, r.s) }}>{leaderLabel(M, r.s)}</span></td>
                    <td>{fmt(A.qN)}</td>
                    {A.qCrit.map((v, i) => <td key={i}><Crit5 v={v} /></td>)}
                    <td><QNum v={r.q} /></td><td className="l"><QChip v={r.q} /></td>
                    <td className={!ok(dv) ? "" : dv >= 0 ? "cs-gt" : "cs-rt"}>{ok(dv) ? sgn(dv, 1) : "—"}</td>
                    <td className="l cs-muted">{wi ? QCRIT[wi.i].s : "—"}</td>
                  </tr>
                );
              })}
              <tr className="tot">
                <td className="l"><b>Equipo</b></td><td /><td><b>{fmt(a.qN)}</b></td>
                {a.qCrit.map((v, i) => <td key={i}><Crit5 v={v} /></td>)}
                <td><QNum v={a.qScore} /></td><td className="l"><QChip v={a.qScore} /></td>
                <td className={b && ok(b.qScore) && ok(a.qScore) ? (a.qScore >= b.qScore ? "cs-gt" : "cs-rt") : ""}>{b && ok(b.qScore) && ok(a.qScore) ? sgn(a.qScore - b.qScore, 1) : "—"}</td><td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="cs-g2 cs-mt">
        <div className="cs-card">
          <CardH t="Tendencia del puntaje" p="Promedio semanal de las llamadas evaluadas" />
          <div className="cs-cw l">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trend} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={COLORS.border} />
                <XAxis dataKey="l" {...axis} />
                <YAxis domain={[0, 100]} {...axis} />
                <Tooltip formatter={(v: any) => fmt(Number(v), 1)} />
                {legend}
                <Area dataKey="team" name="Equipo" stroke={COLORS.primary} fill={COLORS.primary} fillOpacity={0.12} strokeWidth={3} type="monotone" connectNulls />
                {cellSer.map((c) => <Line key={c.l.key} dataKey={c.l.key} name={`Equipo ${c.l.short}`} stroke={c.l.color} strokeDasharray="4 3" strokeWidth={2} type="monotone" connectNulls />)}
                <ReferenceLine y={cfg.qTarget} stroke={COLORS.text} strokeDasharray="5 4" label={{ value: "Meta", fontSize: 11, position: "insideTopRight" }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="cs-card">
          <CardH t="Calidad vs resultado" p="Puntaje de llamadas vs reuniones agendadas por cada 100 llamadas. Tamaño según reuniones realizadas" />
          <div className="cs-cw l">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 18, right: 16, left: 0, bottom: 14 }}>
                <CartesianGrid stroke={COLORS.border} />
                <XAxis type="number" dataKey="x" name="Puntaje" domain={["dataMin - 5", "dataMax + 5"]} {...axis} label={{ value: "Puntaje promedio de llamadas", position: "insideBottom", offset: -8, fontSize: 11 }} />
                <YAxis type="number" dataKey="y" name="Reuniones/100" {...axis} />
                <ZAxis type="number" dataKey="z" range={[60, 420]} />
                <ReferenceLine x={mx} stroke={COLORS.n} strokeDasharray="5 5" />
                <ReferenceLine y={my} stroke={COLORS.n} strokeDasharray="5 5" />
                <Tooltip formatter={(v: any, n: any) => [fmt(Number(v), 2), n]} labelFormatter={() => ""} />
                <Scatter data={pts.map((r) => ({ x: r.q, y: r.a.mp100, z: r.a.held + 1, name: r.s.short, key: r.s.key, col: r.s.color }))} onClick={(x: any) => openSdr(x.key)} cursor="pointer">
                  {pts.map((r) => <Cell key={r.s.key} fill={r.s.color} fillOpacity={0.7} />)}
                  <LabelList dataKey="name" position="top" style={{ fontSize: 11 }} />
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <Sec t="Últimas llamadas evaluadas" p="Detalle de la calificación de cada llamada, con la oportunidad de mejora y la fortaleza que identificó Allo" />
      <div className="cs-card">
        <CardH t="Registro de evaluaciones" p={log.length ? `Mostrando las ${log.length} más recientes` : "Sin evaluaciones con este filtro"} right={<Seg value={S.qBand} opts={[["all", "Todas"], ["g", "Buenas"], ["y", "Regulares"], ["r", "Deficientes"]]} onChange={(v) => setS({ qBand: v })} />} />
        <div className="cs-tw">
          <table>
            <thead><tr><th className="l">Fecha</th><th className="l">SDR</th><th className="l">Cliente</th><th>Duración</th><th>Puntaje</th><th className="l">Calificación</th><th className="l">Retroalimentación</th><th className="l">Evaluó</th></tr></thead>
            <tbody>
              {log.map((e) => {
                const s = M.SD[e.s];
                const wi = e.crit.map((v, i) => ({ v, i })).filter((x) => ok(x.v)).sort((x, y) => x.v! - y.v!)[0];
                return (
                  <tr key={e.id}>
                    <td className="l">{dayShort(e.d)} {dayMonthShort(e.d).split(" ")[1]}</td>
                    <td className="l">{s ? <Who s={s} /> : e.s}</td>
                    <td className="l">{e.c && M.CL[e.c] ? M.CL[e.c].name : "—"}</td>
                    <td>{fmt(e.dur / 60, 1)} min</td>
                    <td><QNum v={e.score} /></td><td className="l"><QChip v={e.score} /></td>
                    <td className="l fb">
                      {wi ? <b>{QCRIT[wi.i].s} ({fmt(wi.v, 1)}/5): </b> : null}{e.improve ?? "—"}
                      {e.strength ? <><br /><span className="cs-muted">Fortaleza: {e.strength}</span></> : null}
                    </td>
                    <td className="l cs-muted">IA de Allo</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="cs-note">Pauta de Allo: {QCRIT.map((c) => c.n).join(", ")}, cada ítem de 1 a 5. El puntaje total (0 a 100) lo calcula la IA de Allo en el &quot;Score de Desempeño SDR&quot;. Solo se consideran llamadas conectadas con ese análisis. La meta y los rangos se ajustan en Configurar (colores igual que en el resto de la app).</p>
    </>
  );
}

// ─── Reuniones y no-show ────────────────────────────────────────────────────
export function ViewMtg() {
  const { M, f, P, Pp, ptype, S, setS } = useCells();
  const d = useMemo(() => {
    const fl = makeFilter(M, f);
    const a = agg(M, P, fl), b = Pp ? agg(M, Pp, fl) : null;
    const nb = buckets(M, f, S.nsDim, P).filter((x) => x.a.held + x.a.noshow > 0);
    const ws = lastWeeks(M, endOf(P), 8).map((w) => ({ w, x: agg(M, weekPeriod(M, w), fl) }));
    return { a, b, nb, ws };
  }, [M, f, P, Pp, S.nsDim]);
  const { a, b, nb, ws } = d;
  const cfg = M.cfg;
  const nsAvg = a.nsRate;
  const st: [string, number, string][] = [["Llamadas", a.calls, COLORS.primary], ["Contactados", a.contacted, COLORS.sky], ["Reuniones agendadas", a.sched, COLORS.violet], ["Reuniones realizadas", a.held, COLORS.teal], ["Oportunidades", a.opps, COLORS.magenta]];
  const cvk: (keyof Agg)[] = ["conn", "c2m", "concr", "m2o"];
  const cv = ["Llamada → contacto", "Contacto → reunión", "Agendada → realizada", "Realizada → oportunidad"];
  const mx = Math.log10(a.calls + 1) || Math.log10(a.sched + 1) || 1;
  const dims: [string, string][] = [["sdr", "SDR"], ["client", "Cliente"], ["leader", "Líder"], ["week", "Semana"], ["month", "Mes"]];
  const flag = nb.filter((x) => ok(x.a.nsRate) && ok(nsAvg) && x.a.nsRate > nsAvg && x.a.held + x.a.noshow >= 3).sort((x, y) => (y.a.nsRate ?? 0) - (x.a.nsRate ?? 0));
  const cards: KCard[] = [
    { ic: "cal", l: "Reuniones agendadas", v: fmt(a.sched), of: fmt(a.schedGoal), prog: div(a.sched, a.schedGoal), dl: dPct(ptype, a.sched, b?.sched) },
    { ic: "check", l: "Reuniones realizadas", v: fmt(a.held), of: fmt(a.goal), prog: a.compl, dl: dPct(ptype, a.held, b?.held) },
    { ic: "x", l: "No-show", v: fmt(a.noshow), sub: `${fmt(a.due)} reuniones con fecha en el período`, sem: !ok(a.nsRate) ? "n" : a.nsRate <= cfg.noshowMax ? "g" : "r", dl: dPct(ptype, a.noshow, b?.noshow, true) },
    { ic: "repeat", l: "Reprogramadas (rescates)", v: fmt(a.resch), sub: `${pct(div(a.resch, a.due))} de las reuniones del período`, dl: dPct(ptype, a.resch, b?.resch, true) },
    { ic: "pctg", l: "Tasa de no-show", v: pct(a.nsRate, 1), of: pct(cfg.noshowMax), sem: !ok(a.nsRate) ? "n" : a.nsRate <= cfg.noshowMax ? "g" : a.nsRate <= cfg.noshowMax * 1.25 ? "y" : "r", sub: "No-show / (realizadas + no-show)", dl: dPP(ptype, a.nsRate, b?.nsRate, true) },
    { ic: "users", l: "Tasa de asistencia", v: pct(a.attend, 1), of: pct(cfg.attendTarget), prog: div(a.attend, cfg.attendTarget), dl: dPP(ptype, a.attend, b?.attend) },
  ];
  const label = (l: string) => (S.nsDim === "month" ? monthLabel(l) : l);
  const nsData = nb.map((x) => ({ l: label(x.l), v: x.a.nsRate, ns: x.a.noshow, due: x.a.held + x.a.noshow }));
  const weekData = ws.map(({ w, x }) => ({ l: `Sem ${w.short}`, held: x.held, noshow: x.noshow, resch: x.resch, opps: x.opps, m2o: x.m2o }));
  return (
    <>
      <div className="cs-g21">
        <div className="cs-card">
          <CardH t="Embudo comercial" p="Llamadas → contactados → agendadas → realizadas → oportunidades" />
          <Funnel stages={st} convs={cvk.map((k) => a[k] as number | null)} labels={cv} mx={mx} extra={(i) => (b ? dPP(ptype, a[cvk[i]] as number | null, b[cvk[i]] as number | null) : null)} />
        </div>
        <div className="cs-card cs-m2o">
          <CardH t="Reunión realizada → oportunidad" p="La métrica que conecta la actividad SDR con el negocio" />
          <div className="bigv">{pct(a.m2o)}</div>
          <div className="cs-muted">{fmt(a.opps)} oportunidades de {fmt(a.held)} reuniones realizadas. Objetivo {pct(cfg.oppTarget)}</div>
          <div>{b ? dPP(ptype, a.m2o, b.m2o) : null}</div>
          <div style={{ height: 110, marginTop: 8 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={weekData}>
                <YAxis hide domain={[0, "auto"]} />
                <Tooltip formatter={(v: any) => pct(Number(v))} labelStyle={{ color: COLORS.text }} />
                <Area dataKey="m2o" stroke="#fff" fill="#fff" fillOpacity={0.12} strokeWidth={2} type="monotone" connectNulls />
                <ReferenceLine y={cfg.oppTarget} stroke="rgba(255,255,255,.45)" strokeDasharray="4 4" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="cs-muted" style={{ fontSize: 12 }}>Últimas 8 semanas. La línea punteada es el objetivo</div>
        </div>
      </div>
      <Sec t="No-show" p="Reuniones perdidas y asistencia. Realizado: Si = realizada, No = no-show, Reagendar = rescate a gestionar" />
      <KGrid cards={cards} />
      <div className="cs-g21 cs-mt">
        <div className="cs-card">
          <CardH t="Tasa de no-show" p={`Rojo: sobre el límite. Amarillo: sobre el promedio (${pct(nsAvg, 1)})`} right={<Seg value={S.nsDim} opts={dims} onChange={(v) => setS({ nsDim: v })} />} />
          <div className="cs-cw l">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={nsData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={COLORS.border} />
                <XAxis dataKey="l" {...axis} interval={0} angle={nsData.length > 8 ? -25 : 0} textAnchor={nsData.length > 8 ? "end" : "middle"} height={nsData.length > 8 ? 60 : 30} />
                <YAxis tickFormatter={pctTick} {...axis} />
                <Tooltip formatter={(v: any, _n, p: any) => [`${pct(Number(v), 1)} (${p.payload.ns} de ${p.payload.due})`, "No-show"]} />
                <Bar dataKey="v" name="Tasa de no-show" radius={[8, 8, 0, 0]} maxBarSize={44}>
                  {nsData.map((x, i) => <Cell key={i} fill={(x.v ?? 0) > cfg.noshowMax ? COLORS.r : ok(nsAvg) && (x.v ?? 0) > nsAvg ? COLORS.y : COLORS.g} fillOpacity={0.85} />)}
                </Bar>
                {ok(nsAvg) ? <ReferenceLine y={nsAvg} stroke={COLORS.text} strokeDasharray="5 4" label={{ value: "Promedio", fontSize: 11, position: "insideTopLeft" }} /> : null}
                <ReferenceLine y={cfg.noshowMax} stroke={COLORS.r} strokeDasharray="2 3" label={{ value: "Límite", fontSize: 11, fill: COLORS.r, position: "insideTopRight" }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="cs-card">
          <CardH t="Sobre el promedio" p="Identificados automáticamente" />
          <div className="cs-att">
            {flag.length ? flag.map((x, i) => (
              <AlertItem key={i} a={{ lvl: (x.a.nsRate ?? 0) > cfg.noshowMax ? "r" : "y", score: 0, cat: `${x.a.noshow} no-show de ${x.a.held + x.a.noshow} reuniones`, sdr: x.sdr, client: x.client, text: `**${x.full || label(x.l)}**: ${pct(x.a.nsRate, 1)} de no-show`, hint: `${sgn(((x.a.nsRate ?? 0) - (nsAvg ?? 0)) * 100, 1)} pp sobre el promedio` }} />
            )) : <p className="cs-muted">Nadie supera el promedio con volumen suficiente.</p>}
          </div>
        </div>
      </div>
      <div className="cs-card cs-mt">
        <CardH t="Resultado de reuniones por semana" p="Realizadas, no-show y reprogramadas según la fecha de la reunión" />
        <div className="cs-cw l">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={weekData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={COLORS.border} />
              <XAxis dataKey="l" {...axis} />
              <YAxis {...axis} allowDecimals={false} />
              <Tooltip />
              {legend}
              <Bar dataKey="held" name="Realizadas" stackId="m" fill={COLORS.teal} maxBarSize={40} />
              <Bar dataKey="noshow" name="No-show" stackId="m" fill={COLORS.r} maxBarSize={40} />
              <Bar dataKey="resch" name="Reprogramadas" stackId="m" fill={COLORS.y} maxBarSize={40} radius={[4, 4, 0, 0]} />
              <Line dataKey="opps" name="Oportunidades" stroke={COLORS.magenta} strokeWidth={2.5} dot={{ r: 3 }} type="monotone" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      <p className="cs-note">Agendadas cuentan por fecha de agendamiento; realizadas, no-show y reprogramadas por fecha de la reunión. Se cuentan todas las reuniones, sin importar el origen, atribuidas al &quot;Responsable de la reunión&quot;. Oportunidad = reunión realizada con Propuesta/Oportunidad en: {cfg.oppValues.join(", ") || "—"}.</p>
    </>
  );
}

// ─── Cumplimiento por cliente ───────────────────────────────────────────────
export function ViewClients() {
  const { M, f, P, ptype, openClient, openCfg } = useCells();
  const d = useMemo(() => {
    const rows = clientRows(M, f, P).sort((x, y) => (y.a.compl ?? -1) - (x.a.compl ?? -1));
    const team = agg(M, P, makeFilter(M, f));
    return { rows, team };
  }, [M, f, P]);
  const { rows, team } = d;
  const cfg = M.cfg;
  const cnt = { g: 0, y: 0, r: 0, none: 0, hi: 0 };
  rows.forEach((r) => {
    if (r.status === "n") return;
    cnt[r.status]++;
    if (r.hiLo) cnt.hi++;
  });
  const ST: Record<string, [string, string]> = { g: ["Sobre meta", "g"], y: ["En riesgo", "y"], r: ["Bajo meta", "r"], none: ["Sin actividad", "r"], n: ["Sin meta", ""] };
  const pts = rows.filter((r) => r.a.goal > 0);
  const avgCalls = div(pts.reduce((x, r) => x + r.a.calls, 0), pts.length);
  return (
    <>
      <div className="cs-counts">
        <div className="cs-cnt" style={{ ["--c" as any]: COLORS.primary }}><b>{pct(team.wcompl)}</b><span>Cumplimiento ponderado</span></div>
        <div className="cs-cnt" style={{ ["--c" as any]: COLORS.g }}><b>{cnt.g}</b><span>🟢 Sobre meta</span></div>
        <div className="cs-cnt" style={{ ["--c" as any]: COLORS.y }}><b>{cnt.y}</b><span>🟡 En riesgo</span></div>
        <div className="cs-cnt" style={{ ["--c" as any]: COLORS.r }}><b>{cnt.r}</b><span>🔴 Bajo meta</span></div>
        <div className="cs-cnt" style={{ ["--c" as any]: COLORS.n }}><b>{cnt.none}</b><span>Sin actividad</span></div>
        <div className="cs-cnt" style={{ ["--c" as any]: COLORS.orange }}><b>{cnt.hi}</b><span>Alta actividad, bajo resultado</span></div>
      </div>
      <div className="cs-card">
        <CardH t="Cumplimiento por cliente" p={`Cumplimiento = realizadas / meta del cliente (suma de las metas internas de sus SDR, ${ptype === "mes" && cfg.goalBase === "mes" ? "meta completa del mes" : "meta a la fecha"}). El aporte ponderado usa el peso de cada cliente, con tope de ${pct(cfg.cap)}`} right={<button className="cs-btn" onClick={openCfg}><Ic n="sliders" s={14} /> Editar pesos</button>} />
        <div className="cs-tw">
          <table>
            <thead><tr><th className="l">Cliente</th><th className="l">País</th><th>Meta</th><th>Peso</th><th>Agendadas</th><th>Realizadas</th><th>Cumplimiento</th><th>No-show</th><th>Oportunidades</th><th>Llamadas</th><th>Aporte ponderado</th><th className="l">Estado</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const a = r.a, s = ST[r.status] ?? ST.n;
                return (
                  <tr key={r.c.id} className="click" onClick={() => openClient(r.c.id)}>
                    <td className="l"><b>{r.c.name}</b></td>
                    <td className="l cs-muted">{r.c.country ?? "—"}</td>
                    <td>{fmt(a.goal, 1)}</td><td>{fmt(r.c.weight, 1)}%</td><td>{fmt(a.sched)}</td><td><b>{fmt(a.held)}</b></td>
                    <td>{r.status === "n" ? <span className="cs-muted">—</span> : <><Pill v={r.status === "none" ? 0 : a.compl} s={r.status === "none" ? "r" : undefined} /><Mini v={a.compl} s={r.status === "none" ? "r" : undefined} /></>}</td>
                    <td>{fmt(a.noshow)}</td><td>{fmt(a.opps)}</td><td>{fmt(a.calls)}</td>
                    <td>{ok(r.contrib) ? `${fmt(r.contrib * r.c.weight, 1)} / ${fmt(r.c.weight, 1)}` : "—"}</td>
                    <td className="l"><span className={`cs-tag ${s[1]}`}>{s[0]}</span>{r.hiLo ? <> <span className="cs-tag" style={{ color: COLORS.orange }}>Alta actividad, bajo resultado</span></> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="cs-note">Haz clic en un cliente para filtrar todo el dashboard por esa cuenta. País del cliente: el más frecuente en sus reuniones (columna País). La actividad por cliente se mide en llamadas de Allo (HubSpot no separa emails/WhatsApp/LinkedIn por cliente).</p>
      </div>
      <div className="cs-card cs-mt">
        <CardH t="Actividad vs resultado por cliente" p="El tamaño de cada burbuja es el peso del cliente. Líneas: llamadas promedio y umbral verde" />
        <div className="cs-cw" style={{ height: 380 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 18, right: 16, left: 0, bottom: 14 }}>
              <CartesianGrid stroke={COLORS.border} />
              <XAxis type="number" dataKey="x" name="Llamadas" {...axis} label={{ value: "Llamadas en el período", position: "insideBottom", offset: -8, fontSize: 11 }} />
              <YAxis type="number" dataKey="y" name="Cumplimiento" tickFormatter={pctTick} {...axis} />
              <ZAxis type="number" dataKey="z" range={[60, 900]} />
              {ok(avgCalls) ? <ReferenceLine x={avgCalls} stroke={COLORS.n} strokeDasharray="5 5" /> : null}
              <ReferenceLine y={cfg.green} stroke={COLORS.n} strokeDasharray="5 5" />
              <Tooltip formatter={(v: any, n: any) => [n === "Cumplimiento" ? pct(Number(v)) : fmt(Number(v)), n]} labelFormatter={() => ""} />
              <Scatter data={pts.map((r) => ({ x: r.a.calls, y: r.a.compl || 0, z: r.c.weight + 1, name: r.c.name, id: r.c.id, st: r.status }))} onClick={(x: any) => openClient(x.id)} cursor="pointer">
                {pts.map((r) => <Cell key={r.c.id} fill={r.status === "none" ? COLORS.r : r.status === "n" ? COLORS.n : COLORS[r.status]} fillOpacity={0.55} />)}
                <LabelList dataKey="name" position="top" style={{ fontSize: 11 }} />
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
}

export { monthOf };
