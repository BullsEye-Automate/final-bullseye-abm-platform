"use client";

import { useEffect, useState } from "react";
import { IconAlertCircle, IconExternalLink, IconLoader2, IconMail, IconRefresh } from "@tabler/icons-react";
import MailRecipientsEditor from "@/components/MailRecipientsEditor";
import { CardH, Pending } from "../components/ui";

// ─── Alerta de feriados ─────────────────────────────────────────────────────
// Vista de Células SDR (Operación → Alerta de feriados). Feriados del próximo
// día hábil por país (el aviso llega el día hábil anterior al feriado),
// reuniones agendadas en un feriado del país de la empresa (planilla de
// reuniones + HubSpot) y lo que viene en 3 semanas. El mismo contenido sale
// por correo de lunes a viernes a las 8:30 de Chile (cron
// /api/cron/alerta-feriados). Datos de /api/alerta-feriados (lib/feriados/).
// No usa los filtros de período, célula, SDR, cliente ni país del módulo.

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
  flags: Flag[];
  checked: { sheet: number; hubspot: number };
  warnings: string[];
  generatedAt: string;
};
type Payload = { report: Report; subject: string; html: string; recipients: string[] };

const COUNTRY_NAME: Record<CountryCode, string> = { CL: "Chile", MX: "México", CO: "Colombia", PE: "Perú", AR: "Argentina" };
const KIND_LABEL: Record<Kind, string> = { national: "Feriado", regional: "Feriado regional", low: "Baja actividad" };
const KIND_CLS: Record<Kind, string> = { national: "r", regional: "y", low: "y" };
const LEVELS: { level: Flag["level"]; title: string; hint: string; cls: string }[] = [
  { level: "conflict", title: "En feriado", hint: "Caen en un feriado del país de la empresa: reagendar.", cls: "r" },
  { level: "review", title: "A revisar", hint: "Feriado regional o día de baja actividad: confirmar con el contacto.", cls: "y" },
  { level: "unverified", title: "Sin país", hint: "Caen en un feriado de algún país, pero no tienen país o empresa: completar el dato.", cls: "" },
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
const wrap = { whiteSpace: "normal" as const };

export function ViewFeriados() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ t: string; err: boolean } | null>(null);
  const [showMail, setShowMail] = useState(false);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/alerta-feriados", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Error al cargar");
      setData(json);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function sendNow() {
    if (!window.confirm("¿Enviar ahora la Alerta de feriados a los destinatarios de la lista?")) return;
    setSending(true);
    setMsg(null);
    try {
      const res = await fetch("/api/alerta-feriados", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "No se pudo enviar");
      setMsg({ t: `Correo enviado a ${json.sent.to.join(", ")}`, err: false });
    } catch (e) {
      setMsg({ t: (e as Error).message, err: true });
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const r = data?.report;
  const actions = (
    <div style={{ display: "flex", gap: 8 }}>
      <button className="cs-btn" onClick={sendNow} disabled={sending || loading}>
        {sending ? <IconLoader2 size={14} className="animate-spin" /> : <IconMail size={14} />} Enviar ahora
      </button>
      <button className="cs-btn" onClick={load} disabled={loading}>
        {loading ? <IconLoader2 size={14} className="animate-spin" /> : <IconRefresh size={14} />} Actualizar
      </button>
    </div>
  );

  if (err) return <div className="cs-banner err"><IconAlertCircle size={15} /><span>{err}</span></div>;
  if (!r || !data) return <div className="cs-card"><Pending>{loading ? "Revisando feriados y reuniones…" : "Sin datos"}</Pending></div>;

  return (
    <>
      {msg && <div className={`cs-banner ${msg.err ? "err" : "info"}`}><span>{msg.t}</span></div>}
      {r.warnings.map((w) => (
        <div key={w} className="cs-banner warn"><IconAlertCircle size={15} /><span>{w}</span></div>
      ))}

      <div className="cs-card">
        <CardH
          t={`Próximo día hábil · ${shortDay(r.nextDay)}`}
          p={`El correo de las 8:30 avisa los feriados del día hábil siguiente. Actualizado a las ${timeCL(r.generatedAt)}.`}
          right={actions}
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 12 }}>
          {r.nextStatus.map((s) => {
            const top = s.holidays[0];
            return (
              <div key={s.country} className="cs-stat">
                <small>{COUNTRY_NAME[s.country]}</small>
                <b>{top ? <span className={`cs-tag ${KIND_CLS[top.kind]}`}>{KIND_LABEL[top.kind]}</span> : "Se llama normal"}</b>
                {top && <div className="cs-muted" style={{ fontSize: 12, marginTop: 4 }}>{label(top)}</div>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="cs-card cs-mt">
        <CardH
          t="Reuniones agendadas en feriado"
          p={`Revisadas ${r.checked.sheet} reuniones de la planilla y ${r.checked.hubspot} de HubSpot hasta el ${shortDay(r.windowEnd)}.`}
        />
        {r.flags.length === 0 && <p className="cs-muted" style={{ fontSize: 13 }}>Ninguna reunión cae en un feriado.</p>}
        {LEVELS.map((lv) => {
          const list = r.flags.filter((f) => f.level === lv.level);
          if (!list.length) return null;
          return (
            <div key={lv.level} style={{ marginTop: 10 }}>
              <span className={`cs-tag ${lv.cls}`}>{lv.title} · {list.length}</span>
              <p className="cs-note" style={{ marginTop: 4 }}>{lv.hint}</p>
              <div className="cs-tw">
                <table>
                  <thead>
                    <tr><th className="l">Fecha</th><th className="l">Empresa</th><th className="l">Responsable</th><th className="l">Motivo</th></tr>
                  </thead>
                  <tbody>
                    {list.map((f, i) => (
                      <tr key={`${f.source}-${f.date}-${f.company}-${i}`}>
                        <td className="l">{shortDay(f.date)}{f.time ? <div className="cs-muted" style={{ fontSize: 11.5 }}>{f.time}</div> : null}</td>
                        <td className="l" style={wrap}>
                          {f.url ? (
                            <a href={f.url} target="_blank" rel="noreferrer" style={{ fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 4 }}>
                              {f.company} <IconExternalLink size={12} />
                            </a>
                          ) : (
                            <b style={{ fontWeight: 500 }}>{f.company}</b>
                          )}
                          <div className="cs-muted" style={{ fontSize: 11.5 }}>{f.country ?? "Sin país"} · {f.title} · {f.source}</div>
                        </td>
                        <td className="l">{f.who}</td>
                        <td className="l" style={wrap}>{f.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>

      <div className="cs-card cs-mt">
        <CardH t="Más adelante (próximas 3 semanas)" p="Feriados en días hábiles, con su respaldo legal." />
        {r.upcoming.length === 0 ? (
          <p className="cs-muted" style={{ fontSize: 13 }}>Ningún otro feriado en días hábiles.</p>
        ) : (
          <div className="cs-tw">
            <table>
              <thead>
                <tr><th className="l">Fecha</th><th className="l">País</th><th className="l">Motivo</th><th className="l">Impacto</th></tr>
              </thead>
              <tbody>
                {r.upcoming.flatMap(({ date, holidays }) =>
                  holidays.map((x) => (
                    <tr key={`${date}-${x.country}-${x.name}`}>
                      <td className="l">{shortDay(date)}</td>
                      <td className="l">{COUNTRY_NAME[x.country]}</td>
                      <td className="l" style={wrap}>{label(x)}<div className="cs-muted" style={{ fontSize: 11.5 }}>{x.legal}</div></td>
                      <td className="l"><span className={`cs-tag ${KIND_CLS[x.kind]}`}>{KIND_LABEL[x.kind]}</span></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="cs-card cs-mt">
        <CardH
          t="Correo automático"
          p="Lunes a viernes a las 8:30 de Chile desde alertas@notificaciones.bullseye-abm.com, con los feriados del día hábil siguiente (el viernes avisa los del lunes)."
        />
        <p className="cs-note" style={{ marginTop: 0 }}>Asunto de hoy: “{data.subject}”</p>
        <MailRecipientsEditor reportKey="feriados" />
        <button className="cs-btn ghost" style={{ marginTop: 8 }} onClick={() => setShowMail((v) => !v)}>
          {showMail ? "Ocultar" : "Ver"} el correo de hoy
        </button>
        {showMail && (
          <iframe title="Vista previa del correo" srcDoc={data.html} sandbox="" style={{ width: "100%", height: 640, marginTop: 10, border: "1px solid var(--border)", borderRadius: 8, background: "#fff" }} />
        )}
      </div>
    </>
  );
}
