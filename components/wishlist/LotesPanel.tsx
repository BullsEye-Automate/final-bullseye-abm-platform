"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { IconLoader2, IconChevronDown, IconChevronRight } from "@tabler/icons-react";

// Lotes de carga de la wishlist de un cliente (lib/wishlistLotes.ts): de dónde
// vino cada empresa, en qué carga entró y cómo avanza cada lote. Lo usan
// Empresas (pestaña «Lotes de carga») y el Dashboard del Centro.

export type LotRow = {
  id: string; kind: string; kindLabel: string; name: string; country: string | null;
  by: string | null; at: string; file: string | null; note: string | null;
  empresas: number; pendientes: number; aprobadas: number; rechazadas: number; descartadas: number;
  conBusqueda: number; pocosContactos: number; contactosEncontrados: number; contactosAprobados: number;
};
export type LotsData = { lots: LotRow[]; byItem: Record<string, string> };

export const KIND_COLOR: Record<string, { bg: string; fg: string }> = {
  ia: { bg: "#EEF0FF", fg: "#3B3B98" },
  equipo: { bg: "#E6F7F5", fg: "#0B6E67" },
  cliente: { bg: "#FFF4E5", fg: "#9A5B00" },
  cliente_equipo: { bg: "#FDECEF", fg: "#9B2C48" },
  centro: { bg: "#F1F1F1", fg: "#444" },
};

export function LotBadge({ lot }: { lot: Pick<LotRow, "kind" | "kindLabel" | "name"> | undefined }) {
  if (!lot) return null;
  const c = KIND_COLOR[lot.kind] ?? KIND_COLOR.centro;
  return (
    <span title={lot.kindLabel} className="inline-block text-[11px] rounded px-1.5 py-0.5 max-w-full truncate align-middle" style={{ background: c.bg, color: c.fg }}>
      {lot.name}
    </span>
  );
}

// Carga los lotes del cliente (solo el equipo)
export function useLots(clientId: string | null | undefined, reloadKey = 0) {
  const [data, setData] = useState<LotsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!clientId) { setData(null); return; }
    let alive = true;
    setError(null);
    fetch(`/api/portal/wishlist/lotes?client_id=${clientId}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!alive) return;
        if (!r.ok || !j) setError(j?.error ?? "No se pudieron cargar los lotes");
        else setData(j as LotsData);
      })
      .catch(() => alive && setError("No se pudieron cargar los lotes"));
    return () => { alive = false; };
  }, [clientId, reloadKey]);
  const byId = useMemo(() => new Map((data?.lots ?? []).map((l) => [l.id, l])), [data]);
  return { data, error, byId };
}

// Selector de lote (filtro)
export function LotSelect({ lots, value, onChange, counts }: { lots: LotRow[]; value: string; onChange: (v: string) => void; counts?: Map<string, number> }) {
  if (!lots.length) return null;
  const shown = counts ? lots.filter((l) => (counts.get(l.id) ?? 0) > 0) : lots;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white max-w-full">
      <option value="">Todos los lotes</option>
      {shown.map((l) => (
        <option key={l.id} value={l.id}>{l.name}{counts ? ` (${counts.get(l.id) ?? 0})` : ` (${l.empresas})`}</option>
      ))}
    </select>
  );
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const day = (iso: string) => new Date(iso).toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "numeric" });

export default function LotesPanel({ clientId, items, compact = false }: {
  clientId: string;
  // Empresas de la wishlist para ver el detalle de cada lote (opcional)
  items?: { id: string; company_name: string; domain: string | null; status: string }[];
  compact?: boolean;
}) {
  const { data, error } = useLots(clientId);
  const [kind, setKind] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  if (error) return <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl">{error}</div>;
  if (!data) return <div className="flex items-center gap-2 text-sm text-gray-500"><IconLoader2 className="animate-spin" size={16} /> Cargando lotes…</div>;
  const lots = data.lots.filter((l) => !kind || l.kind === kind);
  const kinds = Array.from(new Map(data.lots.map((l) => [l.kind, l.kindLabel])).entries());
  const byLot = new Map<string, NonNullable<typeof items>>();
  for (const it of items ?? []) {
    const id = data.byItem[it.id];
    if (id) byLot.set(id, [...(byLot.get(id) ?? []), it]);
  }
  // Totales por origen
  const tot = (k: string) => data.lots.filter((l) => l.kind === k).reduce((s, l) => s + l.empresas, 0);

  return (
    <div className="space-y-4">
      {!compact && (
        <p className="text-sm text-gray-500 max-w-3xl">
          Cada carga de empresas queda como un lote, con su origen: recomendada por la IA, propuesta del equipo, listado del cliente
          (subido por él o cargado por el equipo) o pasada desde el Centro. El avance de cada lote muestra cuántas aprobó el cliente,
          a cuántas ya se les buscó contactos y cuántos contactos se aprobaron.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setKind("")} className={`text-xs rounded-full px-3 py-1 border ${!kind ? "border-[#251762] text-[#251762] font-medium" : "border-gray-200 text-gray-500"}`}>
          Todos ({data.lots.reduce((s, l) => s + l.empresas, 0)})
        </button>
        {kinds.map(([k, label]) => {
          const c = KIND_COLOR[k] ?? KIND_COLOR.centro;
          return (
            <button key={k} onClick={() => setKind(k === kind ? "" : k)} className="text-xs rounded-full px-3 py-1 border"
              style={{ background: kind === k ? c.bg : "white", color: c.fg, borderColor: kind === k ? c.fg : "#E5E7EB" }}>
              {label} ({tot(k)})
            </button>
          );
        })}
      </div>
      {!lots.length ? (
        <div className="text-sm text-gray-500 bg-gray-50 rounded-xl px-4 py-3">Este cliente aún no tiene empresas cargadas.</div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500 border-b border-gray-100">
              <tr>
                <th className="p-3">Lote</th>
                <th className="p-3">Cargado</th>
                <th className="p-3 text-right">Empresas</th>
                <th className="p-3 text-right" title="Esperando aprobación del cliente">Pendientes</th>
                <th className="p-3 text-right">Aprobadas</th>
                <th className="p-3 text-right">Rechazadas</th>
                <th className="p-3 text-right" title="Aprobadas a las que ya se les buscó contactos">Con contactos buscados</th>
                <th className="p-3 text-right">Contactos encontrados</th>
                <th className="p-3 text-right">Contactos aprobados</th>
              </tr>
            </thead>
            <tbody>
              {lots.map((l) => {
                const list = byLot.get(l.id) ?? [];
                const isOpen = open === l.id;
                return (
                  <Fragment key={l.id}>
                    <tr className="border-b border-gray-50 align-top">
                      <td className="p-3">
                        <button onClick={() => setOpen(isOpen ? null : l.id)} className="flex items-start gap-1 text-left" disabled={!list.length}>
                          {list.length ? (isOpen ? <IconChevronDown size={15} className="mt-0.5 shrink-0" /> : <IconChevronRight size={15} className="mt-0.5 shrink-0" />) : <span className="w-[15px]" />}
                          <span>
                            <LotBadge lot={l} />
                            <div className="text-xs text-gray-500 mt-1">{l.kindLabel}{l.file ? ` · ${l.file}` : ""}</div>
                            {l.note && <div className="text-xs text-gray-500 italic">{l.note}</div>}
                          </span>
                        </button>
                      </td>
                      <td className="p-3 text-xs text-gray-500 whitespace-nowrap">{day(l.at)}{l.by ? <div className="max-w-[200px] truncate" title={l.by}>{l.by.split(" · ")[0]}</div> : null}</td>
                      <td className="p-3 text-right font-semibold">{l.empresas}</td>
                      <td className="p-3 text-right">{l.pendientes || "—"}</td>
                      <td className="p-3 text-right">{l.aprobadas}<div className="text-[11px] text-gray-400">{pct(l.aprobadas, l.empresas - l.pendientes)}</div></td>
                      <td className="p-3 text-right">{l.rechazadas || "—"}</td>
                      <td className="p-3 text-right">{l.conBusqueda}<div className="text-[11px] text-gray-400">{l.pocosContactos ? `${l.pocosContactos} con pocos` : pct(l.conBusqueda, l.aprobadas)}</div></td>
                      <td className="p-3 text-right">{l.contactosEncontrados}</td>
                      <td className="p-3 text-right font-semibold">{l.contactosAprobados}</td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-gray-50 bg-gray-50/50">
                        <td colSpan={9} className="p-3">
                          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3 text-xs">
                            {list.map((it) => (
                              <div key={it.id} className="truncate"><span className="text-gray-800">{it.company_name}</span> <span className="text-gray-400">{it.domain ?? ""}</span></div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
