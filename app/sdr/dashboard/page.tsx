"use client";

// Dashboard SDR: empresas y contactos asignados a cada SDR por cliente y sus
// cuentas estancadas (15+ días hábiles en "Asignada"). Datos de los informes
// de Pulso ABM ya sincronizados (lib/dashboardSdr/server.ts). Por ahora no
// suma actividades (decisión de BullsEye). Abre en el SDR de la sesión;
// ?sdr=<clave>&estancadas=1 abre un SDR con el filtro de estancadas (links
// del correo semanal).
import { useCallback, useEffect, useMemo, useState } from "react";
import { IconAlertCircle, IconAlertTriangle, IconLoader2, IconRefresh, IconSearch, IconUserCircle } from "@tabler/icons-react";
import type { SdrCompany, SdrContact, SdrDashboardResponse } from "@/lib/dashboardSdr/types";
import { STALE_BUSINESS_DAYS, staleDays } from "@/lib/dashboardSdr/stale";

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
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "0%");

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
  const [client, setClient] = useState("");
  const [tab, setTab] = useState<"empresas" | "contactos">("empresas");
  const [onlyStale, setOnlyStale] = useState(false);

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
    if (q.get("estancadas") === "1") { setOnlyStale(true); setTab("empresas"); }
    load(q.get("sdr") ?? "");
  }, [load]);

  const slice = data?.sdr ?? null;
  const today = data?.today ?? new Date().toISOString().slice(0, 10);
  const clients = useMemo(() => [...new Set((slice?.companies ?? []).map((c) => c.c).concat((slice?.contacts ?? []).map((c) => c.c)))].sort(), [slice]);

  const calc = useMemo(() => {
    const companies = (slice?.companies ?? []).filter((c) => !client || c.c === client);
    const contacts = (slice?.contacts ?? []).filter((c) => !client || c.c === client);
    const days = new Map<string, number | null>(companies.map((c) => [c.id, staleDays(c, today)]));
    const isStale = (c: SdrCompany) => (days.get(c.id) ?? -1) >= STALE_BUSINESS_DAYS;
    const byClient = new Map<string, { cliente: string; asignadas: number; por_gestionar: number; estancadas: number; en_gestion: number; reunion: number; cerradas: number; contactos: number }>();
    const row = (c: string) => {
      let r = byClient.get(c);
      if (!r) { r = { cliente: c, asignadas: 0, por_gestionar: 0, estancadas: 0, en_gestion: 0, reunion: 0, cerradas: 0, contactos: 0 }; byClient.set(c, r); }
      return r;
    };
    for (const co of companies) {
      const r = row(co.c);
      r.asignadas++;
      r[companyGroup(co.st)]++;
      if (isStale(co)) r.estancadas++;
    }
    for (const ct of contacts) row(ct.c).contactos++;
    const stale = companies.filter(isStale);
    return {
      companies, contacts, days, stale,
      perClient: [...byClient.values()].sort((a, b) => b.asignadas - a.asignadas),
      unworked: companies.filter((c) => companyGroup(c.st) === "por_gestionar").length,
      withMeeting: companies.filter((c) => companyGroup(c.st) === "reunion" || c.msch > 0).length,
      meetings: companies.reduce((s, c) => s + c.msch, 0),
      noContacts: companies.filter((c) => c.nct === 0).length,
      oldest: stale.reduce((m, c) => Math.max(m, days.get(c.id) ?? 0), 0),
    };
  }, [slice, client, today]);

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
            Empresas y contactos asignados por cliente.
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
          <section className="space-y-2">
            <h2 className="text-base font-semibold">Cartera asignada{client ? ` · ${client}` : ""}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <Tile label="Empresas asignadas" value={calc.companies.length} sub={`En ${client ? 1 : clients.length} cliente${!client && clients.length !== 1 ? "s" : ""}`} />
              <Tile label="Sin gestionar" value={calc.unworked} sub={`${pct(calc.unworked, calc.companies.length)} en Asignada`} />
              <Tile label="Contactos asignados" value={calc.contacts.length} sub={`${calc.noContacts ? `${fmt(calc.noContacts)} empresas sin contactos` : "Todas las empresas con contactos"}`} />
              <Tile label="Empresas con reunión" value={calc.withMeeting} sub={`${fmt(calc.meetings)} reuniones agendadas (histórico)`} />
              <Tile label="Cuentas estancadas" value={calc.stale.length} sub={`${STALE_BUSINESS_DAYS}+ días hábiles en Asignada`} alert={calc.stale.length > 0} />
            </div>
          </section>

          {calc.stale.length > 0 && (
            <div className="flex items-start gap-2 text-sm p-3 rounded-lg bg-warning-bg text-warning-fg">
              <IconAlertTriangle size={18} className="shrink-0 mt-0.5" />
              <div className="flex-1">
                <b>{fmt(calc.stale.length)} cuenta{calc.stale.length === 1 ? "" : "s"} estancada{calc.stale.length === 1 ? "" : "s"}</b>: siguen en Asignada hace {STALE_BUSINESS_DAYS} días hábiles o más (la más antigua, {fmt(calc.oldest)}). Gestiónalas o actualiza su status en HubSpot.
              </div>
              {!onlyStale && (
                <button onClick={() => { setOnlyStale(true); setTab("empresas"); }} className="shrink-0 px-2.5 py-1 rounded-md border border-current text-xs hover:bg-black/5">Ver cuáles</button>
              )}
            </div>
          )}

          <section className="card p-0 overflow-hidden">
            <div className="px-4 pt-4 pb-2">
              <h2 className="text-base font-semibold">Empresas asignadas por cliente</h2>
              <p className="text-xs text-ink-muted">Status de la asignación actual de cada empresa. Clic en un cliente para filtrar.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-ink-muted bg-black/[0.02]">
                  <tr>
                    <Th>Cliente</Th><Th n>Asignadas</Th><Th n>Por gestionar</Th><Th n>Estancadas</Th><Th n>En gestión / seguimiento</Th>
                    <Th n>Reunión / oportunidad</Th><Th n>Descartadas / nutrir</Th><Th n>Contactos</Th>
                  </tr>
                </thead>
                <tbody>
                  {calc.perClient.map((r) => (
                    <tr key={r.cliente} className="border-t hover:bg-black/[0.02] cursor-pointer" onClick={() => setClient(client === r.cliente ? "" : r.cliente)}>
                      <td className="px-3 py-2 font-medium">{r.cliente}</td>
                      <Td n>{r.asignadas}</Td><Td n>{r.por_gestionar}</Td>
                      <td className={`px-3 py-2 text-right tabular-nums ${r.estancadas ? "text-warning-fg font-semibold" : ""}`}>{fmt(r.estancadas)}</td>
                      <Td n>{r.en_gestion}</Td><Td n>{r.reunion}</Td><Td n>{r.cerradas}</Td><Td n>{r.contactos}</Td>
                    </tr>
                  ))}
                  {!calc.perClient.length && (
                    <tr><td colSpan={8} className="px-3 py-4 text-ink-muted">Sin empresas asignadas{client ? " en este cliente" : ""}.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

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
              ? <CompaniesTable rows={calc.companies} days={calc.days} showClient={!client} onlyStale={onlyStale} setOnlyStale={setOnlyStale} />
              : <ContactsTable rows={calc.contacts} showClient={!client} />}
          </section>

          <details className="text-xs text-ink-muted">
            <summary className="cursor-pointer">Cómo se calcula y de dónde salen los datos</summary>
            <div className="mt-2 space-y-1.5 leading-relaxed">
              <p>Se leen los informes de <b>Pulso ABM</b> de los clientes activos en la Maestra (se sincronizan con HubSpot cada día). Empresa asignada = su propiedad «SDR - &lt;cliente&gt;» es este SDR; contacto asignado = su «SDR Asignado - &lt;cliente&gt;» o, si está vacío, el SDR de su empresa.</p>
              <p><b>Cuenta estancada</b> = empresa en «Asignada» {STALE_BUSINESS_DAYS} días hábiles o más (lunes a viernes sin feriados de Chile) desde su fecha de asignación en HubSpot; si el HubSpot del cliente no tiene la propiedad «Fecha de asignación», se usa la fecha de creación de la empresa. Cada semana llega un correo al SDR con su lista y a su líder con el resumen de la célula.</p>
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

function Tile({ label, value, sub, alert }: { label: string; value: number; sub?: string; alert?: boolean }) {
  return (
    <div className={`card py-3 ${alert ? "border-warning-fg/40 bg-warning-bg/40" : ""}`}>
      <div className="text-xs text-ink-muted">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${alert ? "text-warning-fg" : ""}`}>{fmt(value)}</div>
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

function SearchBox({ q, setQ, placeholder }: { q: string; setQ: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <IconSearch size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle" />
      <input className="input pl-8 min-w-[240px]" type="search" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
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
    <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
      <option value="">Todos los status</option>
      {counts.map(([s, n]) => <option key={s} value={s}>{s} ({fmt(n)})</option>)}
    </select>
  );
}

function CompaniesTable({ rows, days, showClient, onlyStale, setOnlyStale }: {
  rows: SdrCompany[]; days: Map<string, number | null>; showClient: boolean; onlyStale: boolean; setOnlyStale: (v: boolean) => void;
}) {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [sort, toggle] = useSort({ k: "days", dir: -1 });
  const list = useMemo(() => {
    const nq = norm(q.trim());
    const f = rows.filter((r) =>
      (!status || r.st === status) &&
      (!nq || norm(`${r.n} ${r.pais} ${r.ind ?? ""}`).includes(nq)) &&
      (!onlyStale || (days.get(r.id) ?? -1) >= STALE_BUSINESS_DAYS)
    );
    return sortRows(f, sort, (r, k) => {
      switch (k) {
        case "days": return days.get(r.id) ?? -1;
        case "nct": return r.nct;
        case "nmg": return r.nmg;
        case "msch": return r.msch;
        default: return (r as unknown as Record<string, string>)[k] ?? "";
      }
    });
  }, [rows, status, q, onlyStale, sort, days]);
  const th = (k: string, l: string, n?: boolean) => <Th n={n} onClick={() => toggle(k)} active={sort.k === k} dir={sort.dir}>{l}</Th>;
  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <StatusSelect rows={rows} status={status} setStatus={setStatus} />
        <SearchBox q={q} setQ={setQ} placeholder="Empresa, país o industria" />
        <label className="flex items-center gap-1.5 text-sm text-ink-muted">
          <input type="checkbox" checked={onlyStale} onChange={(e) => setOnlyStale(e.target.checked)} /> Solo estancadas ({STALE_BUSINESS_DAYS}+ días hábiles en Asignada)
        </label>
        <span className="text-xs text-ink-muted ml-auto">{fmt(list.length)} empresas{list.length > MAX_ROWS ? ` (se muestran ${MAX_ROWS})` : ""}</span>
      </div>
      <div className="overflow-auto max-h-[560px] border rounded-lg">
        <table className="w-full text-sm">
          <thead className="text-xs text-ink-muted bg-white sticky top-0 shadow-[0_1px_0_rgba(0,0,0,0.06)]">
            <tr>
              {th("n", "Empresa")}{showClient && th("c", "Cliente")}{th("pais", "País")}{th("st", "Status de la asignación")}
              {th("asg", "Asignada el")}{th("days", "Días hábiles en Asignada", true)}{th("nct", "Contactos", true)}{th("nmg", "Gestionados", true)}{th("msch", "Reuniones", true)}
            </tr>
          </thead>
          <tbody>
            {list.slice(0, MAX_ROWS).map((r) => {
              const d = days.get(r.id);
              const stale = (d ?? -1) >= STALE_BUSINESS_DAYS;
              return (
                <tr key={r.id} className={`border-t ${stale ? "bg-warning-bg/30" : ""}`}>
                  <td className="px-3 py-2 font-medium">{r.n}{r.ind && <div className="text-xs font-normal text-ink-muted">{r.ind}</div>}</td>
                  {showClient && <td className="px-3 py-2">{r.c}</td>}
                  <td className="px-3 py-2">{r.pais || "—"}</td>
                  <td className="px-3 py-2"><Pill st={r.st} /></td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDay(r.asg || null)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${stale ? "text-warning-fg font-semibold" : ""}`}>{d == null ? "—" : fmt(d)}</td>
                  <Td n>{r.nct}</Td><Td n>{r.nmg}</Td><Td n>{r.msch}</Td>
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
            <tr>{th("n", "Contacto")}{th("cargo", "Cargo")}{th("con", "Empresa")}{showClient && th("c", "Cliente")}{th("st", "Status")}</tr>
          </thead>
          <tbody>
            {list.slice(0, MAX_ROWS).map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2 font-medium">{r.n}</td>
                <td className="px-3 py-2">{r.cargo || "—"}</td>
                <td className="px-3 py-2">{r.con || "—"}</td>
                {showClient && <td className="px-3 py-2">{r.c}</td>}
                <td className="px-3 py-2"><Pill st={r.st} /></td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={5} className="px-3 py-4 text-ink-muted">Sin contactos con estos filtros.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
