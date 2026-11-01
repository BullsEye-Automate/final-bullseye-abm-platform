"use client";

// Salud de números: semáforo de los números de Allo agrupado por acción
// (Reemplazar / Revisar esta semana / Vigilar / Sanos / Sin volumen). Cada
// número muestra un motivo corto y, al hacer clic, el detalle. Reglas en
// lib/phoneHealth/engine.ts; el mismo cálculo se envía por correo cada día
// hábil a las 8:00 (cron /api/cron/alertas-numeros).
import { useEffect, useState } from "react";
import {
  IconPhone,
  IconLoader2,
  IconAlertCircle,
  IconRefresh,
  IconMail,
  IconChevronDown,
  IconChevronUp,
  IconInfoCircle,
} from "@tabler/icons-react";
import MailRecipientsEditor from "@/components/MailRecipientsEditor";

type Level = "red" | "yellow" | "watch" | "ok" | "low_volume";
type NumberHealth = {
  number: string;
  name: string;
  client: string;
  country: string;
  level: Level;
  reasons: string[];
  summary?: string;
  action: string;
  dials7: number;
  rate7: number | null;
  rateBase: number | null;
};
type Report = {
  today: string;
  windows: { current: [string, string]; baseline: [string, string] };
  numbers: NumberHealth[];
  counts: Record<Level, number>;
  dataWarning: string | null;
  generatedAt: string;
  since: Record<string, string>;
  recipients: string[];
};

// Grupos en orden de prioridad; los últimos parten plegados.
const GROUPS: { level: Level; title: string; card: string; color: string; open: boolean }[] = [
  { level: "red", title: "Reemplazar", card: "Reemplazar", color: "text-red-700", open: true },
  { level: "yellow", title: "Revisar esta semana", card: "Revisar", color: "text-amber-700", open: true },
  { level: "watch", title: "Vigilar", card: "Vigilar", color: "text-ink", open: false },
  { level: "ok", title: "Sanos", card: "Sanos", color: "text-ink", open: false },
  { level: "low_volume", title: "Sin volumen suficiente", card: "Sin volumen", color: "text-ink", open: false },
];

const pct = (n: number | null) => (n === null ? "—" : `${n.toFixed(1).replace(".", ",")}%`);
const shortDate = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${Number(d)}-${["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][Number(m) - 1]}`;
};
const timeCL = (iso: string) =>
  new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

function Row({ n, since }: { n: NumberHealth; since?: string }) {
  const [open, setOpen] = useState(false);
  const isAlert = n.level === "red" || n.level === "yellow" || n.level === "watch";
  return (
    <div className={`border-b ${open ? "bg-black/[0.02]" : ""}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full grid grid-cols-[minmax(0,1.6fr)_96px_minmax(0,1.6fr)_20px] gap-3 items-center py-2.5 px-2 text-left hover:bg-black/[0.03]"
      >
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{n.name}</div>
          <div className="text-xs text-ink-muted">
            {n.country} · {n.dials7} llamadas
          </div>
        </div>
        <div className="text-sm font-semibold">
          {pct(n.rate7)}
          <div className="text-[11px] font-normal text-ink-muted">base {pct(n.rateBase)}</div>
        </div>
        <div className="text-sm text-ink-muted truncate">{n.summary ?? n.reasons[0] ?? ""}</div>
        {open ? <IconChevronUp size={16} className="text-ink-muted" /> : <IconChevronDown size={16} className="text-ink-muted" />}
      </button>
      {open && (
        <div className="px-2 pb-3 text-xs text-ink-muted leading-relaxed space-y-0.5">
          <div>
            {n.number} · {n.client}
            {since ? ` · en esta alerta desde el ${shortDate(since)}` : ""}
          </div>
          {n.reasons.map((r, i) => (
            <div key={i}>{r}</div>
          ))}
          {isAlert && <div className="text-ink font-medium">Sugerido: {n.action.replace(/^Revisar: /, "")}</div>}
        </div>
      )}
    </div>
  );
}

export default function SaludNumerosPage() {
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<Level, boolean>>(
    Object.fromEntries(GROUPS.map((g) => [g.level, g.open])) as Record<Level, boolean>
  );
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState<string | null>(null);

  async function load(fresh = false) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/analisis/alertas-numeros${fresh ? "?fresh=1" : ""}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Error al cargar");
      setData(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function sendNow() {
    setSending(true);
    setSendMsg(null);
    try {
      const res = await fetch("/api/analisis/alertas-numeros", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "No se pudo enviar");
      setSendMsg(json.sent ? `Correo enviado a ${json.to.join(", ")}` : `No se envió: ${json.reason}`);
    } catch (e) {
      setSendMsg((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6 max-w-5xl">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="label">Reportería</div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <IconPhone size={24} />
            Salud de números
          </h1>
          <p className="text-sm text-ink-muted mt-1 flex items-center gap-1.5 flex-wrap">
            Últimos 7 días comparados con el promedio de las 4 semanas anteriores
            {data && <> · actualizado el {shortDate(data.today)} a las {timeCL(data.generatedAt)}</>}
            {data?.dataWarning && (
              <span title={data.dataWarning} className="inline-flex items-center gap-1 text-xs text-amber-800 cursor-help">
                <IconInfoCircle size={14} /> datos aproximados
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={sendNow}
            disabled={sending || loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border hover:bg-black/5 transition disabled:opacity-50"
          >
            {sending ? <IconLoader2 size={15} className="animate-spin" /> : <IconMail size={15} />}
            Enviarme el correo
          </button>
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border hover:bg-black/5 transition disabled:opacity-50"
          >
            {loading ? <IconLoader2 size={15} className="animate-spin" /> : <IconRefresh size={15} />}
            Actualizar
          </button>
        </div>
      </header>

      {sendMsg && <p className="text-xs text-ink-muted -mt-3">{sendMsg}</p>}

      {error && (
        <div className="flex items-center gap-2 text-error-fg text-sm p-3 rounded bg-error-bg/20 border border-error-bg">
          <IconAlertCircle size={16} className="shrink-0" />
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-16 text-ink-muted gap-2">
          <IconLoader2 size={18} className="animate-spin" />
          Evaluando números (puede tardar cerca de un minuto)…
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {GROUPS.slice(0, 4).map((g) => (
              <div key={g.level} className="rounded-lg bg-black/[0.03] px-4 py-3">
                <div className="text-xs text-ink-muted">{g.card}</div>
                <div className={`text-2xl font-semibold ${data.counts[g.level] > 0 && (g.level === "red" || g.level === "yellow") ? g.color : ""}`}>
                  {data.counts[g.level]}
                </div>
              </div>
            ))}
          </div>

          <section className="card space-y-5">
            {data.counts.red + data.counts.yellow === 0 && (
              <p className="text-sm text-ink-muted">Ningún número requiere acción esta semana.</p>
            )}
            {GROUPS.map((g) => {
              const items = data.numbers.filter((n) => n.level === g.level);
              if (items.length === 0) return null;
              const open = openGroups[g.level];
              return (
                <div key={g.level}>
                  <button
                    onClick={() => setOpenGroups((s) => ({ ...s, [g.level]: !s[g.level] }))}
                    className="flex items-center gap-1.5 text-sm font-semibold mb-1"
                  >
                    {open ? <IconChevronUp size={15} /> : <IconChevronDown size={15} />}
                    <span className={g.level === "red" || g.level === "yellow" ? g.color : ""}>{g.title}</span>
                    <span className="text-ink-muted font-normal">({items.length})</span>
                  </button>
                  {open && (
                    <div className="border-t">
                      {items.map((n) => (
                        <Row key={n.number} n={n} since={data.since[n.number]} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </section>

          <section className="card space-y-2">
            <h2 className="text-sm font-semibold">Correo automático</h2>
            <p className="text-xs text-ink-muted">
              Lunes a las 8:00: resumen semanal completo. Martes a viernes a las 8:00: solo si un número pasa a
              “Reemplazar”.
            </p>
            <MailRecipientsEditor reportKey="phone_health" />
          </section>

          <p className="text-xs text-ink-muted">
            Métrica: % de llamadas que contesta una persona. Reemplazar: bajo 5% dos semanas seguidas o caída de 40% o
            más. Revisar: caída de 25–40%, bajo 5% esta semana, más de 60% a buzón o posibles cortes.
          </p>
        </>
      )}
    </div>
  );
}
