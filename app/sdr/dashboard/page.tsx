"use client";

// Dashboard SDR (ver CLAUDE.md → "Dashboard SDR"). Dos vistas:
//  - Mi cartera: un SDR (por defecto el de la sesión) con su cartera total y
//    por cliente, lo que tiene por corregir, disponibilidad de datos, calidad
//    de la gestión, reuniones y el detalle de empresas y contactos.
//  - Célula: la líder ve a su célula (ranking por SDR, cuentas estancadas
//    más antiguas y disponibilidad por cliente).
// Datos de Pulso ABM (lib/dashboardSdr/server.ts); cálculo en
// lib/dashboardSdr/compute.ts (el mismo del correo semanal). Por ahora no
// suma actividades. ?sdr=<clave>&estancadas=1 / ?vista=celula (links del correo).
import { useCallback, useEffect, useMemo, useState } from "react";
import { IconAlertCircle, IconAlertTriangle, IconLoader2, IconRefresh, IconSearch, IconUserCircle, IconUsersGroup } from "@tabler/icons-react";
import type { SdrCompany, SdrContact, SdrDashboardResponse, SdrIndexRow } from "@/lib/dashboardSdr/types";
import { analyze, CO_GROUP_LABEL, FIX_KINDS, goalStatus, monthProgress, type CoGroup, type FixKind, type Pace } from "@/lib/dashboardSdr/compute";
import { STALE_BUSINESS_DAYS } from "@/lib/dashboardSdr/stale";

const nf = new Intl.NumberFormat("es-CL");
const fmt = (n: number) => nf.format(n);
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "0%");
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTHS_L = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const fmtDay = (d: string | null | undefined) => (d ? `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}` : "—");
const timeCL = (iso: string) =>
  new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const GROUP_COLOR: Record<CoGroup, string> = { por_gestionar: "#185FA5", en_gestion: "#D39B1F", reunion: "#0F6E56", cerradas: "#B9B4CC" };
const GROUPS: CoGroup[] = ["por_gestionar", "en_gestion", "reunion", "cerradas"];

function pillClass(st: string): string {
  const t = norm(st);
  if (t.includes("reuni") || t.includes("oportunidad") || t.startsWith("en conversaciones")) return "bg-success-bg text-success-fg";
  if (t.includes("seguimiento") || t.includes("en gesti") || t.includes("hot calling")) return "bg-warning-bg text-warning-fg";
  if (t.includes("no fit") || t.includes("no califica") || t.includes("sin informaci") || t.includes("no interes")) return "bg-danger-bg text-danger-fg";
  if (t === "asignada" || t.includes("por gestionar") || t.includes("por llamar")) return "bg-info-bg text-info-fg";
  return "bg-black/5 text-ink";
}

type SortState = { k: string; dir: 1 | -1 };
function useSort(initial: SortState) {
  const [s, set] = useState<SortState>(initial);
  const toggle = (k: string) => set((p) => ({ k, dir: p.k === k ? ((-p.dir) as 1 | -1) : -1 }));
  return [s, toggle] as const;
}
function sortRows<T>(rows: T[], s: SortState, get: (r: T, k: string) => string | number | null | undefined): T[] {
  return [...rows].sort((a, b) => {
    const x = get(a, s.k) ?? "", y = get(b, s.k) ?? "";
    const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return r * s.dir;
  });
}

const MAX_ROWS = 500;

export default function DashboardSdrPage() {
  const [data, setData] = useState<SdrDashboardResponse | null>(null);
  const [sdr, setSdr] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"sdr" | "celula">("sdr");
  const [client, setClient] = useState("");
  const [fixTab, setFixTab] = useState<FixKind>("est");
  const [detTab, setDetTab] = useState<"empresas" | "contactos">("empresas");
  const [onlyFix, setOnlyFix] = useState(false);

  const load = useCallback(async (key: string, fresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (key) qs.set("sdr", key);
      if (fresh) qs.set("fresh", "1");
      const res = await fetch(`/api/sdr/dashboard?${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Error ${res.status}`);
      setData(json);
      setSdr(json.sdr?.key ?? key);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("estancadas") === "1") { setFixTab("est"); }
    if (q.get("vista") === "celula") setView("celula");
    load(q.get("sdr") ?? "");
  }, [load]);

  const openSdr = (key: string) => { setView("sdr"); setClient(""); setSdr(key); load(key); window.scrollTo({ top: 0 }); };

  const slice = data?.sdr ?? null;
  const today = data?.today ?? new Date().toISOString().slice(0, 10);
  const A = useMemo(() => (slice ? analyze(slice, today, client) : null), [slice, today, client]);
  const allClients = useMemo(() => (slice ? analyze(slice, today).clients : []), [slice, today]);
  const myself = !!data?.me.key && data.me.key === slice?.key;
  const monthName = MONTHS_L[Number(today.slice(5, 7)) - 1];

  return (
    <div className="space-y-6 max-w-6xl">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="label">SDR</div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            {view === "sdr" ? <IconUserCircle size={24} className="text-brand" /> : <IconUsersGroup size={24} className="text-brand" />}
            {view === "celula" ? "Dashboard SDR · células" : slice ? (myself ? `Mi dashboard · ${slice.name}` : `Dashboard de ${slice.name}`) : "Dashboard SDR"}
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            {view === "sdr" ? "Empresas y contactos asignados por cliente." : "Cartera, pendientes y reuniones de cada SDR de la célula."}
            {data && <> Datos de Pulso ABM, calculados {timeCL(data.generated)}.</>}
          </p>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <div role="tablist" aria-label="Vista" className="flex rounded-lg border bg-white p-0.5">
            {([["sdr", "Mi cartera"], ["celula", "Célula"]] as const).map(([v, l]) => (
              <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
                className={`px-3 py-1.5 rounded-md text-sm ${view === v ? "bg-brand text-white" : "text-ink-muted hover:text-ink"}`}>{l}</button>
            ))}
          </div>
          {view === "sdr" && (
            <>
              <label className="flex flex-col gap-1 text-xs text-ink-muted">
                SDR
                <select className="input min-w-[200px]" value={sdr} onChange={(e) => openSdr(e.target.value)} disabled={!data}>
                  {!slice && <option value="">Elige un SDR…</option>}
                  {(data?.index ?? []).map((r) => (
                    <option key={r.key} value={r.key}>{r.name}{r.key === data?.me.key ? " (yo)" : ""}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink-muted">
                Cliente
                <select className="input min-w-[160px]" value={client} onChange={(e) => setClient(e.target.value)}>
                  <option value="">Todos</option>
                  {allClients.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            </>
          )}
          <button
            onClick={() => load(sdr, true)}
            disabled={loading}
            title="Vuelve a leer los informes de Pulso ABM"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border hover:bg-black/5 transition disabled:opacity-50"
          >
            {loading ? <IconLoader2 size={15} className="animate-spin" /> : <IconRefresh size={15} />} Actualizar
          </button>
        </div>
      </header>

      {error && (
        <div className="flex items-center gap-2 text-danger-fg text-sm p-3 rounded-lg bg-danger-bg border border-danger-bg">
          <IconAlertCircle size={16} className="shrink-0" /> {error}
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-16 text-ink-muted gap-2">
          <IconLoader2 size={18} className="animate-spin" /> Leyendo los informes de Pulso ABM de todos los clientes (la primera vez del día puede tardar un par de minutos)…
        </div>
      )}

      {data && view === "celula" && <CellView data={data} onOpen={openSdr} />}

      {data && view === "sdr" && !slice && !loading && (
        <div className="card text-sm text-ink-muted">
          {data.me.name
            ? `${data.me.name} no tiene empresas ni contactos asignados en los informes de Pulso ABM. Elige otro SDR arriba.`
            : "No identificamos tu usuario con un SDR de la Maestra. Elige un SDR arriba."}
        </div>
      )}

      {data && view === "sdr" && slice && A && (
        <div className={loading ? "opacity-50 pointer-events-none space-y-6" : "space-y-6"}>
          {/* 1. Cartera */}
          <section className="space-y-2">
            <h2 className="text-base font-semibold">1. Cartera asignada · {client || "total"}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <Tile label="Empresas asignadas" value={A.totals.cos} sub={`En ${A.clients.length} cliente${A.clients.length === 1 ? "" : "s"}`} />
              <Tile label="Sin gestionar" value={A.totals.unw} sub={`${pct(A.totals.unw, A.totals.cos)} en Asignada`} />
              <Tile label="Contactos asignados" value={A.totals.cts} sub={A.totals.none ? `${fmt(A.totals.none)} empresas sin contactos` : "Todas las empresas con contactos"} />
              <Tile label="Empresas con reunión" value={A.totals.withMtg} sub={`${pct(A.totals.withMtg, A.totals.cos)} de la cartera`} />
              <Tile label="Por corregir" value={A.totals.fix} sub={`${fmt(A.fixBy.est.length)} estancadas · ${fmt(A.fixBy.seg.length)} seguimientos vencidos`} alert={A.totals.fix > 0} />
            </div>
          </section>

          {!client && A.perClient.length > 0 && (
            <section className="space-y-2">
              <div className="flex flex-wrap gap-2 justify-between items-end">
                <div>
                  <h2 className="text-base font-semibold">Lo que tienes disponible por cliente</h2>
                  <p className="text-xs text-ink-muted">Un cliente por tarjeta. «Ver solo este cliente» filtra todo el dashboard.</p>
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-ink-muted">
                  {GROUPS.map((g) => (
                    <span key={g} className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: GROUP_COLOR[g] }} />{CO_GROUP_LABEL[g]}</span>
                  ))}
                </div>
              </div>
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))" }}>
                {A.perClient.map((p) => (
                  <article key={p.client} className="card flex flex-col gap-3">
                    <div className="flex justify-between items-baseline gap-2">
                      <h3 className="text-base font-semibold">{p.client}</h3>
                      <span className="text-xs text-ink-muted">{fmt(p.cos)} empresas</span>
                    </div>
                    <div aria-hidden className="flex h-3 rounded-md overflow-hidden bg-black/5">
                      {GROUPS.map((g) => <div key={g} style={{ width: `${p.cos ? (100 * p.groups[g]) / p.cos : 0}%`, background: GROUP_COLOR[g] }} />)}
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                      {GROUPS.map((g) => (
                        <div key={g}><div className="text-xs text-ink-muted">{CO_GROUP_LABEL[g]}</div><div className="text-xl font-semibold tabular-nums">{fmt(p.groups[g])}</div></div>
                      ))}
                    </div>
                    <div className="border-t pt-2.5 flex flex-col gap-1.5 text-sm">
                      <Line l="Contactos disponibles (por gestionar)" v={`${fmt(p.stock)} de ${fmt(p.cts)}`} />
                      <Line l="Con teléfono" v={p.tel === null ? "Sin dato aún" : `${p.tel}%`} />
                      <Line l="Empresas sin contactos" v={fmt(p.none)} bad={p.none > 0} />
                    </div>
                    <GoalBox goal={p.goal} done={p.re} pct={p.pct} expected={p.expected} pace={p.pace} monthName={monthName} pending={p.pe} />
                    <div className={`rounded-lg px-2.5 py-2 text-sm ${p.fixN ? "bg-warning-bg text-warning-fg" : "bg-success-bg text-success-fg"}`}>
                      {p.fixN ? `Por corregir: ${fmt(p.fixN)} (${fmt(p.fixEst)} estancadas, ${fmt(p.fixSeg)} seguimientos vencidos)` : "Sin pendientes por corregir"}
                    </div>
                    <button onClick={() => setClient(p.client)} className="min-h-[38px] rounded-lg border text-sm hover:bg-black/5">Ver solo este cliente</button>
                  </article>
                ))}
              </div>
            </section>
          )}
          {client && (
            <div className="flex items-center gap-2 text-sm p-2.5 rounded-lg bg-info-bg text-info-fg">
              Viendo solo <b>{client}</b>.
              <button onClick={() => setClient("")} className="underline">Ver todos los clientes</button>
            </div>
          )}

          {/* 2. Por corregir */}
          <section className="card p-0 overflow-hidden">
            <div className="px-4 pt-4 pb-3">
              <h2 className="text-base font-semibold">2. Por corregir</h2>
              <p className="text-xs text-ink-muted">Lo que tienes que gestionar o actualizar, de lo más urgente a lo menos urgente.</p>
            </div>
            <div role="tablist" aria-label="Tipo de alerta" className="flex flex-wrap gap-2 px-4 pb-3">
              {FIX_KINDS.map((k) => (
                <button key={k.id} role="tab" aria-selected={fixTab === k.id} onClick={() => setFixTab(k.id)}
                  className={`px-3 py-1.5 rounded-full text-sm border ${fixTab === k.id ? "bg-brand text-white border-brand" : "bg-white hover:bg-black/5"}`}>
                  {k.label} · <b>{fmt(A.fixBy[k.id].length)}</b>
                </button>
              ))}
            </div>
            <p className="px-4 pb-2 text-xs text-ink-muted">{FIX_KINDS.find((k) => k.id === fixTab)!.help}</p>
            <div className="overflow-auto max-h-[460px]">
              <table className="w-full text-sm">
                <thead className="text-xs text-ink-muted bg-[#FAF9FD] sticky top-0">
                  <tr><Th>Empresa / contacto</Th>{!client && <Th>Cliente</Th>}<Th>Qué pasa</Th><Th>Desde</Th><Th>Qué hacer</Th></tr>
                </thead>
                <tbody>
                  {A.fixBy[fixTab].slice(0, MAX_ROWS).map((f, i) => (
                    <tr key={`${f.coId}-${i}`} className="border-t">
                      <td className="px-3 py-2 font-medium">{f.who}{f.sub && <div className="text-xs font-normal text-ink-muted">{f.sub}</div>}</td>
                      {!client && <td className="px-3 py-2">{f.client}</td>}
                      <td className="px-3 py-2">{f.what}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-warning-fg font-medium">{f.since}</td>
                      <td className="px-3 py-2">{f.todo}</td>
                    </tr>
                  ))}
                  {!A.fixBy[fixTab].length && <tr><td colSpan={5} className="px-3 py-4 text-ink-muted">Nada por corregir aquí.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          {/* 3. Disponibilidad */}
          <section className="card p-0 overflow-hidden">
            <div className="px-4 pt-4 pb-3">
              <h2 className="text-base font-semibold">3. Disponibilidad de datos</h2>
              <p className="text-xs text-ink-muted">¿Tienes con qué trabajar? Contactos por empresa y datos de contacto, por cliente. «Sin dato aún» = el informe de Pulso de ese cliente todavía no se sincroniza con teléfono, correo y LinkedIn (se completa en la próxima sincronización).</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-ink-muted bg-[#FAF9FD]">
                  <tr><Th>Cliente</Th><Th n>Empresas</Th><Th n>Sin contactos</Th><Th n>1 solo contacto</Th><Th n>Contactos por gestionar</Th><Th>Con teléfono</Th><Th>Con correo</Th><Th>Con LinkedIn</Th></tr>
                </thead>
                <tbody>
                  {A.perClient.map((p) => (
                    <tr key={p.client} className="border-t">
                      <td className="px-3 py-2 font-medium">{p.client}</td>
                      <Td n>{p.cos}</Td>
                      <td className={`px-3 py-2 text-right tabular-nums ${p.none ? "text-danger-fg font-medium" : ""}`}>{fmt(p.none)}</td>
                      <Td n>{p.one}</Td><Td n>{p.stock}</Td>
                      <td className="px-3 py-2"><PctBar v={p.tel} /></td>
                      <td className="px-3 py-2"><PctBar v={p.mail} /></td>
                      <td className="px-3 py-2"><PctBar v={p.li} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 4. Calidad */}
          <section className="space-y-2">
            <h2 className="text-base font-semibold">4. Calidad de la gestión</h2>
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
              <div className="card space-y-2">
                <h3 className="text-sm font-semibold">Profundidad</h3>
                <p className="text-xs text-ink-muted">Empresas trabajadas ({fmt(A.quality.worked)}) según cuántos contactos gestionaste en cada una.</p>
                <Bars rows={A.quality.depth} color={(i) => ["#C2562E", "#7F77DD", "#3D2878"][i]} />
              </div>
              <div className="card space-y-2">
                <h3 className="text-sm font-semibold">Devoluciones</h3>
                <p className="text-xs text-ink-muted">Empresas devueltas a prospección (status actual). Entre paréntesis, sin ningún llamado.</p>
                {A.quality.returns.length
                  ? <Bars rows={A.quality.returns.map((r) => ({ label: r.label, n: r.n, extra: `(${fmt(r.none)})` }))} color={() => "#C2562E"} />
                  : <p className="text-sm text-ink-muted">Sin empresas devueltas.</p>}
              </div>
              <div className="card space-y-2">
                <h3 className="text-sm font-semibold">Status de los contactos</h3>
                <p className="text-xs text-ink-muted">Cómo están hoy los {fmt(A.totals.cts)} contactos asignados.</p>
                <Bars rows={A.quality.ctStatus} color={() => "#7F77DD"} />
              </div>
            </div>
          </section>

          {/* 5. Reuniones */}
          <MeetingsSection A={A} client={client} monthName={monthName} />

          {/* 6. Detalle */}
          <section className="card space-y-3">
            <h2 className="text-base font-semibold">6. Detalle</h2>
            <div role="tablist" className="flex gap-1 border-b">
              {(["empresas", "contactos"] as const).map((t) => (
                <button key={t} role="tab" aria-selected={detTab === t} onClick={() => setDetTab(t)}
                  className={`px-3 py-2 text-sm -mb-px border-b-2 ${detTab === t ? "border-brand text-brand font-medium" : "border-transparent text-ink-muted hover:text-ink"}`}>
                  {t === "empresas" ? `Empresas (${fmt(A.companies.length)})` : `Contactos (${fmt(A.contacts.length)})`}
                </button>
              ))}
            </div>
            {detTab === "empresas"
              ? <CompaniesTable rows={A.companies} flagOf={A.flagOf} showClient={!client} onlyFix={onlyFix} setOnlyFix={setOnlyFix} />
              : <ContactsTable rows={A.contacts} showClient={!client} />}
          </section>

          <details className="text-xs text-ink-muted">
            <summary className="cursor-pointer">Cómo se calcula y de dónde salen los datos</summary>
            <div className="mt-2 space-y-1.5 leading-relaxed">
              <p>Se leen los informes de <b>Pulso ABM</b> de los clientes activos en la Maestra (se sincronizan con HubSpot cada día). Empresa asignada = su «SDR - &lt;cliente&gt;» es este SDR; contacto asignado = su «SDR Asignado - &lt;cliente&gt;» o, si está vacío, el SDR de su empresa; reunión = «Responsable de la reunión» de la planilla de reuniones; meta = pestaña «Asignación» de la planilla de metas (SDR × cliente × mes, cuenta las realizadas).</p>
              <p><b>Cuenta estancada</b> = empresa en «Asignada» {STALE_BUSINESS_DAYS} días hábiles o más (lunes a viernes sin feriados de Chile) desde su fecha de asignación en HubSpot; si el HubSpot del cliente no tiene «Fecha de asignación», se usa la fecha de creación de la empresa. <b>Seguimiento vencido</b> = fecha de próximo seguimiento (empresa) o próxima actividad (contacto) ya pasada. <b>Status desactualizado</b> = empresa en Asignada con contactos gestionados, o en gestión sin ninguno. Los status son los actuales de HubSpot. Por ahora no se suman actividades.</p>
              {data.sources.length > 0 && <p>Informes leídos: {data.sources.map((s) => `${s.client}${s.syncedAt ? ` (${timeCL(s.syncedAt)})` : ""}`).join(" · ")}.</p>}
              {data.missing.length > 0 && <p className="text-warning-fg">Clientes activos sin informe de Pulso ABM: {data.missing.join(", ")}.</p>}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

// ── Reuniones ─────────────────────────────────────────────────────────────
function MeetingsSection({ A, client, monthName }: { A: NonNullable<ReturnType<typeof analyze>>; client: string; monthName: string }) {
  const [dim, setDim] = useState<"sen" | "area">("sen");
  const m = A.mtg;
  const occurred = m.re + m.ns;
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">5. Reuniones · {monthName}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Tile label="Agendadas" value={m.ag} sub="Por fecha de agendamiento" />
        <Tile label="Realizadas" value={m.re} sub="Por fecha de reunión" tone="ok" />
        <Tile label="No-show" value={m.ns} sub={`${pct(m.ns, occurred)} de las ocurridas`} tone={m.ns ? "bad" : undefined} />
        <Tile label="Pendientes" value={m.pe} sub={m.pePast ? `${fmt(m.pePast)} con fecha pasada` : "Por realizarse"} tone={m.pePast ? "warn" : undefined} />
        <div className={`card py-3 ${PACE[A.goal.pace].tile}`}>
          <div className="text-xs text-ink-muted">Cumplimiento de la meta</div>
          <div className={`text-2xl font-semibold tabular-nums ${PACE[A.goal.pace].fg}`}>{A.goal.pct === null ? "—" : `${A.goal.pct}%`}</div>
          <div className="text-xs text-ink-muted">{A.goal.total ? `${fmt(A.goal.done)} de ${fmt(A.goal.total)} · esperado a la fecha ${fmtDec(A.goal.expected)}` : "Sin meta cargada este mes"}</div>
        </div>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
        <div className="card p-0 overflow-hidden" style={{ gridColumn: "1 / -1" }}>
          <h3 className="text-sm font-semibold px-4 pt-3.5 pb-2">Meta y reuniones por cliente</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-ink-muted bg-[#FAF9FD]">
                <tr><Th>Cliente</Th><Th n>Meta</Th><Th n>Realizadas</Th><Th n>Cumplimiento</Th><Th n>Esperado a la fecha</Th><Th>Ritmo</Th><Th n>Agendadas</Th><Th n>No-show</Th><Th n>Pendientes</Th></tr>
              </thead>
              <tbody>
                {A.perClient.map((p) => (
                  <tr key={p.client} className="border-t">
                    <td className="px-3 py-2 font-medium">{p.client}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.goal ?? "—"}</td><Td n>{p.re}</Td>
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold ${PACE[p.pace].fg}`}>{p.pct === null ? "—" : `${p.pct}%`}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.expected === null ? "—" : fmtDec(p.expected)}</td>
                    <td className="px-3 py-2"><PaceBadge pace={p.pace} /></td>
                    <Td n>{p.ag}</Td><Td n>{p.ns}</Td><Td n>{p.pe}</Td>
                  </tr>
                ))}
                {A.goal.total && A.perClient.length > 1 && (
                  <tr className="border-t bg-[#FAF9FD] font-semibold">
                    <td className="px-3 py-2">Total</td><Td n>{A.goal.total}</Td><Td n>{A.goal.done}</Td>
                    <td className={`px-3 py-2 text-right tabular-nums ${PACE[A.goal.pace].fg}`}>{A.goal.pct}%</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtDec(A.goal.expected)}</td>
                    <td className="px-3 py-2"><PaceBadge pace={A.goal.pace} /></td>
                    <Td n>{A.mtg.ag}</Td><Td n>{A.mtg.ns}</Td><Td n>{A.mtg.pe}</Td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-xs text-ink-muted">Meta del SDR en cada cliente (pestaña «Asignación»). Cumplimiento = realizadas ÷ meta. Esperado a la fecha = meta × días hábiles transcurridos ÷ días hábiles del mes (hoy: {A.goal.elapsed} de {A.goal.days}). Ritmo: al día si las realizadas alcanzan lo esperado, en riesgo desde el 70%, atrasado bajo eso.</p>
        </div>
        <div className="card space-y-2">
          <div className="flex justify-between items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold">Qué perfiles convierten</h3>
            <select aria-label="Agrupar por" className="input py-1 text-sm" value={dim} onChange={(e) => setDim(e.target.value as "sen" | "area")}>
              <option value="sen">Por seniority</option><option value="area">Por área</option>
            </select>
          </div>
          <p className="text-xs text-ink-muted">{fmt(A.profile.n)} reuniones agendadas en los últimos 90 días{client ? ` en ${client}` : ""}, según el contacto.</p>
          {A.profile[dim].length ? <Bars rows={A.profile[dim]} color={() => "#0F6E56"} /> : <p className="text-sm text-ink-muted">Sin reuniones en los últimos 90 días.</p>}
        </div>
      </div>
    </section>
  );
}

// ── Vista de la líder ─────────────────────────────────────────────────────
function CellView({ data, onOpen }: { data: SdrDashboardResponse; onOpen: (key: string) => void }) {
  const meCell = data.index.find((r) => r.key === data.me.key)?.cell ?? null;
  const prog = monthProgress(data.today);
  const [cell, setCell] = useState<string>(meCell && data.cells.includes(meCell) ? meCell : "");
  const [sort, toggle] = useSort({ k: "est", dir: -1 });
  const rows = data.index.filter((r) => r.key !== "sin-sdr" && (!cell || r.cell === cell));
  const S = (k: keyof SdrIndexRow["summary"]) => rows.reduce((s, r) => s + (r.summary[k] as number), 0);
  const cols: { k: string; l: string; get: (r: SdrIndexRow) => number | string; hot?: boolean }[] = [
    { k: "name", l: "SDR", get: (r) => r.name },
    { k: "goal", l: "Meta del mes", get: (r) => r.summary.goal ?? 0 },
    { k: "re", l: "Realizadas", get: (r) => r.summary.re },
    { k: "gpct", l: "Cumplimiento", get: (r) => (r.summary.goal ? Math.round((100 * (r.summary.goalDone ?? 0)) / r.summary.goal) : -1) },
    { k: "cos", l: "Asignadas", get: (r) => r.summary.cos },
    { k: "unw", l: "Sin gestionar", get: (r) => r.summary.unw },
    { k: "est", l: "Estancadas", get: (r) => r.summary.est, hot: true },
    { k: "seg", l: "Seguim. vencidos", get: (r) => r.summary.seg, hot: true },
    { k: "sta", l: "Status desactualizado", get: (r) => r.summary.sta, hot: true },
    { k: "reu", l: "Reun. por actualizar", get: (r) => r.summary.reu + r.summary.hs, hot: true },
    { k: "ag", l: "Agendadas", get: (r) => r.summary.ag },

    { k: "pctm", l: "% emp. con reunión", get: (r) => (r.summary.cos ? Math.round((100 * r.summary.withMtg) / r.summary.cos) : 0) },
  ];
  const avg = (c: (typeof cols)[number]) => rows.length ? rows.reduce((s, r) => s + Number(c.get(r)), 0) / rows.length : 0;
  const sorted = sortRows(rows, sort, (r, k) => cols.find((c) => c.k === k)!.get(r));
  const oldest = rows.flatMap((r) => r.summary.oldest.map((o) => ({ ...o, sdr: r.name, key: r.key }))).sort((a, b) => b.d - a.d).slice(0, 10);
  const byClient = new Map<string, { cos: number; none: number; stock: number; telN: number; telD: number }>();
  for (const r of rows) for (const p of r.summary.perClient) {
    const x = byClient.get(p.c) ?? { cos: 0, none: 0, stock: 0, telN: 0, telD: 0 };
    x.cos += p.cos; x.none += p.none; x.stock += p.stock; x.telN += p.telN; x.telD += p.telD;
    byClient.set(p.c, x);
  }
  const clients = [...byClient.entries()].sort((a, b) => b[1].cos - a[1].cos);

  return (
    <div className="space-y-6">
      <div className="flex items-end gap-2 flex-wrap">
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Célula
          <select className="input min-w-[220px]" value={cell} onChange={(e) => setCell(e.target.value)}>
            <option value="">Todas las células</option>
            {data.cells.map((c) => <option key={c} value={c}>Célula de {c}</option>)}
          </select>
        </label>
        <span className="text-sm text-ink-muted pb-2">{fmt(rows.length)} SDR</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Tile label="Empresas asignadas" value={S("cos")} sub={`${fmt(rows.length)} SDR`} />
        <Tile label="Cuentas estancadas" value={S("est")} sub={`${STALE_BUSINESS_DAYS}+ días hábiles en Asignada`} alert={S("est") > 0} />
        <Tile label="Seguimientos vencidos" value={S("seg")} sub="Empresas y contactos" />
        <Tile label="Reuniones del mes" value={S("ag")} sub={`${fmt(S("re"))} realizadas · ${fmt(S("ns"))} no-show · ${pct(S("withMtg"), S("cos"))} de las empresas con reunión`} />
        {(() => {
          const g = goalStatus(S("goal") || null, S("goalDone"), prog.share);
          return (
            <div className="card py-3">
              <div className="text-xs text-ink-muted">Cumplimiento de la meta</div>
              <div className={`text-2xl font-semibold tabular-nums ${PACE[g.pace].fg}`}>{g.pct === null ? "—" : `${g.pct}%`}</div>
              <div className="text-xs text-ink-muted">{S("goal") ? `${fmt(S("goalDone"))} de ${fmt(S("goal"))} · esperado a la fecha ${fmtDec(g.expected)}` : "Sin metas cargadas"}</div>
            </div>
          );
        })()}
      </div>
      <section className="card p-0 overflow-hidden">
        <div className="px-4 pt-4 pb-3">
          <h2 className="text-base font-semibold">Ranking de la célula</h2>
          <p className="text-xs text-ink-muted">Clic en una columna para ordenar; clic en un SDR abre su dashboard. En rojo, lo que está sobre el promedio.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-muted bg-[#FAF9FD]">
              <tr>{cols.map((c) => <Th key={c.k} n={c.k !== "name"} onClick={() => toggle(c.k)} active={sort.k === c.k} dir={sort.dir}>{c.l}</Th>)}</tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.key} className="border-t hover:bg-black/[0.02]">
                  {cols.map((c) => {
                    const v = c.get(r);
                    if (c.k === "name") return <td key={c.k} className="px-3 py-2"><button onClick={() => onOpen(r.key)} className="font-medium text-brand hover:underline text-left whitespace-nowrap">{r.name}</button></td>;
                    const hot = c.hot && Number(v) > avg(c);
                    if (c.k === "gpct") {
                      const g = goalStatus(r.summary.goal || null, r.summary.goalDone ?? 0, prog.share);
                      return <td key={c.k} className={`px-3 py-2 text-right tabular-nums font-semibold ${PACE[g.pace].fg}`}>{g.pct === null ? "—" : `${g.pct}%`}</td>;
                    }
                    return <td key={c.k} className={`px-3 py-2 text-right tabular-nums ${hot ? "text-danger-fg font-semibold" : ""}`}>{c.k === "pctm" ? `${v}%` : fmt(Number(v))}</td>;
                  })}
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={cols.length} className="px-3 py-4 text-ink-muted">Sin SDR en esta célula.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
        <section className="card p-0 overflow-hidden">
          <h2 className="text-sm font-semibold px-4 pt-3.5 pb-2">Cuentas estancadas más antiguas</h2>
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-muted bg-[#FAF9FD]"><tr><Th>Empresa</Th><Th>SDR</Th><Th>Cliente</Th><Th n>Días hábiles</Th></tr></thead>
            <tbody>
              {oldest.map((o, i) => (
                <tr key={i} className="border-t"><td className="px-3 py-2 font-medium">{o.n}</td><td className="px-3 py-2"><button onClick={() => onOpen(o.key)} className="text-brand hover:underline">{o.sdr}</button></td><td className="px-3 py-2">{o.c}</td><td className="px-3 py-2 text-right text-warning-fg font-semibold">{o.d}</td></tr>
              ))}
              {!oldest.length && <tr><td colSpan={4} className="px-3 py-4 text-ink-muted">Sin cuentas estancadas.</td></tr>}
            </tbody>
          </table>
        </section>
        <section className="card p-0 overflow-hidden">
          <h2 className="text-sm font-semibold px-4 pt-3.5 pb-2">Disponibilidad por cliente</h2>
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-muted bg-[#FAF9FD]"><tr><Th>Cliente</Th><Th n>Empresas</Th><Th n>Sin contactos</Th><Th n>Contactos por gestionar</Th><Th n>Con teléfono</Th></tr></thead>
            <tbody>
              {clients.map(([c, x]) => (
                <tr key={c} className="border-t"><td className="px-3 py-2 font-medium">{c}</td><Td n>{x.cos}</Td><Td n>{x.none}</Td><Td n>{x.stock}</Td><td className="px-3 py-2 text-right">{x.telD ? pct(x.telN, x.telD) : "Sin dato aún"}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

// ── Meta del mes ──────────────────────────────────────────────────────────
const fmtDec = (n: number | null) => (n === null ? "—" : n.toLocaleString("es-CL", { maximumFractionDigits: 1 }));
const PACE: Record<Pace, { label: string; fg: string; badge: string; bar: string; tile: string }> = {
  ok: { label: "Al día", fg: "text-success-fg", badge: "bg-success-bg text-success-fg", bar: "#0F6E56", tile: "" },
  risk: { label: "En riesgo", fg: "text-warning-fg", badge: "bg-warning-bg text-warning-fg", bar: "#D39B1F", tile: "" },
  late: { label: "Atrasado", fg: "text-danger-fg", badge: "bg-danger-bg text-danger-fg", bar: "#C2562E", tile: "" },
  none: { label: "Sin meta", fg: "", badge: "bg-black/5 text-ink-muted", bar: "#B9B4CC", tile: "" },
};
function PaceBadge({ pace }: { pace: Pace }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs whitespace-nowrap ${PACE[pace].badge}`}>{PACE[pace].label}</span>;
}
// Meta del SDR en un cliente: barra de realizadas vs meta con la marca de lo esperado a la fecha
function GoalBox({ goal, done, pct: p, expected, pace, monthName, pending }: { goal: number | null; done: number; pct: number | null; expected: number | null; pace: Pace; monthName: string; pending: number }) {
  if (!goal) {
    return (
      <div className="rounded-lg border border-dashed px-2.5 py-2 text-sm text-ink-muted">
        Sin meta cargada para {monthName} · {fmt(done)} realizada{done === 1 ? "" : "s"}
      </div>
    );
  }
  const w = Math.min(100, (100 * done) / goal);
  const mark = expected === null ? 0 : Math.min(100, (100 * expected) / goal);
  return (
    <div className="rounded-lg bg-[#FAF9FD] border px-2.5 py-2 flex flex-col gap-1.5 text-sm">
      <div className="flex justify-between items-center gap-2">
        <span className="font-medium">Meta de {monthName}</span>
        <PaceBadge pace={pace} />
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`text-2xl font-semibold tabular-nums ${PACE[pace].fg}`}>{p}%</span>
        <span className="text-ink-muted">{fmt(done)} de {fmt(goal)} realizadas</span>
      </div>
      <div className="relative h-2.5 rounded bg-black/10" aria-hidden>
        <div className="h-full rounded" style={{ width: `${w}%`, background: PACE[pace].bar }} />
        <div className="absolute -top-1 h-[18px] w-0.5 bg-ink" style={{ left: `calc(${mark}% - 1px)` }} title="Esperado a la fecha" />
      </div>
      <div className="flex justify-between text-xs text-ink-muted">
        <span>Esperado a la fecha: <b className="text-ink">{fmtDec(expected)}</b></span>
        <span>{pending ? `${fmt(pending)} por realizar` : `Faltan ${fmt(Math.max(0, goal - done))}`}</span>
      </div>
    </div>
  );
}

// ── Piezas ────────────────────────────────────────────────────────────────
function Tile({ label, value, sub, alert, tone }: { label: string; value: number; sub?: string; alert?: boolean; tone?: "ok" | "bad" | "warn" }) {
  const color = alert || tone === "warn" ? "text-warning-fg" : tone === "ok" ? "text-success-fg" : tone === "bad" ? "text-danger-fg" : "";
  return (
    <div className={`card py-3 ${alert ? "!bg-warning-bg/50 !border-warning-fg/30" : ""}`}>
      <div className="text-xs text-ink-muted">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${color}`}>{fmt(value)}</div>
      {sub && <div className="text-xs text-ink-muted">{sub}</div>}
    </div>
  );
}
function Line({ l, v, bad }: { l: string; v: string; bad?: boolean }) {
  return <div className="flex justify-between gap-2"><span className="text-ink-muted">{l}</span><b className={bad ? "text-danger-fg" : ""}>{v}</b></div>;
}
function Bars({ rows, color }: { rows: { label: string; n: number; extra?: string }[]; color: (i: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        <div key={r.label} className="grid items-center gap-2 text-sm" style={{ gridTemplateColumns: "minmax(110px, 40%) 1fr auto" }}>
          <span className="truncate" title={r.label}>{r.label}</span>
          <div className="h-2.5 rounded bg-black/5 overflow-hidden"><div className="h-full rounded" style={{ width: `${(100 * r.n) / max}%`, background: color(i) }} /></div>
          <span className="text-right tabular-nums">{fmt(r.n)}{r.extra && <span className="text-danger-fg"> {r.extra}</span>}</span>
        </div>
      ))}
    </div>
  );
}
function PctBar({ v }: { v: number | null }) {
  if (v === null) return <span className="text-xs text-ink-subtle">Sin dato aún</span>;
  return (
    <div className="flex items-center gap-2 min-w-[110px]">
      <div className="flex-1 h-2 rounded bg-black/5 overflow-hidden"><div className="h-full bg-brand" style={{ width: `${v}%` }} /></div>
      <span className="tabular-nums w-9 text-right">{v}%</span>
    </div>
  );
}
function Th({ children, n, onClick, active, dir }: { children: React.ReactNode; n?: boolean; onClick?: () => void; active?: boolean; dir?: number }) {
  return (
    <th onClick={onClick} className={`px-3 py-2 font-medium whitespace-nowrap ${n ? "text-right" : "text-left"} ${onClick ? "cursor-pointer select-none hover:text-ink" : ""} ${active ? "text-ink" : ""}`}>
      {children}{active ? (dir === 1 ? " ▲" : " ▼") : ""}
    </th>
  );
}
function Td({ children, n }: { children: React.ReactNode; n?: boolean }) {
  return <td className={`px-3 py-2 ${n ? "text-right tabular-nums" : ""}`}>{typeof children === "number" ? fmt(children) : children}</td>;
}
function Pill({ st }: { st: string }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs whitespace-nowrap ${pillClass(st)}`}>{st}</span>;
}
function SearchBox({ q, setQ, placeholder }: { q: string; setQ: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <IconSearch size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle" />
      <input className="input pl-8 min-w-[240px]" type="search" aria-label="Buscar" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
    </div>
  );
}
function StatusSelect({ rows, status, setStatus }: { rows: { st: string }[]; status: string; setStatus: (v: string) => void }) {
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.st, (m.get(r.st) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  return (
    <select className="input" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
      <option value="">Todos los status</option>
      {counts.map(([s, n]) => <option key={s} value={s}>{s} ({fmt(n)})</option>)}
    </select>
  );
}

function CompaniesTable({ rows, flagOf, showClient, onlyFix, setOnlyFix }: {
  rows: SdrCompany[]; flagOf: Map<string, string>; showClient: boolean; onlyFix: boolean; setOnlyFix: (v: boolean) => void;
}) {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [sort, toggle] = useSort({ k: "flag", dir: -1 });
  const list = useMemo(() => {
    const nq = norm(q.trim());
    const f = rows.filter((r) => (!status || r.st === status) && (!nq || norm(`${r.n} ${r.pais} ${r.ind ?? ""}`).includes(nq)) && (!onlyFix || flagOf.has(r.id)));
    return sortRows(f, sort, (r, k) => {
      switch (k) {
        case "flag": return flagOf.get(r.id) ?? "";
        case "nct": return r.nct;
        case "nmg": return r.nmg;
        case "msch": return r.msch;
        default: return (r as unknown as Record<string, string>)[k] ?? "";
      }
    });
  }, [rows, status, q, onlyFix, sort, flagOf]);
  const th = (k: string, l: string, n?: boolean) => <Th n={n} onClick={() => toggle(k)} active={sort.k === k} dir={sort.dir}>{l}</Th>;
  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <StatusSelect rows={rows} status={status} setStatus={setStatus} />
        <SearchBox q={q} setQ={setQ} placeholder="Empresa, país o industria" />
        <label className="flex items-center gap-1.5 text-sm text-ink-muted">
          <input type="checkbox" checked={onlyFix} onChange={(e) => setOnlyFix(e.target.checked)} /> Solo con algo por corregir
        </label>
        <span className="text-xs text-ink-muted ml-auto">{fmt(list.length)} empresas{list.length > MAX_ROWS ? ` (se muestran ${MAX_ROWS})` : ""}</span>
      </div>
      <div className="overflow-auto max-h-[560px] border rounded-lg">
        <table className="w-full text-sm">
          <thead className="text-xs text-ink-muted bg-white sticky top-0 shadow-[0_1px_0_rgba(0,0,0,0.06)]">
            <tr>
              {th("n", "Empresa")}{showClient && th("c", "Cliente")}{th("st", "Status de la asignación")}{th("asg", "Asignada el")}
              {th("nct", "Contactos", true)}{th("nmg", "Gestionados", true)}{th("next", "Próx. seguimiento")}{th("msch", "Reuniones", true)}{th("flag", "Por corregir")}
            </tr>
          </thead>
          <tbody>
            {list.slice(0, MAX_ROWS).map((r) => {
              const flag = flagOf.get(r.id);
              return (
                <tr key={r.id} className={`border-t ${flag ? "bg-warning-bg/30" : ""}`}>
                  <td className="px-3 py-2 font-medium">{r.n}<div className="text-xs font-normal text-ink-muted">{[r.pais, r.ind].filter(Boolean).join(" · ")}</div></td>
                  {showClient && <td className="px-3 py-2">{r.c}</td>}
                  <td className="px-3 py-2"><Pill st={r.st} /></td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDay(r.asg)}</td>
                  <Td n>{r.nct}</Td><Td n>{r.nmg}</Td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDay(r.next)}</td>
                  <Td n>{r.msch}</Td>
                  <td className="px-3 py-2 text-warning-fg font-medium">{flag && <span className="inline-flex items-center gap-1"><IconAlertTriangle size={14} />{flag}</span>}</td>
                </tr>
              );
            })}
            {!list.length && <tr><td colSpan={9} className="px-3 py-4 text-ink-muted">Sin empresas con estos filtros.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ContactsTable({ rows, showClient }: { rows: SdrContact[]; showClient: boolean }) {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [sort, toggle] = useSort({ k: "con", dir: 1 });
  const list = useMemo(() => {
    const nq = norm(q.trim());
    const f = rows.filter((r) => (!status || r.st === status) && (!nq || norm(`${r.n} ${r.cargo} ${r.con}`).includes(nq)));
    return sortRows(f, sort, (r, k) => (r as unknown as Record<string, string>)[k] ?? "");
  }, [rows, status, q, sort]);
  const th = (k: string, l: string) => <Th onClick={() => toggle(k)} active={sort.k === k} dir={sort.dir}>{l}</Th>;
  const yn = (v: 0 | 1 | undefined) => (v === undefined ? <span className="text-ink-subtle">—</span> : v ? "Sí" : <span className="text-danger-fg">No</span>);
  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <StatusSelect rows={rows} status={status} setStatus={setStatus} />
        <SearchBox q={q} setQ={setQ} placeholder="Nombre, cargo o empresa" />
        <span className="text-xs text-ink-muted ml-auto">{fmt(list.length)} contactos{list.length > MAX_ROWS ? ` (se muestran ${MAX_ROWS})` : ""}</span>
      </div>
      <div className="overflow-auto max-h-[560px] border rounded-lg">
        <table className="w-full text-sm">
          <thead className="text-xs text-ink-muted bg-white sticky top-0 shadow-[0_1px_0_rgba(0,0,0,0.06)]">
            <tr>{th("n", "Contacto")}{th("cargo", "Cargo")}{th("con", "Empresa")}{showClient && th("c", "Cliente")}{th("st", "Status")}{th("next", "Próx. actividad")}<Th>Teléfono</Th><Th>Correo</Th><Th>LinkedIn</Th></tr>
          </thead>
          <tbody>
            {list.slice(0, MAX_ROWS).map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2 font-medium">{r.n}</td>
                <td className="px-3 py-2">{r.cargo || "—"}</td>
                <td className="px-3 py-2">{r.con || "—"}</td>
                {showClient && <td className="px-3 py-2">{r.c}</td>}
                <td className="px-3 py-2"><Pill st={r.st} /></td>
                <td className="px-3 py-2 whitespace-nowrap">{fmtDay(r.next)}</td>
                <td className="px-3 py-2">{yn(r.ph)}</td><td className="px-3 py-2">{yn(r.ml)}</td><td className="px-3 py-2">{yn(r.lk)}</td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={9} className="px-3 py-4 text-ink-muted">Sin contactos con estos filtros.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
