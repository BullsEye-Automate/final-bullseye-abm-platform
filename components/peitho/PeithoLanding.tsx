"use client";

import {
  IconArrowRight,
  IconBolt,
  IconBrandZoom,
  IconCheck,
  IconClipboardCheck,
  IconDownload,
  IconInfinity,
  IconMessageReport,
  IconPlayerPlay,
  IconQuote,
  IconSearch,
  IconStars,
  IconTarget,
} from "@tabler/icons-react";

// Landing comercial de Peitho (clientes sin "Incluir Peitho"). Contenido del
// deck "Peitho – BullsEye 2026" y del one pager 2026-2027; los recursos están
// en public/peitho/. El call to action todavía no está conectado.

const NAVY = "#160B52";
const NAVY2 = "#2A0F6E";
const TEAL = "#45D6C9";
const VIOLET = "#5B3FD9";

const STEPS = [
  {
    n: "01",
    title: "Prepare",
    when: "Antes de la reunión",
    text: "Research de la empresa y del contacto: señales comerciales, LinkedIn, competencia, cargo y contexto, cruzado con tu ICP, casos de éxito y materiales comerciales.",
    result: "Tu ejecutivo entra preparado para una conversación relevante.",
  },
  {
    n: "02",
    title: "Perform",
    when: "Durante la reunión",
    text: "Un bot llamado “Peitho” entra solo a Meet, Teams o Zoom y registra la conversación.",
    result: "Nadie instala una extensión ni tiene que acordarse de activar nada.",
  },
  {
    n: "03",
    title: "Close",
    when: "Después de la reunión",
    text: "Transcripción con el nombre real de cada participante. Analiza dolores, objeciones, compromisos y próximos pasos, y evalúa al ejecutivo y el fit de la empresa y del contacto con el ICP.",
    result: "Listo apenas termina la llamada.",
  },
];

const FEATURES = [
  { icon: IconSearch, title: "Research real, no genérico", text: "El brief y el análisis se apoyan en el ICP, casos de éxito y materiales reales de tu cuenta." },
  { icon: IconStars, title: "Coaching con puntaje", text: "No solo un resumen: un 1 a 10 de desempeño del vendedor, con oportunidades de mejora concretas." },
  { icon: IconMessageReport, title: "Objeciones y dolores, solos", text: "Se identifican automáticamente en cada llamada, sin depender de notas tomadas a mano." },
  { icon: IconClipboardCheck, title: "Compromisos que no se pierden", text: "Cada acuerdo de la llamada queda registrado, listo para el seguimiento." },
  { icon: IconBrandZoom, title: "Multiplataforma", text: "Funciona igual en Google Meet, Microsoft Teams y Zoom, sin configuración extra de tu lado." },
  { icon: IconTarget, title: "Reporte de fit con tu ICP", text: "Cada reunión se evalúa contra tu ICP: qué tan calzado estaba el prospecto, no solo cómo fue la conversación." },
  { icon: IconInfinity, title: "Sin límites de uso", text: "Usuarios, research previo y base de conocimiento ilimitados, con tarifa plana." },
];

const REPORT = [
  { label: "Desempeño del vendedor", value: "7,8/10", pct: 78 },
  { label: "Fit empresa con ICP", value: "10/10", pct: 100 },
  { label: "Fit contacto con buyer persona", value: "8/10", pct: 80 },
];

const CIRCLE = ["Generamos demanda", "Reunión con contexto", "Peitho analiza", "La siguiente reunión mejora"];

function CtaButton({ label = "Quiero activar Peitho" }: { label?: string }) {
  // Call to action: se conecta en una próxima etapa
  return (
    <button
      type="button"
      title="Próximamente"
      className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition hover:opacity-90"
      style={{ background: TEAL, color: NAVY }}
    >
      {label} <IconArrowRight size={16} />
    </button>
  );
}

export default function PeithoLanding({ clientName }: { clientName: string | null }) {
  return (
    <div className="max-w-6xl space-y-16 pb-10">
      {/* ── Hero ── */}
      <section
        className="relative rounded-3xl overflow-hidden text-white"
        style={{ background: `linear-gradient(135deg, ${NAVY} 0%, ${NAVY2} 100%)` }}
      >
        <img src="/peitho/cover-bg.jpg" alt="" className="absolute inset-0 w-full h-full object-cover opacity-50" />
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(90deg, rgba(22,11,82,.97) 0%, rgba(22,11,82,.85) 55%, rgba(22,11,82,.25) 100%)" }}
        />
        <div className="relative grid lg:grid-cols-[1.1fr_1fr] gap-10 items-center px-8 sm:px-12 py-12">
          <div>
            <div className="text-xs font-bold tracking-[0.25em] uppercase" style={{ color: TEAL }}>
              Conversation intelligence para equipos de venta B2B
            </div>
            <h1 className="mt-4 text-4xl sm:text-5xl font-bold tracking-tight leading-[1.08]">
              El copiloto de BullsEye para cada reunión comercial.
            </h1>
            <p className="mt-5 text-white/75 text-lg max-w-xl">
              Peitho se prepara antes de la llamada, graba sin que nadie tenga que acordarse de nada y deja aprendizaje accionable
              después de cada conversación con un prospecto{clientName ? ` de ${clientName}` : ""}.
            </p>
            <div className="mt-3 text-lg font-medium" style={{ color: TEAL }}>Prepare · Perform · Close</div>
            <div className="mt-8 flex flex-wrap gap-3">
              <CtaButton />
              <a
                href="/peitho/peitho-one-pager.pdf"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm border border-white/30 text-white/90 hover:bg-white/10"
              >
                <IconDownload size={16} /> Descargar one pager
              </a>
            </div>
          </div>
          <div className="flex justify-center">
            <img src="/peitho/logo-white.png" alt="Peitho — Prepare · Perform · Close" className="w-full max-w-[320px] h-auto" />
          </div>
        </div>
      </section>

      {/* ── Más allá de la reunión agendada ── */}
      <section className="space-y-6">
        <SectionHead eyebrow="Más allá de la reunión agendada" title="Nuestro trabajo no termina cuando logramos agendar la reunión" />
        <div className="grid md:grid-cols-[1fr_1.2fr] gap-5">
          <div className="rounded-2xl border-2 p-7 space-y-4" style={{ borderColor: "#DDD9EE" }}>
            <div className="text-xs font-bold tracking-widest uppercase" style={{ color: VIOLET }}>Primera parte · lo que ya hacemos</div>
            {["La cuenta correcta", "El cargo correcto", "La oportunidad generada"].map((t) => (
              <div key={t} className="flex items-center gap-3 text-lg font-semibold" style={{ color: NAVY }}>
                <span className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ background: "#E3F8F6" }}>
                  <IconCheck size={16} style={{ color: "#1FA89B" }} />
                </span>
                {t}
              </div>
            ))}
          </div>
          <div className="rounded-2xl p-7 space-y-5 text-white" style={{ background: NAVY }}>
            <div className="text-xs font-bold tracking-widest uppercase" style={{ color: TEAL }}>Segunda parte · aquí entra Peitho</div>
            {["¿Qué tan preparado llega tu ejecutivo?", "¿Qué pasa realmente dentro de esa conversación?"].map((q) => (
              <p key={q} className="text-2xl font-semibold leading-snug">{q}</p>
            ))}
          </div>
        </div>
      </section>

      {/* ── Video ── */}
      <section className="grid lg:grid-cols-[1.4fr_1fr] gap-8 items-center">
        <div className="rounded-2xl overflow-hidden shadow-lg bg-black">
          <video src="/peitho/video.mp4" poster="/peitho/poster.jpg" controls playsInline preload="none" className="w-full h-auto block" />
        </div>
        <div>
          <div className="text-xs font-bold tracking-widest uppercase" style={{ color: VIOLET }}>Conoce a Peitho</div>
          <h2 className="mt-2 text-3xl font-bold tracking-tight" style={{ color: NAVY }}>Tu copiloto en cada reunión</h2>
          <p className="mt-3 text-ink-muted">
            Peitho acompaña a tu ejecutivo de principio a fin: llega con el research hecho, registra la conversación y entrega el
            análisis apenas termina la llamada.
          </p>
          <div className="mt-4 inline-flex items-center gap-2 text-sm font-medium" style={{ color: VIOLET }}>
            <IconPlayerPlay size={16} /> Mira el video (10 s)
          </div>
        </div>
      </section>

      {/* ── Cómo funciona ── */}
      <section className="space-y-6">
        <SectionHead eyebrow="Cómo funciona" title="Peitho trabaja en tres momentos" />
        <div className="grid md:grid-cols-3 gap-5">
          {STEPS.map((s) => (
            <div key={s.n} className="card flex flex-col gap-3">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-bold" style={{ color: TEAL }}>{s.n}</span>
                <span className="text-2xl font-bold" style={{ color: NAVY }}>{s.title}</span>
              </div>
              <div className="text-xs font-semibold tracking-wider uppercase" style={{ color: VIOLET }}>{s.when}</div>
              <p className="text-sm text-ink-muted flex-1">{s.text}</p>
              <p className="text-sm font-medium pt-3 border-t border-gray-100" style={{ color: NAVY }}>{s.result}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Después de cada reunión + ejemplo de reporte ── */}
      <section className="grid lg:grid-cols-2 gap-8 items-center">
        <div>
          <div className="text-xs font-bold tracking-widest uppercase" style={{ color: VIOLET }}>Después de cada reunión</div>
          <h2 className="mt-2 text-3xl font-bold tracking-tight" style={{ color: NAVY }}>
            Información concreta, no “parece que hay interés”
          </h2>
          <p className="mt-3 text-ink-muted">
            Entendemos qué está convirtiendo, qué no, dónde hay oportunidades de mejora y cómo ajustar la estrategia.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {["Dolores", "Objeciones", "Compromisos", "Próximos pasos"].map((t) => (
              <span key={t} className="px-3.5 py-1.5 rounded-full text-sm font-medium" style={{ background: "#EEEDFE", color: NAVY }}>{t}</span>
            ))}
          </div>
        </div>
        <div className="rounded-2xl p-7 text-white shadow-xl" style={{ background: `linear-gradient(160deg, ${NAVY} 0%, ${NAVY2} 100%)` }}>
          <div className="text-xs font-bold tracking-widest uppercase" style={{ color: TEAL }}>Ejemplo de reporte Peitho</div>
          <div className="mt-5 flex items-center justify-between">
            <span className="text-sm text-white/70">Predicción de éxito</span>
            <span className="flex items-center gap-2 font-semibold">
              <span className="tracking-[0.2em]" style={{ color: TEAL }}>●●●●<span className="text-white/25">●</span></span> Bueno
            </span>
          </div>
          <div className="mt-5 space-y-4">
            {REPORT.map((r) => (
              <div key={r.label}>
                <div className="flex justify-between text-sm">
                  <span className="text-white/70">{r.label}</span>
                  <span className="font-semibold">{r.value}</span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-white/10">
                  <div className="h-2 rounded-full" style={{ width: `${r.pct}%`, background: TEAL }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 text-xs text-white/50 flex items-center gap-1.5">
            <IconBolt size={13} /> Generado solo, al terminar la llamada.
          </div>
        </div>
      </section>

      {/* ── Qué resuelve ── */}
      <section className="space-y-6">
        <SectionHead eyebrow="Qué resuelve" title="Qué resuelve Peitho en el día a día" />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="card">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#E3F8F6" }}>
                <Icon size={20} style={{ color: NAVY }} />
              </div>
              <div className="mt-3 font-semibold" style={{ color: NAVY }}>{title}</div>
              <p className="mt-1 text-sm text-ink-muted">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Peitho cierra el círculo + CTA ── */}
      <section className="rounded-3xl px-8 sm:px-12 py-12 text-white" style={{ background: `linear-gradient(135deg, ${NAVY} 0%, ${NAVY2} 100%)` }}>
        <div className="text-xs font-bold tracking-widest uppercase" style={{ color: TEAL }}>La evolución natural de BullsEye</div>
        <h2 className="mt-2 text-3xl font-bold tracking-tight">Peitho cierra el círculo</h2>
        <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {CIRCLE.map((t, i) => (
            <div key={t} className="rounded-2xl p-5" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
              <div className="text-3xl font-bold" style={{ color: TEAL }}>{String(i + 1).padStart(2, "0")}</div>
              <div className="mt-2 font-semibold">{t}</div>
            </div>
          ))}
        </div>
        <blockquote className="mt-10 flex gap-3 max-w-3xl">
          <IconQuote size={28} className="shrink-0" style={{ color: TEAL }} />
          <p className="text-xl italic text-white/90">
            Cada reunión no es solo una cita más en la agenda: es una fuente de aprendizaje comercial.
          </p>
        </blockquote>
        <p className="mt-6 text-sm text-white/60">
          <b className="text-white/80">En camino:</b> más reportería de desempeño y pipeline, e integración con CRM, comenzando con HubSpot.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <CtaButton label={clientName ? `Activar Peitho para ${clientName}` : "Quiero activar Peitho"} />
          <a href="https://peithob2b.com" target="_blank" rel="noopener noreferrer" className="text-sm text-white/70 hover:text-white underline">
            peithob2b.com
          </a>
        </div>
      </section>
    </div>
  );
}

function SectionHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <div className="text-xs font-bold tracking-widest uppercase" style={{ color: VIOLET }}>{eyebrow}</div>
      <h2 className="mt-2 text-3xl font-bold tracking-tight" style={{ color: NAVY }}>{title}</h2>
    </div>
  );
}
