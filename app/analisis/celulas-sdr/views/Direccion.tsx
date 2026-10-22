"use client";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from "recharts";
import {
  COLORS, FC_TXT, LEADERS_GROUP, NO_CELL, QBN, agg, attention, buildAlerts, c01, div, endOf, fmt, forecast,
  lastWeeks, leaderColor, leaderLabel, makeFilter, ok, pct, qBand, qSt, sdrRows, sem, sgn, weekPeriod,
  type Agg, type SdrRow,
} from "@/lib/celulasSdr/engine";
import { monthLabel } from "@/lib/celulasSdr/calendar";
import {
  AlertItem, Av, CardH, GoalSeg, Ic, KGrid, Mini, Pill, QChip, Rings, Sec, SemPill, Stat, Who, dPP, dPct, dPts,
  useCells, type KCard,
} from "../components/ui";

const pctTick = (v: number) => `${Math.round(v * 100)}%`;
const legend = <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />;

// ─── Resumen ejecutivo ──────────────────────────────────────────────────────
export function ViewExec() {
  const { M, f, P, Pp, ptype, go } = useCells();
  const d = useMemo(() => {
    const fl = makeFilter(M, f);
    const a = agg(M, P, fl), b = Pp ? agg(M, Pp, fl) : null;
    const fc = forecast(M, fl, endOf(P));
    const al = buildAlerts(M, f, P);
    const wk = lastWeeks(M, endOf(P), 8).map((w) => ({ w, x: agg(M, weekPeriod(M, w), fl) }));
    return { a, b, fc, al, att: attention(al), wk };
  }, [M, f, P, Pp]);
  const { a, b, fc, al, att, wk } = d;
  const cfg = M.cfg;
  const nsS = !ok(a.nsRate) ? "n" : a.nsRate <= cfg.noshowMax ? "g" : a.nsRate <= cfg.noshowMax * 1.25 ? "y" : "r";
  const cards: KCard[] = [
    { ic: "target", l: "Cumplimiento general", v: pct(a.compl), of: "100%", prog: a.compl, progTxt: `Realizadas vs meta. Ponderado por cliente: ${pct(a.wcompl)}`, dl: dPP(ptype, a.compl, b?.compl), hl: true },
    { ic: "flag", l: "Meta de reuniones", v: fmt(a.goal), sub: ptype === "mes" && cfg.goalBase === "mes" ? `Meta completa del mes. Esperado a la fecha: ${fmt((fc.goalM * fc.elapsed) / (fc.total || 1), 1)}` : `Meta a la fecha. Meta del mes: ${fmt(fc.goalM)}` },
    { ic: "cal", l: "Reuniones agendadas", v: fmt(a.sched), of: fmt(a.schedGoal), prog: div(a.sched, a.schedGoal), dl: dPct(ptype, a.sched, b?.sched) },
    { ic: "check", l: "Reuniones realizadas", v: fmt(a.held), of: fmt(a.goal), prog: a.compl, dl: dPct(ptype, a.held, b?.held), hl: true },
    { ic: "clock", l: "Reuniones pendientes", v: fmt(a.pending), sub: "Agendadas que aún no ocurren" },
    { ic: "x", l: "No-show", v: fmt(a.noshow), sem: nsS, prog: ok(a.nsRate) ? c01(a.nsRate / cfg.noshowMax) : null, progTxt: `Tasa ${pct(a.nsRate)}, límite ${pct(cfg.noshowMax)}`, dl: dPct(ptype, a.noshow, b?.noshow, true) },
    { ic: "pctg", l: "Tasa de asistencia", v: pct(a.attend), of: pct(cfg.attendTarget), prog: div(a.attend, cfg.attendTarget), dl: dPP(ptype, a.attend, b?.attend) },
    { ic: "star", l: "Oportunidades generadas", v: fmt(a.opps), of: fmt(a.oppGoal), prog: div(a.opps, a.oppGoal), dl: dPct(ptype, a.opps, b?.opps) },
    { ic: "zap", l: "Reunión → oportunidad", v: pct(a.m2o), of: pct(cfg.oppTarget), prog: div(a.m2o, cfg.oppTarget), dl: dPP(ptype, a.m2o, b?.m2o), hl: true },
    { ic: "phone", l: "Llamadas realizadas", v: fmt(a.calls), of: fmt(a.callGoal), prog: a.callPct, dl: dPct(ptype, a.calls, b?.calls) },
    { ic: "users", l: "Contactados", v: fmt(a.contacted), of: fmt(a.contGoal), prog: div(a.contacted, a.contGoal), dl: dPct(ptype, a.contacted, b?.contacted) },
    { ic: "wifi", l: "Tasa de conexión", v: pct(a.conn, 1), of: pct(cfg.connectTarget), prog: div(a.conn, cfg.connectTarget), dl: dPP(ptype, a.conn, b?.conn) },
    a.chUnavailable
      ? { ic: "act", l: "Actividades realizadas", v: "—", sub: "Con filtro de cliente o país solo hay llamadas (HubSpot no separa por cliente)" }
      : { ic: "act", l: "Actividades realizadas", v: fmt(a.acts), of: fmt(a.actGoal), prog: a.actPct, dl: dPct(ptype, a.acts, b?.acts) },
    { ic: "mic", l: "Puntaje de llamadas", v: fmt(a.qScore), of: fmt(cfg.qTarget), sem: qSt(M, a.qScore), prog: a.qPct, progTxt: ok(a.qScore) ? `${QBN[qBand(M, a.qScore)]}. ${fmt(a.qN)} llamadas evaluadas` : "Sin evaluaciones", dl: dPts(ptype, a.qScore, b?.qScore), hl: true },
  ];
  const gs = sem(M, a.compl);
  const fcol = fc.st === "n" ? COLORS.n : COLORS[fc.st];
  const scale = Math.max(fc.goalM, fc.proj) * 1.05 || 1;
  const fs: [string, number, string][] = [["Llamadas", a.calls, COLORS.primary], ["Contactados", a.contacted, COLORS.sky], ["Agendadas", a.sched, COLORS.violet], ["Realizadas", a.held, COLORS.teal], ["Oportunidades", a.opps, COLORS.magenta]];
  const mx = Math.log10(a.calls + 1) || Math.log10(a.sched + 1) || 1;
  const convs = [a.conn, a.c2m, a.concr, a.m2o];
  const cl = ["Llamada → contacto", "Contacto → reunión", "Agendada → realizada", "Realizada → oportunidad"];
  const weekData = wk.map(({ w, x }) => ({ l: `Sem ${w.short}`, held: x.held, goal: +x.goal.toFixed(1), sched: x.sched, st: sem(M, x.compl) }));

  return (
    <>
      <div className="cs-hero">
        <div className="cs-card">
          <CardH t="Cumplimiento general" p={`Reuniones realizadas vs meta. Ponderado por cliente: ${pct(a.wcompl)}`} right={<div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}><SemPill s={gs} />{ptype === "mes" ? <GoalSeg /> : null}</div>} />
          <div className="cs-target">
            <Rings items={[{ v: a.compl, col: COLORS[gs] }, { v: div(a.attend, cfg.attendTarget), col: COLORS.teal }, { v: div(a.m2o, cfg.oppTarget), col: COLORS.magenta }]} center={pct(a.compl)} sub="de la meta" />
            <div className="cs-rl">
              <div><i style={{ background: COLORS[gs] }} /><span>Realizadas vs meta</span><b>{pct(a.compl)}</b></div>
              <div><i style={{ background: COLORS.teal }} /><span>Asistencia vs objetivo</span><b>{pct(div(a.attend, cfg.attendTarget))}</b></div>
              <div><i style={{ background: COLORS.magenta }} /><span>Reunión → opp vs objetivo</span><b>{pct(div(a.m2o, cfg.oppTarget))}</b></div>
            </div>
          </div>
          <div className="cs-stats">
            <Stat l="Meta del período" v={fmt(a.goal, 1)} />
            <Stat l="Resultado actual" v={fmt(a.held)} />
            <Stat l="Diferencia vs meta" v={sgn(a.held - a.goal, 1)} cls={a.held >= a.goal ? "cs-gt" : "cs-rt"} />
            <Stat l="Ritmo actual" v={`${fmt(fc.avg, 1)} / día`} />
            <Stat l="Ritmo necesario" v={fc.remaining ? `${fmt(fc.need, 1)} / día` : "Cerrado"} cls={fc.need > fc.avg ? "cs-rt" : "cs-gt"} />
            <Stat l="Proyección de cierre" v={fmt(fc.proj)} />
          </div>
        </div>
        <div className="cs-card">
          <CardH t="Proyección de cierre" p={`${monthLabel(fc.m)}, reuniones realizadas`} right={<SemPill s={fc.st} txt={FC_TXT[fc.st]} />} />
          <div className="cs-fc-big"><b>{fmt(fc.proj)}</b><span>proyectadas de {fmt(fc.goalM)} ({pct(fc.ratio)})</span></div>
          <div className="cs-fcbar">
            <div className="pj" style={{ width: `${Math.min(100, (fc.proj / scale) * 100)}%`, background: fcol }} />
            <div className="ac" style={{ width: `${Math.min(100, (fc.actual / scale) * 100)}%`, background: fcol }} />
            <div className="mk" style={{ left: `${(fc.goalM / scale) * 100}%` }}><span>Meta {fmt(fc.goalM)}</span></div>
          </div>
          <div className="cs-rows">
            <div><span>Resultado acumulado</span><b>{fmt(fc.actual)}</b></div>
            <div><span>Días hábiles transcurridos</span><b>{fc.elapsed} de {fc.total}</b></div>
            <div><span>Días hábiles restantes</span><b>{fc.remaining}</b></div>
            <div><span>Promedio diario actual</span><b>{fmt(fc.avg, 1)}</b></div>
            <div><span>Ritmo necesario para la meta</span><b className={fc.need > fc.avg ? "cs-rt" : "cs-gt"}>{fc.remaining ? `${fmt(fc.need, 1)} / día` : "—"}</b></div>
            <div><span>Reuniones pendientes en agenda</span><b>{fmt(fc.pending)}</b></div>
            <div><span>Oportunidades proyectadas</span><b>{fmt(fc.oppProj)}</b></div>
          </div>
        </div>
        <div className="cs-card cs-att-card">
          <CardH t="Atención del líder" p="Las 5 situaciones que requieren intervención" right={<button className="cs-btn" onClick={() => go("alerts")}><Ic n="bell" s={14} /> Ver todas ({al.filter((x) => x.lvl !== "g").length})</button>} />
          <div className="cs-att">{att.length ? att.map((x, i) => <AlertItem key={i} a={x} />) : <p className="cs-muted">Sin situaciones críticas en este período.</p>}</div>
        </div>
      </div>
      <KGrid cards={cards} />
      <div className="cs-g21 cs-mt">
        <div className="cs-card">
          <CardH t="Ritmo semanal" p="Reuniones realizadas por semana vs meta. El color de la barra indica el semáforo de esa semana" />
          <div className="cs-cw l">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={weekData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={COLORS.border} />
                <XAxis dataKey="l" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip formatter={(v: any) => fmt(Number(v), 1)} />
                {legend}
                <Bar dataKey="held" name="Realizadas" radius={[8, 8, 0, 0]} maxBarSize={38}>
                  {weekData.map((x, i) => <Cell key={i} fill={COLORS[x.st]} fillOpacity={0.85} />)}
                </Bar>
                <Line dataKey="goal" name="Meta" stroke={COLORS.text} strokeDasharray="5 4" strokeWidth={1.5} dot={false} />
                <Line dataKey="sched" name="Agendadas" stroke={COLORS.primary} strokeWidth={2.5} dot={{ r: 3 }} type="monotone" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="cs-card">
          <CardH t="De actividad a resultado" p="Conversión entre etapas del período" right={<button className="cs-btn" onClick={() => go("mtg")}>Ver embudo</button>} />
          <Funnel stages={fs} convs={convs} labels={cl} mx={mx} />
        </div>
      </div>
    </>
  );
}

export function Funnel({ stages, convs, labels, mx, extra }: { stages: [string, number, string][]; convs: (number | null)[]; labels: string[]; mx: number; extra?: (i: number) => React.ReactNode }) {
  return (
    <div className="cs-fun">
      {stages.map(([l, v, c], i) => (
        <div key={l}>
          <div className="cs-fst">
            <div className="cs-fbar" style={{ width: `${35 + (65 * Math.log10(v + 1)) / mx}%`, maxWidth: "100%", background: c }}>
              <span>{l}</span>
              <b>{fmt(v)}</b>
            </div>
          </div>
          {i < stages.length - 1 ? (
            <div className={`cs-fconv ${i === stages.length - 2 ? "key" : ""}`}>
              {labels[i]} <b>{pct(convs[i], 1)}</b> {extra ? extra(i) : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ─── Ranking de SDR ─────────────────────────────────────────────────────────
const RCOLS: [string, string, string?][] = [["name", "SDR", "l"], ["leader", "Líder", "l"], ["goal", "Meta"], ["sched", "Agendadas"], ["held", "Realizadas"], ["compl", "Cumplimiento"], ["qScore", "Puntaje llamadas"], ["noshow", "No-show"], ["calls", "Llamadas"], ["contacted", "Conectados"], ["conn", "Conexión"], ["opps", "Oportunidades"], ["m2o", "Reunión → opp"]];
const MEDAL = ["🥇", "🥈", "🥉"];

export function ViewRank() {
  const { M, f, P, Pp, ptype, S, setS, openSdr } = useCells();
  const rows = useMemo(() => {
    // Solo SDR con "Status Responsable = Activo" en la pestaña Maestra
    // (confirmado con BullsEye). El podio, los destacados y la tabla usan
    // esta misma lista.
    const r = sdrRows(M, f, P, Pp).filter((x) => x.s.active === true);
    [...r].sort((x, y) => (y.a.compl ?? -1) - (x.a.compl ?? -1)).forEach((x, i) => (x.rank = i + 1));
    return r;
  }, [M, f, P, Pp]);
  const { k, d: dir } = S.sort;
  const val = (r: SdrRow): any => (k === "name" ? r.s.name : k === "leader" ? leaderLabel(M, r.s) : (r.a as any)[k]);
  const sorted = [...rows].sort((x, y) => {
    const a = val(x), b = val(y);
    if (typeof a === "string") return a.localeCompare(b, "es") * dir;
    return ((a ?? -1e9) - (b ?? -1e9)) * dir;
  });
  const byC = [...rows].sort((x, y) => (x.rank ?? 0) - (y.rank ?? 0));
  const pick = (fv: (r: SdrRow) => number | null | undefined, g?: (r: SdrRow) => boolean) => {
    let best: { r: SdrRow; v: number } | null = null;
    rows.forEach((r) => {
      const v = fv(r);
      if (!ok(v) || (g && !g(r)) || r.s.nodata) return;
      if (!best || v > best.v) best = { r, v };
    });
    return best as { r: SdrRow; v: number } | null;
  };
  const H: [string, string, ReturnType<typeof pick>, (v: number) => string, string][] = [
    ["trend", "Mayor crecimiento", pick((r) => r.gr, (r) => !!r.b && r.b.held >= 2), (v) => sgn(v * 100, 0) + "% realizadas", COLORS.g],
    ["check", "Más reuniones realizadas", pick((r) => r.a.held), (v) => fmt(v) + " reuniones", COLORS.primary],
    ["wifi", "Mejor tasa de conexión", pick((r) => r.a.conn, (r) => r.a.calls >= 20), (v) => pct(v, 1), COLORS.sky],
    ["target", "Mejor cumplimiento", pick((r) => r.a.compl), (v) => pct(v), COLORS.teal],
    ["zap", "Mejor reunión → opp", pick((r) => r.a.m2o, (r) => r.a.held >= 3), (v) => pct(v), COLORS.magenta],
    ["mic", "Mejor puntaje de llamadas", pick((r) => r.a.qScore, (r) => r.a.qN >= 3), (v) => `${fmt(v, 1)} pts. ${QBN[qBand(M, v)]}`, COLORS.violet],
    ["x", "Mayor no-show", pick((r) => r.a.nsRate, (r) => r.a.held + r.a.noshow >= 3), (v) => pct(v) + " de no-show", COLORS.r],
  ];
  const pod = [byC[1], byC[0], byC[2]].filter((r) => r && ok(r.a.compl));
  const onSort = (key: string) => setS({ sort: k === key ? { k, d: -dir } : { k: key, d: key === "name" || key === "leader" ? 1 : -1 } });

  return (
    <>
      <div className="cs-podium">
        {pod.map((r) => (
          <div key={r.s.key} className={`cs-pod p${r.rank}`} onClick={() => openSdr(r.s.key)}>
            <div className="md">{MEDAL[(r.rank ?? 1) - 1]}</div>
            <Av s={r.s} z={44} />
            <h4>{r.s.name}</h4>
            <small className="cs-muted">{r.s.group === "cell" ? `Equipo ${leaderLabel(M, r.s)}` : leaderLabel(M, r.s)}</small>
            <div className="big" style={{ color: COLORS[sem(M, r.a.compl)] }}>{pct(r.a.compl)}</div>
            <small className="cs-muted">{fmt(r.a.held)} de {fmt(r.a.goal, 1)} reuniones</small>
          </div>
        ))}
      </div>
      <Sec t="Destacados del período" p="Haz clic para abrir la ficha del SDR" />
      <div className="cs-hls">
        {H.map(([i, l, b, fm, c]) =>
          b ? (
            <div key={l} className="cs-hlc" style={{ ["--c" as any]: c }} onClick={() => openSdr(b.r.s.key)}>
              <span className="i"><Ic n={i} s={17} /></span>
              <div><small>{l}</small><b>{b.r.s.name}</b><em>{fm(b.v)}</em></div>
            </div>
          ) : null
        )}
      </div>
      {ptype === "mes" ? (
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, margin: "18px 0 -8px" }}>
          <small className="cs-muted">Cumplimiento vs</small>
          <GoalSeg />
        </div>
      ) : null}
      <Sec t="Ranking individual" p={`Ordenado por ${(RCOLS.find((c) => c[0] === k) ?? ["", ""])[1].toLowerCase()}. Haz clic en un encabezado para cambiar el criterio. Solo SDR activos en la Maestra`} />
      <div className="cs-card">
        <div className="cs-tw">
          <table>
            <thead>
              <tr>
                <th className="l">#</th>
                {RCOLS.map(([key, l, al]) => (
                  <th key={key} className={`s ${al ?? ""} ${k === key ? "on" : ""}`} onClick={() => onSort(key)}>
                    {l}{k === key ? (dir < 0 ? " ▾" : " ▴") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const a = r.a;
                return (
                  <tr key={r.s.key} className="click" onClick={() => openSdr(r.s.key)}>
                    <td className="l" style={{ fontSize: (r.rank ?? 9) <= 3 ? 17 : 13 }}>{(r.rank ?? 9) <= 3 && ok(a.compl) ? MEDAL[(r.rank ?? 1) - 1] : r.rank}</td>
                    <td className="l"><Who s={r.s} /></td>
                    <td className="l"><span className="cs-tag" style={{ color: leaderColor(M, r.s) }}>{leaderLabel(M, r.s)}</span></td>
                    <td>{fmt(a.goal, 1)}</td>
                    <td>{fmt(a.sched)}</td>
                    <td><b>{fmt(a.held)}</b></td>
                    <td><Pill v={a.compl} /><Mini v={a.compl} /></td>
                    <td><QChip v={a.qScore} withNum /></td>
                    <td className={ok(a.nsRate) && a.nsRate > M.cfg.noshowMax ? "cs-rt" : ""}>{fmt(a.noshow)} <small className="cs-muted">({pct(a.nsRate)})</small></td>
                    <td>{fmt(a.calls)}</td>
                    <td>{fmt(a.contacted)}</td>
                    <td className={ok(a.conn) && a.conn < M.cfg.connectMin ? "cs-rt" : ""}>{pct(a.conn, 1)}</td>
                    <td>{fmt(a.opps)}</td>
                    <td>{pct(a.m2o)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ─── Comparación de líderes ─────────────────────────────────────────────────
export function ViewLeaders() {
  const { M, f, P, Pp, openLeader } = useCells();
  const L = useMemo(() => M.leaders.map((l) => {
    const fl = makeFilter(M, { ...f, leader: l.key, sdr: "" });
    const a = agg(M, P, fl);
    const b = Pp ? agg(M, Pp, fl) : null;
    const n = M.sdrs.filter((s) => s.leaderKey === l.key && !s.nodata).length;
    const wk = lastWeeks(M, endOf(P), 8).map((w) => ({ w, x: agg(M, weekPeriod(M, w), fl) }));
    return { l, a, b, n, col: l.color, wk };
  }), [M, f, P, Pp]);
  const rowsAll = useMemo(() => sdrRows(M, { ...f, leader: "" }, P, null).filter((r) => r.s.group === "cell"), [M, f, P]);

  if (L.length < 2) {
    return <div className="cs-card"><p className="cs-muted">Se necesitan al menos dos células en la pestaña Maestra (columnas O y P) para comparar líderes.</p></div>;
  }
  const [A, B] = L;
  const cfg = M.cfg;
  const Mx: [string, (x: typeof A) => number | null, (v: number | null) => string, boolean?, boolean?][] = [
    ["Meta del equipo", (x) => x.a.goal, (v) => fmt(v, 1), false, true], ["Reuniones agendadas", (x) => x.a.sched, (v) => fmt(v)], ["Reuniones realizadas", (x) => x.a.held, (v) => fmt(v)],
    ["Cumplimiento", (x) => x.a.compl, (v) => pct(v)], ["No-show", (x) => x.a.noshow, (v) => fmt(v), true], ["Tasa de no-show", (x) => x.a.nsRate, (v) => pct(v), true],
    ["Llamadas", (x) => x.a.calls, (v) => fmt(v)], ["Conexiones", (x) => x.a.contacted, (v) => fmt(v)], ["Tasa de conexión", (x) => x.a.conn, (v) => pct(v, 1)],
    ["Oportunidades", (x) => x.a.opps, (v) => fmt(v)], ["Reunión → opp", (x) => x.a.m2o, (v) => pct(v)], ["Puntaje de llamadas", (x) => x.a.qScore, (v) => (ok(v) ? fmt(v, 1) + " pts" : "—")],
    ["Realizadas por SDR", (x) => div(x.a.held, x.n), (v) => fmt(v, 1)], ["Llamadas por SDR/día", (x) => x.a.callsPerDay, (v) => fmt(v)], ["Oportunidades por SDR", (x) => div(x.a.opps, x.n), (v) => fmt(v, 1)],
  ];
  const lead = (A.a.compl || 0) >= (B.a.compl || 0) ? A : B, other = lead === A ? B : A;
  const gaps = ([["tasa de conexión", (x: typeof A) => x.a.conn], ["asistencia", (x: typeof A) => x.a.attend], ["reunión → oportunidad", (x: typeof A) => x.a.m2o], ["cumplimiento de llamadas", (x: typeof A) => x.a.callPct]] as const)
    .map(([n, fn]) => ({ n, a: fn(A), b: fn(B), d: (fn(A) || 0) - (fn(B) || 0) }))
    .filter((g) => ok(g.a) || ok(g.b))
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  const g0 = gaps[0];
  const norm = (x: Agg) => [
    Math.min(1.2, x.compl || 0), Math.min(1.2, div(x.attend, cfg.attendTarget) || 0), Math.min(1.2, div(x.conn, cfg.connectTarget) || 0),
    Math.min(1.2, div(x.m2o, cfg.oppTarget) || 0), Math.min(1.2, x.callPct || 0), Math.min(1.2, x.actPct || 0), Math.min(1.2, x.qPct || 0),
  ];
  const axes = ["Cumplimiento", "Asistencia", "Conexión", "Reunión → opp", "Llamadas", "Actividad", "Calidad"];
  const radar = axes.map((ax, i) => ({ ax, A: norm(A.a)[i], B: norm(B.a)[i] }));
  const trend = A.wk.map((x, i) => ({ l: `Sem ${x.w.short}`, A: x.x.compl, B: B.wk[i]?.x.compl ?? null }));
  const team = rowsAll.filter((r) => !f.leader || r.s.leaderKey === f.leader);

  const avatar = (x: typeof A) => <Av s={{ name: x.l.name, color: x.col }} z={48} />;
  return (
    <>
      <div className="cs-lead-sum">
        <div className="cs-card"><div className="cs-who"><Ic n="trophy" s={22} /><div><b>El equipo de {lead.l.short} lidera con {pct(lead.a.compl)} de cumplimiento</b><small>{other.l.short} está en {pct(other.a.compl)}: diferencia de {fmt(Math.abs((lead.a.compl || 0) - (other.a.compl || 0)) * 100, 1)} pp</small></div></div></div>
        {g0 ? <div className="cs-card"><div className="cs-who"><Ic n="split" s={22} /><div><b>Mayor brecha: {g0.n}</b><small>{A.l.short} {pct(g0.a, 1)} vs {B.l.short} {pct(g0.b, 1)} ({sgn(g0.d * 100, 1)} pp)</small></div></div></div> : null}
      </div>
      <div className="cs-card">
        <div className="cs-vs-head">
          <div className="cs-vs-l cs-lk" onClick={() => openLeader(A.l.key)}>{avatar(A)}<div><h3>{A.l.name}</h3><small className="cs-muted">{A.n} SDR. <Pill v={A.a.compl} /></small></div></div>
          <div className="cs-vs-mid">vs</div>
          <div className="cs-vs-l r cs-lk" onClick={() => openLeader(B.l.key)}>{avatar(B)}<div><h3>{B.l.name}</h3><small className="cs-muted"><Pill v={B.a.compl} /> {B.n} SDR.</small></div></div>
        </div>
        {Mx.map(([lb, fn, fm, inv, neutral]) => {
          const va = fn(A), vb = fn(B), mx = Math.max(va || 0, vb || 0) || 1;
          const aw = !neutral && ok(va) && ok(vb) && va !== vb && (inv ? va < vb : va > vb);
          const bw = !neutral && ok(va) && ok(vb) && va !== vb && !aw;
          return (
            <div className="cs-vsr" key={lb}>
              <div className={`cs-vside a ${aw ? "win" : ""}`}><span>{fm(va)}</span><div className="vb"><i style={{ width: `${((va || 0) / mx) * 100}%`, background: A.col }} /></div></div>
              <div className="lb">{lb}</div>
              <div className={`cs-vside ${bw ? "win" : ""}`}><div className="vb"><i style={{ width: `${((vb || 0) / mx) * 100}%`, background: B.col }} /></div><span>{fm(vb)}</span></div>
            </div>
          );
        })}
        <p className="cs-note">Las células suman solo a sus integrantes: la meta y las reuniones propias de cada líder se cuentan aparte (grupo &quot;Líderes&quot;).</p>
      </div>
      <div className="cs-g2 cs-mt">
        <div className="cs-card">
          <CardH t="Perfil de desempeño" p="Cada eje muestra el % del objetivo alcanzado" />
          <div className="cs-cw l">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radar} outerRadius="72%">
                <PolarGrid stroke={COLORS.border} />
                <PolarAngleAxis dataKey="ax" tick={{ fontSize: 12, fill: "#6B6884" }} />
                <PolarRadiusAxis domain={[0, 1.2]} tick={false} axisLine={false} />
                <Radar name={A.l.name} dataKey="A" stroke={A.col} fill={A.col} fillOpacity={0.18} strokeWidth={2} />
                <Radar name={B.l.name} dataKey="B" stroke={B.col} fill={B.col} fillOpacity={0.18} strokeWidth={2} />
                <Tooltip formatter={(v: any) => `${pct(Number(v))} del objetivo`} />
                {legend}
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="cs-card">
          <CardH t="Tendencia semanal" p="Cumplimiento semanal de cada célula" />
          <div className="cs-cw l">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trend} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={COLORS.border} />
                <XAxis dataKey="l" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={pctTick} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v: any) => pct(Number(v))} />
                {legend}
                <Line dataKey="A" name={`Equipo ${A.l.short}`} stroke={A.col} strokeWidth={2.5} dot={{ r: 3 }} type="monotone" connectNulls />
                <Line dataKey="B" name={`Equipo ${B.l.short}`} stroke={B.col} strokeWidth={2.5} dot={{ r: 3 }} type="monotone" connectNulls />
                <Line dataKey={() => cfg.green} name="Umbral verde" stroke={COLORS.n} strokeDasharray="5 4" dot={false} strokeWidth={1} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <div className="cs-card cs-mt">
        <CardH t="Cumplimiento por SDR" p="Color según la célula de cada SDR. Haz clic para abrir su ficha" />
        <div className="cs-cw">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={team.map((r) => ({ l: r.s.short, v: r.a.compl, key: r.s.key, col: leaderColor(M, r.s) }))} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={COLORS.border} />
              <XAxis dataKey="l" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} interval={0} />
              <YAxis tickFormatter={pctTick} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
              <Tooltip formatter={(v: any) => ["Cumplimiento: " + pct(Number(v)), ""]} />
              <Bar dataKey="v" radius={[8, 8, 0, 0]} maxBarSize={34}>
                {team.map((r) => <Cell key={r.s.key} fill={leaderColor(M, r.s)} fillOpacity={0.85} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="cs-g2 cs-mt">
        {[A, B].map((x) => (
          <div className="cs-card" key={x.l.key}>
            <CardH t={`Equipo ${x.l.short}`} p={`${x.n} SDR`} />
            <div className="cs-tw">
              <table>
                <thead><tr><th className="l">SDR</th><th>Meta</th><th>Realizadas</th><th>Cumplimiento</th><th>Conexión</th><th>Reunión → opp</th></tr></thead>
                <tbody>
                  {rowsAll.filter((r) => r.s.leaderKey === x.l.key).map((r) => (
                    <tr key={r.s.key}><td className="l"><Who s={r.s} /></td><td>{fmt(r.a.goal, 1)}</td><td><b>{fmt(r.a.held)}</b></td><td><Pill v={r.a.compl} /></td><td>{pct(r.a.conn, 1)}</td><td>{pct(r.a.m2o)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Alertas de gestión ─────────────────────────────────────────────────────
export function ViewAlerts() {
  const { M, f, P, S, setS } = useCells();
  const al = useMemo(() => buildAlerts(M, f, P), [M, f, P]);
  const fl = S.alertF;
  const shown = al.filter((a) => fl === "all" || a.lvl === fl);
  const c = { r: al.filter((a) => a.lvl === "r").length, y: al.filter((a) => a.lvl === "y").length, g: al.filter((a) => a.lvl === "g").length };
  const cats = [...new Set(shown.map((a) => a.cat))];
  const cfg = M.cfg;
  return (
    <>
      <MailAlertsCard />
      <div className="cs-counts">
        {([["r", c.r, "🔴 Críticas", COLORS.r], ["y", c.y, "🟡 Seguimiento", COLORS.y], ["g", c.g, "🟢 Positivas", COLORS.g], ["all", al.length, "Todas", COLORS.primary]] as const).map(([k, n, l, col]) => (
          <div key={k} className="cs-cnt cs-lk" style={{ ["--c" as any]: col, outline: fl === k ? `2px solid ${col}` : undefined }} onClick={() => setS({ alertF: k })}>
            <b>{n}</b><span>{l}</span>
          </div>
        ))}
      </div>
      <div className="cs-card" style={{ marginBottom: 16 }}>
        <CardH t="Atención del líder" p="Prioridad según la brecha contra el umbral" />
        <div className="cs-att">{attention(al).map((a, i) => <AlertItem key={i} a={a} />)}</div>
      </div>
      <div className="cs-g2">
        {cats.length ? cats.map((ct) => (
          <div className="cs-card" key={ct}>
            <CardH t={ct} right={<span className="cs-tag">{shown.filter((a) => a.cat === ct).length}</span>} />
            <div className="cs-att">{shown.filter((a) => a.cat === ct).map((a, i) => <AlertItem key={i} a={a} />)}</div>
          </div>
        )) : <p className="cs-muted">No hay alertas con este filtro.</p>}
      </div>
      <p className="cs-note">Umbrales actuales: verde ≥ {pct(cfg.green)}, amarillo ≥ {pct(cfg.yellow)}, no-show máximo {pct(cfg.noshowMax)}, conexión mínima {pct(cfg.connectMin)}, meta diaria {cfg.callGoal} llamadas. Cámbialos en Configurar.</p>
    </>
  );
}

// Correo diario a las líderes: vista previa y envío de prueba (solo a la
// casilla de prueba — ver lib/celulasSdr/server/alertsMail.ts).
function MailAlertsCard() {
  const { M } = useCells();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const sendTest = async (key: string) => {
    setBusy(key);
    setMsg(null);
    try {
      const res = await fetch(`/api/celulas-sdr/alerts-preview?leader=${encodeURIComponent(key)}`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Error");
      const r = (j.results ?? [])[0];
      setMsg(r ? (r.status === "sent" ? `Prueba enviada a ${r.to.join(", ")}.` : `No se envió: ${r.error}`) : "No hubo nada que enviar.");
    } catch (e) {
      setMsg(`No se pudo enviar: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="cs-card" style={{ marginBottom: 16 }}>
      <CardH t={<><Ic n="mail" s={16} /> Correo diario a las líderes</>} p="Lunes a viernes 8:30 (hora Chile): llamadas de ayer, agenda de hoy, no-show, rescates, registros por actualizar, cumplimiento del mes y calidad de su célula." />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {M.leaders.map((l) => (
          <span key={l.key} style={{ display: "inline-flex", gap: 6 }}>
            <a className="cs-btn" href={`/api/celulas-sdr/alerts-preview?leader=${encodeURIComponent(l.key)}`} target="_blank" rel="noreferrer">Ver correo de {l.short}</a>
            <button className="cs-btn" disabled={!!busy} onClick={() => sendTest(l.key)}>{busy === l.key ? "Enviando…" : "Enviarme prueba"}</button>
          </span>
        ))}
      </div>
      {msg ? <p className="cs-note">{msg}</p> : null}
    </div>
  );
}

export { LEADERS_GROUP, NO_CELL };
