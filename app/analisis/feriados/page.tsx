"use client";

// Alerta de feriados: feriados del próximo día hábil por país (el aviso llega
// el día hábil anterior al feriado), reuniones agendadas en un
// feriado del país de la empresa (planilla de reuniones + HubSpot) y próximos
// feriados en días hábiles. El mismo contenido se envía por correo de lunes a
// viernes a las 8:30 de Chile (cron /api/cron/alerta-feriados). Calendario y
// fuentes oficiales en lib/feriados/calendar.ts.
import { useEffect, useState } from "react";
import {
  IconCalendarEvent,
  IconLoader2,
  IconAlertCircle,
  IconRefresh,
  IconMail,
  IconExternalLink,
  IconChevronDown,
  IconChevronUp,
} from "@tabler/icons-react";
import MailRecipientsEditor from "@/components/MailRecipientsEditor";

type Kind = "national" | "regional" | "low";
type CountryCode = "CL" | "MX" | "CO" | "PE" | "AR";
type Holiday = { date: string; country: CountryCode; name: string; kind: Kind; regions?: string; legal: string };
type Flag = {
  level: "conflict" | "review" | "unverified";
  source: "Planilla" | "HubSpot";
  date: string;
  time: string | null;
  who: string;
  company: string;
  country: string | null;
  title: string;
  reason: string;
  url?: string;
};
type Report = {
  today: string;
  nextDay: string;
  windowEnd: string;
  nextStatus: { country: CountryCode; holidays: Holiday[] }[];
  upcoming: { date: string; holidays: Holiday[] }[];
  weekend: { date: string; holidays: Holiday[] }[];
  flags: Flag[];
  checked: { sheet: number; hubspot: number };
  warnings: string[];
  generatedAt: string;
};
type Payload = { report: Report; subject: string; html: string; recipients: string[] };

const COUNTRY_NAME: Record<CountryCode, string> = { CL: "Chile", MX: "México", CO: "Colombia", PE: "Perú", AR: "Argentina" };
const KIND_LABEL: Record<Kind, string> = { national: "Feriado", regional: "Feriado regional", low: "Baja actividad" };
const KIND_CLASS: Record<Kind, string> = {
  national: "bg-red-50 text-red-700",
  regional: "bg-amber-50 text-amber-800",
  low: "bg-amber-50 text-amber-800",
};
const LEVELS: { level: Flag["level"]; title: string; hint: string; color: string }[] = [
  { level: "conflict", title: "En feriado", hint: "Caen en un feriado del país de la empresa: reagendar.", color: "text-red-700" },
  { level: "review", title: "A revisar", hint: "Feriado regional o día de baja actividad: confirmar con el contacto.", color: "text-amber-800" },
  { level: "unverified", title: "Sin país", hint: "Caen en un feriado de algún país, pero no tienen país o empresa: completar el dato.", color: "text-ink" },
];

const DAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const shortDay = (d: string) => {
  const x = new Date(`${d}T12:00:00Z`);
  return `${DAYS[x.getUTCDay()]} ${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}`;
};
const timeCL = (iso: string) =>
  new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const label = (x: Holiday) => (x.kind === "regional" && x.regions ? `${x.name} (solo ${x.regions})` : x.name);

function Pill({ kind }: { kind: Kind }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${KIND_CLASS[kind]}`}>{KIND_LABEL[kind]}</span>;
}

export default function AlertaFeriadosPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState<string | null>(null);
  const [showMail, setShowMail] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/alerta-feriados");
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
    if (!window.confirm("¿Enviar ahora la Alerta de feriados a los destinatarios de la lista?")) return;
    setSending(true);
    setSendMsg(null);
    try {
      const res = await fetch("/api/alerta-feriados", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "No se pudo enviar");
      setSendMsg(`Correo enviado a ${json.sent.to.join(", ")}`);
    } catch (e) {
      setSendMsg((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const r = data?.report;

  return (
    <div className="space-y-6 max-w-5xl">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="label">Reportería</div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <IconCalendarEvent size={24} />
            Alerta de feriados
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            Chile, México, Colombia, Perú y Argentina · próximas 3 semanas
            {r && <> · actualizado a las {timeCL(r.generatedAt)}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={sendNow}
            disabled={sending || loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border hover:bg-black/5 transition disabled:opacity-50"
          >
            {sending ? <IconLoader2 size={15} className="animate-spin" /> : <IconMail size={15} />}
            Enviar ahora
          </button>
          <button
            onClick={load}
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
          Revisando feriados y reuniones…
        </div>
      )}

      {r && data && (
        <>
          {r.warnings.length > 0 && (
            <div className="text-sm p-3 rounded bg-amber-50 text-amber-900 border border-amber-200 space-y-1">
              {r.warnings.map((w) => (
                <p key={w} className="flex items-start gap-1.5">
                  <IconAlertCircle size={15} className="shrink-0 mt-0.5" />
                  {w}
                </p>
              ))}
            </div>
          )}

          <h2 className="text-sm font-semibold -mb-3">Próximo día hábil · {shortDay(r.nextDay)}</h2>
          <section className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {r.nextStatus.map((s) => {
              const top = s.holidays[0];
              return (
                <div key={s.country} className="rounded-lg bg-black/[0.03] px-4 py-3">
                  <div className="text-xs text-ink-muted">{COUNTRY_NAME[s.country]}</div>
                  <div className={`text-base font-semibold ${top?.kind === "national" ? "text-red-700" : top ? "text-amber-800" : ""}`}>
                    {top ? KIND_LABEL[top.kind] : "Se llama normal"}
                  </div>
                  {top && <div className="text-xs text-ink-muted mt-0.5">{label(top)}</div>}
                </div>
              );
            })}
          </section>

          <section className="card space-y-4">
            <div>
              <h2 className="text-sm font-semibold">Reuniones agendadas en feriado</h2>
              <p className="text-xs text-ink-muted">
                Revisadas {r.checked.sheet} reuniones de la planilla y {r.checked.hubspot} de HubSpot hasta el {shortDay(r.windowEnd)}.
              </p>
            </div>
            {r.flags.length === 0 && <p className="text-sm text-ink-muted">Ninguna reunión cae en un feriado.</p>}
            {LEVELS.map((lv) => {
              const list = r.flags.filter((f) => f.level === lv.level);
              if (!list.length) return null;
              return (
                <div key={lv.level}>
                  <p className={`text-sm font-semibold ${lv.color}`}>
                    {lv.title} <span className="text-ink-muted font-normal">({list.length})</span>
                  </p>
                  <p className="text-xs text-ink-muted mb-1">{lv.hint}</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-ink-muted border-b">
                          <th className="py-1.5 pr-3 font-medium">Fecha</th>
                          <th className="py-1.5 pr-3 font-medium">Empresa</th>
                          <th className="py-1.5 pr-3 font-medium">Responsable</th>
                          <th className="py-1.5 font-medium">Motivo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((f, i) => (
                          <tr key={`${f.source}-${f.date}-${f.company}-${i}`} className="border-b last:border-0 align-top">
                            <td className="py-2 pr-3 whitespace-nowrap">
                              {shortDay(f.date)}
                              {f.time && <div className="text-xs text-ink-muted">{f.time}</div>}
                            </td>
                            <td className="py-2 pr-3">
                              {f.url ? (
                                <a href={f.url} target="_blank" rel="noreferrer" className="font-medium hover:underline inline-flex items-center gap-1">
                                  {f.company} <IconExternalLink size={13} />
                                </a>
                              ) : (
                                <span className="font-medium">{f.company}</span>
                              )}
                              <div className="text-xs text-ink-muted">
                                {f.country ?? "Sin país"} · {f.title} · {f.source}
                              </div>
                            </td>
                            <td className="py-2 pr-3">{f.who}</td>
                            <td className="py-2 text-xs">{f.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </section>

          <section className="card space-y-2">
            <h2 className="text-sm font-semibold">Más adelante (próximas 3 semanas)</h2>
            {r.upcoming.length === 0 ? (
              <p className="text-sm text-ink-muted">Ningún otro feriado en días hábiles.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-ink-muted border-b">
                      <th className="py-1.5 pr-3 font-medium">Fecha</th>
                      <th className="py-1.5 pr-3 font-medium">País</th>
                      <th className="py-1.5 pr-3 font-medium">Motivo</th>
                      <th className="py-1.5 font-medium">Impacto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.upcoming.flatMap(({ date, holidays }) =>
                      holidays.map((x) => (
                        <tr key={`${date}-${x.country}-${x.name}`} className="border-b last:border-0 align-top">
                          <td className="py-2 pr-3 whitespace-nowrap">{shortDay(date)}</td>
                          <td className="py-2 pr-3">{COUNTRY_NAME[x.country]}</td>
                          <td className="py-2 pr-3">
                            {label(x)}
                            <div className="text-xs text-ink-muted">{x.legal}</div>
                          </td>
                          <td className="py-2">
                            <Pill kind={x.kind} />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card space-y-2">
            <h2 className="text-sm font-semibold">Correo automático</h2>
            <p className="text-xs text-ink-muted">
              Lunes a viernes a las 8:30 de Chile, con los feriados del día hábil siguiente (el viernes avisa los del lunes), desde alertas@notificaciones.bullseye-abm.com. Asunto de hoy: “{data.subject}”.
            </p>
            <MailRecipientsEditor reportKey="feriados" />
            <button onClick={() => setShowMail((v) => !v)} className="flex items-center gap-1 text-xs text-ink-muted hover:text-ink pt-1">
              {showMail ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
              {showMail ? "Ocultar" : "Ver"} el correo de hoy
            </button>
            {showMail && (
              <iframe title="Vista previa del correo" srcDoc={data.html} className="w-full h-[640px] rounded border bg-white" sandbox="" />
            )}
          </section>
        </>
      )}
    </div>
  );
}
