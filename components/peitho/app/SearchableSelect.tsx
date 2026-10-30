"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface SearchableSelectOption {
  value: string;
  label: string;
}

// Combobox genérico con buscador — reemplaza los <select> nativos que
// listan clientes (pedido explícito del usuario, 30-09-2026: con 17+
// clientes y creciendo, un <select> nativo obliga a scrollear la lista
// entera para encontrar uno). No es específico de clientes a propósito —
// cualquier listado largo (roles, ejecutivos, etc.) puede reusarlo.
export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Buscar...",
  className = "",
}: {
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? "";

  // Cierra al clickear afuera — patrón estándar de combobox, sin esto queda
  // abierto para siempre hasta que se elija una opción.
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

  function openAndFocus() {
    setOpen(true);
    setQuery("");
    // El input recién se monta al abrir (ver return de abajo) — sin el
    // setTimeout, el focus() corre antes de que React lo pinte.
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function selectOption(optionValue: string) {
    onChange(optionValue);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {open ? (
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              setQuery("");
            } else if (e.key === "Enter" && filtered.length > 0) {
              selectOption(filtered[0].value);
            }
          }}
          placeholder={placeholder}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2"
          style={{ ["--tw-ring-color" as string]: "#62E0D8" }}
        />
      ) : (
        <button
          type="button"
          onClick={openAndFocus}
          className="w-full text-left text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 truncate"
          style={{ ["--tw-ring-color" as string]: "#62E0D8" }}
        >
          {selectedLabel || placeholder}
        </button>
      )}
      {open && (
        <ul className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg py-1">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-400">Sin resultados</li>
          ) : (
            filtered.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  onClick={() => selectOption(option.value)}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 ${
                    option.value === value ? "font-semibold" : ""
                  }`}
                  style={option.value === value ? { color: "#251762" } : undefined}
                >
                  {option.label}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
