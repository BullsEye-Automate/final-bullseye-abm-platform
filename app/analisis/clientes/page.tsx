"use client";

import { useEffect, useRef, useState } from "react";
import {
  IconPhone,
  IconLoader2,
  IconAlertCircle,
  IconTrendingUp,
  IconRefresh,
} from "@tabler/icons-react";
import { useClient } from "@/lib/clientContext";
import { RangeKey, RANGE_LABELS } from "@/lib/dashboardRanges";
import GraficoResultadosSdr from "../sdr/components/GraficoResultadosSdr";
import TablaRankingPais from "../sdr/components/TablaRankingPais";
import SdrMultiSelect from "../sdr/components/SdrMultiSelect";
import TablaRankingClientes from "./components/TablaRankingClientes";
import ClienteMultiSelect from "./components/ClienteMultiSelect";

type ClienteRoster = { cliente_id: string; cliente_nombre: string };
type SdrRoster = { sdr_id: string; sdr_nombre: string };

type ClienteMetrics = {
  cliente_id: string;
  cliente_nombre: string;
  contactos_gestionados: number;
  llamadas_realizadas: number;
  contactos_conectados: number;
  llamadas_conectadas: number;
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
  clientes_data: ClienteMetrics[];
  resultados_por_dia: ResultadosDia[];
  all_clientes?: ClienteRoster[];
};

type PaisMetrics = {
  pais_key: string;
  pais_nombre: string;
  contactos_gestionados: number;
  llamadas_realizadas: number;
  contactos_conectados: number;
  llamadas_conectadas: number;
  reuniones_agendadas: number;
  reuniones_realizadas: number;
  reuniones_pendientes: number;
  tasa_conectadas_por_contacto: number;
  tasa_agendada_por_conectada: number;
  tasa_realizacion_reuniones: number;
};

type PaisApiResponse = {
  paises_data: PaisMetrics[];
  all_sdrs?: SdrRoster[];
  all_clientes?: ClienteRoster[];
};

// Rangos propios de la sección "Resultados Clientes" (no viven en
// lib/dashboardRanges.ts para no agregar estas opciones en los demás
// filtros de la app que comparten ese archivo). Van primero en el dropdown.
type GraficoRangeKey = RangeKey | "last_3_months" | "last_6_months";
const GRAFICO_RANGE_LABELS: Record<string, string> = {
  last_3_months: "Últimos 3 meses",
  last_6_months: "Últimos 6 meses",
  ...RANGE_LABELS,
};

export default function AnalisisClientes() {
  const { currentClient } = useClient();

  const [graficoRangeKey, setGraficoRangeKey] = useState<GraficoRangeKey>("this_month");
  const [graficoCustomFrom, setGraficoCustomFrom] = useState<string>("");
  const [graficoCustomTo, setGraficoCustomTo] = useState<string>("");
  const [graficoClienteFilter, setGraficoClienteFilter] = useState<string[]>([]);
  const [graficoGranularidad, setGraficoGranularidad] = useState<"dia" | "semana" | "mes">("dia");
  const [graficoLoading, setGraficoLoading] = useState(false);
  const [graficoData, setGraficoData] = useState<ApiResponse | null>(null);
  const [graficoError, setGraficoError] = useState<string | null>(null);

  const [tablaRangeKey, setTablaRangeKey] = useState<RangeKey>("this_month");
  const [tablaCustomFrom, setTablaCustomFrom] = useState<string>("");
  const [tablaCustomTo, setTablaCustomTo] = useState<string>("");
  const [tablaClienteFilter, setTablaClienteFilter] = useState<string[]>([]);
  const [tablaLoading, setTablaLoading] = useState(false);
  const [tablaData, setTablaData] = useState<ApiResponse | null>(null);
  const [tablaError, setTablaError] = useState<string | null>(null);

  const [paisRangeKey, setPaisRangeKey] = useState<RangeKey>("this_month");
  const [paisCustomFrom, setPaisCustomFrom] = useState<string>("");
  const [paisCustomTo, setPaisCustomTo] = useState<string>("");
  const [paisSdrFilter, setPaisSdrFilter] = useState<string[]>([]);
  const [paisClienteFilter, setPaisClienteFilter] = useState<string[]>([]);
  const [paisLoading, setPaisLoading] = useState(false);
  const [paisData, setPaisData] = useState<PaisApiResponse | null>(null);
  const [paisError, setPaisError] = useState<string | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Evita que una respuesta más lenta de un filtro anterior sobrescriba
  // los datos del filtro seleccionado actualmente (race condition).
  const graficoRequestId = useRef(0);
  const tablaRequestId = useRef(0);
  const paisRequestId = useRef(0);

  // Las 3 secciones llaman a Allo por cada número asignado, y Allo limita a
  // 5 requests/segundo en total. Si dos o más secciones cargan al mismo
  // tiempo (ej. al entrar a la página, o al cambiar de cliente — las 3
  // dependen de currentClient.id) la suma puede superar ese límite entre sí
  // y gatillar un 429 que agota los reintentos (mismo caso que en Análisis
  // SDR). Esta cola encadena todas las cargas para que nunca haya más de
  // una pegándole a Allo a la vez, sin importar qué la disparó.
  const alloQueueRef = useRef<Promise<void>>(Promise.resolve());
  function runQueued(fn: () => Promise<void>): Promise<void> {
    const run = alloQueueRef.current.then(fn, fn);
    alloQueueRef.current = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  const loadGrafico = async () => {
    // Con "Fecha personalizada" esperamos a que ambas fechas estén elegidas
    if (graficoRangeKey === "custom" && (!graficoCustomFrom || !graficoCustomTo)) return;

    const requestId = ++graficoRequestId.current;
    setGraficoLoading(true);
    setGraficoError(null);
    try {
      const searchParams = new URLSearchParams({
        rangeKey: graficoRangeKey,
        client_id: currentClient?.id || "__all__",
        ...(graficoClienteFilter.length > 0 && { cliente_ids: graficoClienteFilter.join(",") }),
        ...(graficoRangeKey === "custom" && {
          custom_from: graficoCustomFrom,
          custom_to: graficoCustomTo,
        }),
      });

      const response = await fetch(`/api/analisis/clientes?${searchParams}`);
      if (requestId !== graficoRequestId.current) return; // respuesta obsoleta

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setGraficoError(body?.error || "Error al cargar datos");
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
    // Con "Fecha personalizada" esperamos a que ambas fechas estén elegidas
    if (tablaRangeKey === "custom" && (!tablaCustomFrom || !tablaCustomTo)) return;

    const requestId = ++tablaRequestId.current;
    setTablaLoading(true);
    setTablaError(null);
    try {
      const searchParams = new URLSearchParams({
        rangeKey: tablaRangeKey,
        client_id: currentClient?.id || "__all__",
        ...(tablaClienteFilter.length > 0 && { cliente_ids: tablaClienteFilter.join(",") }),
        ...(tablaRangeKey === "custom" && {
          custom_from: tablaCustomFrom,
          custom_to: tablaCustomTo,
        }),
      });

      const response = await fetch(`/api/analisis/clientes?${searchParams}`);
      if (requestId !== tablaRequestId.current) return; // respuesta obsoleta

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setTablaError(body?.error || "Error al cargar datos");
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

  const loadPais = async () => {
    // Con "Fecha personalizada" esperamos a que ambas fechas estén elegidas
    if (paisRangeKey === "custom" && (!paisCustomFrom || !paisCustomTo)) return;

    const requestId = ++paisRequestId.current;
    setPaisLoading(true);
    setPaisError(null);
    try {
      const searchParams = new URLSearchParams({
        rangeKey: paisRangeKey,
        client_id: currentClient?.id || "__all__",
        ...(paisSdrFilter.length > 0 && { sdr_ids: paisSdrFilter.join(",") }),
        ...(paisClienteFilter.length > 0 && { client_ids: paisClienteFilter.join(",") }),
        ...(paisRangeKey === "custom" && {
          custom_from: paisCustomFrom,
          custom_to: paisCustomTo,
        }),
      });

      const response = await fetch(`/api/analisis/paises?${searchParams}`);
      if (requestId !== paisRequestId.current) return; // respuesta obsoleta

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setPaisError(body?.error || "Error al cargar datos");
      } else {
        setPaisData(await response.json());
      }
    } catch (err) {
      if (requestId !== paisRequestId.current) return;
      setPaisError((err as Error).message);
    } finally {
      if (requestId === paisRequestId.current) setPaisLoading(false);
    }
  };

  // Trae la última versión del Excel de reuniones (Google Sheets) a la
  // tabla `meetings` antes de recargar el reporte, para que Reuniones
  // Agendadas/Realizadas calce con el reporte interno que lee el mismo
  // Excel — la sincronización automática puede no haber corrido recién.
  const handleSync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch("/api/meetings/sync");
      const data = await res.json();
      if (data.error) {
        setSyncMessage(`Error al actualizar: ${data.error}`);
      } else {
        setSyncMessage(`✓ Datos actualizados — ${data.synced ?? 0} reuniones sincronizadas`);
        // runQueued (no Promise.all ni llamadas sueltas): encadena estas
        // recargas con cualquier otra que ya esté en curso (ver alloQueueRef
        // más arriba) para que nunca haya más de una sección pegándole a
        // Allo a la vez.
        await runQueued(loadGrafico);
        await runQueued(loadTabla);
        await runQueued(loadPais);
      }
    } catch (err) {
      setSyncMessage(`Error al actualizar: ${(err as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (currentClient?.id) {
      runQueued(loadGrafico);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentClient?.id, graficoRangeKey, graficoClienteFilter, graficoCustomFrom, graficoCustomTo]);

  useEffect(() => {
    if (currentClient?.id) {
      runQueued(loadTabla);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentClient?.id, tablaRangeKey, tablaClienteFilter, tablaCustomFrom, tablaCustomTo]);

  useEffect(() => {
    if (currentClient?.id) {
      runQueued(loadPais);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentClient?.id, paisRangeKey, paisSdrFilter, paisClienteFilter, paisCustomFrom, paisCustomTo]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="label">Reportería</div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <IconTrendingUp size={24} />
            Análisis Clientes
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            Rendimiento y métricas por cliente en el período.
          </p>
        </div>

        <div className="flex flex-col items-end gap-1.5">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-white bg-brand hover:opacity-90 transition disabled:opacity-50"
          >
            {syncing ? (
              <IconLoader2 size={15} className="animate-spin" />
            ) : (
              <IconRefresh size={15} />
            )}
            Actualizar datos de reuniones
          </button>
          {syncMessage && <p className="text-xs text-ink-muted text-right">{syncMessage}</p>}
        </div>
      </header>

      {/* Sección Gráfico */}
      <section className="card space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap pb-3 border-b">
          <h2 className="font-semibold flex items-center gap-2">
            <IconPhone size={16} className="text-brand" /> Resultados Clientes
          </h2>
        </div>

        {/* Filtros específicos del gráfico */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-muted font-medium">Período</label>
            <select
              value={graficoRangeKey}
              onChange={(e) => setGraficoRangeKey(e.target.value as GraficoRangeKey)}
              className="input py-1.5 text-sm"
            >
              {Object.entries(GRAFICO_RANGE_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          {graficoRangeKey === "custom" && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={graficoCustomFrom}
                onChange={(e) => setGraficoCustomFrom(e.target.value)}
                className="input py-1.5 text-sm"
              />
              <span className="text-xs text-ink-muted">a</span>
              <input
                type="date"
                value={graficoCustomTo}
                onChange={(e) => setGraficoCustomTo(e.target.value)}
                className="input py-1.5 text-sm"
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-muted font-medium">Cliente</label>
            <ClienteMultiSelect
              clientes={graficoData?.all_clientes || []}
              selected={graficoClienteFilter}
              onChange={setGraficoClienteFilter}
            />
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

      {/* Sección Ranking Clientes */}
      <section className="card space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap pb-3 border-b">
          <h2 className="font-semibold flex items-center gap-2">
            <IconTrendingUp size={16} className="text-brand" /> Ranking Clientes
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

          {tablaRangeKey === "custom" && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={tablaCustomFrom}
                onChange={(e) => setTablaCustomFrom(e.target.value)}
                className="input py-1.5 text-sm"
              />
              <span className="text-xs text-ink-muted">a</span>
              <input
                type="date"
                value={tablaCustomTo}
                onChange={(e) => setTablaCustomTo(e.target.value)}
                className="input py-1.5 text-sm"
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-muted font-medium">Cliente</label>
            <ClienteMultiSelect
              clientes={tablaData?.all_clientes || []}
              selected={tablaClienteFilter}
              onChange={setTablaClienteFilter}
            />
          </div>
        </div>

        <p className="text-xs text-ink-muted">
          Métricas consolidadas por cliente — haz clic en cualquier encabezado para ordenar.
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
          tablaData.clientes_data.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-ink-muted">
              No hay datos disponibles
            </div>
          ) : (
            <TablaRankingClientes data={tablaData.clientes_data} />
          )
        )}
      </section>

      {/* Sección Ranking País */}
      <section className="card space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap pb-3 border-b">
          <h2 className="font-semibold flex items-center gap-2">
            <IconTrendingUp size={16} className="text-brand" /> Ranking País
          </h2>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-muted font-medium">Período</label>
            <select
              value={paisRangeKey}
              onChange={(e) => setPaisRangeKey(e.target.value as RangeKey)}
              className="input py-1.5 text-sm"
            >
              {Object.entries(RANGE_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          {paisRangeKey === "custom" && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={paisCustomFrom}
                onChange={(e) => setPaisCustomFrom(e.target.value)}
                className="input py-1.5 text-sm"
              />
              <span className="text-xs text-ink-muted">a</span>
              <input
                type="date"
                value={paisCustomTo}
                onChange={(e) => setPaisCustomTo(e.target.value)}
                className="input py-1.5 text-sm"
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-muted font-medium">SDR</label>
            <SdrMultiSelect
              sdrs={paisData?.all_sdrs || []}
              selected={paisSdrFilter}
              onChange={setPaisSdrFilter}
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-muted font-medium">Cliente</label>
            <ClienteMultiSelect
              clientes={paisData?.all_clientes || []}
              selected={paisClienteFilter}
              onChange={setPaisClienteFilter}
            />
          </div>
        </div>

        <p className="text-xs text-ink-muted">
          Métricas consolidadas por país (según el número de Allo de cada llamada, y el país de
          cada reunión) — haz clic en cualquier encabezado para ordenar.
        </p>

        {paisError && (
          <div className="flex items-center gap-2 text-error-fg text-sm p-3 rounded bg-error-bg/20 border border-error-bg">
            <IconAlertCircle size={16} className="shrink-0" />
            {paisError}
          </div>
        )}

        {paisLoading && (
          <div className="flex items-center justify-center py-12 text-ink-muted gap-2">
            <IconLoader2 size={18} className="animate-spin" />
            Cargando datos…
          </div>
        )}

        {!paisLoading && paisData && (
          paisData.paises_data.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-ink-muted">
              No hay datos disponibles
            </div>
          ) : (
            <TablaRankingPais data={paisData.paises_data} />
          )
        )}
      </section>
    </div>
  );
}
