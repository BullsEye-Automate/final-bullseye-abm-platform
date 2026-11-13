"use client";

// Dashboard SDR: empresas y contactos asignados a cada SDR por cliente, con su
// actividad del período. Datos de los informes de Pulso ABM ya sincronizados
// (lib/dashboardSdr/server.ts). Por defecto muestra al SDR de la sesión.
import { useCallback, useEffect, useMemo, useState } from "react";
import { IconAlertCircle, IconLoader2, IconRefresh, IconSearch, IconUserCircle } from "@tabler/icons-react";
import type { SdrActivity, SdrCompany, SdrContact, SdrDashboardResponse } from "@/lib/dashboardSdr/types";

type Period = "mes" | "7" | "30" | "90";
const PERIODS: { v: Period; l: string }[] = [
  { v: "mes", l: "Este mes" },
  { v: "7", l: "Últimos 7 días" },
  { v: "30", l: "Últimos 30 días" },
  { v: "90", l: "Últimos 90 días" },
];

const nf = new Intl.NumberFormat("es-CL");
const fmt = (n: number) => nf.format(n);
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fmtDay = (d: string | null) => {
  if (!d) return "—";
  const [y, m, dd] = d.slice(0, 10).split("-");
  return `${Number(dd)} ${MONTHS[Number(m) - 1]} ${y}`;
};
const timeCL = (iso: string) =>
  new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function periodFrom(p: Period, today: string): string {
  if (p === "mes") return `${today.slice(0, 7)}-01`;
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - Number(p) + 1);
  return d.toISOString().slice(0, 10);
}

// Grupos de status de empresa (La Biblia)
type CoGroup = "por_gestionar" | "en_gestion" | "reunion" | "cerradas";
function companyGroup(st: string): CoGroup {
  const t = norm(st);
  if (t.includes("reuni") || t.includes("cliente") || t.includes("oportunidad")) return "reunion";
  if (t === "asignada" || t.includes("por gestionar") || t === "sin status") return "por_gestionar";
  if (t.includes("en gesti") || t.includes("seguimiento") || t.includes("conversaci")) return "en_gestion";
  return "cerradas";
}
function pillClass(st: string): string {
  const t = norm(st);
  if (t.includes("reuni") || t.includes("oportunidad")) return "bg-success-bg text-success-fg";
  if (t.includes("seguimiento") || t.includes("en gesti") || t.includes("conversaci") || t.includes("hot calling")) return "bg-warning-bg text-warning-fg";
  if (t.includes("no fit") || t.includes("no califica") || t.includes("sin informaci") || t.includes("descart")) return "bg-danger-bg text-danger-fg";
  if (t === "asignada" || t.includes("por gestionar") || t.includes("por llamar")) return "bg-info-bg text-info-fg";
  return "bg-black/5 text-ink";
}

type Counts = { call: number; conn: number; em: number; wa: number; li: number; total: number; last: string | null };
const emptyCounts = (): Counts => ({ call: 0, conn: 0, em: 0, wa: 0, li: 0, total: 0, last: null });
function add(c: Counts, a: SdrActivity) {
  c[a[1]]++;
  if (a[1] === "call" && a[4]) c.conn++;
  c.total++;
  if (!c.last || a[0] > c.last) c.last = a[0];
}

type SortState = { k: string; dir: 1 | -1 };
function useSort(initial: SortState) {
  const [s, set] = useState<SortState>(initial);
  const toggle = (k: string) => set((p) => ({ k, dir: p.k === k ? ((-p.dir) as 1 | -1) : -1 }));
  return [s, toggle] as const;
}
function sortRows<T>(rows: T[], s: SortState, get: (r: T, k: string) => string | number | null): T[] {
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
  const [period, setPeriod] = useState<Period>("mes");
  const [client, setClient] = useState("");
  const [tab, setTab] = useState<"empresas" | "contactos">("empresas");

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

  useEffect(() => { load(""); }, [load]);

  const slice = data?.sdr ?? null;
  const today = data?.today ?? new Date().toISOString().slice(0, 10);
  const from = periodFrom(period, today);
  const clients = useMemo(() => [...new Set((slice?.companies ?? []).map((c) => c.c).concat((slice?.contacts ?? []).map((c) => c.c)))].sort(), [slice]);

  // Actividad del período por empresa y por contacto
  const calc = useMemo(() => {
    const byCo = new Map<string, Counts>();
    const byCt = new Map<string, Counts>();
    const total = emptyCounts();
    const coClient = new Map((slice?.companies ?? []).map((c) => [c.id, c.c]));
    const ctClient = new Map((slice?.contacts ?? []).map((c) => [c.id, c.c]));
    for (const a of slice?.activities ?? []) {
      if (a[0] < from) continue;
      const cl = (a[3] && ctClient.get(a[3])) || coClient.get(a[2]);
      if (client && cl !== client) continue;
      add(total, a);
      const co = byCo.get(a[2]) ?? emptyCounts(); add(co, a); byCo.set(a[2], co);
      if (a[3]) { const ct = byCt.get(a[3]) ?? emptyCounts(); add(ct, a); byCt.set(a[3], ct); }
    }
    const companies = (slice?.companies ?? []).filter((c) => !client || c.c === client);
    const contacts = (slice?.contacts ?? []).filter((c) => !client || c.c === client);
    const byClient = new Map<string, { cliente: string; asignadas: number; activas: number; por_gestionar: number; en_gestion: number; reunion: number; cerradas: number; contactos: number; contactosActivos: number; acts: number }>();
    const row = (c: string) => {
      let r = byClient.get(c);
      if (!r) { r = { cliente: c, asignadas: 0, activas: 0, por_gestionar: 0, en_gestion: 0, reunion: 0, cerradas: 0, contactos: 0, contactosActivos: 0, acts: 0 }; byClient.set(c, r); }
      return r;
    };
    for (const co of companies) {
      const r = row(co.c);
      r.asignadas++;
      r[companyGroup(co.st)]++;
      const a = byCo.get(co.id);
      if (a) { r.activas++; }
    }
    for (const ct of contacts) {
      const r = row(ct.c);
      r.contactos++;
      if (byCt.has(ct.id)) r.contactosActivos++;
    }
    for (const [coId, a] of byCo) { const cl = coClient.get(coId); if (cl && byClient.has(cl)) byClient.get(cl)!.acts += a.total; }
    return {
      byCo, byCt, total, companies, contacts,
      perClient: [...byClient.values()].sort((a, b) => b.asignadas - a.asignadas),
      activeCompanies: companies.filter((c) => byCo.has(c.id)).length,
      activeContacts: contacts.filter((c) => byCt.has(c.id)).length,
      meetings: companies.reduce((s, c) => s + c.msch, 0),
      withMeeting: companies.filter((c) => companyGroup(c.st) === "reunion" || c.msch > 0).length,
    };
  }, [slice, from, client]);

  const myself = data?.me.key && data.me.key === slice?.key;

  return (
    <div className="space-y-6 max-w-6xl">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="label">SDR</div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <IconUserCircle size={24} className="text-brand" />
            {slice ? (myself ? `Mi dashboard · ${slice.name}` : `Dashboard de ${slice.name}`) : "Dashboard SDR"}
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            Empresas y contactos asignados por cliente, con la actividad registrada en ellos.
            {data && <> Calculado {timeCL(data.generated)}.</>}
          </p>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            SDR
            <select className="input min-w-[200px]" value={sdr} onChange={(e) => { setSdr(e.target.value); setClient(""); load(e.target.value); }} disabled={!data}>
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
              {clients.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            Período
            <select className="input" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
              {PERIODS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
            </select>
          </label>
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

      {data && !slice && !loading && (
        <div className="card text-sm text-ink-muted">
          {data.me.name
            ? `${data.me.name} no tiene empresas ni contactos asignados en los informes de Pulso ABM. Elige otro SDR arriba.`
            : "No identificamos tu usuario con un SDR de la Maestra. Elige un SDR arriba."}
        </div>
      )}

      {data && slice && (
        <div className={loading ? "opacity-50 pointer-events-none space-y-6" : "space-y-6"}>
          {/* Cartera */}
          <section className="space-y-2">
            <h2 className="text-base font-semibold">Cartera asignada{client ? ` · ${client}` : ""}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <Tile label="Empresas asignadas" value={calc.companies.length} sub={`En ${client ? 1 : clients.length} cliente${!client && clients.length !== 1 ? "s" : ""}`} />
              <Tile label="Empresas con actividad" value={calc.activeCompanies} sub={pct(calc.activeCompanies, calc.companies.length) + " en el período"} />
              <Tile label="Contactos asignados" value={calc.contacts.length} sub="De sus empresas y propios" />
              <Tile label="Contactos con actividad" value={calc.activeContacts} sub={pct(calc.activeContacts, calc.contacts.length) + " en el período"} />
              <Tile label="Empresas con reunión" value={calc.withMeeting} sub={`${fmt(calc.meetings)} reuniones agendadas (histórico)`} />
            </div>
          </section>

          {/* Actividades */}
          <section className="space-y-2">
            <h2 className="text-base font-semibold">Actividades del período</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <Tile label="Llamadas" value={calc.total.call} sub={`${fmt(calc.total.conn)} conectadas (${pct(calc.total.conn, calc.total.call)})`} />
              <Tile label="Correos" value={calc.total.em} />
              <Tile label="WhatsApp" value={calc.total.wa} />
              <Tile label="LinkedIn" value={calc.total.li} />
              <Tile label="Total" value={calc.total.total} sub={`Desde el ${fmtDay(from)}`} />
            </div>
          </section>

          {/* Por cliente */}
          <section className="card p-0 overflow-hidden">
            <div className="px-4 pt-4 pb-2">
              <h2 className="text-base font-semibold">Empresas asignadas por cliente</h2>
              <p className="text-xs text-ink-muted">Status de la asignación actual de cada empresa. Clic en un cliente para filtrar.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-ink-muted bg-black/[0.02]">
                  <tr>
                    <Th>Cliente</Th><Th n>Asignadas</Th><Th n>Con actividad</Th><Th n>Por gestionar</Th><Th n>En gestión / seguimiento</Th>
                    <Th n>Reunión / oportunidad</Th><Th n>Descartadas / nutrir</Th><Th n>Contactos</Th><Th n>Contactos con actividad</Th><Th n>Actividades</Th>
                  </tr>
                </thead>
                <tbody>
                  {calc.perClient.map((r) => (
                    <tr key={r.cliente} className="border-t hover:bg-black/[0.02] cursor-pointer" onClick={() => setClient(client === r.cliente ? "" : r.cliente)}>
                      <td className="px-3 py-2 font-medium">{r.cliente}</td>
                      <Td n>{r.asignadas}</Td><Td n>{r.activas}</Td><Td n>{r.por_gestionar}</Td><Td n>{r.en_gestion}</Td>
                      <Td n>{r.reunion}</Td><Td n>{r.cerradas}</Td><Td n>{r.contactos}</Td><Td n>{r.contactosActivos}</Td><Td n>{r.acts}</Td>
                    </tr>
                  ))}
                  {!calc.perClient.length && (
                    <tr><td colSpan={10} className="px-3 py-4 text-ink-muted">Sin empresas asignadas{client ? " en este cliente" : ""}.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Detalle */}
          <section className="card space-y-3">
            <div className="flex gap-1 border-b">
              {(["empresas", "contactos"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-2 text-sm -mb-px border-b-2 ${tab === t ? "border-brand text-brand font-medium" : "border-transparent text-ink-muted hover:text-ink"}`}
                >
                  {t === "empresas" ? `Empresas (${fmt(calc.companies.length)})` : `Contactos (${fmt(calc.contacts.length)})`}
                </button>
              ))}
            </div>
            {tab === "empresas"
              ? <CompaniesTable rows={calc.companies} acts={calc.byCo} showClient={!client} />
              : <ContactsTable rows={calc.contacts} acts={calc.byCt} showClient={!client} />}
          </section>

          <details className="text-xs text-ink-muted">
            <summary className="cursor-pointer">Cómo se calcula y de dónde salen los datos</summary>
            <div className="mt-2 space-y-1.5 leading-relaxed">
              <p>Se leen los informes de <b>Pulso ABM</b> de los clientes activos en la Maestra (se sincronizan con HubSpot cada día). Empresa asignada = su propiedad «SDR - &lt;cliente&gt;» es este SDR; contacto asignado = su «SDR Asignado - &lt;cliente&gt;» o, si está vacío, el SDR de su empresa.</p>
              <p>Las actividades son las llamadas, correos, WhatsApp y LinkedIn registrados en HubSpot en esas empresas y contactos dentro del período (HubSpot no distingue aquí quién hizo cada una). Llamada conectada = «Resultado de la llamada» Conectada. Se incluyen los últimos {ACTIVITY_LABEL} días.</p>
              <p>Los status son los actuales de HubSpot. «Reunión / oportunidad» agrupa los status con reunión, oportunidad o cliente; «Descartadas / nutrir» los que salieron de gestión (No califica, Nutrir, sin contactos fit…).</p>
              {data.sources.length > 0 && (
                <p>Informes leídos: {data.sources.map((s) => `${s.client}${s.syncedAt ? ` (${timeCL(s.syncedAt)})` : ""}`).join(" · ")}.</p>
              )}
              {data.missing.length > 0 && <p className="text-warning-fg">Clientes activos sin informe de Pulso ABM: {data.missing.join(", ")}.</p>}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

const ACTIVITY_LABEL = 92;
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "0%");

function Tile({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="card py-3">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{fmt(value)}</div>
      {sub && <div className="text-xs text-ink-muted">{sub}</div>}
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

function Filters({ statuses, status, setStatus, q, setQ, onlyIdle, setOnlyIdle, placeholder, count }: {
  statuses: [string, number][]; status: string; setStatus: (v: string) => void; q: string; setQ: (v: string) => void;
  onlyIdle: boolean; setOnlyIdle: (v: boolean) => void; placeholder: string; count: string;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">Todos los status</option>
        {statuses.map(([s, n]) => <option key={s} value={s}>{s} ({fmt(n)})</option>)}
      </select>
      <div className="relative">
        <IconSearch size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle" />
        <input className="input pl-8 min-w-[240px]" type="search" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <label className="flex items-center gap-1.5 text-sm text-ink-muted">
        <input type="checkbox" checked={onlyIdle} onChange={(e) => setOnlyIdle(e.target.checked)} /> Solo sin actividad en el período
      </label>
      <span className="text-xs text-ink-muted ml-auto">{count}</span>
    </div>
  );
}

function statusCounts(rows: { st: string }[]): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.st, (m.get(r.st) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function CompaniesTable({ rows, acts, showClient }: { rows: SdrCompany[]; acts: Map<string, Counts>; showClient: boolean }) {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [onlyIdle, setOnlyIdle] = useState(false);
  const [sort, toggle] = useSort({ k: "acts", dir: -1 });
  const statuses = useMemo(() => statusCounts(rows), [rows]);
  const list = useMemo(() => {
    const nq = norm(q.trim());
    const f = rows.filter((r) => (!status || r.st === status) && (!nq || norm(`${r.n} ${r.pais} ${r.ind ?? ""}`).includes(nq)) && (!onlyIdle || !acts.has(r.id)));
    return sortRows(f, sort, (r, k) => {
      const a = acts.get(r.id);
      switch (k) {
        case "acts": return a?.total ?? 0;
        case "calls": return a?.call ?? 0;
        case "last": return r.last ?? "";
        case "nct": return r.nct;
        case "nmg": return r.nmg;
        case "msch": return r.msch;
        default: return (r as unknown as Record<string, string>)[k] ?? "";
      }
    });
  }, [rows, status, q, onlyIdle, sort, acts]);
  const th = (k: string, l: string, n?: boolean) => <Th n={n} onClick={() => toggle(k)} active={sort.k === k} dir={sort.dir}>{l}</Th>;
  return (
    <>
      <Filters statuses={statuses} status={status} setStatus={setStatus} q={q} setQ={setQ} onlyIdle={onlyIdle} setOnlyIdle={setOnlyIdle}
        placeholder="Empresa, país o industria" count={`${fmt(list.length)} empresas${list.length > MAX_ROWS ? ` (se muestran ${MAX_ROWS})` : ""}`} />
      <div className="overflow-auto max-h-[560px] border rounded-lg">
        <table className="w-full text-sm">
          <thead className="text-xs text-ink-muted bg-white sticky top-0 shadow-[0_1px_0_rgba(0,0,0,0.06)]">
            <tr>
              {th("n", "Empresa")}{showClient && th("c", "Cliente")}{th("pais", "País")}{th("st", "Status de la asignación")}
              {th("nct", "Contactos", true)}{th("nmg", "Gestionados", true)}{th("calls", "Llamadas", true)}{th("acts", "Actividades", true)}{th("msch", "Reuniones", true)}{th("last", "Última actividad")}
            </tr>
          </thead>
          <tbody>
            {list.slice(0, MAX_ROWS).map((r) => {
              const a = acts.get(r.id);
              return (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{r.n}{r.ind && <div className="text-xs font-normal text-ink-muted">{r.ind}</div>}</td>
                  {showClient && <td className="px-3 py-2">{r.c}</td>}
                  <td className="px-3 py-2">{r.pais || "—"}</td>
                  <td className="px-3 py-2"><Pill st={r.st} /></td>
                  <Td n>{r.nct}</Td><Td n>{r.nmg}</Td>
                  <Td n>{a ? `${fmt(a.call)}${a.conn ? ` (${fmt(a.conn)} con.)` : ""}` : 0}</Td>
                  <Td n>{a?.total ?? 0}</Td><Td n>{r.msch}</Td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDay(r.last)}</td>
                </tr>
              );
            })}
            {!list.length && <tr><td colSpan={10} className="px-3 py-4 text-ink-muted">Sin empresas con estos filtros.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ContactsTable({ rows, acts, showClient }: { rows: SdrContact[]; acts: Map<string, Counts>; showClient: boolean }) {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [onlyIdle, setOnlyIdle] = useState(false);
  const [sort, toggle] = useSort({ k: "total", dir: -1 });
  const statuses = useMemo(() => statusCounts(rows), [rows]);
  const list = useMemo(() => {
    const nq = norm(q.trim());
    const f = rows.filter((r) => (!status || r.st === status) && (!nq || norm(`${r.n} ${r.cargo} ${r.con}`).includes(nq)) && (!onlyIdle || !acts.has(r.id)));
    return sortRows(f, sort, (r, k) => {
      const a = acts.get(r.id);
      if (k === "call" || k === "em" || k === "wa" || k === "li" || k === "total") return a?.[k] ?? 0;
      if (k === "last") return r.last ?? "";
      return (r as unknown as Record<string, string>)[k] ?? "";
    });
  }, [rows, status, q, onlyIdle, sort, acts]);
  const th = (k: string, l: string, n?: boolean) => <Th n={n} onClick={() => toggle(k)} active={sort.k === k} dir={sort.dir}>{l}</Th>;
  return (
    <>
      <Filters statuses={statuses} status={status} setStatus={setStatus} q={q} setQ={setQ} onlyIdle={onlyIdle} setOnlyIdle={setOnlyIdle}
        placeholder="Nombre, cargo o empresa" count={`${fmt(list.length)} contactos${list.length > MAX_ROWS ? ` (se muestran ${MAX_ROWS})` : ""}`} />
      <div className="overflow-auto max-h-[560px] border rounded-lg">
        <table className="w-full text-sm">
          <thead className="text-xs text-ink-muted bg-white sticky top-0 shadow-[0_1px_0_rgba(0,0,0,0.06)]">
            <tr>
              {th("n", "Contacto")}{th("con", "Empresa")}{showClient && th("c", "Cliente")}{th("st", "Status")}
              {th("call", "Llamadas", true)}{th("em", "Correos", true)}{th("wa", "WhatsApp", true)}{th("li", "LinkedIn", true)}{th("total", "Total", true)}{th("last", "Última actividad")}
            </tr>
          </thead>
          <tbody>
            {list.slice(0, MAX_ROWS).map((r) => {
              const a = acts.get(r.id);
              return (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2"><div className="font-medium">{r.n}</div>{r.cargo && <div className="text-xs text-ink-muted">{r.cargo}</div>}</td>
                  <td className="px-3 py-2">{r.con || "—"}</td>
                  {showClient && <td className="px-3 py-2">{r.c}</td>}
                  <td className="px-3 py-2"><Pill st={r.st} /></td>
                  <Td n>{a ? `${fmt(a.call)}${a.conn ? ` (${fmt(a.conn)} con.)` : ""}` : 0}</Td>
                  <Td n>{a?.em ?? 0}</Td><Td n>{a?.wa ?? 0}</Td><Td n>{a?.li ?? 0}</Td><Td n>{a?.total ?? 0}</Td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDay(r.last)}</td>
                </tr>
              );
            })}
            {!list.length && <tr><td colSpan={10} className="px-3 py-4 text-ink-muted">Sin contactos con estos filtros.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
