"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Pedido explícito del usuario (15-09-2026): "la facultad para admin de
// poder cambiar manualmente la información de una reunión.. el sales
// manager, el nombre, el cargo, todo lo que sea necesario cambiar para que
// el research pueda correr bien". Complementa el match automático contra el
// excel de metas (metasSheet.ts) — para los casos donde ese match nunca
// encontró la fila correcta o la encontró desactualizada. Colapsado por
// defecto para no ensuciar la ficha en el caso normal (match automático ok).
export default function ManualContactForm({
  meetingId,
  initial,
}: {
  meetingId: string;
  initial: {
    contacto_nombre: string | null;
    contacto_cargo: string | null;
    contacto_industria: string | null;
    empresa_nombre: string | null;
    cliente_sales_manager: string | null;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({
    contacto_nombre: initial.contacto_nombre ?? "",
    contacto_cargo: initial.contacto_cargo ?? "",
    contacto_industria: initial.contacto_industria ?? "",
    empresa_nombre: initial.empresa_nombre ?? "",
    cliente_sales_manager: initial.cliente_sales_manager ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setField(field: keyof typeof values, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/contact-info`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "No se pudo guardar");
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs font-medium underline"
        style={{ color: "#251762" }}
      >
        Editar info de contacto a mano
      </button>
    );
  }

  const fields: Array<{ key: keyof typeof values; label: string }> = [
    { key: "contacto_nombre", label: "Nombre del contacto" },
    { key: "contacto_cargo", label: "Cargo" },
    { key: "contacto_industria", label: "Industria" },
    { key: "empresa_nombre", label: "Empresa" },
    { key: "cliente_sales_manager", label: "Sales Manager (cliente)" },
  ];

  return (
    <div className="pt-2 border-t border-gray-100 mt-2 space-y-2">
      <p className="text-xs font-medium text-gray-500">Editar info de contacto a mano</p>
      <div className="grid grid-cols-2 gap-2">
        {fields.map(({ key, label }) => (
          <div key={key}>
            <label className="text-xs text-gray-500">{label}</label>
            <input
              type="text"
              value={values[key]}
              onChange={(e) => setField(key, e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2"
              style={{ ["--tw-ring-color" as string]: "#62E0D8" }}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-50"
          style={{ background: "#251762" }}
        >
          {saving ? "Guardando…" : "Guardar"}
        </button>
        <button onClick={() => setOpen(false)} disabled={saving} className="text-sm text-gray-500">
          Cancelar
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
