"use client";

import { createContext, useContext, type ReactNode } from "react";
import {
  IconTarget, IconFlag, IconCalendar, IconCircleCheck, IconClock, IconX, IconPercentage, IconStar,
  IconBolt, IconPhone, IconUsers, IconWifi, IconActivity, IconMicrophone, IconTrophy, IconTrendingUp,
  IconAlertTriangle, IconEye, IconBell, IconArrowsSplit, IconMail, IconMessageCircle, IconBrandLinkedin,
  IconLayoutGrid, IconRepeat, IconBuilding, IconFilter, IconUser, IconGauge, IconAdjustments,
} from "@tabler/icons-react";
import {
  COLORS, SEMI, SEMT, c01, fmt, ok, pct, qBand, QBN, qColor, sem, sgn, prevLabel,
  type Agg, type Alert, type Filters, type Model, type Period, type PType, type Sem,
} from "@/lib/celulasSdr/engine";
import type { Sdr } from "@/lib/celulasSdr/types";

// ─── contexto del módulo ────────────────────────────────────────────────────
export type ViewState = {
  sort: { k: string; d: number };
  ficha: string;
  connDim: string;
  nsDim: string;
  heatM: string;
  alertF: string;
  effSort: string;
  qBand: string;
  avgBy: string;
  avgBase: string;
  avgMet: string;
};

export type Ctx = {
  M: Model;
  f: Filters;
  ptype: PType;
  pval: string;
  P: Period;
  Pp: Period | null;
  S: ViewState;
  setS: (p: Partial<ViewState>) => void;
  go: (view: string) => void;
  openSdr: (key: string) => void;
  openClient: (id: string) => void;
  openLeader: (key: string) => void;
  openCfg: () => void;
  setGoalBase: (v: "mes" | "fecha") => void;
  alloReady: boolean;   // Allo cargado para todos los meses del período
  hubspotReady: boolean;
};
export const CellsCtx = createContext<Ctx | null>(null);
export function useCells(): Ctx {
  const c = useContext(CellsCtx);
  if (!c) throw new Error("CellsCtx no disponible");
  return c;
}

// ─── íconos ─────────────────────────────────────────────────────────────────
const ICONS: Record<string, any> = {
  target: IconTarget, flag: IconFlag, cal: IconCalendar, check: IconCircleCheck, clock: IconClock, x: IconX,
  pctg: IconPercentage, star: IconStar, zap: IconBolt, phone: IconPhone, users: IconUsers, wifi: IconWifi,
  act: IconActivity, mic: IconMicrophone, trophy: IconTrophy, trend: IconTrendingUp, alert: IconAlertTriangle,
  eye: IconEye, bell: IconBell, split: IconArrowsSplit, mail: IconMail, msg: IconMessageCircle,
  link: IconBrandLinkedin, grid: IconLayoutGrid, repeat: IconRepeat, bld: IconBuilding, funnel: IconFilter,
  user: IconUser, gauge: IconGauge, sliders: IconAdjustments,
};
export function Ic({ n, s = 18 }: { n: string; s?: number }) {
  const C = ICONS[n] ?? IconActivity;
  return <C size={s} stroke={2} />;
}

// ─── texto con **negritas** (alertas) ───────────────────────────────────────
export function Rich({ t }: { t: string }) {
  const parts = t.split("**");
  return <>{parts.map((p, i) => (i % 2 ? <b key={i}>{p}</b> : <span key={i}>{p}</span>))}</>;
}

// ─── variaciones vs período anterior ────────────────────────────────────────
export type DL = ReactNode | "" | undefined;
export function Dl({ v, txt, inv, eps = 1e-4, ptype }: { v: number; txt: string; inv?: boolean | "n"; eps?: number; ptype: PType }) {
  const up = v > eps, dn = v < -eps;
  const cls = inv === "n" ? "n" : (inv ? dn : up) ? "good" : (inv ? up : dn) ? "bad" : "n";
  return (
    <span className={`cs-dl ${cls}`}>
      {up ? "▲" : dn ? "▼" : "■"} {txt} <em>{prevLabel(ptype)}</em>
    </span>
  );
}
export function dPct(ptype: PType, c: number | null | undefined, p: number | null | undefined, inv?: boolean | "n"): DL {
  if (!ok(p) || !ok(c)) return "";
  if (p === 0) return c > 0 ? <Dl v={1} txt="nuevo" inv={inv} ptype={ptype} /> : "";
  const v = (c - p) / p;
  return <Dl v={v} txt={sgn(v * 100, 0) + "%"} inv={inv} eps={0.005} ptype={ptype} />;
}
export function dPP(ptype: PType, c: number | null | undefined, p: number | null | undefined, inv?: boolean): DL {
  if (!ok(c) || !ok(p)) return "";
  const v = c - p;
  return <Dl v={v} txt={sgn(v * 100, 1) + " pp"} inv={inv} eps={0.0005} ptype={ptype} />;
}
export function dPts(ptype: PType, c: number | null | undefined, p: number | null | undefined): DL {
  if (!ok(c) || !ok(p)) return undefined;
  return <Dl v={c - p} txt={sgn(c - p, 1) + " pts"} eps={0.05} ptype={ptype} />;
}

// ─── piezas ─────────────────────────────────────────────────────────────────
export function Pill({ v, d = 0, s }: { v: number | null | undefined; d?: number; s?: Sem }) {
  const { M } = useCells();
  return <span className={`cs-pill ${s || sem(M, v)}`}>{pct(v, d)}</span>;
}
export function Mini({ v, s }: { v: number | null | undefined; s?: Sem }) {
  const { M } = useCells();
  const k = s || sem(M, v);
  return (
    <span className="cs-mini">
      <i style={{ width: `${c01(v) * 100}%`, background: COLORS[k] }} />
    </span>
  );
}
export function Av({ s, z = 30 }: { s: { color: string; initials?: string; name: string }; z?: number }) {
  const ini = s.initials || s.name.split(" ").map((x) => x[0]).join("").slice(0, 2);
  return (
    <span className="cs-av" style={{ width: z, height: z, fontSize: Math.max(10, z * 0.38), color: s.color, background: `color-mix(in srgb, ${s.color} 16%, #fff)` }}>
      {ini}
    </span>
  );
}
export function Who({ s, sub }: { s: Sdr & { nodata?: boolean }; sub?: ReactNode }) {
  const { openSdr } = useCells();
  return (
    <div className="cs-who cs-lk" onClick={(e) => { e.stopPropagation(); openSdr(s.key); }}>
      <Av s={s} />
      <div>
        <b>{s.name}</b>
        {s.nodata ? <small className="nd">Sin datos aún</small> : sub !== undefined ? <small>{sub}</small> : null}
      </div>
    </div>
  );
}
export function Seg<T extends string>({ value, opts, onChange, sm = true }: { value: T; opts: [T, string][]; onChange: (v: T) => void; sm?: boolean }) {
  return (
    <div className={`cs-seg ${sm ? "sm" : ""}`}>
      {opts.map(([v, l]) => (
        <button key={v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}
export function Sec({ t, p }: { t: string; p?: string }) {
  return (
    <div className="cs-sec">
      <h2>{t}</h2>
      {p ? <p>{p}</p> : null}
    </div>
  );
}
export function Stat({ l, v, cls = "" }: { l: string; v: ReactNode; cls?: string }) {
  return (
    <div className="cs-stat">
      <small>{l}</small>
      <b className={cls}>{v}</b>
    </div>
  );
}
export function CardH({ t, p, right }: { t: ReactNode; p?: ReactNode; right?: ReactNode }) {
  return (
    <div className="cs-ch">
      <div>
        <h3>{t}</h3>
        {p ? <p>{p}</p> : null}
      </div>
      {right}
    </div>
  );
}
export function Pending({ children }: { children?: ReactNode }) {
  return <div className="cs-pending">{children ?? "Datos pendientes de conexión"}</div>;
}
export function GoalSeg() {
  const { M, setGoalBase } = useCells();
  return (
    <Seg value={M.cfg.goalBase} opts={[["mes", "Meta del mes"], ["fecha", "Meta a la fecha"]]} onChange={(v) => setGoalBase(v)} />
  );
}

export type KCard = {
  ic: string; l: string; v: ReactNode; of?: ReactNode; prog?: number | null; progTxt?: ReactNode;
  sem?: Sem; sub?: ReactNode; dl?: DL; hl?: boolean;
};
export function KpiCard({ c }: { c: KCard }) {
  const { M } = useCells();
  const s: Sem = c.sem || (ok(c.prog) ? sem(M, c.prog) : "n");
  return (
    <div className={`cs-kpi ${c.hl ? "hl" : ""}`}>
      <div className="cs-kpi-h">
        <span className={`cs-kic ${s === "n" ? "" : s}`}><Ic n={c.ic} s={15} /></span>
        <span>{c.l}</span>
      </div>
      <div className="cs-kv">
        {c.v}
        {c.of !== undefined ? <span className="of"> / {c.of}</span> : null}
      </div>
      {ok(c.prog) ? (
        <>
          <div className="cs-bar"><i className={s} style={{ width: `${c01(c.prog) * 100}%` }} /></div>
          <div className={`cs-kp cs-${s}t`} style={{ color: s === "n" ? COLORS.n : COLORS[s] }}>{c.progTxt || pct(c.prog) + " cumplimiento"}</div>
        </>
      ) : (
        <div className="cs-ksub">{c.sub || ""}</div>
      )}
      <div>{c.dl === undefined ? null : c.dl || <span className="cs-dl n">Sin período anterior comparable</span>}</div>
    </div>
  );
}
export function KGrid({ cards, k6 }: { cards: KCard[]; k6?: boolean }) {
  return (
    <div className={`cs-kgrid ${k6 ? "k6" : ""}`}>
      {cards.map((c, i) => <KpiCard key={i} c={c} />)}
    </div>
  );
}

export function AlertItem({ a }: { a: Alert }) {
  const { openSdr, openClient } = useCells();
  const col = a.lvl === "r" ? COLORS.r : a.lvl === "y" ? COLORS.y : COLORS.g;
  const icn = a.lvl === "g" ? "trend" : a.lvl === "y" ? "eye" : "alert";
  const click = a.sdr ? () => openSdr(a.sdr!) : a.client ? () => openClient(a.client!) : undefined;
  return (
    <div className={`cs-ai ${click ? "cs-lk" : ""}`} style={{ ["--c" as any]: col }} onClick={click}>
      <span className="dot"><Ic n={icn} s={15} /></span>
      <div>
        <p><Rich t={a.text} /></p>
        <small>{a.cat}. {a.hint}</small>
      </div>
    </div>
  );
}

// ─── diana de 3 anillos ─────────────────────────────────────────────────────
export function Rings({ items, center, sub }: { items: { v: number | null; col: string }[]; center: string; sub: string }) {
  const cx = 100, cy = 100, sw = 15, rs = [84, 64, 44];
  return (
    <svg width="200" height="200" viewBox="0 0 200 200" role="img" aria-label={`Cumplimiento ${center}`} style={{ flex: "none" }}>
      {items.map((it, k) => {
        const r = rs[k], C = 2 * Math.PI * r, v = c01(it.v);
        return (
          <g key={k}>
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="#EEEDF5" strokeWidth={sw} />
            <circle cx={cx} cy={cy} r={r} fill="none" stroke={it.col} strokeWidth={sw} strokeLinecap="round" strokeDasharray={`${(C * v).toFixed(1)} ${C.toFixed(1)}`} transform={`rotate(-90 ${cx} ${cy})`} />
            {ok(it.v) && it.v > 1 ? <circle cx={cx} cy={cy - r} r={4} fill="#fff" /> : null}
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r={30} fill="#fff" />
      <text x={cx} y={cy + 3} textAnchor="middle" fontSize="20" fontWeight="700" fill={COLORS.text}>{center}</text>
      <text x={cx} y={cy + 18} textAnchor="middle" fontSize="9.5" fontWeight="500" fill="#6B6884">{sub}</text>
    </svg>
  );
}

// ─── calidad ────────────────────────────────────────────────────────────────
export function QChip({ v, withNum }: { v: number | null | undefined; withNum?: boolean }) {
  const { M } = useCells();
  if (!ok(v)) return withNum ? <span className="cs-muted">—</span> : <span className="cs-qb" style={{ color: COLORS.n, background: "#EEEDF5" }}>Sin evaluar</span>;
  const b = qBand(M, v), c = qColor(b);
  return (
    <span className="cs-qb" style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)` }} title={QBN[b]}>
      {withNum ? `${fmt(v)} · ${QBN[b]}` : QBN[b]}
    </span>
  );
}
export function QNum({ v }: { v: number | null | undefined }) {
  const { M } = useCells();
  if (!ok(v)) return <span className="cs-muted">—</span>;
  return <b style={{ color: qColor(qBand(M, v)), fontSize: 15 }}>{fmt(v)}</b>;
}
// Ítem del desglose (/5): mismos colores que la app (5 verde, 3-4 amarillo, 1-2 rojo).
export function crit5Color(v: number): string {
  const r = Math.round(v);
  return r >= 5 ? COLORS.g : r >= 3 ? COLORS.y : COLORS.r;
}
export function Crit5({ v }: { v: number | null | undefined }) {
  if (!ok(v)) return <span className="cs-muted">—</span>;
  const c = crit5Color(v);
  return <span className="cs-qc" style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)` }}>{fmt(v, 1)}</span>;
}

export function SemPill({ s, txt }: { s: Sem; txt?: string }) {
  return <span className={`cs-pill ${s}`}>{SEMI[s]} {txt ?? SEMT[s]}</span>;
}

export type { Agg };
