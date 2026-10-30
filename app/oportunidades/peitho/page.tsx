"use client";

import { useEffect, useState } from "react";
import { IconLoader2, IconSparkles } from "@tabler/icons-react";
import { useClient, ALL_CLIENTS } from "@/lib/clientContext";
import PeithoLanding from "@/components/peitho/PeithoLanding";
import PeithoApp from "@/components/peitho/PeithoApp";

// Oportunidades → Peitho. Depende de "Incluir Peitho" en Config. cliente:
//  - Sí: el cliente paga el servicio → aquí se abrirá la app Peitho con el
//    feedback automático de sus reuniones (integración pendiente).
//  - No o sin configurar: landing comercial para que quiera activarlo (el
//    call to action se conecta después). Sin cliente elegido también se
//    muestra la landing (genérica).
export default function PeithoPage() {
  const { currentClient } = useClient();
  const clientId = currentClient && currentClient.id !== ALL_CLIENTS.id ? currentClient.id : null;
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    if (!clientId) return;
    setEnabled(null);
    fetch(`/api/clients/${clientId}/peitho`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setEnabled(!!j.enabled))
      .catch(() => setEnabled(false));
  }, [clientId]);

  if (!clientId) return <PeithoLanding clientName={null} />;
  if (enabled === null) return <IconLoader2 className="animate-spin text-ink-muted" />;
  return enabled ? <PeithoAppView clientName={currentClient!.name} /> : <PeithoLanding clientName={currentClient!.name} />;
}

// ── Cliente con Peitho contratado ────────────────────────────────────────
function PeithoAppView({ clientName }: { clientName: string }) {
  return (
    <div className="space-y-6 max-w-5xl">
      <header>
        <div className="label">Oportunidades</div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <IconSparkles size={22} style={{ color: "#62E0D8" }} /> Peitho
        </h1>
        <p className="text-sm text-ink-muted mt-1">Feedback automático de las reuniones de {clientName}.</p>
      </header>
      <PeithoApp clientName={clientName} />
    </div>
  );
}
