"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import MeetingDetail from "@/components/peitho/app/MeetingDetail";
import { PeithoContext, peithoApiFor } from "@/components/peitho/app/context";

// ACTI · Reuniones y feedback: próximas y realizadas. Cada realizada muestra el
// informe de Peitho con su diseño actual (planes desde Crece) y la pestaña
// "Tu feedback" (se realizó, calificación del perfil, oportunidad).

type Feedback = {
  realizada: boolean;
  perfil_rating: number | null;
  perfil_ok: boolean | null;
  oportunidad: "si" | "no" | "aun_no" | "otra_reunion" | null;
  comentario: string | null;
  disputa: "en_revision" | "cobrar" | "no_cobrar" | null;
};
type Meeting = {
  id: string;
  company: string;
  date: string | null;
  time: string | null;
  status: "proxima" | "realizada" | "no_show" | "por_confirmar" | "reagendada";
  contact: { name: string | null; title: string | null; email: string | null; phone: string | null };
  peithoId: string | null;
  feedback: Feedback | null;
  surveyDone: boolean;
};
type Data = { meetings: Meeting[]; peitho: "on" | "off_plan" | "off_client" };

const STATUS: Record<Meeting["status"], { label: string; cls: string }> = {
  proxima: { label: "Próxima", cls: "" },
  realizada: { label: "Realizada", cls: "ok" },
  no_show: { label: "No asistió el prospecto", cls: "bad" },
  por_confirmar: { label: "Por confirmar", cls: "warn" },
  reagendada: { label: "Reagendada", cls: "warn" },
};
const OPORTUNIDAD: [NonNullable<Feedback["oportunidad"]>, string][] = [
  ["si", "Sí, es oportunidad"],
  ["aun_no", "Aún no"],
  ["otra_reunion", "Falta otra reunión"],
  ["no", "No"],
];

const fmtDate = (iso: string | null) => {
  if (!iso) return "Sin fecha";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-CL", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};
const needsFeedback = (m: Meeting) => (m.status === "realizada" || m.status === "por_confirmar") && !m.feedback;

export default function Reuniones() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"proximas" | "realizadas">("proximas");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = () =>
    fetch("/api/acti/reuniones", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => (j.error ? setErr(j.error) : setData(j)))
      .catch(() => setErr("No se pudieron cargar tus reuniones"));
  useEffect(() => { load(); }, []);

  const upcoming = useMemo(() => data?.meetings.filter((m) => m.status === "proxima") ?? [], [data]);
  const past = useMemo(() => data?.meetings.filter((m) => m.status !== "proxima") ?? [], [data]);
  const pending = past.filter(needsFeedback).length;
  const open = data?.meetings.find((m) => m.id === openId) ?? null;

  if (err) return <div className="acti-banner warn">{err}</div>;
  if (!data) return <div className="acti-card acti-empty">Cargando…</div>;
  if (open) return <MeetingView m={open} peitho={data.peitho} onBack={() => setOpenId(null)} onSaved={load} />;

  return (
    <div className="acti-stack" style={{ gap: 16 }}>
      <div className="acti-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "proximas"} className="acti-tab" data-on={tab === "proximas" || undefined} onClick={() => setTab("proximas")}>
          Próximas ({upcoming.length})
        </button>
        <button role="tab" aria-selected={tab === "realizadas"} className="acti-tab" data-on={tab === "realizadas" || undefined} onClick={() => setTab("realizadas")}>
          Realizadas{pending ? ` · ${pending} por feedback` : ""}
        </button>
      </div>

      {tab === "proximas" ? (
        upcoming.length === 0 ? (
          <div className="acti-card acti-empty">
            <p style={{ margin: "0 0 12px" }}>No tienes reuniones agendadas.</p>
            <Link className="acti-btn sm" href="/acti/buscar">Buscar cuentas</Link>
          </div>
        ) : (
          <div className="acti-grid2">
            {upcoming.map((m) => (
              <section key={m.id} className="acti-card">
                <div className="acti-between">
                  <h2 style={{ margin: 0 }}>{m.company}</h2>
                  <span className="acti-tag">{fmtDate(m.date)}{m.time ? ` · ${m.time}` : ""}</span>
                </div>
                <ContactBlock m={m} />
              </section>
            ))}
          </div>
        )
      ) : past.length === 0 ? (
        <div className="acti-card acti-empty">Aún no tienes reuniones realizadas.</div>
      ) : (
        <div className="acti-tw">
          <table>
            <thead>
              <tr><th>Empresa</th><th>Fecha</th><th>Contacto</th><th>Estado</th><th>Peitho</th><th>Tu feedback</th><th /></tr>
            </thead>
            <tbody>
              {past.map((m) => (
                <tr key={m.id}>
                  <td style={{ fontWeight: 600 }}>{m.company}</td>
                  <td>{fmtDate(m.date)}</td>
                  <td>{[m.contact.name, m.contact.title].filter(Boolean).join(" · ") || "—"}</td>
                  <td><span className={`acti-tag ${STATUS[m.status].cls}`}>{STATUS[m.status].label}</span></td>
                  <td>{m.peithoId ? <span className="acti-tag ok">Análisis listo</span> : <span className="acti-tiny acti-muted">—</span>}</td>
                  <td>
                    {m.feedback?.disputa === "en_revision" ? <span className="acti-tag warn">En revisión</span>
                      : m.feedback ? <span className="acti-tag ok">Enviado</span>
                      : needsFeedback(m) ? <span className="acti-tag warn">Pendiente</span>
                      : <span className="acti-tiny acti-muted">—</span>}
                  </td>
                  <td><button className="acti-btn ghost sm" onClick={() => setOpenId(m.id)}>Ver</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ContactBlock({ m }: { m: Meeting }) {
  return (
    <div className="acti-small" style={{ marginTop: 8 }}>
      <div>{[m.contact.name, m.contact.title].filter(Boolean).join(" · ") || "Contacto por confirmar"}</div>
      {(m.contact.email || m.contact.phone) && <div className="acti-muted">{[m.contact.email, m.contact.phone].filter(Boolean).join(" · ")}</div>}
    </div>
  );
}

function MeetingView({ m, peitho, onBack, onSaved }: { m: Meeting; peitho: Data["peitho"]; onBack: () => void; onSaved: () => void }) {
  const [tab, setTab] = useState<"peitho" | "feedback">(m.peithoId ? "peitho" : "feedback");
  const ctx = useMemo(() => ({ api: peithoApiFor("/api/acti/peitho/proxy"), openMeeting: () => {}, refresh: () => {} }), []);
  return (
    <div className="acti-stack" style={{ gap: 16 }}>
      <div>
        <button className="acti-link" onClick={onBack}>← Volver a mis reuniones</button>
        <div className="acti-between" style={{ marginTop: 6 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>{m.company}</h2>
          <span className={`acti-tag ${STATUS[m.status].cls}`}>{STATUS[m.status].label} · {fmtDate(m.date)}</span>
        </div>
        <ContactBlock m={m} />
      </div>
      <div className="acti-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "peitho"} className="acti-tab" data-on={tab === "peitho" || undefined} onClick={() => setTab("peitho")}>Análisis de Peitho</button>
        <button role="tab" aria-selected={tab === "feedback"} className="acti-tab" data-on={tab === "feedback" || undefined} onClick={() => setTab("feedback")}>Tu feedback</button>
      </div>
      {tab === "peitho" ? (
        m.peithoId ? (
          <div className="acti-peitho">
            <PeithoContext.Provider value={ctx}>
              <MeetingDetail meetingId={m.peithoId} onBack={() => setTab("feedback")} />
            </PeithoContext.Provider>
          </div>
        ) : (
          <div className="acti-card acti-empty">
            {peitho === "off_plan" ? (
              <>
                <p style={{ margin: "0 0 12px" }}>El análisis de Peitho (desempeño, dolores, próximos pasos, transcripción y correo sugerido) está incluido desde el plan Crece.</p>
                <Link className="acti-btn sm" href="/acti/mi-plan">Ver planes</Link>
              </>
            ) : peitho === "off_client" ? (
              "Peitho se está activando para tu cuenta. Pronto verás aquí el análisis de cada reunión."
            ) : (
              "Esta reunión aún no tiene análisis de Peitho. Puede tardar unas horas, o el asistente no pudo entrar a la reunión."
            )}
          </div>
        )
      ) : (
        <FeedbackForm m={m} onSaved={onSaved} />
      )}
    </div>
  );
}

function FeedbackForm({ m, onSaved }: { m: Meeting; onSaved: () => void }) {
  const f = m.feedback;
  const [realizada, setRealizada] = useState<boolean | null>(f ? f.realizada : m.status === "no_show" ? false : null);
  const [rating, setRating] = useState<number | null>(f?.perfil_rating ?? null);
  const [perfilOk, setPerfilOk] = useState<boolean | null>(f?.perfil_ok ?? null);
  const [oportunidad, setOportunidad] = useState<Feedback["oportunidad"]>(f?.oportunidad ?? null);
  const [comentario, setComentario] = useState(f?.comentario ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (m.status === "proxima") return <div className="acti-card acti-empty">Podrás dar tu feedback después de la reunión.</div>;

  async function save() {
    setBusy(true); setMsg(null);
    const r = await fetch(`/api/acti/reuniones/${m.id}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ realizada, perfil_rating: rating, perfil_ok: perfilOk, oportunidad, comentario }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: j.error ?? "No se pudo guardar" });
    setMsg({
      ok: true,
      text: j.disputa === "en_revision"
        ? "Gracias. Como la reunión figuraba como realizada, el equipo de BullsEye la revisará y no se cobrará mientras tanto."
        : "Gracias. Tu feedback mejora las próximas recomendaciones.",
    });
    onSaved();
  }

  return (
    <section className="acti-card acti-stack">
      {f?.disputa === "en_revision" && <div className="acti-banner warn">Esta reunión está en revisión: no se cobra hasta que el equipo de BullsEye la confirme.</div>}
      <div className="acti-field">
        <span className="acti-field-label">¿Se realizó la reunión?</span>
        <div className="acti-chips">
          <button className="acti-chip" data-on={realizada === true || undefined} onClick={() => setRealizada(true)}>Sí, se realizó</button>
          <button className="acti-chip" data-on={realizada === false || undefined} onClick={() => setRealizada(false)}>No se realizó</button>
        </div>
      </div>
      {realizada && (
        <>
          <div className="acti-field">
            <span className="acti-field-label">¿Cómo calificas el perfil contactado?</span>
            <div className="acti-chips" role="radiogroup">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} role="radio" aria-checked={rating === n} className="acti-chip" data-on={rating === n || undefined} onClick={() => setRating(n)}>
                  {"★".repeat(n)}
                </button>
              ))}
            </div>
          </div>
          <div className="acti-field">
            <span className="acti-field-label">¿Era el tipo de cargo que pediste?</span>
            <div className="acti-chips">
              <button className="acti-chip" data-on={perfilOk === true || undefined} onClick={() => setPerfilOk(true)}>Sí</button>
              <button className="acti-chip" data-on={perfilOk === false || undefined} onClick={() => setPerfilOk(false)}>No</button>
            </div>
          </div>
          <div className="acti-field">
            <span className="acti-field-label">¿Es una oportunidad de negocio?</span>
            <div className="acti-chips">
              {OPORTUNIDAD.map(([k, l]) => <button key={k} className="acti-chip" data-on={oportunidad === k || undefined} onClick={() => setOportunidad(k)}>{l}</button>)}
            </div>
          </div>
        </>
      )}
      <label className="acti-field">
        <span className="acti-field-label">Comentarios (opcional)</span>
        <textarea rows={3} value={comentario} onChange={(e) => setComentario(e.target.value)} />
      </label>
      <div className="acti-between">
        <button className="acti-btn" disabled={busy || realizada === null} onClick={save}>{busy ? "Guardando…" : f ? "Actualizar feedback" : "Enviar feedback"}</button>
        {msg && <span className={`acti-small ${msg.ok ? "acti-ok" : "acti-bad"}`}>{msg.text}</span>}
      </div>
    </section>
  );
}
