"use client";

import { useState } from "react";

// Envuelve contenido ya renderizado desde el Server Component que lo llama
// (mismo patrón que DetailTabs) detrás de un botón "Ver X" / "Ocultar X" —
// para que el research pre-reunión no quede tapado ni se pierda una vez que
// aparece el análisis, pero tampoco compita por espacio si el usuario ya no
// lo necesita ver de entrada.
export default function CollapsibleSection({
  label,
  defaultOpen = false,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-sm font-medium mb-3 transition"
        style={{ color: "#251762" }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform 0.15s" }}
        >
          <polyline points="9 6 15 12 9 18" />
        </svg>
        {open ? `Ocultar ${label}` : `Ver ${label}`}
      </button>
      <div hidden={!open}>{children}</div>
    </div>
  );
}
