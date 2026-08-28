"use client";

import { useEffect, useRef, useState } from "react";
import { IconChevronDown, IconCheck, IconSearch } from "@tabler/icons-react";

interface ClienteOption {
  cliente_id: string;
  cliente_nombre: string;
}

interface ClienteMultiSelectProps {
  clientes: ClienteOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
}

export default function ClienteMultiSelect({ clientes, selected, onChange }: ClienteMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function toggleOpen() {
    setOpen((v) => {
      if (!v) setTimeout(() => inputRef.current?.focus(), 50);
      else setQuery("");
      return !v;
    });
  }

  function toggleCliente(id: string) {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  }

  const filtered = query.trim()
    ? clientes.filter((c) => c.cliente_nombre.toLowerCase().includes(query.toLowerCase()))
    : clientes;

  const label =
    selected.length === 0
      ? "Todos los clientes"
      : selected.length === 1
      ? clientes.find((c) => c.cliente_id === selected[0])?.cliente_nombre || "1 seleccionado"
      : `${selected.length} clientes seleccionados`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        className="input py-1.5 text-sm flex items-center gap-2 min-w-[160px] justify-between"
      >
        <span className="truncate">{label}</span>
        <IconChevronDown
          size={14}
          className="shrink-0 transition-transform text-ink-muted"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 w-72 rounded-lg py-1 z-50 bg-white border border-gray-200 shadow-lg"
        >
          <div className="px-2 pt-1 pb-1.5 border-b border-gray-100">
            <div className="relative">
              <IconSearch size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar cliente…"
                className="w-full rounded-md pl-7 pr-2 py-1.5 text-xs outline-none border border-gray-200 focus:border-brand"
              />
            </div>
          </div>

          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full text-left px-3 py-1.5 text-xs text-brand hover:bg-gray-50"
            >
              Limpiar selección
            </button>
          )}

          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-gray-400">Sin resultados</p>
            ) : (
              filtered.map((cliente) => {
                const checked = selected.includes(cliente.cliente_id);
                return (
                  <label
                    key={cliente.cliente_id}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span
                        className="shrink-0 w-4 h-4 rounded border flex items-center justify-center"
                        style={{
                          borderColor: checked ? "#251762" : "#d1d5db",
                          background: checked ? "#251762" : "transparent",
                        }}
                      >
                        {checked && <IconCheck size={11} className="text-white" />}
                      </span>
                      <span className="truncate text-gray-800">{cliente.cliente_nombre}</span>
                    </span>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      onChange={() => toggleCliente(cliente.cliente_id)}
                    />
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
