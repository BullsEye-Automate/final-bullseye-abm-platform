"use client";

import { useMemo, useState } from "react";
import { IconArrowUp, IconArrowDown, IconMaximize, IconX } from "@tabler/icons-react";
import type { MeetingDetail } from "./OrigenPieYDetalle";
import { resolveSdrKey } from "@/lib/sdrAnalytics";

export type ActividadHubspotSdr = { sdr_key: string; email: number; linkedin: number; whatsapp: number };

interface SdrMetrics {
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
}

// "Llamadas x Contacto" no viene de la API — se calcula acá mismo a partir
// de Llamadas ÷ Contactos Gestionados, ya que ambos ya están en cada fila.
// Las 3 columnas de actividades de HubSpot (Correo/LinkedIn/WhatsApp) sí
// vienen de una API aparte (/api/analisis/actividades-hubspot, ver
// page.tsx) — se cruzan acá por nombre de SDR normalizado, igual que el
// propio Ranking SDR cruza Allo con `meetings`.
type DerivedMetrics = SdrMetrics & {
  llamadas_por_contacto: number;
  actividades_email: number;
  actividades_linkedin: number;
  actividades_whatsapp: number;
};

// Columnas cuyo número se puede hacer clic para ver el desglose por Origen.
type OrigenClickableKey = "reuniones_agendadas" | "reuniones_realizadas";
const ORIGEN_CLICKABLE_KEYS = new Set<OrigenClickableKey>(["reuniones_agendadas", "reuniones_realizadas"]);

type SortKey = keyof Omit<DerivedMetrics, "reuniones_agendadas_detalle" | "reuniones_realizadas_detalle">;
type NumericKey = Exclude<SortKey, "sdr_id" | "sdr_nombre">;
type SortDir = "asc" | "desc";

interface TablaRankingSdrProps {
  data: SdrMetrics[];
  // row === null representa la fila "Total" (todas las filas filtradas).
  onOrigenClick?: (row: SdrMetrics | null, key: OrigenClickableKey, label: string) => void;
  // Actividades de HubSpot por SDR (ver /api/analisis/actividades-hubspot),
  // keyed por sdr_key (mismo resolveSdrKey usado para cruzar Allo↔meetings).
  // A diferencia del resto de la tabla, no se filtra por cliente ni país.
  actividadesHubspot?: ActividadHubspotSdr[];
}

const COLUMNS: { key: NumericKey; label: string; description: string }[] = [
  {
    key: "contactos_gestionados",
    label: "Contactos Gestionados",
    description: "Teléfonos distintos marcados en el período, sin importar si se conectaron o no.",
  },
  {
    key: "llamadas_realizadas",
    label: "Llamadas",
    description: "Total de llamadas salientes realizadas en el período (pueden repetirse por contacto).",
  },
  {
    key: "llamadas_por_contacto",
    label: "Llamadas x Contacto",
    description: "Llamadas ÷ Contactos Gestionados — promedio de intentos por cada contacto marcado.",
  },
  {
    key: "contactos_conectados",
    label: "Contactos Conectados",
    description: "Teléfonos distintos con al menos una llamada conectada (contestada o transferida, de 60 segundos o más).",
  },
  {
    key: "llamadas_conectadas",
    label: "Llamadas Conectadas",
    description: "Llamadas contestadas o transferidas que duraron 60 segundos o más.",
  },
  {
    key: "actividades_email",
    label: "Correos (HubSpot)",
    description:
      "Correos registrados por el SDR en HubSpot en el período. A diferencia del resto de la tabla, es el total del SDR en TODOS los clientes — HubSpot aún no distingue a qué cliente de BullsEye pertenece cada actividad.",
  },
  {
    key: "actividades_linkedin",
    label: "LinkedIn (HubSpot)",
    description:
      "Mensajes de LinkedIn registrados por el SDR en HubSpot en el período. Total del SDR en TODOS los clientes (ver nota de Correos).",
  },
  {
    key: "actividades_whatsapp",
    label: "WhatsApp (HubSpot)",
    description:
      "Mensajes de WhatsApp registrados por el SDR en HubSpot en el período. Total del SDR en TODOS los clientes (ver nota de Correos).",
  },
  {
    key: "reuniones_agendadas",
    label: "Reuniones Agendadas",
    description: "Reuniones cuya Fecha de agendamiento cae dentro del período (sin importar cuándo ocurre la reunión).",
  },
  {
    key: "reuniones_realizadas",
    label: "Reuniones Realizadas",
    description: "De las reuniones con fecha en el período, las que quedaron marcadas como \"Sí\" (se realizaron).",
  },
  {
    key: "reuniones_pendientes",
    label: "Reuniones Pendientes",
    description: "De las reuniones con fecha en el período, las que siguen marcadas como \"Pendiente\".",
  },
  {
    key: "tasa_conectadas_por_contacto",
    label: "Contactos Conectados/Gestionados",
    description: "Contactos Conectados ÷ Contactos Gestionados — de los teléfonos marcados, a qué porcentaje se logró conectar.",
  },
  {
    key: "tasa_agendada_por_conectada",
    label: "Tasa Agendada/Conectada",
    description: "Reuniones agendadas dentro del período (según su Fecha de agendamiento) ÷ Contactos Conectados — mismo numerador que la columna Reuniones Agendadas.",
  },
  {
    key: "tasa_realizacion_reuniones",
    label: "Tasa Realización",
    description: "Reuniones Realizadas ÷ Reuniones Agendadas.",
  },
];

const PERCENT_KEYS = new Set<NumericKey>([
  "tasa_conectadas_por_contacto",
  "tasa_agendada_por_conectada",
  "tasa_realizacion_reuniones",
]);

// Columnas de razón (no porcentaje, no entero) que se muestran con 1 decimal.
const RATIO_KEYS = new Set<NumericKey>(["llamadas_por_contacto"]);

export default function TablaRankingSdr({ data, onOrigenClick, actividadesHubspot }: TablaRankingSdrProps) {
  const [sortKey, setSortKey] = useState<SortKey>("reuniones_realizadas");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [isFullscreen, setIsFullscreen] = useState(false);

  const actividadesPorSdrKey = useMemo(() => {
    const map = new Map<string, ActividadHubspotSdr>();
    for (const a of actividadesHubspot || []) map.set(a.sdr_key, a);
    return map;
  }, [actividadesHubspot]);

  const dataWithDerived: DerivedMetrics[] = useMemo(
    () =>
      data.map((d) => {
        const actividad = actividadesPorSdrKey.get(resolveSdrKey(d.sdr_nombre));
        return {
          ...d,
          llamadas_por_contacto: d.contactos_gestionados > 0 ? d.llamadas_realizadas / d.contactos_gestionados : 0,
          actividades_email: actividad?.email || 0,
          actividades_linkedin: actividad?.linkedin || 0,
          actividades_whatsapp: actividad?.whatsapp || 0,
        };
      }),
    [data, actividadesPorSdrKey]
  );

  const sortedData = useMemo(() => {
    const sorted = [...dataWithDerived].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];

      if (typeof aVal === "string") {
        return sortDir === "asc" ? aVal.localeCompare(bVal as string) : (bVal as string).localeCompare(aVal);
      }

      const numA = aVal as number;
      const numB = bVal as number;
      return sortDir === "asc" ? numA - numB : numB - numA;
    });

    return sorted;
  }, [dataWithDerived, sortKey, sortDir]);

  const totals = useMemo(() => {
    const count = dataWithDerived.length || 1;
    const sum = (key: keyof DerivedMetrics) => dataWithDerived.reduce((acc, sdr) => acc + (sdr[key] as number), 0);
    const totalContactos = sum("contactos_gestionados");
    const totalLlamadas = sum("llamadas_realizadas");
    return {
      contactos_gestionados: totalContactos,
      llamadas_realizadas: totalLlamadas,
      // Se recalcula sobre los totales (no un promedio de razones por SDR)
      // para reflejar el promedio real del período completo.
      llamadas_por_contacto: totalContactos > 0 ? totalLlamadas / totalContactos : 0,
      contactos_conectados: sum("contactos_conectados"),
      llamadas_conectadas: sum("llamadas_conectadas"),
      actividades_email: sum("actividades_email"),
      actividades_linkedin: sum("actividades_linkedin"),
      actividades_whatsapp: sum("actividades_whatsapp"),
      reuniones_agendadas: sum("reuniones_agendadas"),
      reuniones_realizadas: sum("reuniones_realizadas"),
      reuniones_pendientes: sum("reuniones_pendientes"),
      tasa_conectadas_por_contacto: sum("tasa_conectadas_por_contacto") / count,
      tasa_agendada_por_conectada: sum("tasa_agendada_por_conectada") / count,
      tasa_realizacion_reuniones: sum("tasa_realizacion_reuniones") / count,
    };
  }, [dataWithDerived]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return <span className="text-gray-300 ml-1">↕</span>;
    return sortDir === "asc" ? (
      <IconArrowUp size={14} className="inline ml-1" />
    ) : (
      <IconArrowDown size={14} className="inline ml-1" />
    );
  };

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-ink-muted">
        No hay datos disponibles
      </div>
    );
  }

  const table = (
    <div className={isFullscreen ? "overflow-auto h-full" : "overflow-auto max-h-[600px]"}>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
          <tr>
            <th
              className="px-4 py-3 text-left font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 bg-gray-50"
              title="Nombre del SDR responsable de las llamadas y/o reuniones."
            >
              <button onClick={() => toggleSort("sdr_nombre")} className="flex items-center">
                SDR
                <SortIcon column="sdr_nombre" />
              </button>
            </th>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                className="px-4 py-3 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 bg-gray-50"
                title={col.description}
              >
                <button onClick={() => toggleSort(col.key)} className="flex items-center justify-end w-full">
                  {col.label}
                  <SortIcon column={col.key} />
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sortedData.map((sdr, idx) => (
            <tr key={sdr.sdr_id} className={idx % 2 === 0 ? "bg-white hover:bg-gray-50" : "bg-gray-50 hover:bg-gray-100"}>
              <td className="px-4 py-3 font-medium text-gray-900">{sdr.sdr_nombre}</td>
              {COLUMNS.map((col) => (
                <td key={col.key} className="px-4 py-3 text-right text-gray-700">
                  {onOrigenClick && ORIGEN_CLICKABLE_KEYS.has(col.key as OrigenClickableKey) ? (
                    <button
                      onClick={() => onOrigenClick(sdr, col.key as OrigenClickableKey, col.label)}
                      className="hover:underline hover:text-brand transition"
                      title="Ver desglose por Origen"
                    >
                      {sdr[col.key]}
                    </button>
                  ) : PERCENT_KEYS.has(col.key) ? (
                    `${(sdr[col.key] as number).toFixed(1)}%`
                  ) : RATIO_KEYS.has(col.key) ? (
                    (sdr[col.key] as number).toFixed(1)
                  ) : (
                    sdr[col.key]
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold sticky bottom-0">
            <td className="px-4 py-3 text-gray-900">Total</td>
            {COLUMNS.map((col) => (
              <td key={col.key} className="px-4 py-3 text-right text-gray-900">
                {onOrigenClick && ORIGEN_CLICKABLE_KEYS.has(col.key as OrigenClickableKey) ? (
                  <button
                    onClick={() => onOrigenClick(null, col.key as OrigenClickableKey, col.label)}
                    className="hover:underline hover:text-brand transition"
                    title="Ver desglose por Origen"
                  >
                    {totals[col.key]}
                  </button>
                ) : PERCENT_KEYS.has(col.key) ? (
                  `${totals[col.key].toFixed(1)}%`
                ) : RATIO_KEYS.has(col.key) ? (
                  totals[col.key].toFixed(1)
                ) : (
                  totals[col.key]
                )}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-white flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
          <h2 className="font-semibold text-gray-900">Ranking SDR</h2>
          <button
            onClick={() => setIsFullscreen(false)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition"
          >
            <IconX size={16} />
            Cerrar
          </button>
        </div>
        <div className="flex-1 min-h-0">{table}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-end mb-2">
        <button
          onClick={() => setIsFullscreen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-600 hover:bg-gray-100 border border-gray-200 transition"
        >
          <IconMaximize size={14} />
          Ver en pantalla completa
        </button>
      </div>
      {table}
    </div>
  );
}
