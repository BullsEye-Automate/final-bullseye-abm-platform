"use client";

import { useEffect, useRef, useState } from "react";
import {
  IconPhone,
  IconLoader2,
  IconAlertCircle,
  IconTrendingUp,
} from "@tabler/icons-react";
import { useClient } from "@/lib/clientContext";
import { RangeKey, RANGE_LABELS } from "@/lib/dashboardRanges";
import GraficoResultadosSdr from "./components/GraficoResultadosSdr";
import TablaRankingSdr from "./components/TablaRankingSdr";

type SdrMetrics = {
  sdr_id: string;
  sdr_nombre: string;
  llamadas_realizadas: number;
  reuniones_agendadas: number;
  reuniones_realizadas: number;
  reuniones_pendientes: number;
  tasa_conectadas_por_contacto: number;
  tasa_agendada_por_conectada: number;
  tasa_realizacion_reuniones: number;
};

type ResultadosDia = {
  fecha: string;
  llamadas_realizadas: number;
  reuniones_agendadas: number;
  reuniones_realizadas: number;
};

type ApiResponse = {
  sdrs_data: SdrMetrics[];
  resultados_por_dia: ResultadosDia[];
};

export default function AnalisisSdr() {
  const { currentClient } = useClient();

  const [graficoRangeKey, setGraficoRangeKey] = useState<RangeKey>("this_month");
  const [graficoSdrFilter, setGraficoSdrFilter] = useState<string>("");
  const [graficoGranularidad, setGraficoGranularidad] = useState<"dia" | "semana" | "mes">("dia");
  const [graficoLoading, setGraficoLoading] = useState(false);
  const [graficoData, setGraficoData] = useState<ApiResponse | null>(null);
  const [graficoError, setGraficoError] = useState<string | null>(null);

  const [tablaRangeKey, setTablaRangeKey] = useState<RangeKey>("this_month");
  const [tablaSdrFilter, setTablaSdrFilter] = useState<string>("");
  const [tablaLoading, setTablaLoading] = useState(false);
  const [tablaData, setTablaData] = useState<ApiResponse | null>(null);
  const [tablaError, setTablaError] = useState<string | null>(null);

  // Evita que una respuesta más lenta de un filtro anterior sobrescriba
  // los datos del filtro seleccionado actualmente (race condition).
  const graficoRequestId = useRef(0);
  const tablaRequestId = useRef(0);

  const loadGrafico = async () => {
    const requestId = ++graficoRequestId.current;
    setGraficoLoading(true);
    setGraficoError(null);
    try {
      const searchParams = new URLSearchParams({
        rangeKey: graficoRangeKey,
        client_id: currentClient?.id || "__all__",
        ...(graficoSdrFilter && { sdr_id: graficoSdrFilter }),
      });

      const response = await fetch(`/api/analisis/sdr?${searchParams}`);
      if (requestId !== graficoRequestId.current) return; // respuesta obsoleta

      if (!response.ok) {
        setGraficoError("Error al cargar datos");
      } else {
        setGraficoData(await response.json());
      }
    } catch (err) {
      if (requestId !== graficoRequestId.current) return;
      setGraficoError((err as Error).message);
    } finally {
      if (requestId === graficoRequestId.current) setGraficoLoading(false);
    }
  };

  const loadTabla = async () => {
    const requestId = ++tablaRequestId.current;
    setTablaLoading(true);
    setTablaError(null);
    try {
      const searchParams = new URLSearchParams({
        rangeKey: tablaRangeKey,
        client_id: currentClient?.id || "__all__",
        ...(tablaSdrFilter && { sdr_id: tablaSdrFilter }),
      });

      const response = await fetch(`/api/analisis/sdr?${searchParams}`);
      if (requestId !== tablaRequestId.current) return; // respuesta obsoleta

      if (!response.ok) {
        setTablaError("Error al cargar datos");
      } else {
        setTablaData(await response.json());
      }
    } catch (err) {
      if (requestId !== tablaRequestId.current) return;
      setTablaError((err as Error).message);
    } finally {
      if (requestId === tablaRequestId.current) setTablaLoading(false);
    }
  };

  useEffect(() => {
    if (currentClient?.id) {
      loadGrafico();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentClient?.id, graficoRangeKey, graficoSdrFilter]);

  useEffect(() => {
    if (currentClient?.id) {
      loadTabla();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentClient?.id, tablaRangeKey, tablaSdrFilter]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <header>
        <div className="label">Reportería</div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <IconTrendingUp size={24} />
          Análisis SDR
        </h1>
        <p className="text-sm text-ink-muted mt-1">
          Rendimiento y métricas de los SDRs por período.
        </p>
      </header>

      {/* Sección Gráfico */}
      <section className="card space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap pb-3 border-b">
          <h2 className="font-semibold flex items-center gap-2">
            <IconPhone size={16} className="text-brand" /> Resultados SDR
          </h2>
        </div>

        {/* Filtros específicos del gráfico */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-muted font-medium">Período</label>
            <select
              value={graficoRangeKey}
              onChange={(e) => setGraficoRangeKey(e.target.value as RangeKey)}
              className="input py-1.5 text-sm"
            >
              {Object.entries(RANGE_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-muted font-medium">SDR</label>
            <select
              value={graficoSdrFilter}
              onChange={(e) => setGraficoSdrFilter(e.target.value)}
              className="input py-1.5 text-sm"
            >
              <option value="">Todos los SDRs</option>
              {graficoData?.sdrs_data?.map((sdr) => (
                <option key={sdr.sdr_id} value={sdr.sdr_id}>
                  {sdr.sdr_nombre}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-muted font-medium">Granularidad</label>
            <select
              value={graficoGranularidad}
              onChange={(e) => setGraficoGranularidad(e.target.value as "dia" | "semana" | "mes")}
              className="input py-1.5 text-sm"
            >
              <option value="dia">Día</option>
              <option value="semana">Semana</option>
              <option value="mes">Mes</option>
            </select>
          </div>
        </div>

        <p className="text-xs text-ink-muted">
          Evolución de llamadas realizadas y reuniones agendadas.
        </p>

        {graficoError && (
          <div className="flex items-center gap-2 text-error-fg text-sm p-3 rounded bg-error-bg/20 border border-error-bg">
            <IconAlertCircle size={16} className="shrink-0" />
            {graficoError}
          </div>
        )}

        {graficoLoading && (
          <div className="flex items-center justify-center py-12 text-ink-muted gap-2">
            <IconLoader2 size={18} className="animate-spin" />
            Cargando datos…
          </div>
        )}

        {!graficoLoading && graficoData && (
          graficoData.resultados_por_dia.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-ink-muted">
              No hay datos disponibles
            </div>
          ) : (
            <GraficoResultadosSdr data={graficoData.resultados_por_dia} granularidad={graficoGranularidad} />
          )
        )}
      </section>

      {/* Sección Tabla */}
      <section className="card space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap pb-3 border-b">
          <h2 className="font-semibold flex items-center gap-2">
            <IconTrendingUp size={16} className="text-brand" /> Ranking SDR
          </h2>
        </div>

        {/* Filtros específicos de la tabla */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-muted font-medium">Período</label>
            <select
              value={tablaRangeKey}
              onChange={(e) => setTablaRangeKey(e.target.value as RangeKey)}
              className="input py-1.5 text-sm"
            >
              {Object.entries(RANGE_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-muted font-medium">SDR</label>
            <select
              value={tablaSdrFilter}
              onChange={(e) => setTablaSdrFilter(e.target.value)}
              className="input py-1.5 text-sm"
            >
              <option value="">Todos los SDRs</option>
              {tablaData?.sdrs_data?.map((sdr) => (
                <option key={sdr.sdr_id} value={sdr.sdr_id}>
                  {sdr.sdr_nombre}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="text-xs text-ink-muted">
          Métricas consolidadas por SDR — haz clic en cualquier encabezado para ordenar.
        </p>

        {tablaError && (
          <div className="flex items-center gap-2 text-error-fg text-sm p-3 rounded bg-error-bg/20 border border-error-bg">
            <IconAlertCircle size={16} className="shrink-0" />
            {tablaError}
          </div>
        )}

        {tablaLoading && (
          <div className="flex items-center justify-center py-12 text-ink-muted gap-2">
            <IconLoader2 size={18} className="animate-spin" />
            Cargando datos…
          </div>
        )}

        {!tablaLoading && tablaData && (
          tablaData.sdrs_data.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-ink-muted">
              No hay datos disponibles
            </div>
          ) : (
            <TablaRankingSdr data={tablaData.sdrs_data} />
          )
        )}
      </section>
    </div>
  );
}
