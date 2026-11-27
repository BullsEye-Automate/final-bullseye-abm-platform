"use client";

import { useEffect, useMemo, useState } from "react";
import { IconLoader2, IconRefresh, IconAlertTriangle } from "@tabler/icons-react";
import { useClient } from "@/lib/clientContext";

// Centro de prospección → «Contactos receptivos» (pedido de la reunión de líderes
// 26-nov-2026): personas que ya mostraron disposición a reunirse con BullsEye (por
// cualquier cliente) y que calzan con el ICP del cliente elegido. La prospectora
// valida y las carga al HubSpot; llegan al SDR en la lista diaria de las 18:00.
// Nunca muestra correo ni teléfono, y no dice al SDR para qué cliente fue la reunión anterior.

type Sig = { label: string; d: string; withOther: boolean };
type Sug = {
  key: string; name: string | null; title: string | null; company: string | null; domain: string | null; country: string | null;
  linkedin: string | null; hasMobile: boolean; hasEmail: boolean; score: number; titleFit: number; companyFit: number; companyReason: string;
  signals: Sig[]; competitor: { client: string; reason: string } | null; inPortfolio: boolean;
  decision?: { st: "cargado" | "descartado"; by: string; at: string; motivo?: string | null } | null;
};
type Data = {
  at: string; clientName: string; hasIcp: boolean;
  stats: { receptiveTotal: number; candidates: number; excluded: number; alreadyThisClient: number; noTitle: number; titleFit: number; titlePartial: number; final: number; bySignal: { label: string; n: number }[]; byCountry: { label: string; n: number }[]; withCompetitor: number; inPortfolio: number };
  suggestions: Sug[];
};
type Summary = { clientId: string; clientName: string; final: number; pending: number; loaded: number; at: string };

const n = (x: number) => x.toLocaleString("es-CL");
const fmt = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "2-digit" });

function Kpi({ label, value, sub, hl }: { label: string; value: string; sub?: string; hl?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${hl ? "border-[#62E0D8] bg-[#62E0D8]/10" : "border-gray-100 bg-white"}`}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-2xl font-semibold text-[#251762] mt-1">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

export default function ReceptivosPanel() {
  const { currentClient, clients, setCurrentClient } = useClient();
  const clientId = currentClient?.id && currentClient.id !== "__all__" ? currentClient.id : null;
  const [data, setData] = useState<Data | null>(null);
  const [sums, setSums] = useState<Summary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"pend" | "cargado" | "descartado">("pend");
  const [busy, setBusy] = useState<string | null>(null);

  async function load(fresh = false) {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/centro/receptivos${clientId ? `?client_id=${clientId}${fresh ? "&fresh=1" : ""}` : ""}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo cargar");
      if (clientId) setData(j); else setSums(j.summaries ?? []);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }
  useEffect(() => { setData(null); setSums(null); load(); }, [clientId]);

  async function act(s: Sug, action: "cargar" | "descartar") {
    let motivo: string | null = null;
    if (action === "descartar") { motivo = window.prompt("¿Por qué no sirve? (opcional)") ?? null; }
    setBusy(s.key);
    try {
      const r = await fetch("/api/centro/receptivos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: clientId, key: s.key, action, motivo }) });
      const j = await r.json();
      if (!r.ok || j.ok === false) throw new Error(j.error ?? "No se pudo");
      setData((d) => d && ({ ...d, suggestions: d.suggestions.map((x) => x.key === s.key ? { ...x, decision: { st: action === "cargar" ? "cargado" : "descartado", by: "tú", at: new Date().toISOString(), motivo } } : x) }));
    } catch (e) { setError(`${s.name ?? "Contacto"}: ${(e as Error).message}`); } finally { setBusy(null); }
  }

  const list = useMemo(() => (data?.suggestions ?? []).filter((s) => (view === "pend" ? !s.decision : s.decision?.st === view)), [data, view]);
  const counts = useMemo(() => {
    const s = data?.suggestions ?? [];
    return { pend: s.filter((x) => !x.decision).length, cargado: s.filter((x) => x.decision?.st === "cargado").length, descartado: s.filter((x) => x.decision?.st === "descartado").length };
  }, [data]);

  return (
    <div className="space-y-5 max-w-[1640px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-[#251762]">Contactos receptivos</h2>
          <p className="text-sm text-gray-500 max-w-3xl">
            Personas que en los últimos 12 meses tuvieron o agendaron una reunión con BullsEye, respondieron con interés o conversaron por teléfono
            (por cualquier cliente) y que calzan con el ICP del cliente elegido: cargo y empresa. Valídalas y cárgalas: llegan al SDR en la lista diaria de las 18:00.
          </p>
        </div>
        {clientId && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            {data && <span>Calculado: {new Date(data.at).toLocaleString("es-CL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
            <button onClick={() => load(true)} disabled={loading} className="border border-gray-200 rounded-lg px-2 py-1 flex items-center gap-1 disabled:opacity-50"><IconRefresh size={14} /> Recalcular</button>
          </div>
        )}
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 rounded-xl px-4 py-2">{error}</div>}
      {loading && <div className="text-sm text-gray-600 flex items-center gap-2"><IconLoader2 size={14} className="animate-spin" /> {clientId ? "Calculando (la primera vez de la semana puede tardar 1–3 minutos)…" : "Cargando…"}</div>}

      {!clientId && sums && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
          <div className="px-4 pt-3 text-sm font-semibold text-[#251762]">Clientes calculados esta semana</div>
          <p className="px-4 text-xs text-gray-500">Elige un cliente en el selector de arriba para ver sus sugerencias. Se calculan solos los lunes de madrugada.</p>
          <table className="w-full text-sm mt-2">
            <thead className="text-left text-xs text-gray-500 border-b border-gray-100"><tr><th className="p-2">Cliente</th><th className="p-2">Sugeridos</th><th className="p-2">Por revisar</th><th className="p-2">Cargados</th></tr></thead>
            <tbody>
              {sums.map((s) => (
                <tr key={s.clientId} className="border-b border-gray-50 cursor-pointer hover:bg-gray-50" onClick={() => { const c = clients.find((x) => x.id === s.clientId); if (c) setCurrentClient(c); }}>
                  <td className="p-2 text-[#251762] underline">{s.clientName}</td><td className="p-2">{n(s.final)}</td><td className="p-2">{n(s.pending)}</td><td className="p-2">{n(s.loaded)}</td>
                </tr>
              ))}
              {!sums.length && <tr><td colSpan={4} className="p-3 text-gray-500">Aún no hay clientes calculados esta semana.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {clientId && data && (
        <>
          {!data.hasIcp && <div className="text-sm bg-amber-50 text-amber-800 rounded-xl px-4 py-2">{data.clientName} no tiene ICP cargado en el portal: sin ICP no se puede filtrar.</div>}
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-6">
            <Kpi label="Receptivos en toda la base" value={n(data.stats.receptiveTotal)} sub="Últimos 12 meses, todos los clientes" />
            <Kpi label="Ya trabajados para este cliente" value={n(data.stats.alreadyThisClient)} sub="No se sugieren" />
            <Kpi label="Cargo calza con el buyer persona" value={n(data.stats.titleFit)} sub={`${n(data.stats.titlePartial)} con calce parcial`} />
            <Kpi label="Sugeridos (cargo + empresa en ICP)" value={n(data.stats.final)} hl />
            <Kpi label="En cuentas que ya trabajamos" value={n(data.stats.inPortfolio)} sub="Contacto nuevo en una cuenta de la cartera" />
            <Kpi label="Con aviso de competencia" value={n(data.stats.withCompetitor)} sub="Conversó por un cliente que podría competir" />
          </div>
          {(data.stats.bySignal.length > 0 || data.stats.byCountry.length > 0) && (
            <div className="text-xs text-gray-500">
              {data.stats.bySignal.map((x) => `${x.label}: ${n(x.n)}`).join(" · ")}
              {data.stats.byCountry.length > 0 && <> &nbsp;|&nbsp; {data.stats.byCountry.map((x) => `${x.label}: ${n(x.n)}`).join(" · ")}</>}
              {data.stats.noTitle > 0 && <> &nbsp;|&nbsp; {n(data.stats.noTitle)} sin cargo o empresa conocidos (no se pueden evaluar)</>}
            </div>
          )}

          <div className="flex gap-2 text-sm">
            {(["pend", "cargado", "descartado"] as const).map((k) => (
              <button key={k} onClick={() => setView(k)} className={`px-3 py-1.5 rounded-lg border ${view === k ? "border-[#251762] bg-[#251762] text-white" : "border-gray-200"}`}>
                {k === "pend" ? "Por revisar" : k === "cargado" ? "Cargados" : "Descartados"} ({counts[k]})
              </button>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500 border-b border-gray-100">
                <tr><th className="p-2">Persona</th><th className="p-2">Empresa</th><th className="p-2">Por qué es receptivo</th><th className="p-2">Calce ICP</th><th className="p-2">Datos</th><th className="p-2"></th></tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.key} className="border-b border-gray-50 align-top">
                    <td className="p-2">
                      {s.linkedin ? <a href={s.linkedin} target="_blank" rel="noopener" className="text-[#251762] underline">{s.name ?? "Sin nombre"}</a> : s.name ?? "Sin nombre"}
                      <div className="text-xs text-gray-500">{s.title}</div>
                    </td>
                    <td className="p-2">{s.company}<div className="text-xs text-gray-400">{[s.domain, s.country].filter(Boolean).join(" · ")}</div>
                      {s.inPortfolio && <div className="text-[11px] text-[#0b7f78]">Cuenta ya en la cartera del cliente</div>}
                    </td>
                    <td className="p-2 text-xs">
                      {s.signals.slice(0, 3).map((g, i) => <div key={i}>{g.label} · {fmt(g.d)}{g.withOther ? " (otro cliente)" : ""}</div>)}
                      {s.competitor && <div className="mt-1 text-amber-700 flex gap-1"><IconAlertTriangle size={13} className="shrink-0 mt-0.5" /> Conversó por {s.competitor.client}, que podría competir: {s.competitor.reason}. Que lo decida el KAM.</div>}
                    </td>
                    <td className="p-2 text-xs"><div>Cargo {s.titleFit}</div><div title={s.companyReason}>Empresa {s.companyFit}</div></td>
                    <td className="p-2 text-xs whitespace-nowrap">{s.hasMobile ? "📱 Celular" : "Sin celular"}<br />{s.hasEmail ? "✉️ Correo" : "Sin correo"}</td>
                    <td className="p-2 text-xs whitespace-nowrap">
                      {s.decision ? (
                        <span className="text-gray-500">{s.decision.st === "cargado" ? "Cargado" : "Descartado"} · {s.decision.by}{s.decision.motivo ? ` · ${s.decision.motivo}` : ""}</span>
                      ) : (
                        <div className="flex gap-1">
                          <button disabled={busy === s.key} onClick={() => act(s, "cargar")} className="bg-[#251762] text-white rounded-lg px-2 py-1 disabled:opacity-50">{busy === s.key ? "…" : "Cargar a HubSpot"}</button>
                          <button disabled={busy === s.key} onClick={() => act(s, "descartar")} className="border border-gray-200 rounded-lg px-2 py-1">Descartar</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {!list.length && <tr><td colSpan={6} className="p-3 text-gray-500">No hay contactos en esta vista.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500">
            Al llamar, el SDR no debe mencionar para qué cliente fue la conversación anterior. Cargar no pisa los datos del contacto en HubSpot: solo lo crea si no existe, lo asocia a su empresa y le agrega el cliente en «Cliente BullsEye».
          </p>
        </>
      )}
    </div>
  );
}
