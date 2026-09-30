"use client";

import { useEffect, useMemo, useState } from "react";
import ScoreBadge from "@/components/ScoreBadge";

// Detalle fila por fila detrás de una tarjeta/etapa del Panel de control —
// pedido explícito del usuario (30-09-2026): poder hacer clic en "Fit Score
// contacto", "Fit Score empresa", "Desempeño del vendedor" o "Reuniones
// agendadas" y ver cuáles son exactamente las reuniones detrás de ese
// número, en vez de solo el promedio/conteo agregado.
export type PanelRowMetric = "agendadas" | "fit_empresa" | "fit_contacto" | "desempeno_vendedor";

interface AgendadaRow {
  contacto: string | null;
  empresa: string | null;
  cargo: string | null;
  status: string;
  realizada: boolean;
}

interface FitContactoRow {
  contacto: string | null;
  empresa: string | null;
  cargo: string | null;
  puntaje: number | null;
  razon: string | null;
}

interface FitEmpresaRow {
  empresa: string | null;
  contacto: string | null;
  puntaje: number | null;
  razon: string | null;
}

interface DesempenoRow {
  ejecutivo: string | null;
  empresa: string | null;
  contacto: string | null;
  puntaje: number | null;
  resumen: string | null;
}

const METRIC_TITLES: Record<PanelRowMetric, string> = {
  agendadas: "Reuniones agendadas",
  fit_empresa: "Fit Score empresa — detalle",
  fit_contacto: "Fit Score contacto — detalle",
  desempeno_vendedor: "Desempeño del vendedor — detalle",
};

// Metrics con una columna de puntaje ordenable — "agendadas" no tiene
// puntaje (solo "¿se realizó?"), así que no aplica orden acá.
const SCORED_METRICS: PanelRowMetric[] = ["fit_empresa", "fit_contacto", "desempeno_vendedor"];

function SortArrow({ dir }: { dir: "asc" | "desc" }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      style={{ transform: dir === "asc" ? "rotate(180deg)" : undefined }}
    >
      <polyline points="7 10 12 15 17 10" />
    </svg>
  );
}

export default function PanelDrilldownModal({
  metric,
  baseParams,
  onClose,
}: {
  metric: PanelRowMetric;
  // from/to/client_id/ejecutivo ya armados por PanelDeControlView — mismo
  // filtro que ya se ve en pantalla, solo se le agrega `metric`.
  baseParams: URLSearchParams;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Array<AgendadaRow | FitContactoRow | FitEmpresaRow | DesempenoRow> | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Pedido explícito del usuario (08-10-2026): las 3 tablas con puntaje
  // (fit empresa/contacto, desempeño) abren siempre ordenadas de mayor a
  // menor por default — el header queda clickeable para invertir el orden,
  // mismo patrón que MeetingsTable/EjecutivoRankingTable.
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const isScored = SCORED_METRICS.includes(metric);

  useEffect(() => {
    let active = true;
    setRows(null);
    setError(null);
    setSortDir("desc");
    const params = new URLSearchParams(baseParams);
    params.set("metric", metric);
    fetch(`/api/panel/funnel/rows?${params.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Error");
        return res.json();
      })
      .then((json) => {
        if (active) setRows(json);
      })
      .catch(() => {
        if (active) setError("No se pudo cargar el detalle.");
      });
    return () => {
      active = false;
    };
    // baseParams es un URLSearchParams nuevo en cada render de
    // PanelDeControlView — se compara por su texto, no por referencia, para
    // no volver a pedir el detalle si el filtro en realidad no cambió.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric, baseParams.toString()]);

  // Escape para cerrar — patrón estándar de modal.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const sortedRows = useMemo(() => {
    if (!rows || !isScored) return rows;
    const withScore = rows as Array<FitContactoRow | FitEmpresaRow | DesempenoRow>;
    return [...withScore].sort((a, b) => {
      // Sin puntaje (null, ej. falta ICP) siempre al final, sin importar el orden.
      if (a.puntaje == null && b.puntaje == null) return 0;
      if (a.puntaje == null) return 1;
      if (b.puntaje == null) return -1;
      return sortDir === "desc" ? b.puntaje - a.puntaje : a.puntaje - b.puntaje;
    });
  }, [rows, sortDir, isScored]);

  function toggleSort() {
    setSortDir((prev) => (prev === "desc" ? "asc" : "desc"));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-[15px] font-semibold text-gray-900">{METRIC_TITLES[metric]}</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 text-base leading-none"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto">
          {error ? (
            <p className="text-sm text-red-600 p-6">{error}</p>
          ) : !sortedRows ? (
            <p className="text-sm text-gray-400 p-6">Cargando…</p>
          ) : sortedRows.length === 0 ? (
            <p className="text-sm text-gray-400 p-6">No hay reuniones para este filtro.</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs text-gray-500 sticky top-0 bg-white border-b border-gray-100 shadow-[0_1px_0_0_rgba(0,0,0,0.04)]">
                  {metric === "agendadas" && (
                    <>
                      <th className="py-3 px-6 font-medium">Empresa</th>
                      <th className="py-3 px-3 font-medium">Contacto</th>
                      <th className="py-3 px-3 font-medium">Cargo</th>
                      <th className="py-3 px-6 font-medium">¿Se realizó?</th>
                    </>
                  )}
                  {metric === "fit_contacto" && (
                    <>
                      <th className="py-3 px-6 font-medium">Contacto</th>
                      <th className="py-3 px-3 font-medium">Empresa</th>
                      <th className="py-3 px-3 font-medium">Cargo</th>
                      <th className="py-3 px-3 font-medium">
                        <button onClick={toggleSort} className="flex items-center gap-1 hover:text-gray-700">
                          Fit Score
                          <SortArrow dir={sortDir} />
                        </button>
                      </th>
                      <th className="py-3 px-6 font-medium">Razón</th>
                    </>
                  )}
                  {metric === "fit_empresa" && (
                    <>
                      <th className="py-3 px-6 font-medium">Empresa</th>
                      <th className="py-3 px-3 font-medium">Contacto</th>
                      <th className="py-3 px-3 font-medium">
                        <button onClick={toggleSort} className="flex items-center gap-1 hover:text-gray-700">
                          Fit Score
                          <SortArrow dir={sortDir} />
                        </button>
                      </th>
                      <th className="py-3 px-6 font-medium">Razón</th>
                    </>
                  )}
                  {metric === "desempeno_vendedor" && (
                    <>
                      <th className="py-3 px-6 font-medium">Ejecutivo</th>
                      <th className="py-3 px-3 font-medium">Empresa</th>
                      <th className="py-3 px-3 font-medium">Contacto</th>
                      <th className="py-3 px-3 font-medium">
                        <button onClick={toggleSort} className="flex items-center gap-1 hover:text-gray-700">
                          Puntaje
                          <SortArrow dir={sortDir} />
                        </button>
                      </th>
                      <th className="py-3 px-6 font-medium">Resumen</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {metric === "agendadas" &&
                  (sortedRows as AgendadaRow[]).map((row, i) => (
                    <tr key={i} className="border-b border-gray-50 last:border-0 align-top hover:bg-gray-50/60">
                      <td className="py-3 px-6 font-medium text-gray-900">{row.empresa ?? "—"}</td>
                      <td className="py-3 px-3 text-gray-700">{row.contacto ?? "—"}</td>
                      <td className="py-3 px-3 text-gray-500">{row.cargo ?? "—"}</td>
                      <td className="py-3 px-6">
                        <span
                          className="text-xs font-bold px-2.5 py-0.5 rounded-lg whitespace-nowrap"
                          style={
                            row.realizada
                              ? { background: "#E6F6EE", color: "#1F8A5C" }
                              : { background: "#F3F4F6", color: "#6B7280" }
                          }
                        >
                          {row.realizada ? "Sí" : "No"}
                        </span>
                      </td>
                    </tr>
                  ))}
                {metric === "fit_contacto" &&
                  (sortedRows as FitContactoRow[]).map((row, i) => (
                    <tr key={i} className="border-b border-gray-50 last:border-0 align-top hover:bg-gray-50/60">
                      <td className="py-3 px-6 font-medium text-gray-900">{row.contacto ?? "—"}</td>
                      <td className="py-3 px-3 text-gray-700">{row.empresa ?? "—"}</td>
                      <td className="py-3 px-3 text-gray-500">{row.cargo ?? "—"}</td>
                      <td className="py-3 px-3">
                        <ScoreBadge puntaje={row.puntaje} />
                      </td>
                      <td className="py-3 px-6 text-gray-600 leading-relaxed max-w-md">{row.razon ?? "—"}</td>
                    </tr>
                  ))}
                {metric === "fit_empresa" &&
                  (sortedRows as FitEmpresaRow[]).map((row, i) => (
                    <tr key={i} className="border-b border-gray-50 last:border-0 align-top hover:bg-gray-50/60">
                      <td className="py-3 px-6 font-medium text-gray-900">{row.empresa ?? "—"}</td>
                      <td className="py-3 px-3 text-gray-700">{row.contacto ?? "—"}</td>
                      <td className="py-3 px-3">
                        <ScoreBadge puntaje={row.puntaje} />
                      </td>
                      <td className="py-3 px-6 text-gray-600 leading-relaxed max-w-md">{row.razon ?? "—"}</td>
                    </tr>
                  ))}
                {metric === "desempeno_vendedor" &&
                  (sortedRows as DesempenoRow[]).map((row, i) => (
                    <tr key={i} className="border-b border-gray-50 last:border-0 align-top hover:bg-gray-50/60">
                      <td className="py-3 px-6 font-medium text-gray-900">{row.ejecutivo ?? "—"}</td>
                      <td className="py-3 px-3 text-gray-700">{row.empresa ?? "—"}</td>
                      <td className="py-3 px-3 text-gray-500">{row.contacto ?? "—"}</td>
                      <td className="py-3 px-3">
                        <ScoreBadge puntaje={row.puntaje} />
                      </td>
                      <td className="py-3 px-6 text-gray-600 leading-relaxed max-w-md">{row.resumen ?? "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
