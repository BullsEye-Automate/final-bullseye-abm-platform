"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  IconAlertCircle,
  IconArrowRight,
  IconBrain,
  IconChartBar,
  IconCheck,
  IconLoader2,
  IconMicrophone,
  IconSparkles,
  IconTargetArrow,
} from "@tabler/icons-react";
import { useClient, ALL_CLIENTS } from "@/lib/clientContext";

// Oportunidades → Peitho. Depende de "Incluir Peitho" en Config. cliente:
//  - Sí: el cliente paga el servicio → aquí se abrirá la app Peitho con el
//    feedback automático de sus reuniones (integración pendiente).
//  - No: landing comercial para que quiera activarlo (el call to action se
//    conecta después).
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

  if (!clientId) {
    return (
      <div className="card flex items-center gap-3 text-warning-fg border border-warning-bg bg-warning-bg/40 text-sm max-w-xl">
        <IconAlertCircle size={18} className="shrink-0" />
        Selecciona un cliente en el menú lateral para ver Peitho.
      </div>
    );
  }
  if (enabled === null) return <IconLoader2 className="animate-spin text-ink-muted" />;
  return enabled ? <PeithoApp clientName={currentClient!.name} /> : <PeithoLanding clientName={currentClient!.name} />;
}

// ── Cliente con Peitho contratado ────────────────────────────────────────
function PeithoApp({ clientName }: { clientName: string }) {
  return (
    <div className="space-y-6 max-w-5xl">
      <header>
        <div className="label">Oportunidades</div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <IconSparkles size={22} style={{ color: "#62E0D8" }} /> Peitho
        </h1>
        <p className="text-sm text-ink-muted mt-1">Feedback automático de las reuniones de {clientName}.</p>
      </header>
      <div className="card text-center py-14">
        <IconSparkles size={36} className="mx-auto" style={{ color: "#62E0D8" }} />
        <h2 className="text-lg font-semibold mt-3">Peitho activo para {clientName}</h2>
        <p className="text-sm text-ink-muted mt-1 max-w-md mx-auto">
          Aquí se mostrará la app Peitho con el análisis y feedback automático de cada reunión. La conexión con Peitho está en desarrollo.
        </p>
      </div>
    </div>
  );
}

// ── Landing comercial (cliente sin Peitho) ───────────────────────────────
const BENEFITS = [
  { icon: IconMicrophone, title: "Cada reunión, analizada", text: "Peitho escucha las reuniones y entrega un resumen con lo que importa: necesidades, objeciones, próximos pasos." },
  { icon: IconTargetArrow, title: "Feedback sin pedirlo", text: "Ya no hay que esperar la encuesta del cliente: la calificación de cada reunión llega sola, el mismo día." },
  { icon: IconBrain, title: "Aprendizaje para el equipo", text: "Detecta qué argumentos funcionan y qué preguntas acercan la oportunidad, para mejorar el pitch reunión a reunión." },
  { icon: IconChartBar, title: "Pipeline más claro", text: "Probabilidad de cierre y calidad de cada reunión en un solo lugar, listas para tu forecast." },
];

function PeithoLanding({ clientName }: { clientName: string }) {
  return (
    <div className="max-w-5xl space-y-8">
      <section
        className="rounded-2xl px-8 py-12 text-white relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, #251762 0%, #3b2a8c 100%)" }}
      >
        <div className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full mb-4" style={{ background: "rgba(98,224,216,0.15)", color: "#62E0D8" }}>
          <IconSparkles size={13} /> Nuevo
        </div>
        <h1 className="text-3xl font-semibold tracking-tight max-w-2xl">
          Convierte cada reunión en una oportunidad mejor entendida con <span style={{ color: "#62E0D8" }}>Peitho</span>
        </h1>
        <p className="mt-3 text-white/70 max-w-xl">
          Feedback automático de todas las reuniones que agendamos para {clientName}: qué pasó, qué tan calificada fue y cuál es el siguiente paso, sin formularios.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {/* Call to action: se conecta en una próxima etapa */}
          <button
            type="button"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: "#62E0D8", color: "#251762" }}
            title="Próximamente"
          >
            Quiero activar Peitho <IconArrowRight size={16} />
          </button>
          <Link href="/oportunidades/feedback" className="inline-flex items-center px-5 py-2.5 rounded-xl text-sm border border-white/30 text-white/90 hover:bg-white/10">
            Seguir con feedback manual
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        {BENEFITS.map(({ icon: Icon, title, text }) => (
          <div key={title} className="card flex gap-4">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(98,224,216,0.15)" }}>
              <Icon size={20} style={{ color: "#251762" }} />
            </div>
            <div>
              <div className="font-semibold">{title}</div>
              <p className="text-sm text-ink-muted mt-1">{text}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="card">
        <h2 className="font-semibold">Feedback manual vs. Peitho</h2>
        <div className="grid sm:grid-cols-2 gap-6 mt-4 text-sm">
          <ul className="space-y-2 text-ink-muted">
            <li className="font-medium text-ink">Hoy (feedback manual)</li>
            <li>· Depende de que el cliente responda la encuesta</li>
            <li>· Llega días después, o no llega</li>
            <li>· Solo una calificación general</li>
          </ul>
          <ul className="space-y-2">
            <li className="font-medium">Con Peitho</li>
            {["Automático en todas las reuniones", "Disponible el mismo día", "Necesidades, objeciones, próximos pasos y probabilidad de cierre"].map((t) => (
              <li key={t} className="flex items-start gap-2"><IconCheck size={16} className="shrink-0 mt-0.5" style={{ color: "#0F6E56" }} /> {t}</li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-ink-muted mt-5">
          Para activarlo en {clientName} marca &quot;Incluir Peitho&quot; en <Link href="/configuracion/cliente" className="underline">Config. cliente</Link>.
        </p>
      </section>
    </div>
  );
}
