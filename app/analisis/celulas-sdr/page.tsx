"use client";

import "./celulas.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconLoader2, IconRefresh, IconAlertCircle } from "@tabler/icons-react";
import {
  LEADERS_GROUP, NO_CELL, buildModel, currentPeriod, previousPeriod, type Filters, type PType,
} from "@/lib/celulasSdr/engine";
import { chileToday, dayLong, dayShort, monthLabel, monthOf, shiftMonth, MN } from "@/lib/celulasSdr/calendar";
import {
  DEFAULT_CONFIG, type AlloMonthResponse, type BaseResponse, type CellsConfig, type HubspotMonthResponse,
} from "@/lib/celulasSdr/types";
import { CellsCtx, Ic, type ViewState } from "./components/ui";
import { ViewAlerts, ViewExec, ViewLeaders, ViewRank } from "./views/Direccion";
import { ViewAct, ViewAvg, ViewClients, ViewConn, ViewMtg, ViewQual } from "./views/Operacion";
import { ViewCal, ViewEff, ViewFicha, ViewTrend } from "./views/Analisis";
import { ViewEvo } from "./views/Evolutivo";
import ConfigModal from "./ConfigModal";

// Módulo "Células SDR" (Análisis → Células SDR): centro de mando del equipo
// SDR, réplica del prototipo Dashboard-SDR-BullsEye.html con datos reales.
// Cadena del reporte: Actividad → Contacto → Agendada → Realizada →
// Oportunidad → Resultado. Todos los usuarios ven toda la información.

const VIEWS: Record<string, { t: string; s: string; ic: string; g?: string; C: () => JSX.Element }> = {
  exec: { t: "Resumen ejecutivo", s: "¿Estamos cumpliendo la meta?", ic: "gauge", g: "Dirección", C: ViewExec },
  rank: { t: "Ranking de SDR", s: "Quién cumple y quién necesita apoyo", ic: "trophy", C: ViewRank },
  leaders: { t: "Comparación de líderes", s: "Célula contra célula", ic: "users", C: ViewLeaders },
  alerts: { t: "Alertas de gestión", s: "Situaciones que requieren intervención", ic: "bell", C: ViewAlerts },
  act: { t: "Actividad SDR", s: "Actividad realizada vs actividad esperada", ic: "act", g: "Operación", C: ViewAct },
  avg: { t: "Promedio diario de actividad", s: "Promedio diario del equipo, semana a semana y mes a mes", ic: "cal", C: ViewAvg },
  conn: { t: "Tasa de conexión", s: "Eficiencia de las llamadas", ic: "wifi", C: ViewConn },
  qual: { t: "Calidad de llamadas", s: "Puntaje y calificación de las llamadas de cada SDR", ic: "mic", C: ViewQual },
  mtg: { t: "Reuniones y no-show", s: "Del contacto a la oportunidad", ic: "funnel", C: ViewMtg },
  clients: { t: "Cumplimiento por cliente", s: "Ponderado según meta y peso de cada cuenta", ic: "bld", C: ViewClients },
  cal: { t: "Calendario de desempeño", s: "Desempeño de cada SDR por día", ic: "grid", g: "Análisis", C: ViewCal },
  trend: { t: "Tendencia semanal", s: "Ritmo de desempeño semana a semana", ic: "trend", C: ViewTrend },
  evo: { t: "Evolutivo mensual", s: "Reuniones agendadas por SDR mes a mes, de enero a la fecha", ic: "trend", C: ViewEvo },
  eff: { t: "Indicadores de eficiencia", s: "Cantidad vs calidad de la actividad", ic: "zap", C: ViewEff },
  ficha: { t: "Ficha individual", s: "Productividad detallada por SDR", ic: "user", C: ViewFicha },
};

const EMPTY_F: Filters = { leader: "", sdr: "", client: "", country: "" };
const FIRST_MONTH = "2026-01";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json as any)?.error) throw new Error((json as any)?.error || `Error ${res.status}`);
  return json as T;
}

export default function CelulasSdrPage() {
  const today = chileToday();
  const [view, setView] = useState("exec");
  const [ptype, setPtype] = useState<PType>("mes");
  const [pval, setPval] = useState(today.slice(0, 7));
  const [f, setF] = useState<Filters>(EMPTY_F);
  const [S, setSState] = useState<ViewState>({ sort: { k: "compl", d: -1 }, ficha: "", connDim: "client", nsDim: "sdr", heatM: "calls", alertF: "all", effSort: "mp100", qBand: "all", avgBy: "sem", avgBase: "sdr", avgMet: "acts" });
  const setS = useCallback((p: Partial<ViewState>) => setSState((s) => ({ ...s, ...p })), []);

  const [cfg, setCfg] = useState<CellsConfig>(DEFAULT_CONFIG);
  const [cfgMeta, setCfgMeta] = useState<{ by: string | null; at: string | null }>({ by: null, at: null });
  const [cfgOpen, setCfgOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [base, setBase] = useState<BaseResponse | null>(null);
  const [baseMonth, setBaseMonth] = useState(today.slice(0, 7));
  const [baseErr, setBaseErr] = useState<string | null>(null);
  const [baseLoading, setBaseLoading] = useState(true);
  const [allo, setAllo] = useState<Record<string, AlloMonthResponse>>({});
  const [hubspot, setHubspot] = useState<Record<string, HubspotMonthResponse>>({});
  const [loadingMonths, setLoadingMonths] = useState<{ allo: string[]; hubspot: string[] }>({ allo: [], hubspot: [] });
  const [srcErr, setSrcErr] = useState<string[]>([]);
  const loadSeq = useRef(0);

  // Configuración global
  useEffect(() => {
    getJson<{ config: CellsConfig; updated_by: string | null; updated_at: string | null }>("/api/celulas-sdr/config")
      .then((r) => { setCfg({ ...DEFAULT_CONFIG, ...r.config }); setCfgMeta({ by: r.updated_by, at: r.updated_at }); })
      .catch(() => {});
  }, []);

  // Datos base (metas, células, reuniones) y luego Allo / HubSpot por mes
  const load = useCallback(async (month: string, refresh = false) => {
    const seq = ++loadSeq.current;
    setBaseLoading(true);
    setBaseErr(null);
    setSrcErr([]);
    try {
      const b = await getJson<BaseResponse>(`/api/celulas-sdr/base?month=${month}`);
      if (seq !== loadSeq.current) return;
      setBase(b);
      setBaseLoading(false);
      const months = [...b.months].reverse().filter((m) => m <= b.today.slice(0, 7));
      const q = refresh ? "&refresh=1" : "";
      setLoadingMonths({ allo: months, hubspot: months });
      // Allo: de a un mes por vez (el más reciente primero) para no
      // saturar su límite de 5 req/s; HubSpot en paralelo.
      (async () => {
        for (const m of months) {
          if (seq !== loadSeq.current) return;
          try {
            const r = await getJson<AlloMonthResponse>(`/api/celulas-sdr/allo?month=${m}${q}`);
            if (seq !== loadSeq.current) return;
            setAllo((x) => ({ ...x, [m]: r }));
          } catch (e) {
            setSrcErr((x) => [...x, `Allo (${monthLabel(m)}): ${(e as Error).message}`]);
          } finally {
            setLoadingMonths((x) => ({ ...x, allo: x.allo.filter((y) => y !== m) }));
          }
        }
      })();
      months.forEach(async (m) => {
        try {
          const r = await getJson<HubspotMonthResponse>(`/api/celulas-sdr/hubspot?month=${m}${q}`);
          if (seq !== loadSeq.current) return;
          setHubspot((x) => ({ ...x, [m]: r }));
        } catch (e) {
          setSrcErr((x) => [...x, `HubSpot (${monthLabel(m)}): ${(e as Error).message}`]);
        } finally {
          setLoadingMonths((x) => ({ ...x, hubspot: x.hubspot.filter((y) => y !== m) }));
        }
      });
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setBaseErr((e as Error).message);
      setBaseLoading(false);
    }
  }, []);

  useEffect(() => { load(baseMonth); }, [baseMonth, load]);

  // Link del correo diario de alertas: ?leader=<clave> abre filtrado por esa célula.
  useEffect(() => {
    const leader = new URLSearchParams(window.location.search).get("leader");
    if (leader) setF((x) => ({ ...x, leader, sdr: "" }));
  }, []);

  const M = useMemo(() => (base ? buildModel(base, allo, hubspot, cfg) : null), [base, allo, hubspot, cfg]);

  // Si el período elegido sale de la ventana cargada (mes elegido y los 2
  // anteriores), se recarga con ese mes como último.
  const periodMonth = ptype === "mes" ? pval : monthOf(pval);
  useEffect(() => {
    if (!base) return;
    if (!base.months.slice(1).includes(periodMonth)) setBaseMonth(periodMonth);
  }, [periodMonth, base]);

  const P = useMemo(() => (M ? currentPeriod(M, ptype, pval) : null), [M, ptype, pval]);
  const Pp = useMemo(() => (M ? previousPeriod(M, ptype, pval) : null), [M, ptype, pval]);

  const go = useCallback((v: string) => { setView(v); if (typeof window !== "undefined") window.scrollTo({ top: 0 }); }, []);
  const openSdr = useCallback((key: string) => { setS({ ficha: key }); setF((x) => (x.sdr ? { ...x, sdr: key } : x)); go("ficha"); }, [go, setS]);
  const openLeader = useCallback((key: string) => { setF((x) => ({ ...x, leader: key, sdr: "" })); go("rank"); }, [go]);
  const openClient = useCallback((id: string) => { setF((x) => ({ ...x, client: id, country: "" })); go("exec"); }, [go]);

  const saveCfg = async (c: CellsConfig) => {
    setSaving(true);
    try {
      const res = await fetch("/api/celulas-sdr/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: c }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "No se pudo guardar");
      setCfg({ ...DEFAULT_CONFIG, ...j.config });
      setCfgMeta({ by: j.updated_by, at: j.updated_at });
      setCfgOpen(false);
    } catch (e) {
      alert(`No se pudo guardar la configuración: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };
  const setGoalBase = (v: "mes" | "fecha") => saveCfg({ ...cfg, goalBase: v });

  // Opciones de período
  const monthOpts = useMemo(() => {
    const out: string[] = [];
    for (let m = today.slice(0, 7); m >= FIRST_MONTH; m = shiftMonth(m, -1)) out.push(m);
    return out;
  }, [today]);
  const changePtype = (t: PType) => {
    if (!M) return;
    setPtype(t);
    if (t === "mes") setPval(periodMonth > today.slice(0, 7) ? today.slice(0, 7) : periodMonth);
    else if (t === "sem") setPval(M.weeks[M.weeks.length - 1].mon);
    else setPval(M.days[M.days.length - 1]);
  };

  if (baseLoading && !base) {
    return (
      <div className="cs-root" style={{ padding: 24 }}>
        <div className="cs-card" style={{ display: "flex", gap: 10, alignItems: "center" }}><IconLoader2 size={18} className="animate-spin" /> Cargando metas, células y reuniones…</div>
      </div>
    );
  }
  if (baseErr && !base) {
    return (
      <div className="cs-root" style={{ padding: 24 }}>
        <div className="cs-banner err"><IconAlertCircle size={16} /><span>No se pudo cargar el módulo: {baseErr}</span></div>
        <button className="cs-btn" onClick={() => load(baseMonth)}>Reintentar</button>
      </div>
    );
  }
  if (!M || !P || !base) return null;

  const V = VIEWS[view];
  const periodLabel = ptype === "mes"
    ? `${monthLabel(pval)}${pval === today.slice(0, 7) ? " a la fecha" : ""}`
    : ptype === "sem" ? `Semana del ${M.weeks.find((w) => w.mon === pval)?.label ?? pval}` : (() => { const s = dayLong(pval); return s[0].toUpperCase() + s.slice(1); })();
  const leaderName = (k: string) => (k === LEADERS_GROUP ? "Líderes" : k === NO_CELL ? "Sin célula" : M.LD[k]?.short ?? k);
  const fs = [f.leader && `Líder: ${leaderName(f.leader)}`, f.sdr && `SDR: ${M.SD[f.sdr]?.name ?? f.sdr}`, f.client && `Cliente: ${M.CL[f.client]?.name ?? f.client}`, f.country && `País: ${f.country}`].filter(Boolean);
  const sdrOpts = M.sdrs.filter((s) => {
    if (!f.leader) return true;
    if (f.leader === LEADERS_GROUP) return s.group === "leader";
    if (f.leader === NO_CELL) return s.group === "none";
    return s.leaderKey === f.leader;
  });
  const activeClients = new Set<string>([...M.goals.map((g) => g.client), ...M.meetings.map((m) => m.client ?? ""), ...M.calls.map((c) => c.c ?? "")]);
  const clientOpts = M.clients.filter((c) => activeClients.has(c.id) && (!f.country || M.CL[c.id]?.country === f.country));
  const periodMonths = [...new Set([...P.dates].map(monthOf))].filter((m) => m <= today.slice(0, 7));
  const alloReady = periodMonths.every((m) => !!allo[m]);
  const hubspotReady = periodMonths.every((m) => !!hubspot[m]);
  const warnings = [...base.warnings, ...Object.values(allo).flatMap((a) => a.warnings)];

  return (
    <CellsCtx.Provider value={{ M, f, ptype, pval, P, Pp, S, setS, go, openSdr, openClient, openLeader, openCfg: () => setCfgOpen(true), setGoalBase, alloReady, hubspotReady }}>
      <div className="cs-root" style={{ maxWidth: 1640 }}>
        <div className="cs-layout">
          <nav className="cs-nav" aria-label="Vistas de Células SDR">
            {Object.entries(VIEWS).map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                {v.g ? <div className="cs-grp">{v.g}</div> : null}
                <button className={view === k ? "on" : ""} onClick={() => go(k)}><Ic n={v.ic} s={16} />{v.t}</button>
              </div>
            ))}
          </nav>
          <div className="cs-main">
            <header className="cs-top">
              <div className="cs-top-row">
                <div>
                  <h1>{V.t}</h1>
                  <p className="cs-sub">{V.s} {periodLabel}{fs.length ? `. Filtros: ${fs.join(", ")}` : ""}</p>
                </div>
                <div className="cs-actions">
                  <button className="cs-btn" onClick={() => load(baseMonth, true)} disabled={baseLoading || loadingMonths.allo.length > 0} title="Volver a consultar la planilla, Allo y HubSpot">
                    {baseLoading || loadingMonths.allo.length ? <IconLoader2 size={14} className="animate-spin" /> : <IconRefresh size={14} />} Actualizar
                  </button>
                  <button className="cs-btn" onClick={() => setCfgOpen(true)}><Ic n="sliders" s={15} /> Configurar</button>
                </div>
              </div>
              <div className="cs-filters">
                <div className="cs-seg">
                  {([["dia", "Día"], ["sem", "Semana"], ["mes", "Mes"]] as [PType, string][]).map(([v, l]) => (
                    <button key={v} className={ptype === v ? "on" : ""} onClick={() => changePtype(v)}>{l}</button>
                  ))}
                </div>
                <select className="cs-select" aria-label="Período" value={pval} onChange={(e) => setPval(e.target.value)}>
                  {ptype === "mes" ? monthOpts.map((m) => <option key={m} value={m}>{monthLabel(m)}{m === today.slice(0, 7) ? ", a la fecha" : ""}</option>)
                    : ptype === "sem" ? [...M.weeks].reverse().map((w) => <option key={w.mon} value={w.mon}>Semana del {w.label}</option>)
                    : [...M.days].reverse().map((d) => <option key={d} value={d}>{dayShort(d)} {MN[Number(d.slice(5, 7)) - 1]}</option>)}
                </select>
                <select className={`cs-select ${f.leader ? "act" : ""}`} aria-label="Líder" value={f.leader} onChange={(e) => { const v = e.target.value; setF((x) => ({ ...x, leader: v, sdr: "" })); }}>
                  <option value="">Todos los líderes</option>
                  {M.leaders.map((l) => <option key={l.key} value={l.key}>Célula {l.name}</option>)}
                  <option value={LEADERS_GROUP}>Líderes (meta propia)</option>
                  <option value={NO_CELL}>Sin célula</option>
                </select>
                <select className={`cs-select ${f.sdr ? "act" : ""}`} aria-label="SDR" value={f.sdr} onChange={(e) => { const v = e.target.value; setF((x) => ({ ...x, sdr: v })); if (v) setS({ ficha: v }); }}>
                  <option value="">Todos los SDR</option>
                  {sdrOpts.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
                </select>
                <select className={`cs-select ${f.client ? "act" : ""}`} aria-label="Cliente" value={f.client} onChange={(e) => { const v = e.target.value; setF((x) => ({ ...x, client: v })); }}>
                  <option value="">Todos los clientes</option>
                  {clientOpts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select className={`cs-select ${f.country ? "act" : ""}`} aria-label="País" value={f.country} onChange={(e) => { const v = e.target.value; setF((x) => ({ ...x, country: v, client: v && x.client && M.CL[x.client]?.country !== v ? "" : x.client })); }}>
                  <option value="">Todos los países</option>
                  {M.countries.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <button className="cs-btn ghost" onClick={() => setF(EMPTY_F)}>Limpiar filtros</button>
              </div>
            </header>

            {baseLoading ? <div className="cs-banner info"><IconLoader2 size={15} className="animate-spin" /><span>Cargando metas y reuniones de la ventana seleccionada…</span></div> : null}
            {loadingMonths.allo.length ? <div className="cs-banner info"><IconLoader2 size={15} className="animate-spin" /><span>Cargando llamadas y puntajes de Allo ({loadingMonths.allo.map(monthLabel).join(", ")}). La primera carga de un mes puede tardar unos minutos; después queda en caché.</span></div> : null}
            {!loadingMonths.allo.length && loadingMonths.hubspot.length ? <div className="cs-banner info"><IconLoader2 size={15} className="animate-spin" /><span>Cargando emails, WhatsApp y LinkedIn de HubSpot…</span></div> : null}
            {srcErr.map((e, i) => <div key={i} className="cs-banner err"><IconAlertCircle size={15} /><span>{e}</span></div>)}
            {warnings.map((w, i) => <div key={i} className="cs-banner warn"><IconAlertCircle size={15} /><span><b>{w.source}:</b> {w.message}</span></div>)}

            <V.C />
          </div>
        </div>
      </div>
      {cfgOpen ? (
        <ConfigModal M={M} month={periodMonth} cfg={cfg} oppValues={[...new Set([...base.oppValues, ...cfg.oppValues])].sort()} onClose={() => setCfgOpen(false)} onSave={saveCfg} saving={saving} updatedBy={cfgMeta.by} updatedAt={cfgMeta.at} />
      ) : null}
    </CellsCtx.Provider>
  );
}
