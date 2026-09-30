"use client";

import { useEffect, useState } from "react";

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

  useEffect(() => {
    let active = true;
    setRows(null);
    setError(null);
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl max-w-4xl w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-sm font-semibold text-gray-900">{METRIC_TITLES[metric]}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto p-6">
          {error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : !rows ? (
            <p className="text-sm text-gray-400">Cargando…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-gray-400">No hay reuniones para este filtro.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  {metric === "agendadas" && (
                    <>
                      <th className="py-2 pr-3 font-medium">Empresa</th>
                      <th className="py-2 px-3 font-medium">Contacto</th>
                      <th className="py-2 px-3 font-medium">Cargo</th>
                      <th className="py-2 pl-3 font-medium">¿Se realizó?</th>
                    </>
                  )}
                  {metric === "fit_contacto" && (
                    <>
                      <th className="py-2 pr-3 font-medium">Contacto</th>
                      <th className="py-2 px-3 font-medium">Empresa</th>
                      <th className="py-2 px-3 font-medium">Cargo</th>
                      <th className="py-2 px-3 font-medium">Fit Score</th>
                      <th className="py-2 pl-3 font-medium">Razón</th>
                    </>
                  )}
                  {metric === "fit_empresa" && (
                    <>
                      <th className="py-2 pr-3 font-medium">Empresa</th>
                      <th className="py-2 px-3 font-medium">Contacto</th>
                      <th className="py-2 px-3 font-medium">Fit Score</th>
                      <th className="py-2 pl-3 font-medium">Razón</th>
                    </>
                  )}
                  {metric === "desempeno_vendedor" && (
                    <>
                      <th className="py-2 pr-3 font-medium">Ejecutivo</th>
                      <th className="py-2 px-3 font-medium">Empresa</th>
                      <th className="py-2 px-3 font-medium">Contacto</th>
                      <th className="py-2 px-3 font-medium">Puntaje</th>
                      <th className="py-2 pl-3 font-medium">Resumen</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {metric === "agendadas" &&
                  (rows as AgendadaRow[]).map((row, i) => (
                    <tr key={i} className="border-b border-gray-50 last:border-0 align-top">
                      <td className="py-2.5 pr-3 text-gray-700">{row.empresa ?? "—"}</td>
                      <td className="py-2.5 px-3 text-gray-700">{row.contacto ?? "—"}</td>
                      <td className="py-2.5 px-3 text-gray-500">{row.cargo ?? "—"}</td>
                      <td className="py-2.5 pl-3">
                        <span
                          className="text-xs font-medium px-2 py-0.5 rounded-full"
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
                  (rows as FitContactoRow[]).map((row, i) => (
                    <tr key={i} className="border-b border-gray-50 last:border-0 align-top">
                      <td className="py-2.5 pr-3 text-gray-700">{row.contacto ?? "—"}</td>
                      <td className="py-2.5 px-3 text-gray-700">{row.empresa ?? "—"}</td>
                      <td className="py-2.5 px-3 text-gray-500">{row.cargo ?? "—"}</td>
                      <td className="py-2.5 px-3 font-semibold text-gray-900 whitespace-nowrap">
                        {row.puntaje != null ? `${row.puntaje}/10` : "—"}
                      </td>
                      <td className="py-2.5 pl-3 text-gray-500 max-w-sm">{row.razon ?? "—"}</td>
                    </tr>
                  ))}
                {metric === "fit_empresa" &&
                  (rows as FitEmpresaRow[]).map((row, i) => (
                    <tr key={i} className="border-b border-gray-50 last:border-0 align-top">
                      <td className="py-2.5 pr-3 text-gray-700">{row.empresa ?? "—"}</td>
                      <td className="py-2.5 px-3 text-gray-700">{row.contacto ?? "—"}</td>
                      <td className="py-2.5 px-3 font-semibold text-gray-900 whitespace-nowrap">
                        {row.puntaje != null ? `${row.puntaje}/10` : "—"}
                      </td>
                      <td className="py-2.5 pl-3 text-gray-500 max-w-sm">{row.razon ?? "—"}</td>
                    </tr>
                  ))}
                {metric === "desempeno_vendedor" &&
                  (rows as DesempenoRow[]).map((row, i) => (
                    <tr key={i} className="border-b border-gray-50 last:border-0 align-top">
                      <td className="py-2.5 pr-3 text-gray-700">{row.ejecutivo ?? "—"}</td>
                      <td className="py-2.5 px-3 text-gray-700">{row.empresa ?? "—"}</td>
                      <td className="py-2.5 px-3 text-gray-500">{row.contacto ?? "—"}</td>
                      <td className="py-2.5 px-3 font-semibold text-gray-900 whitespace-nowrap">
                        {row.puntaje != null ? `${row.puntaje}/10` : "—"}
                      </td>
                      <td className="py-2.5 pl-3 text-gray-500 max-w-sm">{row.resumen ?? "—"}</td>
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
