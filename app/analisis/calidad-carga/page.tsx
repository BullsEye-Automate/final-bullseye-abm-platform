"use client";

// Calidad de carga: contactos que prospección importa al HubSpot del cliente
// (insumo de los SDR). Calce con el ICP, teléfonos, calidad de la información
// y probabilidad de agendamiento. Cálculo en lib/calidadCarga/report.ts.
import { Fragment, useEffect, useMemo, useState } from "react";
import { IconDatabaseImport, IconLoader2, IconAlertCircle, IconRefresh, IconChevronDown, IconChevronUp, IconInfoCircle } from "@tabler/icons-react";
import { useClient } from "@/lib/clientContext";
import type { CargaContact, CargaLoad, CargaReport, CompanyStatusCount } from "@/lib/calidadCarga/report";

// Desplegable con el "Status de la asignación" de las empresas de una carga
function CompanyStatuses({ list, companies, inline }: { list: CompanyStatusCount[]; companies: number; inline?: boolean }) {
  const max = Math.max(1, ...list.map((x) => x.companies));
  return (
    <details className={inline ? "text-xs" : "card p-4"} onClick={(e) => e.stopPropagation()}>
      <summary className={`cursor-pointer select-none ${inline ? "text-brand whitespace-nowrap" : "text-sm font-medium"}`}>
        {inline ? `${companies} empresas` : `Status de la asignación de las empresas cargadas · ${companies} empresas`}
      </summary>
      <div className={`${inline ? "absolute z-10 mt-1 w-80 card p-3 shadow-lg" : "mt-3"} space-y-1.5`}>
        {list.length ? list.map((x) => (
          <div key={x.status} className="grid grid-cols-[minmax(0,1fr)_90px_36px] gap-2 items-center text-xs">
            <span className="truncate" title={x.status}>{x.status}</span>
            {x.companies ? <span className="h-2 rounded bg-black/[0.06] overflow-hidden"><span className="block h-full bg-brand" style={{ width: `${(x.companies / max) * 100}%` }} /></span> : <span />}
            <span className="text-right font-medium">{x.companies || ""}</span>
          </div>
        )) : <div className="text-xs text-ink-muted">Sin empresas asociadas.</div>}
      </div>
    </details>
  );
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const pc1 = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")}%`;
const n1 = (x: number) => x.toFixed(1).replace(".", ",");
const dmy = (d: string) => (d && d !== "total" ? d.split("-").reverse().join("-") : d);
const BAND: Record<string, { label: string; cls: string }> = {
  calza: { label: "Calza", cls: "bg-emerald-100 text-emerald-900" },
  parcial: { label: "Parcial", cls: "bg-amber-100 text-amber-900" },
  no_calza: { label: "No calza", cls: "bg-red-100 text-red-900" },
  sin_cargo: { label: "Sin cargo", cls: "bg-gray-200 text-gray-800" },
  sin_icp: { label: "Sin ICP", cls: "bg-gray-100 text-gray-700" },
};
const qCls = (q: number) => (q >= 75 ? "text-emerald-700" : q >= 55 ? "text-amber-700" : "text-red-700");

function Kpi({ k, v, d }: { k: string; v: string; d?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-ink-muted">{k}</div>
      <div className="text-2xl font-semibold mt-1">{v}</div>
      {d && <div className="text-xs text-ink-muted mt-1">{d}</div>}
    </div>
  );
}

function ContactsTable({ rows }: { rows: CargaContact[] }) {
  const [band, setBand] = useState("");
  const [q, setQ] = useState("");
  const shown = rows.filter((c) => (!band || c.band === band) && (!q || `${c.name} ${c.company} ${c.title}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="p-3 bg-black/[0.02]">
      <div className="flex flex-wrap gap-2 mb-2">
        <input className="input text-xs flex-1 min-w-[180px]" placeholder="Buscar contacto, empresa o cargo…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input text-xs w-44" value={band} onChange={(e) => setBand(e.target.value)}>
          <option value="">Todos los calces</option>
          {Object.entries(BAND).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <span className="text-xs text-ink-muted self-center">{shown.length} contactos</span>
      </div>
      <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-ink-muted sticky top-0 bg-white">
            <tr><th className="py-1.5 pr-2">Contacto</th><th className="pr-2">Empresa</th><th className="pr-2">Cargo</th><th className="pr-2">Calce ICP</th><th className="pr-2 text-right">Teléfonos</th><th className="pr-2">Correo / LinkedIn</th><th className="pr-2 text-right">Calidad</th><th className="pr-2 text-right">Prob.</th><th className="pr-2">Estado actual</th><th>Status empresa</th></tr>
          </thead>
          <tbody>
            {shown.slice(0, 400).map((c) => (
              <tr key={c.id} className="border-t border-[#ECEAF4] align-top">
                <td className="py-1.5 pr-2 font-medium">{c.name}</td>
                <td className="pr-2">{c.company || "—"}</td>
                <td className="pr-2">{c.title || <span className="text-ink-muted">sin cargo</span>}</td>
                <td className="pr-2" title={c.reason}>
                  <span className={`inline-block px-1.5 py-0.5 rounded ${BAND[c.band].cls}`}>{BAND[c.band].label}{c.fit != null ? ` · ${c.fit}` : ""}</span>
                </td>
                <td className="pr-2 text-right" title={c.phoneSources.join(", ")}>{c.phones}{c.lemlist ? " · L" : ""}</td>
                <td className="pr-2">{c.email ? "✓" : "—"} / {c.linkedin ? "✓" : "—"}</td>
                <td className={`pr-2 text-right font-semibold ${qCls(c.quality)}`}>{c.quality}</td>
                <td className="pr-2 text-right">{pc1(c.prob)}</td>
                <td className="pr-2">{c.status || <span className="text-ink-muted">sin estado</span>}</td>
                <td>{c.companyStatus || <span className="text-ink-muted">{c.companyId ? "sin status" : "sin empresa"}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length > 400 && <p className="text-xs text-ink-muted mt-2">Se muestran 400 de {shown.length}.</p>}
      </div>
    </div>
  );
}

export default function CalidadCargaPage() {
  const { currentClient } = useClient();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<CargaReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const clientId = currentClient?.id && currentClient.id !== "__all__" ? currentClient.id : null;

  const load = async (fresh = false) => {
    if (!clientId) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/calidad-carga?client_id=${clientId}&days=${days}${fresh ? "&fresh=1" : ""}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `Error ${res.status}`);
      setData(d);
    } catch (e) {
      setError((e as Error).message); setData(null);
    } finally {
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setData(null); setOpen(null); load(); }, [clientId, days]);

  const t = data?.totals;
  const byDay = useMemo(() => {
    const m = new Map<string, CargaContact[]>();
    for (const c of data?.contacts ?? []) m.set(c.day, [...(m.get(c.day) ?? []), c]);
    return m;
  }, [data]);

  const row = (l: CargaLoad, isTotal = false) => (
    <>
      <td className="py-2 pr-2 font-medium">{isTotal ? "Total del período" : dmy(l.day)}</td>
      <td className="pr-2 text-right">{l.contacts}</td>
      <td className="pr-2 text-right font-semibold">{data?.hasIcp ? pct(l.calza, l.contacts) : "—"}</td>
      <td className="pr-2 text-right">{data?.hasIcp ? pct(l.parcial, l.contacts) : "—"}</td>
      <td className="pr-2 text-right">{pct(l.withPhone, l.contacts)}</td>
      <td className="pr-2 text-right">{n1(l.phonesAvg)}</td>
      <td className="pr-2 text-right">{pct(l.withLemlist, l.contacts)}</td>
      <td className="pr-2 text-right">{pct(l.withEmail, l.contacts)}</td>
      <td className={`pr-2 text-right font-semibold ${qCls(l.quality)}`}>{l.quality}</td>
      <td className="pr-2 text-right">{pc1(l.prob)}</td>
      <td className="pr-2 text-right">{n1(l.expectedMeetings)}</td>
      <td className="pr-2 text-right">{pct(l.contacted, l.contacts)}</td>
      <td className="pr-2 text-right">{l.meetings}</td>
      <td className="pr-2 relative"><CompanyStatuses list={l.companyStatuses} companies={l.companies} inline /></td>
    </>
  );

  return (
    <div className="space-y-6 max-w-7xl">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="label">Reportería</div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <IconDatabaseImport size={24} className="text-brand" /> Calidad de carga
          </h1>
          <p className="text-sm text-ink-muted mt-1 max-w-3xl">
            Contactos que prospección cargó (importó) al HubSpot del cliente: cuántos calzan con el ICP, cuántos teléfonos traen, la calidad de la información y su probabilidad de llegar a reunión.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select className="input text-sm w-40" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>Últimos {d} días</option>)}
          </select>
          <button onClick={() => load(true)} disabled={loading || !clientId} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border hover:bg-black/5 transition disabled:opacity-50">
            {loading ? <IconLoader2 size={15} className="animate-spin" /> : <IconRefresh size={15} />} Actualizar
          </button>
        </div>
      </header>

      {!clientId && <div className="card p-4 text-sm text-ink-muted">Elige un cliente en el selector de arriba.</div>}
      {error && (
        <div className="flex items-center gap-2 text-error-fg text-sm p-3 rounded bg-error-bg/20 border border-error-bg">
          <IconAlertCircle size={16} className="shrink-0" /> {error}
        </div>
      )}
      {loading && !data && clientId && (
        <div className="card p-4 flex items-center gap-2 text-sm text-ink-muted"><IconLoader2 size={16} className="animate-spin" /> Leyendo los contactos cargados en HubSpot y evaluando los cargos… (la primera vez puede tardar 1–2 minutos)</div>
      )}

      {data && t && (
        <>
          {data.warnings.length > 0 && (
            <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded p-3 space-y-1">{data.warnings.map((w, i) => <div key={i}>{w}</div>)}</div>
          )}
          <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Kpi k="Contactos cargados" v={String(t.contacts)} d={`${data.loads.length} cargas en ${days} días`} />
            <Kpi k="Calzan con el ICP" v={data.hasIcp ? pct(t.calza, t.contacts) : "—"} d={data.hasIcp ? `${t.calza} contactos · ${pct(t.parcial, t.contacts)} parcial` : "sin ICP cargado"} />
            <Kpi k="Con teléfono" v={pct(t.withPhone, t.contacts)} d={`${n1(t.phonesAvg)} teléfonos por contacto`} />
            <Kpi k="Con teléfono Lemlist" v={pct(t.withLemlist, t.contacts)} d={`${t.withLemlist} contactos`} />
            <Kpi k="Calidad promedio" v={`${t.quality}/100`} d={`correo ${pct(t.withEmail, t.contacts)} · LinkedIn ${pct(t.withLinkedin, t.contacts)}`} />
            <Kpi k="Prob. de agendamiento" v={pc1(t.prob)} d={`≈ ${n1(t.expectedMeetings)} reuniones esperadas · ${t.meetings} a la fecha`} />
          </section>

          {data.companyStatusProp && <CompanyStatuses list={t.companyStatuses} companies={t.companies} />}

          <section className="card">
            <div className="px-4 pt-4 pb-2 text-sm font-medium">Por carga (día de importación)</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-ink-muted border-b border-[#ECEAF4]">
                  <tr>
                    <th className="py-2 px-2">Carga</th><th className="pr-2 text-right">Contactos</th><th className="pr-2 text-right">Calzan ICP</th><th className="pr-2 text-right">Parcial</th>
                    <th className="pr-2 text-right">Con teléfono</th><th className="pr-2 text-right">Tel./contacto</th><th className="pr-2 text-right">Tel. Lemlist</th><th className="pr-2 text-right">Correo</th>
                    <th className="pr-2 text-right">Calidad</th><th className="pr-2 text-right">Prob. reunión</th><th className="pr-2 text-right">Reuniones esperadas</th>
                    <th className="pr-2 text-right">Contactados</th><th className="pr-2 text-right">Reuniones</th><th className="pr-2">Status empresas</th><th />
                  </tr>
                </thead>
                <tbody>
                  {data.loads.map((l) => (
                    <Fragment key={l.day}>
                      <tr className="border-b border-[#ECEAF4] cursor-pointer hover:bg-black/[0.02] [&>td:first-child]:pl-2" onClick={() => setOpen(open === l.day ? null : l.day)}>
                        {row(l)}
                        <td className="pr-2">{open === l.day ? <IconChevronUp size={15} /> : <IconChevronDown size={15} />}</td>
                      </tr>
                      {open === l.day && <tr><td colSpan={15}><ContactsTable rows={byDay.get(l.day) ?? []} /></td></tr>}
                    </Fragment>
                  ))}
                  <tr className="bg-black/[0.03] font-medium [&>td:first-child]:pl-2">{row(t, true)}<td /></tr>
                </tbody>
              </table>
              {!data.loads.length && <p className="text-sm text-ink-muted p-4">Sin contactos importados en el período.</p>}
            </div>
          </section>

          <section className="grid md:grid-cols-2 gap-4">
            <div className="card p-4">
              <div className="text-sm font-medium mb-1">Probabilidad de agendamiento según el historial</div>
              <p className="text-xs text-ink-muted mb-3">
                Contactos importados de este cliente hace 1 a 6 meses ({data.history.contacts}): {data.history.meetings} llegaron a "Reunión Agendada" ({pc1(data.history.rate)}). Cada contacto nuevo toma la tasa de su segmento (con al menos 25 casos).
              </p>
              <table className="w-full text-xs">
                <thead className="text-left text-ink-muted"><tr><th className="py-1">Segmento</th><th className="text-right">Contactos</th><th className="text-right">Reuniones</th><th className="text-right">Tasa</th></tr></thead>
                <tbody>
                  {data.history.segments.map((s) => (
                    <tr key={s.key} className={`border-t border-[#ECEAF4] ${s.n < 25 ? "text-ink-muted" : ""}`}><td className="py-1">{s.label}</td><td className="text-right">{s.n}</td><td className="text-right">{s.meetings}</td><td className="text-right font-medium">{pc1(s.rate)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card p-4">
              <div className="text-sm font-medium mb-1">Teléfonos por fuente</div>
              <p className="text-xs text-ink-muted mb-3">Contactos del período con un número en cada campo (un mismo número repetido en dos campos cuenta una vez por contacto). Campos revisados: {data.phoneProps.join(", ")}.</p>
              <table className="w-full text-xs">
                <tbody>
                  {data.phoneSources.map((s) => (
                    <tr key={s.label} className="border-t border-[#ECEAF4]"><td className="py-1">{s.label}</td><td className="text-right">{s.contacts}</td><td className="text-right text-ink-muted w-16">{pct(s.contacts, t.contacts)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <details className="card p-4 text-xs text-ink-muted">
            <summary className="cursor-pointer text-sm text-ink flex items-center gap-1.5"><IconInfoCircle size={15} /> Cómo se calcula</summary>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li><b>Contactos cargados:</b> contactos creados por importación en HubSpot{data.statusProp ? "" : ""} del cliente (campo "Cliente BullsEye"), agrupados por día de carga (hora de Chile). Los registros que la importación solo actualizó no se cuentan.</li>
              <li><b>Calce con el ICP:</b> la IA evalúa el cargo frente al ICP y buyer persona del cliente (la misma evaluación de Contactos IA). Calza = 60 o más; parcial = 40 a 59.</li>
              <li><b>Teléfonos:</b> números distintos por contacto entre {data.phoneProps.join(", ")}. "L" en la lista = trae teléfono Lemlist.</li>
              <li><b>Calidad (0–100):</b> calce ICP 35 (parcial 17), teléfono 30, correo 15, LinkedIn 10, empresa asociada 10.</li>
              <li><b>Probabilidad de agendamiento:</b> tasa histórica de "Reunión Agendada" en {data.statusProp ?? "el estado del contacto"} de cargas anteriores del cliente, por segmento. Reuniones esperadas = suma de las probabilidades.</li>
              <li><b>Contactados / Reuniones:</b> avance real a la fecha según el estado del contacto en HubSpot.</li>
            </ul>
            <div className="mt-2">Calculado {new Date(data.generatedAt).toLocaleString("es-CL")} · se guarda 6 h ("Actualizar" recalcula).</div>
          </details>
        </>
      )}
    </div>
  );
}
