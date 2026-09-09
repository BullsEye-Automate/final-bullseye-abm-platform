"use client";

import { useMemo, useState } from "react";
import type { MeetingListItem } from "@/lib/peithoBackend";
import MeetingsTable from "@/components/MeetingsTable";

// "all" es el default ahora (pedido explícito del usuario, 09-09-2026: antes
// solo se podía filtrar por semana/mes, y una reunión fuera de esos rangos
// quedaba invisible sin darse cuenta) — se ven todas las reuniones futuras
// de entrada, y estos filtros acotan sobre esa lista completa.
type RangeKey = "all" | "week" | "nextWeek" | "month" | "custom";

const RANGE_LABEL: Record<RangeKey, string> = {
  all: "Todas",
  week: "Esta semana",
  nextWeek: "Próxima semana",
  month: "Este mes",
  custom: "Rango personalizado",
};

function startOfWeek(d: Date): Date {
  const monday = new Date(d);
  monday.setHours(0, 0, 0, 0);
  const day = monday.getDay(); // 0=domingo .. 6=sábado
  const diffToMonday = day === 0 ? -6 : 1 - day;
  monday.setDate(monday.getDate() + diffToMonday);
  return monday;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function presetRangeFor(key: "week" | "nextWeek" | "month", now: Date): { start: Date; end: Date } {
  if (key === "week" || key === "nextWeek") {
    const monday = startOfWeek(now);
    if (key === "nextWeek") monday.setDate(monday.getDate() + 7);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return { start: monday, end: sunday };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

function formatRange(start: Date, end: Date): string {
  const day = (d: Date) => d.toLocaleDateString("es-CL", { day: "2-digit" });
  const monthYear = end.toLocaleDateString("es-CL", { month: "short", year: "numeric" });
  return `${day(start)} — ${day(end)} ${monthYear}`;
}

function StatCard({ value, label, color }: { value: string | number; label: string; color?: string }) {
  return (
    <div className="bg-white rounded-[14px] border border-gray-100 shadow-sm px-[18px] py-4 flex flex-col gap-1">
      <div className="text-[22px] font-bold" style={{ color: color ?? "#1C1530" }}>
        {value}
      </div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

// Filtro semanal/mensual/personalizado + mini-dashboard sobre "Reuniones
// futuras" — filtra en el navegador sobre las reuniones ya traídas
// (scope=upcoming no tiene límite de fecha del lado del backend, así que no
// hace falta un endpoint nuevo).
export default function ReunionesFuturasView({
  meetings,
  detailBasePath,
  showClientColumn,
}: {
  meetings: MeetingListItem[];
  detailBasePath: string;
  showClientColumn: boolean;
}) {
  const [range, setRange] = useState<RangeKey>("all");
  const now = useMemo(() => new Date(), []);
  const [customFrom, setCustomFrom] = useState(isoDate(now));
  const [customTo, setCustomTo] = useState(() => {
    const d = new Date(now);
    d.setMonth(d.getMonth() + 2);
    return isoDate(d);
  });

  const bounds = useMemo(() => {
    if (range === "all") return null;
    if (range === "custom") {
      return { start: new Date(`${customFrom}T00:00:00`), end: new Date(`${customTo}T23:59:59.999`) };
    }
    return presetRangeFor(range, now);
  }, [range, now, customFrom, customTo]);

  const filtered = useMemo(
    () =>
      meetings.filter((m) => {
        if (!m.start_time) return false;
        if (!bounds) return true; // "all" — sin acotar
        const t = new Date(m.start_time);
        return t >= bounds.start && t <= bounds.end;
      }),
    [meetings, bounds]
  );

  const stats = useMemo(() => {
    const researchListo = filtered.filter((m) => m.pre_brief_status === "done").length;
    const sinBot = filtered.filter((m) => m.has_bot === false).length;
    const clientes = new Set(filtered.map((m) => m.client_id ?? m.empresa_contraparte).filter(Boolean));
    return { total: filtered.length, researchListo, sinBot, clientes: clientes.size };
  }, [filtered]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex bg-white border border-gray-100 rounded-[11px] p-[3px]">
          {(Object.keys(RANGE_LABEL) as RangeKey[]).map((key) => (
            <button
              key={key}
              onClick={() => setRange(key)}
              className="px-3.5 py-2 rounded-[9px] text-[13px] font-medium transition"
              style={
                range === key
                  ? { background: "#251762", color: "#fff" }
                  : { color: "#635C79" }
              }
            >
              {RANGE_LABEL[key]}
            </button>
          ))}
        </div>
        {range === "custom" ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="border border-gray-100 rounded-[11px] px-3 py-2 bg-white outline-none focus:border-[#62E0D8]"
            />
            <span>—</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="border border-gray-100 rounded-[11px] px-3 py-2 bg-white outline-none focus:border-[#62E0D8]"
            />
          </div>
        ) : (
          bounds && (
            <div className="flex items-center gap-2 border border-gray-100 bg-white rounded-[11px] px-[13px] py-[9px] text-[13px] text-gray-500">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#948DA8" strokeWidth="2">
                <rect x="3" y="5" width="18" height="16" rx="2.5" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              {formatRange(bounds.start, bounds.end)}
            </div>
          )
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <StatCard value={stats.total} label="Reuniones en el rango" />
        <StatCard value={stats.researchListo} label="Con research listo" color="#1F8A5C" />
        <StatCard value={stats.sinBot} label="Sin bot agendado" color="#B4740E" />
        <StatCard value={stats.clientes} label="Clientes distintos" />
      </div>

      <MeetingsTable meetings={filtered} detailBasePath={detailBasePath} showClientColumn={showClientColumn} />
    </div>
  );
}
