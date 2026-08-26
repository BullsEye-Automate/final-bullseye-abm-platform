"use client";

import { useEffect, useMemo, useState } from "react";
import {
  IconCalendar,
  IconUsers,
  IconPhone,
  IconCalendarEvent,
  IconLoader2,
  IconAlertCircle,
  IconTrendingUp,
} from "@tabler/icons-react";
import { useClient } from "@/lib/clientContext";
import { RangeKey, RANGE_LABELS } from "@/lib/dashboardRanges";
import GraficoResultadosSdr from "./components/GraficoResultadosSdr";
import TablaRankingSdr from "./components/TablaRankingSdr";

// ─── Tipos ──────────────────────────────────────────────────────────────────

type SdrMetrics = {
  sdr_id: string;
  sdr_nombre: string;
  llamadas_realizadas: number;
  reuniones_agendadas: number;
  reuniones_realizadas: number;
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
  error?: string;
};

// ─── Emails autorizados ─────────────────────────────────────────────────────

const AUTHORIZED_EMAILS = [
  "ihincapie@bullseye-abm.com",
  "jguajardo@bullseye-abm.com",
  "jkarmy@bullseye-abm.com",
];

// ─── Página ─────────────────────────────────────────────────────────────────

export default function AnalisisSdr() {
  const { currentUser, currentClient } = useClient();
  const [rangeKey, setRangeKey] = useState<RangeKey>("mes");
  const [clientFilter, setClientFilter] = useState<string>("");
  const [sdrFilter, setSdrFilter] = useState<string>("");
  const [granularidad, setGranularidad] = useState<"dia" | "semana" | "mes">("dia");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Verificar autorización
  const isAuthorized = useMemo(() => {
    if (!currentUser?.email) return false;
    return AUTHORIZED_EMAILS.includes(currentUser.email);
  }, [currentUser?.email]);

  // Cargar datos
  const load = async (clientId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const searchParams = new URLSearchParams({
        rangeKey,
        ...(clientId && { client_id: clientId }),
        ...(sdrFilter && { sdr_id: sdrFilter }),
      });

      const response = await fetch(`/api/analisis/sdr?${searchParams}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        const text = await response.text();
        setError(text || "Error al cargar datos");
        setData(null);
      } else {
        const json = (await response.json()) as ApiResponse;
        setData(json);
      }
    } catch (err) {
      setError((err as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthorized && currentClient?.id) {
      load(currentClient.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, currentClient?.id, rangeKey, sdrFilter]);

  if (!currentUser) {
    return (
      <div className="flex items-center justify-center py-10 text-ink-muted">
        <IconLoader2 size={22} className="animate-spin mr-2" />
        <span>Cargando usuario…</span>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="space-y-6">
        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="label">Reportería</div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <IconTrendingUp size={24} />
              Análisis SDR
            </h1>
          </div>
        </header>

        <div className="card flex items-center gap-3 text-warning-fg border border-warning-bg bg-warning-bg/40 text-sm">
          <IconAlertCircle size={18} className="shrink-0" />
          <div>
            <p className="font-semibold">Acceso restringido</p>
            <p className="text-xs mt-1">
              Este módulo solo está disponible para los administradores autorizados.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="label">Reportería</div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <IconTrendingUp size={24} />
            Análisis SDR
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            Rendimiento y métricas de los SDRs por período.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <select
            className="input py-1.5 text-sm"
            value={rangeKey}
            onChange={(e) => setRangeKey(e.target.value as RangeKey)}
          >
            {Object.entries(RANGE_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>

          <select
            className="input py-1.5 text-sm"
            value={sdrFilter}
            onChange={(e) => setSdrFilter(e.target.value)}
          >
            <option value="">Todos los SDRs</option>
            {data?.sdrs_data?.map((sdr) => (
              <option key={sdr.sdr_id} value={sdr.sdr_id}>
                {sdr.sdr_nombre}
              </option>
            ))}
          </select>
        </div>
      </header>

      {error && (
        <div className="card flex items-center gap-3 text-error-fg border border-error-bg bg-error-bg/40 text-sm">
          <IconAlertCircle size={18} className="shrink-0" />
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-3 text-ink-muted py-10 justify-center">
          <IconLoader2 size={22} className="animate-spin" />
          <span>Cargando datos…</span>
        </div>
      )}

      {!loading && data && (
        <>
          {/* Resultados SDR */}
          <section className="card space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="font-semibold flex items-center gap-2">
                <IconPhone size={16} className="text-brand" /> Resultados SDR
              </h2>
              <select
                className="input py-1.5 text-sm w-auto"
                value={granularidad}
                onChange={(e) => setGranularidad(e.target.value as "dia" | "semana" | "mes")}
              >
                <option value="dia">Por día</option>
                <option value="semana">Por semana</option>
                <option value="mes">Por mes</option>
              </select>
            </div>
            <p className="text-xs text-ink-muted">
              Evolución de llamadas realizadas, reuniones agendadas y realizadas.
            </p>
            {data.resultados_por_dia.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-ink-muted">
                No hay datos disponibles
              </div>
            ) : (
              <GraficoResultadosSdr data={data.resultados_por_dia} granularidad={granularidad} />
            )}
          </section>

          {/* Ranking SDR */}
          <section className="card space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <IconTrendingUp size={16} className="text-brand" /> Ranking SDR
            </h2>
            <p className="text-xs text-ink-muted">
              Métricas consolidadas por SDR — haz clic en cualquier encabezado para ordenar.
            </p>

            <TablaRankingSdr data={data.sdrs_data} />
          </section>
        </>
      )}
    </div>
  );
}
