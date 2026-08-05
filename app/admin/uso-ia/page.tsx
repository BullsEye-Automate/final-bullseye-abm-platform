"use client";

import { useEffect, useState } from "react";
import { IconLoader2, IconRefresh, IconSparkles, IconAlertCircle, IconTrendingUp, IconCpu } from "@tabler/icons-react";

type FunctionRow = { calls: number; input_tokens: number; output_tokens: number; cost_usd: number };
type ClientRow   = { name: string; calls: number; cost_usd: number };
type UserRow     = { email: string; calls: number; cost_usd: number };
type ModelRow    = { calls: number; input_tokens: number; output_tokens: number; cost_usd: number };
type DayRow      = { calls: number; cost_usd: number };

type UsageData = {
  period_days: number;
  total_calls: number;
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  by_function: Record<string, FunctionRow>;
  by_client: Record<string, ClientRow>;
  by_user: Record<string, UserRow>;
  by_model: Record<string, ModelRow>;
  by_day: Record<string, DayRow>;
  functions_by_day: Record<string, Record<string, { calls: number; cost_usd: number }>>;
  top_functions_by_cost: Array<[string, FunctionRow]>;
  top_functions_by_calls: Array<[string, FunctionRow]>;
};

const FUNCTION_LABELS: Record<string, string> = {
  message_generation_sequence:    "Generación de mensajes (secuencia)",
  message_generation_simple:      "Generación de mensajes (simple)",
  message_review_haiku:           "Revisión de mensajes (Haiku)",
  segment_routing:                "Clasificación de segmento",
  prefilter:                      "Pre-filtro de contactos",
  deep_research:                  "Investigación profunda",
  agente_contenido_chat:          "Chat agente SDR",
  company_research_fast:          "Investigación rápida de empresa",
  discovery_recommendation:       "Discovery de empresas",
  infer_company_name_from_bio:    "Inferir empresa desde bio (Lemlist)",
  sales_nav_recommendations:      "Recomendaciones Sales Navigator",
  training_parse_pdf:             "Parseo de PDF (entrenamiento)",
  hubspot_calls_analyze:          "Análisis de llamadas (HubSpot)",
  company_scrape_contacts:        "Extracción de contactos de empresa",
  company_diagnose:               "Diagnóstico de empresa",
  company_research_diagnostic:    "Investigación de empresa (diagnóstico)",
  company_research_one:           "Investigación de empresa (una)",
  client_generate_campaign_texts: "Generación de textos de campaña",
  client_generate_clay_config:    "Generación de config de Clay",
  client_clay_scoring_prompt:     "Generación de prompt de scoring (Clay)",
};

function fmt(n: number, decimals = 1) {
  return n.toFixed(decimals);
}

function fmtTokens(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

const AUTO_REFRESH_MS = 30_000;

type FunctionDetail = {
  function_name: string;
  period_days: number;
  total_calls: number;
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  by_client: Record<string, { name: string; calls: number; cost_usd: number; input_tokens: number; output_tokens: number }>;
  by_day: Record<string, { calls: number; cost_usd: number }>;
  by_model: Record<string, { calls: number; cost_usd: number; input_tokens: number; output_tokens: number }>;
  metadata_stats: {
    total_contacts: number;
    total_companies: number;
    total_sequences: number;
    avg_tokens_per_contact: number;
    avg_cost_per_contact: number;
  };
};

export default function UsoIAPage() {
  const [days, setDays]     = useState(7);
  const [data, setData]     = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [detailFn, setDetailFn] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<FunctionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  async function load(d: number) {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const r = await fetch(`/api/admin/ai-usage?days=${d}`, { cache: "no-store" });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? "Error");
      setData(json);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }

  async function loadFunctionDetail(fn: string) {
    setDetailLoading(true);
    try {
      const r = await fetch(`/api/admin/ai-usage/function-detail?days=${days}&function=${fn}`, { cache: "no-store" });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? "Error");
      setDetailData(json);
      setDetailFn(fn);
    } catch (e: any) {
      console.error(e);
    }
    setDetailLoading(false);
  }

  useEffect(() => {
    load(days);

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") load(days);
    }, AUTO_REFRESH_MS);

    return () => clearInterval(interval);
  }, [days]);

  const byFn     = data ? Object.entries(data.by_function).sort((a, b) => b[1].cost_usd - a[1].cost_usd) : [];
  const byClient = data ? Object.entries(data.by_client).sort((a, b) => b[1].cost_usd - a[1].cost_usd) : [];
  const byUser   = data ? Object.entries(data.by_user ?? {}).sort((a, b) => b[1].cost_usd - a[1].cost_usd) : [];
  const byModel  = data ? Object.entries(data.by_model).sort((a, b) => b[1].cost_usd - a[1].cost_usd) : [];
  const byDay    = data ? Object.entries(data.by_day ?? {}).sort((a, b) => a[0].localeCompare(b[0])) : [];

  // Calcular costo promedio por llamada
  const avgCostPerCall = data && data.total_calls > 0 ? data.total_cost_usd / data.total_calls : 0;
  const avgTokensOut   = data && data.total_calls > 0 ? data.total_output_tokens / data.total_calls : 0;

  // Encontrar función más costosa
  const mostExpensive = data && data.top_functions_by_cost.length > 0 ? data.top_functions_by_cost[0] : null;

  return (
    <div className="space-y-6 max-w-6xl">
      <header>
        <div className="label">Admin</div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <IconSparkles size={22} style={{ color: "#62E0D8" }} /> Informe de Uso de IA
        </h1>
        <p className="text-sm text-ink-muted mt-0.5">Análisis detallado de tokens, costo y patrones de consumo por función, cliente y modelo.</p>
      </header>

      {/* Filtro de período */}
      <div className="flex items-center gap-2 flex-wrap">
        {[1, 2, 7, 30].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`btn text-sm ${days === d ? "bg-brand text-white" : "bg-white border border-[#E5E2F0] text-ink"}`}
          >
            {d === 1 ? "Hoy" : d === 2 ? "2 días" : d === 7 ? "7 días" : "30 días"}
          </button>
        ))}
        <button onClick={() => load(days)} className="btn bg-white border border-[#E5E2F0] text-ink ml-auto" disabled={loading}>
          {loading ? <IconLoader2 size={14} className="animate-spin" /> : <IconRefresh size={14} />}
          Refrescar
        </button>
      </div>

      {error && (
        <div className="card border border-red-200 bg-red-50 text-red-700 text-sm flex items-center gap-2">
          <IconAlertCircle size={15} /> {error}
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center gap-2 text-ink-muted py-12 justify-center">
          <IconLoader2 size={20} className="animate-spin" style={{ color: "#62E0D8" }} />
          Cargando datos…
        </div>
      )}

      {data && (
        <>
          {/* RESUMEN PRINCIPAL */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Costo total (USD)", value: `$${fmt(data.total_cost_usd)}`, icon: "💰" },
              { label: "Llamadas totales", value: data.total_calls.toLocaleString(), icon: "📞" },
              { label: "Costo / llamada", value: `$${fmt(avgCostPerCall)}`, icon: "🎯" },
              { label: "Tokens output promedio", value: fmtTokens(avgTokensOut), icon: "📊" },
            ].map((s) => (
              <div key={s.label} className="card px-5 py-4">
                <div className="text-xs text-ink-muted mb-1">{s.label}</div>
                <div className="text-2xl font-semibold text-[#251762]">{s.value}</div>
              </div>
            ))}
          </div>

          {/* TOKENS TOTALES */}
          <div className="card px-5 py-4">
            <p className="text-sm font-semibold text-ink mb-3">Distribución de tokens</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-ink-muted mb-1">Tokens entrada (input)</p>
                <p className="text-xl font-semibold text-[#251762]">{fmtTokens(data.total_input_tokens)}</p>
              </div>
              <div>
                <p className="text-xs text-ink-muted mb-1">Tokens salida (output)</p>
                <p className="text-xl font-semibold text-[#251762]">{fmtTokens(data.total_output_tokens)}</p>
              </div>
            </div>
            <div className="mt-3 w-full bg-[#F0EEF8] rounded h-2 overflow-hidden flex">
              <div
                className="bg-blue-500"
                style={{ width: `${(data.total_input_tokens / (data.total_input_tokens + data.total_output_tokens)) * 100}%` }}
              />
              <div className="bg-orange-500" />
            </div>
            <p className="text-xs text-ink-muted mt-2">
              Input: {((data.total_input_tokens / (data.total_input_tokens + data.total_output_tokens)) * 100).toFixed(1)}% |
              Output: {((data.total_output_tokens / (data.total_input_tokens + data.total_output_tokens)) * 100).toFixed(1)}%
            </p>
          </div>

          {/* TOP INSIGHT */}
          {mostExpensive && (
            <button
              onClick={() => loadFunctionDetail(mostExpensive[0])}
              className="card bg-gradient-to-r from-orange-50 to-yellow-50 border border-orange-200 px-5 py-4 w-full text-left hover:shadow-md transition cursor-pointer"
            >
              <p className="text-xs text-orange-700 font-semibold uppercase tracking-wide mb-2">⚠️ Mayor consumidor de recursos (click para análisis detallado)</p>
              <p className="text-lg font-semibold text-orange-900">{FUNCTION_LABELS[mostExpensive[0]] ?? mostExpensive[0]}</p>
              <p className="text-sm text-orange-700 mt-1">
                ${fmt(mostExpensive[1].cost_usd)} ({mostExpensive[1].calls} llamadas) ·
                {((mostExpensive[1].cost_usd / data.total_cost_usd) * 100).toFixed(1)}% del costo total
              </p>
            </button>
          )}

          {/* GRÁFICO DE TENDENCIA TEMPORAL */}
          {byDay.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-[#E5E2F0] flex items-center gap-2">
                <IconTrendingUp size={16} style={{ color: "#62E0D8" }} />
                <p className="font-semibold text-sm text-ink">Tendencia de costo por día</p>
              </div>
              <div className="p-5">
                <div className="flex items-end gap-1 h-32 justify-between">
                  {byDay.map(([day, row]) => {
                    const maxCost = Math.max(...byDay.map(([_, r]) => r.cost_usd));
                    const height = (row.cost_usd / maxCost) * 100;
                    return (
                      <div key={day} className="flex flex-col items-center flex-1 gap-1">
                        <div
                          className="w-full bg-blue-400 rounded-sm hover:bg-blue-600 transition"
                          style={{ height: `${Math.max(5, height)}%` }}
                          title={`${day}: $${fmt(row.cost_usd, 2)}`}
                        />
                        <span className="text-[10px] text-ink-muted">{day.slice(5)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* DESGLOSE POR MODELO */}
          {byModel.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-[#E5E2F0] flex items-center gap-2">
                <IconCpu size={16} style={{ color: "#62E0D8" }} />
                <p className="font-semibold text-sm text-ink">Uso por modelo de Claude</p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E5E2F0]">
                    <th className="text-left px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Modelo</th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Llamadas</th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Tokens in</th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Tokens out</th>
                    <th className="text-right px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Costo USD</th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">% del costo</th>
                  </tr>
                </thead>
                <tbody>
                  {byModel.map(([model, row]) => (
                    <tr key={model} className="border-b border-[#F0EEF8] last:border-0">
                      <td className="px-5 py-2.5 text-ink font-medium">{model}</td>
                      <td className="px-4 py-2.5 text-right text-ink-muted">{row.calls.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right text-ink-muted">{fmtTokens(row.input_tokens)}</td>
                      <td className="px-4 py-2.5 text-right text-ink-muted">{fmtTokens(row.output_tokens)}</td>
                      <td className="px-5 py-2.5 text-right font-semibold text-[#251762]">${fmt(row.cost_usd)}</td>
                      <td className="px-4 py-2.5 text-right text-ink-muted">{((row.cost_usd / data.total_cost_usd) * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* DESGLOSE POR USUARIO */}
          {byUser.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-[#E5E2F0] flex items-center gap-2">
                <span style={{ color: "#62E0D8" }}>👤</span>
                <p className="font-semibold text-sm text-ink">Costo por usuario ($$)</p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E5E2F0]">
                    <th className="text-left px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Usuario</th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Llamadas</th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Costo USD</th>
                    <th className="text-right px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">% del total</th>
                  </tr>
                </thead>
                <tbody>
                  {byUser.map(([id, row]) => (
                    <tr key={id} className="border-b border-[#F0EEF8] last:border-0">
                      <td className="px-5 py-2.5 text-ink font-medium text-sm">{row.email}</td>
                      <td className="px-4 py-2.5 text-right text-ink-muted">{row.calls.toLocaleString()}</td>
                      <td className="px-5 py-2.5 text-right font-semibold text-[#251762]">${fmt(row.cost_usd)}</td>
                      <td className="px-5 py-2.5 text-right text-ink-muted font-medium">{((row.cost_usd / data.total_cost_usd) * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* TOP 10 FUNCIONES MÁS COSTOSAS */}
          {data.top_functions_by_cost.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-[#E5E2F0]">
                <p className="font-semibold text-sm text-ink">🔴 Top 10: Funciones más costosas</p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E5E2F0]">
                    <th className="text-left px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Función</th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Llamadas</th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Costo USD</th>
                    <th className="text-right px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">% del total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_functions_by_cost.map(([fn, row]) => (
                    <tr key={fn} className="border-b border-[#F0EEF8] last:border-0">
                      <td className="px-5 py-2.5 text-ink font-medium">{FUNCTION_LABELS[fn] ?? fn}</td>
                      <td className="px-4 py-2.5 text-right text-ink-muted">{row.calls.toLocaleString()}</td>
                      <td className="px-5 py-2.5 text-right font-semibold text-[#251762]">${fmt(row.cost_usd)}</td>
                      <td className="px-5 py-2.5 text-right text-ink-muted font-medium">{((row.cost_usd / data.total_cost_usd) * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* TOP 10 FUNCIONES MÁS FRECUENTES */}
          {data.top_functions_by_calls.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-[#E5E2F0]">
                <p className="font-semibold text-sm text-ink">🟢 Top 10: Funciones más frecuentes</p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E5E2F0]">
                    <th className="text-left px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Función</th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Llamadas</th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Costo / llamada</th>
                    <th className="text-right px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Costo total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_functions_by_calls.map(([fn, row]) => (
                    <tr key={fn} className="border-b border-[#F0EEF8] last:border-0">
                      <td className="px-5 py-2.5 text-ink font-medium">{FUNCTION_LABELS[fn] ?? fn}</td>
                      <td className="px-4 py-2.5 text-right text-ink-muted">{row.calls.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right text-ink-muted">${fmt(row.cost_usd / row.calls)}</td>
                      <td className="px-5 py-2.5 text-right font-semibold text-[#251762]">${fmt(row.cost_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* DESGLOSE POR CLIENTE */}
          {byClient.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-[#E5E2F0]">
                <p className="font-semibold text-sm text-ink">Desglose por cliente</p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E5E2F0]">
                    <th className="text-left px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Cliente</th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Llamadas</th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Costo / llamada</th>
                    <th className="text-right px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Costo USD</th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">% del total</th>
                  </tr>
                </thead>
                <tbody>
                  {byClient.map(([id, row]) => (
                    <tr key={id} className="border-b border-[#F0EEF8] last:border-0">
                      <td className="px-5 py-2.5 text-ink font-medium">{row.name}</td>
                      <td className="px-4 py-2.5 text-right text-ink-muted">{row.calls.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right text-ink-muted">${fmt(row.cost_usd / row.calls)}</td>
                      <td className="px-5 py-2.5 text-right font-semibold text-[#251762]">${fmt(row.cost_usd)}</td>
                      <td className="px-4 py-2.5 text-right text-ink-muted">{((row.cost_usd / data.total_cost_usd) * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* DESGLOSE COMPLETO POR FUNCIÓN */}
          {byFn.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-[#E5E2F0]">
                <p className="font-semibold text-sm text-ink">Desglose completo por función</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#E5E2F0]">
                      <th className="text-left px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Función</th>
                      <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Llamadas</th>
                      <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Tokens in</th>
                      <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Tokens out</th>
                      <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Costo / llamada</th>
                      <th className="text-right px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Costo USD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byFn.map(([fn, row]) => (
                      <tr key={fn} className="border-b border-[#F0EEF8] last:border-0">
                        <td className="px-5 py-2.5 text-ink font-medium">{FUNCTION_LABELS[fn] ?? fn}</td>
                        <td className="px-4 py-2.5 text-right text-ink-muted">{row.calls.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right text-ink-muted">{fmtTokens(row.input_tokens)}</td>
                        <td className="px-4 py-2.5 text-right text-ink-muted">{fmtTokens(row.output_tokens)}</td>
                        <td className="px-4 py-2.5 text-right text-ink-muted text-xs">${fmt(row.cost_usd / row.calls)}</td>
                        <td className="px-5 py-2.5 text-right font-semibold text-[#251762]">${fmt(row.cost_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data.total_calls === 0 && (
            <div className="card px-5 py-10 text-center text-ink-muted text-sm">
              No hay registros en este período. El logging empieza a registrar desde ahora.
            </div>
          )}
        </>
      )}

      {/* MODAL DE ANÁLISIS DETALLADO */}
      {detailFn && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-[#E5E2F0] px-6 py-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-orange-700 font-semibold uppercase">Análisis detallado</p>
                <h2 className="text-xl font-semibold text-ink">{FUNCTION_LABELS[detailFn] ?? detailFn}</h2>
              </div>
              <button
                onClick={() => { setDetailFn(null); setDetailData(null); }}
                className="text-ink-muted hover:text-ink text-2xl leading-none"
              >
                ✕
              </button>
            </div>

            {detailLoading ? (
              <div className="p-6 text-center">
                <IconLoader2 size={24} className="animate-spin mx-auto mb-2" style={{ color: "#62E0D8" }} />
                Cargando detalles…
              </div>
            ) : detailData ? (
              <div className="p-6 space-y-6">
                {/* RESUMEN RÁPIDO */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Costo total", value: `$${fmt(detailData.total_cost_usd)}` },
                    { label: "Llamadas", value: detailData.total_calls },
                    { label: "Costo / llamada", value: `$${fmt(detailData.total_cost_usd / detailData.total_calls)}` },
                  ].map((s) => (
                    <div key={s.label} className="bg-[#F8F7FC] p-3 rounded">
                      <p className="text-xs text-ink-muted mb-1">{s.label}</p>
                      <p className="text-lg font-semibold text-[#251762]">{s.value}</p>
                    </div>
                  ))}
                </div>

                {/* MÉTRICAS DE METADATA */}
                {detailData.metadata_stats && (
                  <div className="bg-gradient-to-r from-blue-50 to-cyan-50 border border-blue-200 rounded p-4">
                    <p className="text-sm font-semibold text-ink mb-3">📊 Métricas de impacto</p>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: "Contactos procesados", value: detailData.metadata_stats.total_contacts || "—" },
                        { label: "Empresas procesadas", value: detailData.metadata_stats.total_companies || "—" },
                        { label: "Costo por contacto", value: detailData.metadata_stats.total_contacts > 0 ? `$${fmt(detailData.metadata_stats.avg_cost_per_contact)}` : "—" },
                        { label: "Tokens por contacto", value: detailData.metadata_stats.total_contacts > 0 ? fmtTokens(detailData.metadata_stats.avg_tokens_per_contact) : "—" },
                      ].map((s) => (
                        <div key={s.label}>
                          <p className="text-xs text-blue-700 mb-1">{s.label}</p>
                          <p className="text-lg font-semibold text-blue-900">{s.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* DESGLOSE POR CLIENTE */}
                {Object.keys(detailData.by_client).length > 0 && (
                  <div className="border border-[#E5E2F0] rounded overflow-hidden">
                    <div className="bg-[#F8F7FC] px-4 py-2 border-b border-[#E5E2F0]">
                      <p className="text-sm font-semibold text-ink">Consumo por cliente</p>
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[#E5E2F0]">
                          <th className="text-left px-4 py-2 text-[11px] font-semibold text-ink-muted">Cliente</th>
                          <th className="text-right px-4 py-2 text-[11px] font-semibold text-ink-muted">Llamadas</th>
                          <th className="text-right px-4 py-2 text-[11px] font-semibold text-ink-muted">Costo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(detailData.by_client)
                          .sort((a, b) => b[1].cost_usd - a[1].cost_usd)
                          .map(([id, row]) => (
                            <tr key={id} className="border-b border-[#F0EEF8] last:border-0">
                              <td className="px-4 py-2 text-ink font-medium">{row.name}</td>
                              <td className="px-4 py-2 text-right text-ink-muted">{row.calls}</td>
                              <td className="px-4 py-2 text-right font-semibold text-[#251762]">${fmt(row.cost_usd)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* DESGLOSE POR MODELO */}
                {Object.keys(detailData.by_model).length > 0 && (
                  <div className="border border-[#E5E2F0] rounded overflow-hidden">
                    <div className="bg-[#F8F7FC] px-4 py-2 border-b border-[#E5E2F0]">
                      <p className="text-sm font-semibold text-ink">Modelos utilizados</p>
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[#E5E2F0]">
                          <th className="text-left px-4 py-2 text-[11px] font-semibold text-ink-muted">Modelo</th>
                          <th className="text-right px-4 py-2 text-[11px] font-semibold text-ink-muted">Llamadas</th>
                          <th className="text-right px-4 py-2 text-[11px] font-semibold text-ink-muted">Costo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(detailData.by_model)
                          .sort((a, b) => b[1].cost_usd - a[1].cost_usd)
                          .map(([model, row]) => (
                            <tr key={model} className="border-b border-[#F0EEF8] last:border-0">
                              <td className="px-4 py-2 text-ink font-medium text-xs">{model}</td>
                              <td className="px-4 py-2 text-right text-ink-muted">{row.calls}</td>
                              <td className="px-4 py-2 text-right font-semibold text-[#251762]">${fmt(row.cost_usd)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* RECOMENDACIONES */}
                <div className="bg-green-50 border border-green-200 rounded p-4">
                  <p className="text-sm font-semibold text-green-900 mb-2">💡 Recomendaciones de optimización</p>
                  <ul className="text-sm text-green-800 space-y-1 list-disc list-inside">
                    <li>
                      {detailData.by_model['claude-sonnet-4-6'] && detailData.by_model['claude-sonnet-4-6'].calls > detailData.total_calls * 0.5
                        ? "Considerar usar Haiku para pre-filtros o validaciones básicas (reducir 80% del costo)"
                        : "Modelo optimizado para complejidad requerida"}
                    </li>
                    <li>
                      {detailData.total_cost_usd / detailData.total_calls > 0.05
                        ? "El costo por llamada es alto. Revisar si el prompt puede ser más conciso o si se puede usar caching"
                        : "Costo por llamada dentro de lo esperado"}
                    </li>
                    <li>
                      {detailData.metadata_stats.total_contacts > 0 && detailData.metadata_stats.avg_cost_per_contact > 0.01
                        ? "Implementar batch processing para procesar múltiples contactos por llamada"
                        : "Batching ya está optimizado"}
                    </li>
                  </ul>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
