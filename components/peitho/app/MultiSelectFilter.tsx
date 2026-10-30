"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface MultiSelectOption {
  value: string;
  label: string;
}

// Combobox de selección múltiple con checkboxes — mismo patrón de "clickear
// afuera para cerrar" que SearchableSelect, pero esa es single-select (un
// <select> reemplazado 1 a 1). Acá selected=[] siempre significa "sin
// filtro, mostrar todo" — nunca "no mostrar nada" — para no sorprender con
// una tabla vacía apenas se abre el dropdown sin tocar nada.
export default function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  searchable = false,
}: {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  // Solo tiene sentido buscar en listas largas (ej. Ejecutivo, con un roster
  // grande) — para algo fijo y corto como Estado, un buscador es ruido.
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return options;
    return options.filter((o) => o.label.toLowerCase().includes(normalized));
  }, [options, query]);

  function toggle(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-sm border border-gray-100 rounded-[11px] px-3 py-2.5 bg-white hover:border-gray-200 transition"
      >
        <span className="text-gray-700">{label}</span>
        {selected.length > 0 && (
          <span
            className="text-xs font-semibold px-1.5 py-0.5 rounded-md"
            style={{ background: "#EFECFA", color: "#251762" }}
          >
            {selected.length}
          </span>
        )}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#948DA8" strokeWidth="2.4">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 min-w-[220px] bg-white border border-gray-200 rounded-lg shadow-lg py-1">
          {searchable && (
            <div className="px-2 pb-1.5 pt-0.5">
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar…"
                className="w-full text-sm border border-gray-200 rounded-md px-2 py-1.5 outline-none focus:border-[#62E0D8]"
              />
            </div>
          )}
          <ul className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-gray-400">Sin resultados</li>
            ) : (
              filtered.map((option) => (
                <li key={option.value}>
                  <label className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.includes(option.value)}
                      onChange={() => toggle(option.value)}
                      className="accent-[#251762]"
                    />
                    {option.label}
                  </label>
                </li>
              ))
            )}
          </ul>
          {selected.length > 0 && (
            <div className="border-t border-gray-100 mt-1 pt-1 px-3">
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-xs text-gray-400 hover:text-gray-600 py-1"
              >
                Limpiar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
