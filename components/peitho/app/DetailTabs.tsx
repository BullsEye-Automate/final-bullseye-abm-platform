"use client";

import { useState } from "react";

// Tabs genérico — recibe el contenido de cada pestaña ya renderizado desde
// el Server Component que lo llama (`app/reuniones/[id]/page.tsx`), así que
// este componente solo necesita manejar el estado de cuál está activa. Todas
// las pestañas quedan montadas (se ocultan con `hidden`, no se desmontan) —
// más simple que condicionar el render y evita perder estado si alguna
// pestaña llegara a tener uno.
export default function DetailTabs({
  tabs,
}: {
  tabs: { key: string; label: string; content: React.ReactNode }[];
}) {
  const [active, setActive] = useState(tabs[0]?.key);

  return (
    <div>
      <div className="flex gap-1 border-b border-gray-100 mb-5">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActive(tab.key)}
            className="px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition"
            style={
              active === tab.key
                ? { borderColor: "#62E0D8", color: "#251762" }
                : { borderColor: "transparent", color: "#948DA8" }
            }
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div key={tab.key} hidden={active !== tab.key} className="space-y-4">
          {tab.content}
        </div>
      ))}
    </div>
  );
}
