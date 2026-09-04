"use client";

import { useEffect, useRef, useState } from "react";
import {
  IconPhone,
  IconLoader2,
  IconAlertCircle,
  IconTrendingUp,
  IconRefresh,
  IconClock,
} from "@tabler/icons-react";
import { useClient } from "@/lib/clientContext";
import { RangeKey, RANGE_LABELS } from "@/lib/dashboardRanges";
import GraficoResultadosSdr from "./components/GraficoResultadosSdr";
import TablaRankingSdr from "./components/TablaRankingSdr";
import TablaRankingPais from "./components/TablaRankingPais";
import SdrMultiSelect from "./components/SdrMultiSelect";
import PaisMultiSelect from "./components/PaisMultiSelect";
import TablaScoresSdr, { type SdrScoreMetrics } from "./components/TablaScoresSdr";
import ModalScoreLlamadas from "./components/ModalScoreLlamadas";
import ClienteMultiSelect from "../clientes/components/ClienteMultiSelect";
import OrigenPieYDetalle, { type MeetingDetail } from "./components/OrigenPieYDetalle";
import ModalOrigenReuniones from "./components/ModalOrigenReuniones";
import NumeroMultiSelect from "./components/NumeroMultiSelect";
import TablaSaludTelefonica, { type NumeroSalud } from "./components/TablaSaludTelefonica";
import GraficoSaludTelefonica from "./components/GraficoSaludTelefonica";
import MapaCalorHorarios, { type CeldaHeatmap } from "./components/MapaCalorHorarios";

type SdrRoster = { sdr_id: string; sdr_nombre: string };
type PaisRoster = { pais_key: string; pais_nombre: string };
type ClienteRoster = { cliente_id: string; cliente_nombre: string };
type NumeroRoster = { numero: string; numero_nombre: string };

type SdrMetrics = {
  sdr_id: string;
  sdr_nombre: string;
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
  reuniones_agendadas_detalle?: MeetingDetail[];
  reuniones_realizadas_detalle?: MeetingDetail[];
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
  all_sdrs?: SdrRoster[];
  all_paises?: PaisRoster[];
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
};

type ScoresApiResponse = {
  sdr_scores: SdrScoreMetrics[];
  all_sdrs?: SdrRoster[];
  all_clientes?: ClienteRoster[];
};

type OrigenesApiResponse = {
  reuniones: MeetingDetail[];
  all_sdrs?: SdrRoster[];
  all_clientes?: ClienteRoster[];
};

type EvolucionDia = {
  fecha: string;
  porNumero: Record<string, { llamadas: number; conectadas: number }>;
};

type SaludApiResponse = {
  numeros_data: NumeroSalud[];
  resultados_por_dia: EvolucionDia[];
  all_clientes?: ClienteRoster[];
  all_numeros?: NumeroRoster[];
};

type HorariosApiResponse = {
  heatmap: CeldaHeatmap[];
  total_llamadas: number;
  all_clientes?: ClienteRoster[];
  all_paises?: PaisRoster[];
};

// Rangos propios de la sección "Resultados SDR" (no viven en
// lib/dashboardRanges.ts para no agregar estas opciones en los demás
// filtros de la app que comparten ese archivo). Van primero en el dropdown.
type GraficoRangeKey = RangeKey | "last_3_months" | "last_6_months";
const GRAFICO_RANGE_LABELS: Record<string, string> = {
  last_3_months: "Últimos 3 meses",
  last_6_months: "Últimos 6 meses",
  ...RANGE_LABELS,
};

// Botón "Actualizar" de cada informe — versión chica del botón global de
// arriba, para refrescar solo esa sección sin esperar a las demás.
function RefreshButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      title="Actualizar datos de este informe"
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-ink-muted hover:bg-gray-100 border border-gray-200 transition disabled:opacity-50"
    >
      {loading ? <IconLoader2 size={13} className="animate-spin" /> : <IconRefresh size={13} />}
      Actualizar
    </button>
  );
}

export default function AnalisisSdr() {
  const { currentClient } = useClient();

  const [graficoRangeKey, setGraficoRangeKey] = useState<GraficoRangeKey>("this_month");
  const [graficoCustomFrom, setGraficoCustomFrom] = useState<string>("");
  const [graficoCustomTo, setGraficoCustomTo] = useState<string>("");
  const [graficoSdrFilter, setGraficoSdrFilter] = useState<string[]>([]);
  const [graficoGranularidad, setGraficoGranularidad] = useState<"dia" | "semana" | "mes">("dia");
  const [graficoLoading, setGraficoLoading] = useState(false);
  const [graficoData, setGraficoData] = useState<ApiResponse | null>(null);
  const [graficoError, setGraficoError] = useState<string | null>(null);

  const [tablaRangeKey, setTablaRangeKey] = useState<RangeKey>("this_month");
  const [tablaCustomFrom, setTablaCustomFrom] = useState<string>("");
  const [tablaCustomTo, setTablaCustomTo] = useState<string>("");
  const [tablaSdrFilter, setTablaSdrFilter] = useState<string[]>([]);
  const [tablaPaisFilter, setTablaPaisFilter] = useState<string[]>([]);
  const [tablaLoading, setTablaLoading] = useState(false);
  const [tablaData, setTablaData] = useState<ApiResponse | null>(null);
  const [tablaError, setTablaError] = useState<string | null>(null);

  const [paisRangeKey, setPaisRangeKey] = useState<RangeKey>("this_month");
  const [paisCustomFrom, setPaisCustomFrom] = useState<string>("");
  const [paisCustomTo, setPaisCustomTo] = useState<string>("");
  const [paisSdrFilter, setPaisSdrFilter] = useState<string[]>([]);
  const [paisLoading, setPaisLoading] = useState(false);
  const [paisData, setPaisData] = useState<PaisApiResponse | null>(null);
  const [paisError, setPaisError] = useState<string | null>(null);

  const [scoresRangeKey, setScoresRangeKey] = useState<RangeKey>("this_month");
  const [scoresCustomFrom, setScoresCustomFrom] = useState<string>("");
  const [scoresCustomTo, setScoresCustomTo] = useState<string>("");
  const [scoresSdrFilter, setScoresSdrFilter] = useState<string[]>([]);
  const [scoresClienteFilter, setScoresClienteFilter] = useState<string[]>([]);
  const [scoresLoading, setScoresLoading] = useState(false);
  const [scoresData, setScoresData] = useState<ScoresApiResponse | null>(null);
  const [scoresError, setScoresError] = useState<string | null>(null);
  const [scoreModal, setScoreModal] = useState<{
    row: SdrScoreMetrics;
    metricKey: string;
    metricLabel: string;
  } | null>(null);

  // Modal de desglose por Origen que se abre al hacer clic en "Reuniones
  // Agendadas"/"Reuniones Realizadas" del Ranking SDR (por fila o Total).
  const [origenModal, setOrigenModal] = useState<{ title: string; reuniones: MeetingDetail[] } | null>(null);

  const [origenesRangeKey, setOrigenesRangeKey] = useState<RangeKey>("this_month");
  const [origenesCustomFrom, setOrigenesCustomFrom] = useState<string>("");
  const [origenesCustomTo, setOrigenesCustomTo] = useState<string>("");
  const [origenesSdrFilter, setOrigenesSdrFilter] = useState<string[]>([]);
  const [origenesClienteFilter, setOrigenesClienteFilter] = useState<string[]>([]);
  const [origenesLoading, setOrigenesLoading] = useState(false);
  const [origenesData, setOrigenesData] = useState<OrigenesApiResponse | null>(null);
  const [origenesError, setOrigenesError] = useState<string | null>(null);

  const [saludRangeKey, setSaludRangeKey] = useState<RangeKey>("this_month");
  const [saludCustomFrom, setSaludCustomFrom] = useState<string>("");
  const [saludCustomTo, setSaludCustomTo] = useState<string>("");
  const [saludClienteFilter, setSaludClienteFilter] = useState<string[]>([]);
  const [saludNumeroFilter, setSaludNumeroFilter] = useState<string[]>([]);
  const [saludLoading, setSaludLoading] = useState(false);
  const [saludData, setSaludData] = useState<SaludApiResponse | null>(null);
  const [saludError, setSaludError] = useState<string | null>(null);

  const [horariosRangeKey, setHorariosRangeKey] = useState<RangeKey>("this_month");
  const [horariosCustomFrom, setHorariosCustomFrom] = useState<string>("");
  const [horariosCustomTo, setHorariosCustomTo] = useState<string>("");
  const [horariosClienteFilter, setHorariosClienteFilter] = useState<string[]>([]);
  const [horariosPaisFilter, setHorariosPaisFilter] = useState<string[]>([]);
  const [horariosLoading, setHorariosLoading] = useState(false);
  const [horariosData, setHorariosData] = useState<HorariosApiResponse | null>(null);
  const [horariosError, setHorariosError] = useState<string | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  // Sync por informe (botón "Actualizar" de cada sección) — independiente
  // del botón global "Actualizar datos de reuniones".
  const [graficoSyncing, setGraficoSyncing] = useState(false);
  const [tablaSyncing, setTablaSyncing] = useState(false);
  const [paisSyncing, setPaisSyncing] = useState(false);
  const [origenesSyncing, setOrigenesSyncing] = useState(false);

  // Evita que una respuesta más lenta de un filtro anterior sobrescriba
  // los datos del filtro seleccionado actualmente (race condition).
  const graficoRequestId = useRef(0);
  const tablaRequestId = useRef(0);
  const paisRequestId = useRef(0);
  const scoresRequestId = useRef(0);
  const origenesRequestId = useRef(0);
  const saludRequestId = useRef(0);
  const horariosRequestId = useRef(0);

  // Las 4 secciones llaman a Allo por cada número asignado, y Allo limita a
  // 5 requests/segundo en total. Cada carga ya se pacía sola por dentro,
  // pero si dos o más secciones cargan al mismo tiempo (ej. al entrar a la
  // página, o al cambiar de cliente — las 4 dependen de currentClient.id)
  // la suma puede superar ese límite entre sí y gatillar un 429 que agota
  // los reintentos. Esta cola encadena todas las cargas para que nunca haya
  // más de una pegándole a Allo a la vez, sin importar qué la disparó.
  const alloQueueRef = useRef<Promise<void>>(Promise.resolve());
  function runQueued<T>(fn: () => Promise<T>): Promise<T> {
    const run = alloQueueRef.current.then(fn, fn);
    alloQueueRef.current = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  // "Resultados SDR" y "Ranking SDR" pegan a la misma API (/api/analisis/sdr)
  // y, sin ningún filtro propio distinto (el caso más común: recién se
  // entra a la página, o se cambia de cliente), piden exactamente la misma
  // consulta. Antes cada sección hacía su propio fetch, duplicando el
  // trabajo (y las llamadas a Allo) entre las dos. Este cache comparte, por
  // URL exacta, la respuesta EN VUELO entre ambas — si llegan a pedir lo
  // mismo al mismo tiempo, solo una pega a la API y la otra reutiliza esa
  // misma promesa. Se limpia apenas resuelve (éxito o error): es solo para
  // deduplicar llamadas concurrentes, no para servir datos obsoletos en
  // cargas posteriores no simultáneas.
  const sdrFetchCacheRef = useRef<Map<string, Promise<ApiResponse>>>(new Map());
  function fetchSdrShared(url: string): Promise<ApiResponse> {
    const cache = sdrFetchCacheRef.current;
    const cached = cache.get(url);
    if (cached) return cached;

    const promise = runQueued(async () => {
      const response = await fetch(url);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Error al cargar datos");
      }
      return (await response.json()) as ApiResponse;
    });
    cache.set(url, promise);
    promise.catch(() => {}).finally(() => {
      if (cache.get(url) === promise) cache.delete(url);
    });
    return promise;
  }

  // Trae la última versión del Excel de reuniones (Google Sheets) a la
  // tabla `meetings` — acotado a los últimos 40 días como máximo (ver
  // /api/meetings/sync), para que el botón "Actualizar" responda rápido en
  // vez de re-sincronizar todo el historial. Tanto el botón global como el
  // de cada informe individual pasan por este mismo helper: si dos botones
  // se aprietan casi al mismo tiempo, comparten la misma sincronización en
  // vez de disparar dos en paralelo.
  const meetingsSyncPromiseRef = useRef<Promise<{ error?: string; synced?: number }> | null>(null);
  function syncMeetingsOnce(): Promise<{ error?: string; synced?: number }> {
    if (meetingsSyncPromiseRef.current) return meetingsSyncPromiseRef.current;
    const promise = fetch("/api/meetings/sync").then((r) => r.json());
    meetingsSyncPromiseRef.current = promise;
    promise.finally(() => {
      if (meetingsSyncPromiseRef.current === promise) meetingsSyncPromiseRef.current = null;
    });
    return promise;
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
        ...(graficoSdrFilter.length > 0 && { sdr_ids: graficoSdrFilter.join(",") }),
        ...(graficoRangeKey === "custom" && {
          custom_from: graficoCustomFrom,
          custom_to: graficoCustomTo,
        }),
      });

      const data = await fetchSdrShared(`/api/analisis/sdr?${searchParams}`);
      if (requestId !== graficoRequestId.current) return; // respuesta obsoleta
      setGraficoData(data);
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
        ...(tablaSdrFilter.length > 0 && { sdr_ids: tablaSdrFilter.join(",") }),
        ...(tablaPaisFilter.length > 0 && { paises: tablaPaisFilter.join(",") }),
        ...(tablaRangeKey === "custom" && {
          custom_from: tablaCustomFrom,
          custom_to: tablaCustomTo,
        }),
      });

      const data = await fetchSdrShared(`/api/analisis/sdr?${searchParams}`);
      if (requestId !== tablaRequestId.current) return; // respuesta obsoleta
      setTablaData(data);
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

  const loadScores = async () => {
    // Con "Fecha personalizada" esperamos a que ambas fechas estén elegidas
    if (scoresRangeKey === "custom" && (!scoresCustomFrom || !scoresCustomTo)) return;

    const requestId = ++scoresRequestId.current;
    setScoresLoading(true);
    setScoresError(null);
    try {
      const searchParams = new URLSearchParams({
        rangeKey: scoresRangeKey,
        client_id: currentClient?.id || "__all__",
        ...(scoresSdrFilter.length > 0 && { sdr_ids: scoresSdrFilter.join(",") }),
        ...(scoresClienteFilter.length > 0 && { cliente_ids: scoresClienteFilter.join(",") }),
        ...(scoresRangeKey === "custom" && {
          custom_from: scoresCustomFrom,
          custom_to: scoresCustomTo,
        }),
      });

      const response = await fetch(`/api/analisis/scores?${searchParams}`);
      if (requestId !== scoresRequestId.current) return; // respuesta obsoleta

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setScoresError(body?.error || "Error al cargar datos");
      } else {
        setScoresData(await response.json());
      }
    } catch (err) {
      if (requestId !== scoresRequestId.current) return;
      setScoresError((err as Error).message);
    } finally {
      if (requestId === scoresRequestId.current) setScoresLoading(false);
    }
  };

  const loadOrigenes = async () => {
    // Con "Fecha personalizada" esperamos a que ambas fechas estén elegidas
    if (origenesRangeKey === "custom" && (!origenesCustomFrom || !origenesCustomTo)) return;

    const requestId = ++origenesRequestId.current;
    setOrigenesLoading(true);
    setOrigenesError(null);
    try {
      const searchParams = new URLSearchParams({
        rangeKey: origenesRangeKey,
        client_id: currentClient?.id || "__all__",
        ...(origenesSdrFilter.length > 0 && { sdr_ids: origenesSdrFilter.join(",") }),
        ...(origenesClienteFilter.length > 0 && { cliente_ids: origenesClienteFilter.join(",") }),
        ...(origenesRangeKey === "custom" && {
          custom_from: origenesCustomFrom,
          custom_to: origenesCustomTo,
        }),
      });

      const response = await fetch(`/api/analisis/origenes?${searchParams}`);
      if (requestId !== origenesRequestId.current) return; // respuesta obsoleta

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setOrigenesError(body?.error || "Error al cargar datos");
      } else {
        setOrigenesData(await response.json());
      }
    } catch (err) {
      if (requestId !== origenesRequestId.current) return;
      setOrigenesError((err as Error).message);
    } finally {
      if (requestId === origenesRequestId.current) setOrigenesLoading(false);
    }
  };

  const loadSalud = async () => {
    // Con "Fecha personalizada" esperamos a que ambas fechas estén elegidas
    if (saludRangeKey === "custom" && (!saludCustomFrom || !saludCustomTo)) return;

    const requestId = ++saludRequestId.current;
    setSaludLoading(true);
    setSaludError(null);
    try {
      const searchParams = new URLSearchParams({
        rangeKey: saludRangeKey,
        client_id: currentClient?.id || "__all__",
        ...(saludClienteFilter.length > 0 && { cliente_ids: saludClienteFilter.join(",") }),
        ...(saludNumeroFilter.length > 0 && { numeros: saludNumeroFilter.join(",") }),
        ...(saludRangeKey === "custom" && {
          custom_from: saludCustomFrom,
          custom_to: saludCustomTo,
        }),
      });

      const response = await fetch(`/api/analisis/salud-telefonica?${searchParams}`);
      if (requestId !== saludRequestId.current) return; // respuesta obsoleta

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setSaludError(body?.error || "Error al cargar datos");
      } else {
        setSaludData(await response.json());
      }
    } catch (err) {
      if (requestId !== saludRequestId.current) return;
      setSaludError((err as Error).message);
    } finally {
      if (requestId === saludRequestId.current) setSaludLoading(false);
    }
  };

  const loadHorarios = async () => {
    // Con "Fecha personalizada" esperamos a que ambas fechas estén elegidas
    if (horariosRangeKey === "custom" && (!horariosCustomFrom || !horariosCustomTo)) return;

    const requestId = ++horariosRequestId.current;
    setHorariosLoading(true);
    setHorariosError(null);
    try {
      const searchParams = new URLSearchParams({
        rangeKey: horariosRangeKey,
        client_id: currentClient?.id || "__all__",
        ...(horariosClienteFilter.length > 0 && { cliente_ids: horariosClienteFilter.join(",") }),
        ...(horariosPaisFilter.length > 0 && { paises: horariosPaisFilter.join(",") }),
        ...(horariosRangeKey === "custom" && {
          custom_from: horariosCustomFrom,
          custom_to: horariosCustomTo,
        }),
      });

      const response = await fetch(`/api/analisis/horarios?${searchParams}`);
      if (requestId !== horariosRequestId.current) return; // respuesta obsoleta

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setHorariosError(body?.error || "Error al cargar datos");
      } else {
        setHorariosData(await response.json());
      }
    } catch (err) {
      if (requestId !== horariosRequestId.current) return;
      setHorariosError((err as Error).message);
    } finally {
      if (requestId === horariosRequestId.current) setHorariosLoading(false);
    }
  };

  // Trae la última versión del Excel de reuniones (Google Sheets, últimos 40
  // días) a la tabla `meetings` y recarga los 4 informes que dependen de
  // ella, para que Reuniones Agendadas/Realizadas y Origen calcen con el
  // reporte interno que lee el mismo Excel — la sincronización automática
  // puede no haber corrido recién. El Score de Llamadas IA no depende de
  // `meetings` (solo de Allo), así que no se recarga acá — tiene su propio
  // ciclo de carga vía useEffect y su propio botón "Actualizar".
  const handleSync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const data = await syncMeetingsOnce();
      if (data.error) {
        setSyncMessage(`Error al actualizar: ${data.error}`);
      } else {
        setSyncMessage(`✓ Datos actualizados — ${data.synced ?? 0} reuniones sincronizadas`);
        // loadGrafico/loadTabla ya encolan su propio fetch por dentro (ver
        // fetchSdrShared) y loadPais sigue envuelto acá: entre los cuatro
        // nunca hay más de una sección pegándole a Allo a la vez (mismo
        // alloQueueRef que usa fetchSdrShared). loadOrigenes no usa Allo.
        await loadGrafico();
        await loadTabla();
        await runQueued(loadPais);
        await loadOrigenes();
      }
    } catch (err) {
      setSyncMessage(`Error al actualizar: ${(err as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  // Botones "Actualizar" de cada informe — igual que el botón global, pero
  // acotados a una sola sección para no esperar a que se recarguen las
  // demás. Score de Llamadas IA no sincroniza `meetings` (no lo usa).
  const handleRefreshGrafico = async () => {
    setGraficoSyncing(true);
    try {
      await syncMeetingsOnce();
      await loadGrafico();
    } finally {
      setGraficoSyncing(false);
    }
  };

  const handleRefreshTabla = async () => {
    setTablaSyncing(true);
    try {
      await syncMeetingsOnce();
      await loadTabla();
    } finally {
      setTablaSyncing(false);
    }
  };

  const handleRefreshPais = async () => {
    setPaisSyncing(true);
    try {
      await syncMeetingsOnce();
      await runQueued(loadPais);
    } finally {
      setPaisSyncing(false);
    }
  };

  const handleRefreshOrigenes = async () => {
    setOrigenesSyncing(true);
    try {
      await syncMeetingsOnce();
      await loadOrigenes();
    } finally {
      setOrigenesSyncing(false);
    }
  };

  // loadGrafico/loadTabla ya encolan su propio fetch por dentro de
  // fetchSdrShared (y comparten la respuesta cuando piden lo mismo al mismo
  // tiempo), así que no hace falta envolverlos en runQueued acá.
  useEffect(() => {
    if (currentClient?.id) {
      loadGrafico();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentClient?.id, graficoRangeKey, graficoSdrFilter, graficoCustomFrom, graficoCustomTo]);

  useEffect(() => {
    if (currentClient?.id) {
      loadTabla();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentClient?.id, tablaRangeKey, tablaSdrFilter, tablaPaisFilter, tablaCustomFrom, tablaCustomTo]);

  useEffect(() => {
    if (currentClient?.id) {
      runQueued(loadPais);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentClient?.id, paisRangeKey, paisSdrFilter, paisCustomFrom, paisCustomTo]);

  useEffect(() => {
    if (currentClient?.id) {
      runQueued(loadScores);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentClient?.id, scoresRangeKey, scoresSdrFilter, scoresClienteFilter, scoresCustomFrom, scoresCustomTo]);

  // No depende de Allo (solo consulta `meetings` en Supabase), así que no
  // necesita pasar por runQueued/alloQueueRef.
  useEffect(() => {
    if (currentClient?.id) {
      loadOrigenes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentClient?.id, origenesRangeKey, origenesSdrFilter, origenesClienteFilter, origenesCustomFrom, origenesCustomTo]);

  useEffect(() => {
    if (currentClient?.id) {
      runQueued(loadSalud);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentClient?.id, saludRangeKey, saludClienteFilter, saludNumeroFilter, saludCustomFrom, saludCustomTo]);

  useEffect(() => {
    if (currentClient?.id) {
      runQueued(loadHorarios);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentClient?.id, horariosRangeKey, horariosClienteFilter, horariosPaisFilter, horariosCustomFrom, horariosCustomTo]);

  const handleRankingOrigenClick = (
    row: SdrMetrics | null,
    key: "reuniones_agendadas" | "reuniones_realizadas",
    label: string
  ) => {
    const detailKey = key === "reuniones_agendadas" ? "reuniones_agendadas_detalle" : "reuniones_realizadas_detalle";
    const source = row ? [row] : tablaData?.sdrs_data || [];
    const reuniones = source.flatMap((r) => r[detailKey] || []);
    setOrigenModal({ title: `${label} — ${row ? row.sdr_nombre : "Total"}`, reuniones });
  };

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
            <IconPhone size={16} className="text-brand" /> Resultados SDR
          </h2>
          <RefreshButton onClick={handleRefreshGrafico} loading={graficoSyncing || graficoLoading} />
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
            <label className="text-xs text-ink-muted font-medium">SDR</label>
            <SdrMultiSelect
              sdrs={graficoData?.all_sdrs || []}
              selected={graficoSdrFilter}
              onChange={setGraficoSdrFilter}
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

      {/* Sección Tabla */}
      <section className="card space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap pb-3 border-b">
          <h2 className="font-semibold flex items-center gap-2">
            <IconTrendingUp size={16} className="text-brand" /> Ranking SDR
          </h2>
          <RefreshButton onClick={handleRefreshTabla} loading={tablaSyncing || tablaLoading} />
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
            <label className="text-xs text-ink-muted font-medium">SDR</label>
            <SdrMultiSelect
              sdrs={tablaData?.all_sdrs || []}
              selected={tablaSdrFilter}
              onChange={setTablaSdrFilter}
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-muted font-medium">País</label>
            <PaisMultiSelect
              paises={tablaData?.all_paises || []}
              selected={tablaPaisFilter}
              onChange={setTablaPaisFilter}
            />
          </div>
        </div>

        <p className="text-xs text-ink-muted">
          Métricas consolidadas por SDR — haz clic en cualquier encabezado para ordenar, y en los
          números de Reuniones Agendadas/Realizadas para ver su desglose por Origen.
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
            <TablaRankingSdr data={tablaData.sdrs_data} onOrigenClick={handleRankingOrigenClick} />
          )
        )}
      </section>

      {/* Sección Ranking País */}
      <section className="card space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap pb-3 border-b">
          <h2 className="font-semibold flex items-center gap-2">
            <IconTrendingUp size={16} className="text-brand" /> Ranking País
          </h2>
          <RefreshButton onClick={handleRefreshPais} loading={paisSyncing || paisLoading} />
        </div>

        {/* Filtros específicos de la tabla — el filtro de cliente es el
            selector global del sidebar, igual que en el resto de la página. */}
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

      {/* Sección Score de Llamadas IA */}
      <section className="card space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap pb-3 border-b">
          <h2 className="font-semibold flex items-center gap-2">
            <IconTrendingUp size={16} className="text-brand" /> Score de Llamadas IA
          </h2>
          <RefreshButton onClick={() => runQueued(loadScores)} loading={scoresLoading} />
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-muted font-medium">Período</label>
            <select
              value={scoresRangeKey}
              onChange={(e) => setScoresRangeKey(e.target.value as RangeKey)}
              className="input py-1.5 text-sm"
            >
              {Object.entries(RANGE_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          {scoresRangeKey === "custom" && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={scoresCustomFrom}
                onChange={(e) => setScoresCustomFrom(e.target.value)}
                className="input py-1.5 text-sm"
              />
              <span className="text-xs text-ink-muted">a</span>
              <input
                type="date"
                value={scoresCustomTo}
                onChange={(e) => setScoresCustomTo(e.target.value)}
                className="input py-1.5 text-sm"
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-muted font-medium">SDR</label>
            <SdrMultiSelect
              sdrs={scoresData?.all_sdrs || []}
              selected={scoresSdrFilter}
              onChange={setScoresSdrFilter}
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-muted font-medium">Cliente</label>
            <ClienteMultiSelect
              clientes={scoresData?.all_clientes || []}
              selected={scoresClienteFilter}
              onChange={setScoresClienteFilter}
            />
          </div>
        </div>

        <p className="text-xs text-ink-muted">
          Promedios del análisis de llamadas con IA que genera Allo (Puntaje Total y desglose por
          ítem) — solo se incluyen llamadas que tienen ese análisis. Haz clic en cualquier nota
          para ver las llamadas que la componen.
        </p>

        {scoresError && (
          <div className="flex items-center gap-2 text-error-fg text-sm p-3 rounded bg-error-bg/20 border border-error-bg">
            <IconAlertCircle size={16} className="shrink-0" />
            {scoresError}
          </div>
        )}

        {scoresLoading && (
          <div className="flex items-center justify-center py-12 text-ink-muted gap-2">
            <IconLoader2 size={18} className="animate-spin" />
            Cargando datos…
          </div>
        )}

        {!scoresLoading && scoresData && (
          <TablaScoresSdr
            data={scoresData.sdr_scores}
            onCellClick={(row, metricKey, metricLabel) => setScoreModal({ row, metricKey, metricLabel })}
          />
        )}
      </section>

      {/* Sección Origen de Reuniones */}
      <section className="card space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap pb-3 border-b">
          <h2 className="font-semibold flex items-center gap-2">
            <IconTrendingUp size={16} className="text-brand" /> Origen de Reuniones
          </h2>
          <RefreshButton onClick={handleRefreshOrigenes} loading={origenesSyncing || origenesLoading} />
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-muted font-medium">Período</label>
            <select
              value={origenesRangeKey}
              onChange={(e) => setOrigenesRangeKey(e.target.value as RangeKey)}
              className="input py-1.5 text-sm"
            >
              {Object.entries(RANGE_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          {origenesRangeKey === "custom" && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={origenesCustomFrom}
                onChange={(e) => setOrigenesCustomFrom(e.target.value)}
                className="input py-1.5 text-sm"
              />
              <span className="text-xs text-ink-muted">a</span>
              <input
                type="date"
                value={origenesCustomTo}
                onChange={(e) => setOrigenesCustomTo(e.target.value)}
                className="input py-1.5 text-sm"
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-muted font-medium">SDR</label>
            <SdrMultiSelect
              sdrs={origenesData?.all_sdrs || []}
              selected={origenesSdrFilter}
              onChange={setOrigenesSdrFilter}
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-muted font-medium">Cliente</label>
            <ClienteMultiSelect
              clientes={origenesData?.all_clientes || []}
              selected={origenesClienteFilter}
              onChange={setOrigenesClienteFilter}
            />
          </div>
        </div>

        <p className="text-xs text-ink-muted">
          Distribución por Origen de todas las reuniones del período (según su Fecha de reunión),
          sin importar su estado — las categorías sin reuniones en el período no se muestran.
        </p>

        {origenesError && (
          <div className="flex items-center gap-2 text-error-fg text-sm p-3 rounded bg-error-bg/20 border border-error-bg">
            <IconAlertCircle size={16} className="shrink-0" />
            {origenesError}
          </div>
        )}

        {origenesLoading && (
          <div className="flex items-center justify-center py-12 text-ink-muted gap-2">
            <IconLoader2 size={18} className="animate-spin" />
            Cargando datos…
          </div>
        )}

        {!origenesLoading && origenesData && <OrigenPieYDetalle reuniones={origenesData.reuniones} />}
      </section>

      {/* Sección Salud Telefónica */}
      <section className="card space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap pb-3 border-b">
          <h2 className="font-semibold flex items-center gap-2">
            <IconPhone size={16} className="text-brand" /> Salud Telefónica
          </h2>
          <RefreshButton onClick={() => runQueued(loadSalud)} loading={saludLoading} />
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-muted font-medium">Período</label>
            <select
              value={saludRangeKey}
              onChange={(e) => setSaludRangeKey(e.target.value as RangeKey)}
              className="input py-1.5 text-sm"
            >
              {Object.entries(RANGE_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          {saludRangeKey === "custom" && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={saludCustomFrom}
                onChange={(e) => setSaludCustomFrom(e.target.value)}
                className="input py-1.5 text-sm"
              />
              <span className="text-xs text-ink-muted">a</span>
              <input
                type="date"
                value={saludCustomTo}
                onChange={(e) => setSaludCustomTo(e.target.value)}
                className="input py-1.5 text-sm"
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-muted font-medium">Cliente</label>
            <ClienteMultiSelect
              clientes={saludData?.all_clientes || []}
              selected={saludClienteFilter}
              onChange={setSaludClienteFilter}
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-muted font-medium">Número</label>
            <NumeroMultiSelect
              numeros={saludData?.all_numeros || []}
              selected={saludNumeroFilter}
              onChange={setSaludNumeroFilter}
            />
          </div>
        </div>

        <p className="text-xs text-ink-muted">
          Llamadas y tasa de conexión (sin buzón de voz) por número de Allo, comparada contra el
          período anterior — una caída sostenida suele ser señal de que el número quedó marcado
          como spam por las operadoras. Filas en rojo/amarillo destacan caídas fuertes.
        </p>

        {saludError && (
          <div className="flex items-center gap-2 text-error-fg text-sm p-3 rounded bg-error-bg/20 border border-error-bg">
            <IconAlertCircle size={16} className="shrink-0" />
            {saludError}
          </div>
        )}

        {saludLoading && (
          <div className="flex items-center justify-center py-12 text-ink-muted gap-2">
            <IconLoader2 size={18} className="animate-spin" />
            Cargando datos…
          </div>
        )}

        {!saludLoading && saludData && (
          saludData.numeros_data.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-ink-muted">
              No hay datos disponibles
            </div>
          ) : (
            <div className="space-y-6">
              <GraficoSaludTelefonica
                resultadosPorDia={saludData.resultados_por_dia}
                numeros={saludData.numeros_data.map((n) => ({ numero: n.numero, numero_nombre: n.numero_nombre }))}
              />
              <TablaSaludTelefonica data={saludData.numeros_data} />
            </div>
          )
        )}
      </section>

      {/* Sección Mejores Horarios para Conectar */}
      <section className="card space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap pb-3 border-b">
          <h2 className="font-semibold flex items-center gap-2">
            <IconClock size={16} className="text-brand" /> Mejores Horarios para Conectar
          </h2>
          <RefreshButton onClick={() => runQueued(loadHorarios)} loading={horariosLoading} />
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-muted font-medium">Período</label>
            <select
              value={horariosRangeKey}
              onChange={(e) => setHorariosRangeKey(e.target.value as RangeKey)}
              className="input py-1.5 text-sm"
            >
              {Object.entries(RANGE_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          {horariosRangeKey === "custom" && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={horariosCustomFrom}
                onChange={(e) => setHorariosCustomFrom(e.target.value)}
                className="input py-1.5 text-sm"
              />
              <span className="text-xs text-ink-muted">a</span>
              <input
                type="date"
                value={horariosCustomTo}
                onChange={(e) => setHorariosCustomTo(e.target.value)}
                className="input py-1.5 text-sm"
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-muted font-medium">Cliente</label>
            <ClienteMultiSelect
              clientes={horariosData?.all_clientes || []}
              selected={horariosClienteFilter}
              onChange={setHorariosClienteFilter}
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-muted font-medium">País</label>
            <PaisMultiSelect
              paises={horariosData?.all_paises || []}
              selected={horariosPaisFilter}
              onChange={setHorariosPaisFilter}
            />
          </div>
        </div>

        <p className="text-xs text-ink-muted">
          Tasa de conexión (sin buzón de voz) por día y hora de Chile, sumando todas las llamadas del
          período — muestra en qué horarios más nos contestan el teléfono.
        </p>

        {horariosError && (
          <div className="flex items-center gap-2 text-error-fg text-sm p-3 rounded bg-error-bg/20 border border-error-bg">
            <IconAlertCircle size={16} className="shrink-0" />
            {horariosError}
          </div>
        )}

        {horariosLoading && (
          <div className="flex items-center justify-center py-12 text-ink-muted gap-2">
            <IconLoader2 size={18} className="animate-spin" />
            Cargando datos…
          </div>
        )}

        {!horariosLoading && horariosData && (
          <MapaCalorHorarios heatmap={horariosData.heatmap} totalLlamadas={horariosData.total_llamadas} />
        )}
      </section>

      {scoreModal && (
        <ModalScoreLlamadas
          isOpen={!!scoreModal}
          sdrNombre={scoreModal.row.sdr_nombre}
          metricKey={scoreModal.metricKey}
          metricLabel={scoreModal.metricLabel}
          calls={scoreModal.row.calls}
          onClose={() => setScoreModal(null)}
        />
      )}

      {origenModal && (
        <ModalOrigenReuniones
          isOpen={!!origenModal}
          title={origenModal.title}
          reuniones={origenModal.reuniones}
          onClose={() => setOrigenModal(null)}
        />
      )}
    </div>
  );
}
