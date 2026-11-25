"use client";

import { useEffect, useState } from "react";
import { IconLoader2, IconRefresh, IconSearch } from "@tabler/icons-react";

// Centro de prospección → Base de contactos (nov-2026): universo de celulares
// y correos que ya tenemos en los HubSpot de BullsEye y de los clientes, y el
// ahorro de créditos de Lemlist si se reutilizan (lib/baseContactos/).

type Count = { label: string; total: number; mobile: number; maybe: number; email: number };
type Summary = {
  at: string; total: number; mobile: number; maybe: number; email: number; linkedin: number; multiSource: number; mobileOrEmail: number;
  byCountry: Count[]; bySource: Count[]; byClient: Count[];
  back: { days: number; hubspotDuplicates: number; portalEnrich: number; portalEnrichTotal: number };
  forward: { companies: number; companiesWithPeople: number; people: number; byClient: { client: string; companies: number; people: number }[] };
  sync: { passStartedAt: string | null; passFinishedAt: string | null; sources: { key: string; label: string; count: number; done: boolean; error?: string | null }[] };
  costs: { phone: number; email: number; usdPerCredit: number };
};
type Hit = { name: string | null; title: string | null; company: string | null; domain: string | null; country: string | null; linkedin: string | null; hasEmail: boolean; mobiles: string[]; maybe: string[]; clients: string[]; sources: string[] };

const n = (x: number) => x.toLocaleString("es-CL");
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const usd = (credits: number, rate: number) => `US$ ${(credits * rate).toLocaleString("es-CL", { maximumFractionDigits: 0 })}`;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-CL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

function Kpi({ label, value, sub, hl }: { label: string; value: string; sub?: string; hl?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${hl ? "border-[#62E0D8] bg-[#62E0D8]/10" : "border-gray-100 bg-white"}`}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-2xl font-semibold text-[#251762] mt-1">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

function CountTable({ title, rows }: { title: string; rows: Count[] }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
      <div className="px-4 pt-3 text-sm font-semibold text-[#251762]">{title}</div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-gray-500 border-b border-gray-100">
          <tr><th className="p-3"></th><th className="p-3 text-right">Personas</th><th className="p-3 text-right">Con celular</th><th className="p-3 text-right" title="México: el formato no distingue celular de fijo">Posible celular</th><th className="p-3 text-right">Con correo</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-gray-50">
              <td className="p-3">{r.label}</td>
              <td className="p-3 text-right">{n(r.total)}</td>
              <td className="p-3 text-right font-semibold">{n(r.mobile)} <span className="text-[11px] text-gray-400">{pct(r.mobile, r.total)}</span></td>
              <td className="p-3 text-right">{r.maybe ? n(r.maybe) : "—"}</td>
              <td className="p-3 text-right">{n(r.email)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function BaseContactosPanel() {
  const [sum, setSum] = useState<Summary | null>(null);
  const [canSync, setCanSync] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);

  const load = async (fresh = false) => {
    setError(null);
    const j = await fetch(`/api/centro/base-contactos${fresh ? "?fresh=1" : ""}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({ error: "Sin respuesta" }));
    if (j.error) setError(j.error); else { setSum(j.summary); setCanSync(!!j.canSync); }
  };
  useEffect(() => { void load(); }, []);

  const sync = async (force: boolean) => {
    setBusy(force ? "Empezando una sincronización nueva (hasta 4 min)…" : "Sincronizando un tramo (hasta 4 min)…");
    const j = await fetch(`/api/centro/base-contactos${force ? "?force=1" : ""}`, { method: "POST" }).then((r) => r.json()).catch(() => ({ error: "Sin respuesta" }));
    setBusy(null);
    if (j.error) { setError(j.error); return; }
    await load(true);
  };

  const search = async () => {
    if (q.trim().length < 3) return;
    setHits(null);
    const j = await fetch(`/api/centro/base-contactos?q=${encodeURIComponent(q.trim())}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({ error: "Sin respuesta" }));
    if (j.error) setError(j.error); else setHits(j.results);
  };

  if (error && !sum) return <div className="card text-sm text-red-700 bg-red-50">{error}</div>;
  if (!sum) return <div className="card flex items-center gap-2 text-sm text-gray-500"><IconLoader2 size={16} className="animate-spin" /> Cargando la base de contactos…</div>;

  const c = sum.costs;
  const backCredits = (sum.back.hubspotDuplicates + sum.back.portalEnrich) * c.phone;
  const fwCredits = sum.forward.people * c.phone;
  const running = sum.sync.sources.some((s) => !s.done);

  return (
    <div className="space-y-5 max-w-[1640px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-[#251762]">Base de contactos</h2>
          <p className="text-sm text-gray-500 max-w-3xl">
            Personas con teléfono en los HubSpot de BullsEye y de los clientes, unidas en una sola fila por persona (por LinkedIn o correo).
            Solo cuentan los celulares: los fijos no sirven si la persona cambia de empresa. Se actualiza sola cada domingo con los contactos nuevos o modificados en la semana.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>Diagnóstico: {when(sum.at)}</span>
          <button onClick={() => load(true)} className="border border-gray-200 rounded-lg px-2 py-1 flex items-center gap-1"><IconRefresh size={14} /> Recalcular</button>
          {canSync && <button onClick={() => sync(false)} disabled={!!busy} className="border border-[#251762] text-[#251762] rounded-lg px-2 py-1">Sincronizar ahora</button>}
        </div>
      </div>

      {busy && <div className="text-sm text-gray-600 flex items-center gap-2"><IconLoader2 size={14} className="animate-spin" /> {busy}</div>}
      {error && <div className="text-sm text-red-700 bg-red-50 rounded-xl px-4 py-2">{error}</div>}
      {running && (
        <div className="text-sm bg-amber-50 text-amber-800 rounded-xl px-4 py-2">
          La primera lectura de los HubSpot aún no termina: los números van a crecer. Avanza sola de noche{canSync ? " o con «Sincronizar ahora»" : ""}.
        </div>
      )}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-6">
        <Kpi label="Personas únicas" value={n(sum.total)} />
        <Kpi label="Con celular" value={n(sum.mobile)} sub={pct(sum.mobile, sum.total)} hl />
        <Kpi label="Posible celular (México)" value={n(sum.maybe)} sub="El formato no lo distingue" />
        <Kpi label="Con correo" value={n(sum.email)} sub={pct(sum.email, sum.total)} />
        <Kpi label="Con LinkedIn" value={n(sum.linkedin)} sub="Clave para reconocer a la persona" />
        <Kpi label="En más de un HubSpot" value={n(sum.multiSource)} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-gray-100 bg-white p-4">
          <div className="text-sm font-semibold text-[#251762]">Créditos que pudimos ahorrar (últimos {sum.back.days} días)</div>
          <div className="text-3xl font-semibold text-[#251762] mt-2">{n(backCredits)} créditos <span className="text-base text-gray-500">≈ {usd(backCredits, c.usdPerCredit)}</span></div>
          <ul className="text-sm text-gray-600 mt-2 space-y-1">
            <li><b>{n(sum.back.hubspotDuplicates)}</b> personas con teléfono revelado en Lemlist que ya tenían celular en otro registro anterior de HubSpot.</li>
            <li><b>{n(sum.back.portalEnrich)}</b> de {n(sum.back.portalEnrichTotal)} teléfonos pedidos desde Contactos IA eran de personas que ya teníamos con celular.</li>
          </ul>
          <p className="text-xs text-gray-400 mt-2">A {c.phone} créditos por teléfono y US$ {c.usdPerCredit} por crédito. Solo cuenta lo que quedó cargado en HubSpot.</p>
        </div>
        <div className="rounded-2xl border border-gray-100 bg-white p-4">
          <div className="text-sm font-semibold text-[#251762]">Ahorro posible en la cola actual</div>
          <div className="text-3xl font-semibold text-[#251762] mt-2">{n(fwCredits)} créditos <span className="text-base text-gray-500">≈ {usd(fwCredits, c.usdPerCredit)}</span></div>
          <p className="text-sm text-gray-600 mt-2">
            De {n(sum.forward.companies)} empresas aprobadas que esperan búsqueda de contactos, <b>{n(sum.forward.companiesWithPeople)}</b> ya tienen
            personas con celular en la base (<b>{n(sum.forward.people)}</b> personas, cruzadas por el dominio del correo).
          </p>
          {sum.forward.byClient.some((f) => f.people) && (
            <div className="text-xs text-gray-500 mt-2">{sum.forward.byClient.filter((f) => f.people).slice(0, 8).map((f) => `${f.client}: ${n(f.people)}`).join(" · ")}</div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
        <div className="text-sm font-semibold text-[#251762]">Buscar en la base</div>
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="Nombre, empresa, dominio o LinkedIn (mín. 3 letras)" className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm" />
          <button onClick={search} className="bg-[#251762] text-white rounded-xl px-4 py-2 text-sm flex items-center gap-1"><IconSearch size={15} /> Buscar</button>
        </div>
        {hits && (hits.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500 border-b border-gray-100">
                <tr><th className="p-2">Persona</th><th className="p-2">Empresa</th><th className="p-2">País</th><th className="p-2">Celular</th><th className="p-2">Correo</th><th className="p-2">Viene de</th></tr>
              </thead>
              <tbody>
                {hits.map((h, i) => (
                  <tr key={i} className="border-b border-gray-50 align-top">
                    <td className="p-2">{h.linkedin ? <a href={h.linkedin} target="_blank" rel="noopener" className="text-[#251762] underline">{h.name ?? "Sin nombre"}</a> : h.name ?? "Sin nombre"}<div className="text-xs text-gray-500">{h.title ?? ""}</div></td>
                    <td className="p-2">{h.company ?? "—"}<div className="text-xs text-gray-400">{h.domain ?? ""}</div></td>
                    <td className="p-2">{h.country ?? "—"}</td>
                    <td className="p-2 whitespace-nowrap">{h.mobiles.length ? h.mobiles.join(", ") : h.maybe.length ? <span className="text-gray-500">{h.maybe.join(", ")} (posible)</span> : "—"}</td>
                    <td className="p-2">{h.hasEmail ? "Sí" : "—"}</td>
                    <td className="p-2 text-xs">{h.sources.join(", ")}{h.clients.length ? <div className="text-gray-400">{h.clients.join(", ")}</div> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-gray-400 mt-1">El número completo no se muestra aquí: lo usará Contactos IA al aprobar, en la próxima etapa.</p>
          </div>
        ) : <div className="text-sm text-gray-500">No está en la base.</div>)}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <CountTable title="Por país" rows={sum.byCountry} />
        <CountTable title="Por HubSpot de origen" rows={sum.bySource} />
      </div>
      <CountTable title="Por cliente («Cliente BullsEye» del contacto)" rows={sum.byClient} />

      <details className="bg-white rounded-2xl border border-gray-100 p-4 text-sm">
        <summary className="cursor-pointer font-semibold text-[#251762]">Estado de la lectura de cada HubSpot</summary>
        <p className="text-xs text-gray-500 mt-2">Pasada iniciada {when(sum.sync.passStartedAt)} · terminada {when(sum.sync.passFinishedAt)}</p>
        <ul className="mt-2 space-y-1">
          {sum.sync.sources.map((s) => (
            <li key={s.key}>{s.label}: {n(s.count)} contactos leídos · {s.done ? (s.error ? <span className="text-red-700">error: {s.error}</span> : "listo") : "en curso"}</li>
          ))}
        </ul>
        {canSync && <button onClick={() => sync(true)} disabled={!!busy} className="mt-3 text-xs border border-gray-200 rounded-lg px-2 py-1">Empezar una lectura completa de nuevo</button>}
      </details>
    </div>
  );
}
