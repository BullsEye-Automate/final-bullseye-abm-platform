"use client";

import { useMemo, useState } from "react";
import type { ClientListItem, MeetingListItem } from "@/lib/peithoBackend";
import MeetingsTable from "@/components/MeetingsTable";

// Filtro de rango de fechas + buscador (empresa o nombre del prospecto) sobre
// "Reuniones pasadas" — igual que en Reuniones futuras, filtra en el
// navegador sobre lo que ya trajo GET /meetings?scope=past (acotado a 90 días
// del lado del backend), sin necesidad de un endpoint nuevo.
export default function ReunionesPasadasView({
  meetings,
  detailBasePath,
  showClientColumn,
  clients,
}: {
  meetings: MeetingListItem[];
  detailBasePath: string;
  showClientColumn: boolean;
  // Solo la trae el admin — habilita la edición inline del cliente en la
  // tabla (ver MeetingsTable/InlineClientSelect).
  clients?: ClientListItem[];
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const fromDate = from ? new Date(`${from}T00:00:00`) : null;
    const toDate = to ? new Date(`${to}T23:59:59.999`) : null;
    const needle = search.trim().toLowerCase();

    return meetings.filter((m) => {
      if (fromDate || toDate) {
        if (!m.start_time) return false;
        const t = new Date(m.start_time);
        if (fromDate && t < fromDate) return false;
        if (toDate && t > toDate) return false;
      }
      if (needle) {
        const haystack = `${m.contraparte ?? ""} ${m.empresa_contraparte ?? ""} ${m.cliente_bullseye ?? ""}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [meetings, from, to, search]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#948DA8"
            strokeWidth="2"
            className="absolute left-3 top-1/2 -translate-y-1/2"
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por empresa o nombre del prospecto…"
            className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-100 rounded-[11px] bg-white outline-none focus:border-[#62E0D8]"
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="border border-gray-100 rounded-[11px] px-3 py-2.5 bg-white outline-none focus:border-[#62E0D8]"
          />
          <span>—</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="border border-gray-100 rounded-[11px] px-3 py-2.5 bg-white outline-none focus:border-[#62E0D8]"
          />
          {(from || to || search) && (
            <button
              onClick={() => {
                setFrom("");
                setTo("");
                setSearch("");
              }}
              className="text-xs text-gray-400 hover:text-gray-600 px-2"
            >
              Limpiar
            </button>
          )}
        </div>
      </div>

      <MeetingsTable
        meetings={filtered}
        detailBasePath={detailBasePath}
        showClientColumn={showClientColumn}
        showPuntaje
        clients={clients}
      />
    </div>
  );
}
