"use client";

import { useMemo, useState } from "react";
import type { ClientExecutive, ClientListItem, MeetingListItem } from "@/lib/peithoBackend";
import MeetingsTable, { STATUS_LABEL, resolveEjecutivoNombre } from "@/components/MeetingsTable";
import MultiSelectFilter from "@/components/MultiSelectFilter";

const SIN_EJECUTIVO = "__sin_ejecutivo__";

// Filtro de rango de fechas + buscador (empresa o nombre del prospecto) sobre
// "Reuniones pasadas" — igual que en Reuniones futuras, filtra en el
// navegador sobre lo que ya trajo GET /meetings?scope=past (acotado a 90 días
// del lado del backend), sin necesidad de un endpoint nuevo.
export default function ReunionesPasadasView({
  meetings,
  detailBasePath,
  showClientColumn,
  clients,
  executives,
}: {
  meetings: MeetingListItem[];
  detailBasePath: string;
  showClientColumn: boolean;
  // Solo la trae el admin — habilita la edición inline del cliente en la
  // tabla (ver MeetingsTable/InlineClientSelect).
  clients?: ClientListItem[];
  // Pedido explícito del usuario (14-10-2026, mismo bug que el filtro del
  // Panel de control): roster real del cliente (client_executives), no texto
  // libre de meetings — evita duplicados del mismo ejecutivo con distinta
  // mayúscula/acento y que se cuele un SDR de BullsEye. Solo llega cuando hay
  // un cliente único conocido (rol "client", o admin con un cliente ya
  // elegido en el filtro de arriba) — ver reuniones/pasadas/page.tsx. Sin
  // esto (admin viendo todos los clientes mezclados, sin un roster puntual
  // que pedir), cae al criterio viejo (mejor esfuerzo).
  executives?: ClientExecutive[];
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [ejecutivoFilter, setEjecutivoFilter] = useState<string[]>([]);

  const statusOptions = useMemo(
    () => (Object.keys(STATUS_LABEL) as MeetingListItem["status"][]).map((value) => ({ value, label: STATUS_LABEL[value] })),
    []
  );

  // Roster real disponible (executives no vacío) → se usa ESE como fuente de
  // verdad de las opciones y del filtro, en vez de derivar de las reuniones.
  const useRosterOnly = !!executives && executives.length > 0;

  // Pedido explícito del usuario (14-10-2026): poder filtrar por ejecutivo
  // propio, y que las reuniones sin ejecutivo asignado también aparezcan
  // como una opción filtrable (no quedan ocultas ni mezcladas con "todos").
  const ejecutivoOptions = useMemo(() => {
    if (useRosterOnly) {
      const nombres = new Set(executives!.map((e) => e.name));
      const hasSinEjecutivo = meetings.some((m) => !m.client_executive_name);
      const opciones = Array.from(nombres)
        .sort((a, b) => a.localeCompare(b, "es"))
        .map((nombre) => ({ value: nombre, label: nombre }));
      if (hasSinEjecutivo) opciones.push({ value: SIN_EJECUTIVO, label: "Sin ejecutivo asignado" });
      return opciones;
    }

    const nombres = new Set<string>();
    let hasSinEjecutivo = false;
    for (const m of meetings) {
      const nombre = resolveEjecutivoNombre(m);
      if (nombre) nombres.add(nombre);
      else hasSinEjecutivo = true;
    }
    const opciones = Array.from(nombres)
      .sort((a, b) => a.localeCompare(b, "es"))
      .map((nombre) => ({ value: nombre, label: nombre }));
    if (hasSinEjecutivo) opciones.push({ value: SIN_EJECUTIVO, label: "Sin ejecutivo asignado" });
    return opciones;
  }, [meetings, executives, useRosterOnly]);

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
      if (statusFilter.length > 0 && !statusFilter.includes(m.status)) return false;
      if (ejecutivoFilter.length > 0) {
        const nombre = (useRosterOnly ? m.client_executive_name : resolveEjecutivoNombre(m)) ?? SIN_EJECUTIVO;
        if (!ejecutivoFilter.includes(nombre)) return false;
      }
      return true;
    });
  }, [meetings, from, to, search, statusFilter, ejecutivoFilter, useRosterOnly]);

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
        </div>
        <MultiSelectFilter label="Estado" options={statusOptions} selected={statusFilter} onChange={setStatusFilter} />
        <MultiSelectFilter
          label="Ejecutivo"
          options={ejecutivoOptions}
          selected={ejecutivoFilter}
          onChange={setEjecutivoFilter}
          searchable
        />
        {(from || to || search || statusFilter.length > 0 || ejecutivoFilter.length > 0) && (
          <button
            onClick={() => {
              setFrom("");
              setTo("");
              setSearch("");
              setStatusFilter([]);
              setEjecutivoFilter([]);
            }}
            className="text-xs text-gray-400 hover:text-gray-600 px-2"
          >
            Limpiar
          </button>
        )}
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
