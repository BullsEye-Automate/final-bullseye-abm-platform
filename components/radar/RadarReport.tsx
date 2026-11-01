"use client";

import "./radar.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconAlertTriangle, IconArrowLeft, IconArrowRight, IconMoon, IconSun } from "@tabler/icons-react";
import { addDays, compute, dmy, filterDataset, mondayOf, N, NO_IND, NO_WL, periodMonths } from "@/lib/radarAbm/engine";
import { INTERNAL_PARTS, LEADS, PARTS, PART_SLUGS, REACT_SECTIONS, render, sec } from "@/lib/radarAbm/render";
import type { RadarConfig, RadarDataset } from "@/lib/radarAbm/types";
import MasterTables from "./MasterTables";
import WishlistWorkspace from "@/components/wishlist/WishlistWorkspace";
import IcpPanel from "./IcpPanel";
import FeedbackPanel from "./FeedbackPanel";
import PeithoPanel from "@/components/peitho/PeithoPanel";

// Informe Pulso ABM de un cliente (una vista = una parte del informe, con
// sus secciones numeradas). Lo usan la vista interna (Análisis → Pulso ABM)
// y el portal de clientes. El cálculo corre en el navegador sobre el set de
// datos sincronizado (lib/radarAbm/engine.ts) y el HTML de cada sección sale
// de lib/radarAbm/render.ts, igual que en el prototipo.

export type RadarAudience = "internal" | "portal";

// Partes visibles: el anexo de validación de datos es solo interno
// Partes visibles: el anexo de validación de datos y la inteligencia (KAM) son solo internos
export const visibleParts = (audience: RadarAudience) => PARTS.map((_, i) => i).filter((i) => audience === "internal" || !INTERNAL_PARTS.has(PART_SLUGS[i]));

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function periodLabel(ds: RadarDataset) {
  const ms = periodMonths(ds.period, ds.generated);
  const a = ms[0], b = ms[ms.length - 1];
  const lab = (m: string) => MONTHS_ES[Number(m.slice(5, 7)) - 1];
  return a.slice(0, 4) === b.slice(0, 4) ? `${lab(a)}–${lab(b)} ${b.slice(0, 4)}` : `${lab(a)} ${a.slice(0, 4)}–${lab(b)} ${b.slice(0, 4)}`;
}
const monthName = (mo: string) => `${MONTHS_ES[Number(mo.slice(5, 7)) - 1]} ${mo.slice(0, 4)}`;
const lastOfMonth = (mo: string) => new Date(Date.UTC(Number(mo.slice(0, 4)), Number(mo.slice(5, 7)), 0)).toISOString().slice(0, 10);

// Selector de fechas: todo el período, un mes, una semana (lunes a domingo) o un día
type DateGran = "" | "month" | "week" | "day";
function dateRange(gran: DateGran, value: string): { from: string; to: string; label: string } | null {
  if (!gran || !value) return null;
  if (gran === "month") return { from: value + "-01", to: lastOfMonth(value), label: monthName(value) };
  if (gran === "week") return { from: value, to: addDays(value, 6), label: `semana del ${dmy(value)}` };
  return { from: value, to: value, label: dmy(value) };
}

export default function RadarReport({
  dataset,
  config,
  view,
  onView,
  audience,
  actions,
  clientId,
}: {
  dataset: RadarDataset;
  config: RadarConfig;
  view: number;
  onView: (v: number) => void;
  audience: RadarAudience;
  actions?: React.ReactNode;
  clientId?: string | null;            // vista interna: cliente para la wishlist, el ICP y el feedback
}) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [sdr, setSdr] = useState("");
  const [pais, setPais] = useState("");
  const [ind, setInd] = useState("");
  const [wl, setWl] = useState("");
  const [gran, setGran] = useState<DateGran>("");
  const [dateValue, setDateValue] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const pendingJump = useRef<string | null>(null);
  const shownView = useRef<number | null>(null);

  useEffect(() => {
    try { if (localStorage.getItem("radar-theme") === "dark") setTheme("dark"); } catch { /* sin almacenamiento */ }
  }, []);
  // Otro cliente: se limpian los filtros
  useEffect(() => { setSdr(""); setPais(""); setInd(""); setWl(""); setGran(""); setDateValue(""); }, [dataset]);

  const sdrs = useMemo(() => Array.from(new Set(dataset.client.companies.map((c) => c.sdr))).sort(), [dataset]);
  const countries = useMemo(() => Array.from(new Set(dataset.client.companies.map((c) => c.pais))).sort(), [dataset]);
  const industries = useMemo(() => Array.from(new Set(dataset.client.companies.map((c) => c.ind || NO_IND))).sort((a, b) => (a === NO_IND ? 1 : b === NO_IND ? -1 : a.localeCompare(b, "es"))), [dataset]);
  // Wishlist del cliente ("Wish List - <cliente>"): solo si alguna empresa tiene valor
  const wishlists = useMemo(() => {
    const vals = Array.from(new Set(dataset.client.companies.map((c) => c.wl).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, "es"));
    return vals.length ? [...vals, NO_WL] : [];
  }, [dataset]);
  // Opciones del selector de fechas dentro del período del informe (más reciente primero)
  const monthOpts = useMemo(() => periodMonths(dataset.period, dataset.generated).reverse(), [dataset]);
  const weekOpts = useMemo(() => {
    const out: string[] = [];
    for (let d = mondayOf(dataset.generated); d >= mondayOf(dataset.period[0]) && out.length < 60; d = addDays(d, -7)) out.push(d);
    return out;
  }, [dataset]);
  const range = dateRange(gran, dateValue);
  const filtered = useMemo(
    () => filterDataset(dataset, { sdr, pais, ind, wl, ...(range ? { from: range.from, to: range.to } : {}) }),
    [dataset, sdr, pais, ind, wl, range?.from, range?.to] // eslint-disable-line react-hooks/exhaustive-deps
  );

  function changeGran(g: DateGran) {
    setGran(g);
    setDateValue(g === "month" ? monthOpts[0] : g === "week" ? weekOpts[0] : g === "day" ? dataset.generated : "");
  }
  const M = useMemo(() => compute(filtered, config), [filtered, config]);
  const secs = useMemo(() => render(M, dataset.mapping), [M, dataset.mapping]);

  const parts = visibleParts(audience);
  const pi = parts.includes(view) ? view : parts[0];
  const [, pt, items] = PARTS[pi];
  const pos = parts.indexOf(pi);
  const prev = pos > 0 ? parts[pos - 1] : null;
  const next = pos < parts.length - 1 ? parts[pos + 1] : null;

  // Al cambiar de vista: arriba, o a la sección elegida en "Ir a"
  useEffect(() => {
    const id = pendingJump.current;
    pendingJump.current = null;
    // Al abrir no se mueve nada (en móvil escondería el menú del portal)
    // (también con el doble efecto de React en desarrollo)
    if (shownView.current === null || shownView.current === pi) { shownView.current = pi; return; }
    shownView.current = pi;
    // En la app interna el scroll es del <main>, no de la ventana: se lleva
    // a la vista el inicio del informe en vez de window.scrollTo
    if (id) document.getElementById(id)?.scrollIntoView();
    else rootRef.current?.scrollIntoView({ block: "start" });
  }, [pi]);

  function jump(value: string) {
    const [p, id] = value.split("|");
    if (Number(p) !== pi) {
      pendingJump.current = id;
      onView(Number(p));
    } else {
      document.getElementById(id)?.scrollIntoView();
    }
  }

  function toggleTheme() {
    const t = theme === "dark" ? "light" : "dark";
    setTheme(t);
    try { localStorage.setItem("radar-theme", t); } catch { /* sin almacenamiento */ }
  }

  // Desplegables dentro del HTML generado (data-ra-pick): muestran el panel
  // elegido de su tarjeta
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onPick = (e: Event) => {
      const sel = e.target as HTMLSelectElement;
      if (!sel.matches?.("select[data-ra-pick]")) return;
      sel.closest(".rcard")?.querySelectorAll<HTMLElement>("[data-ra-panel]").forEach((p) => { p.hidden = p.dataset.raPanel !== sel.value; });
    };
    // Funnel: clic en una etapa muestra (o esconde) la lista de sus empresas
    const onStage = (e: Event) => {
      const bar = (e.target as HTMLElement).closest?.("[data-ra-stage]") as HTMLElement | null;
      if (!bar) return;
      const card = bar.closest(".rcard");
      const id = bar.dataset.raStage;
      const open = !bar.classList.contains("sel");
      card?.querySelectorAll<HTMLElement>("[data-ra-stage]").forEach((b) => b.classList.toggle("sel", open && b === bar));
      let shown: HTMLElement | null = null;
      card?.querySelectorAll<HTMLElement>("[data-ra-stage-list]").forEach((p) => { p.hidden = !(open && p.dataset.raStageList === id); if (!p.hidden) shown = p; });
      (shown as HTMLElement | null)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
    root.addEventListener("change", onPick);
    root.addEventListener("click", onStage);
    return () => { root.removeEventListener("change", onPick); root.removeEventListener("click", onStage); };
  }, []);

  // Tooltip de los gráficos (atributo data-tip del HTML generado)
  function onMove(e: React.MouseEvent) {
    const tip = tipRef.current;
    if (!tip) return;
    const t = (e.target as HTMLElement).closest?.("[data-tip]");
    if (!t || !rootRef.current?.contains(t)) { tip.style.opacity = "0"; return; }
    tip.textContent = t.getAttribute("data-tip");
    tip.style.opacity = "1";
    tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 290) + "px";
    tip.style.top = e.clientY + 14 + "px";
  }

  const cl = dataset.client;
  // Bloques de la vista: secciones en HTML generado (juntas) y secciones que
  // arma React (wishlist, ICP, feedback), en el orden de PARTS
  const blocks = useMemo(() => {
    const out: ({ html: string } | { react: string; no: number | string; title: string })[] = [];
    for (const [no, id, title] of items) {
      if (REACT_SECTIONS.has(id)) { out.push({ react: id, no, title }); continue; }
      const h = sec(no, id, title, LEADS[id] || "", secs[id] || "");
      const last = out[out.length - 1];
      if (last && "html" in last) last.html += h; else out.push({ html: h });
    }
    return out;
  }, [items, secs]);
  const reactSection = (id: string) => {
    if (id === "wishlist") {
      if (audience === "internal" && !clientId) return <div className="ra-plain-card text-sm text-gray-600">Elige un cliente para ver su wishlist.</div>;
      return <div className="ra-plain-card"><WishlistWorkspace key={clientId ?? "portal"} operatorClientId={audience === "internal" ? clientId ?? undefined : undefined} /></div>;
    }
    if (id === "icp-vigente") return <IcpPanel audience={audience} clientId={clientId} />;
    if (id === "feedback-form") return <FeedbackPanel audience={audience} clientId={clientId} />;
    if (id === "peitho") return <PeithoPanel audience={audience} clientId={clientId} clientName={dataset.client.name} />;
    return null;
  };

  return (
    <div className="ra-root" data-theme={theme} ref={rootRef} onMouseMove={onMove} onMouseLeave={() => tipRef.current && (tipRef.current.style.opacity = "0")}>
      <header className="ra-top">
        <div className="ra-top-row">
          <div style={{ minWidth: 0 }}>
            <h1>{pt}</h1>
            <p className="ra-sub">
              {cl.name} · {N(sdr || pais || ind || wl ? M.C.length : cl.universe)} empresas objetivo · {range ? range.label : periodLabel(dataset)} · corte {dmy(dataset.generated)}
            </p>
          </div>
          <div className="ra-actions">
            {dataset.source === "demo" ? (
              <span className="ra-demo">Datos demo</span>
            ) : dataset.syncedAt ? (
              <span className="ra-sync" title="Última sincronización con HubSpot">
                HubSpot · {new Date(dataset.syncedAt).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" })}
              </span>
            ) : null}
            {actions}
            <button className="ra-btn" onClick={toggleTheme} aria-label="Cambiar tema">
              {theme === "dark" ? <IconSun size={15} /> : <IconMoon size={15} />} {theme === "dark" ? "Claro" : "Oscuro"}
            </button>
          </div>
        </div>
        <div className="ra-filters">
          <label htmlFor="ra-jump">Ir a</label>
          <select id="ra-jump" className="ra-select" value={`${pi}|${items[0][1]}`} onChange={(e) => jump(e.target.value)}>
            {parts.map((i) => (
              <optgroup key={i} label={`${PARTS[i][0]} · ${PARTS[i][1]}`}>
                {PARTS[i][2].map(([no, id, title]) => <option key={id} value={`${i}|${id}`}>§{no} {title}</option>)}
              </optgroup>
            ))}
          </select>
          {sdrs.length > 1 && (
            <>
              <label htmlFor="ra-sdr">SDR</label>
              <select id="ra-sdr" className={`ra-select${sdr ? " act" : ""}`} value={sdr} onChange={(e) => setSdr(e.target.value)}>
                <option value="">Todos</option>
                {sdrs.map((s) => <option key={s}>{s}</option>)}
              </select>
            </>
          )}
          {countries.length > 1 && (
            <>
              <label htmlFor="ra-pais">País</label>
              <select id="ra-pais" className={`ra-select${pais ? " act" : ""}`} value={pais} onChange={(e) => setPais(e.target.value)}>
                <option value="">Todos</option>
                {countries.map((s) => <option key={s}>{s}</option>)}
              </select>
            </>
          )}
          {industries.length > 1 && (
            <>
              <label htmlFor="ra-ind">Industria</label>
              <select id="ra-ind" className={`ra-select${ind ? " act" : ""}`} value={ind} onChange={(e) => setInd(e.target.value)}>
                <option value="">Todas</option>
                {industries.map((s) => <option key={s}>{s}</option>)}
              </select>
            </>
          )}
          {wishlists.length > 0 && (
            <>
              <label htmlFor="ra-wl">Wishlist</label>
              <select id="ra-wl" className={`ra-select${wl ? " act" : ""}`} value={wl} onChange={(e) => setWl(e.target.value)}>
                <option value="">Todas las empresas</option>
                {wishlists.map((s) => <option key={s} value={s}>{s === NO_WL ? s : `En wishlist: ${s}`}</option>)}
              </select>
            </>
          )}
          <label htmlFor="ra-gran">Fechas</label>
          <select id="ra-gran" className={`ra-select${gran ? " act" : ""}`} value={gran} onChange={(e) => changeGran(e.target.value as DateGran)}>
            <option value="">Todo el período</option>
            <option value="month">Mes</option>
            <option value="week">Semana</option>
            <option value="day">Día</option>
          </select>
          {gran === "month" && (
            <select aria-label="Mes" className="ra-select act" value={dateValue} onChange={(e) => setDateValue(e.target.value)}>
              {monthOpts.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
            </select>
          )}
          {gran === "week" && (
            <select aria-label="Semana" className="ra-select act" value={dateValue} onChange={(e) => setDateValue(e.target.value)}>
              {weekOpts.map((w) => <option key={w} value={w}>{`${dmy(w).slice(0, 5)} – ${dmy(addDays(w, 6))}`}</option>)}
            </select>
          )}
          {gran === "day" && (
            <input type="date" aria-label="Día" className="ra-select ra-date act" value={dateValue} min={dataset.period[0]} max={dataset.generated}
              onChange={(e) => e.target.value && setDateValue(e.target.value)} />
          )}
        </div>
        {pi === 0 && dataset.source === "demo" && (
          <div className="simnote">
            <IconAlertTriangle size={16} style={{ flex: "none", marginTop: 1 }} />
            <span><b>Beta con datos simulados.</b> Sirven para validar métricas, lógica y formato antes de conectar HubSpot. No presentar estas cifras a clientes.</span>
          </div>
        )}
        {(sdr || pais || ind || wl) && (
          <div className="ra-banner info">
            Filtro activo ({[sdr && `SDR: ${sdr}`, pais && `País: ${pais}`, ind && `Industria: ${ind}`, wl && `Wishlist: ${wl}`].filter(Boolean).join(" · ")}): el universo y todas las tasas se calculan solo sobre esas empresas.{dataset.client.meetingsTotal && (ind || wl) ? " Reuniones muestra el total de la planilla (no se filtra por industria ni wishlist)." : ""}
          </div>
        )}
        {range && (
          <div className="ra-banner info">
            Fechas: {range.label}. Reuniones (por fecha de la reunión, como el Excel de metas), actividades y negocios se cuentan solo dentro de ese rango; el status de empresas y contactos es el actual.
            {dataset.source === "demo" && " En datos demo las actividades por contacto no tienen fecha y no se recortan."}
          </div>
        )}
      </header>

      {PART_SLUGS[pi] === "tablas-maestras" ? <MasterTables M={M} numbers={items.map((x) => x[0])} /> : blocks.map((b, i) => "html" in b
        ? <div key={i} dangerouslySetInnerHTML={{ __html: b.html }} />
        : (
          <section key={i} className="s" id={b.react}>
            <div className="s-h"><span className="no">§{b.no}</span><h3>{b.title}</h3></div>
            {LEADS[b.react] && <p className="lead">{LEADS[b.react]}</p>}
            <div className="body ra-plain">{reactSection(b.react)}</div>
          </section>
        ))}

      <div className="ra-pager">
        {prev != null ? (
          <button className="ra-btn" onClick={() => onView(prev)}><IconArrowLeft size={15} /> {PARTS[prev][1]}</button>
        ) : <span />}
        {next != null && (
          <button className="ra-btn" onClick={() => onView(next)}>{PARTS[next][1]} <IconArrowRight size={15} /></button>
        )}
      </div>
      <div className="ra-tip" ref={tipRef} role="tooltip" style={{ opacity: 0 }} />
    </div>
  );
}
