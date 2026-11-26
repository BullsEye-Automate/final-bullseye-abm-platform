"use client";

// Dashboard SDR → ficha de empresa (panel lateral). Historial de la empresa y
// sus contactos leído en vivo de HubSpot, seguimientos pendientes y registro
// de notas, WhatsApp, LinkedIn, correos y seguimientos (lib/dashboardSdr/ficha.ts).
import { useCallback, useEffect, useState } from "react";
import { IconBrandLinkedin, IconBrandWhatsapp, IconCalendarEvent, IconCheck, IconChecklist, IconExternalLink, IconLoader2, IconMail, IconNote, IconPhone, IconRefresh, IconX } from "@tabler/icons-react";
import type { Ficha, FichaItem, FichaKind } from "@/lib/dashboardSdr/ficha";

type Acct = { id: string; sub: string | null; edit: boolean; portal?: number };
type Rec = { c: string; hs: string; n: string };
type Kind = "note" | "whatsapp" | "linkedin" | "email" | "task";

const KIND_META: Record<FichaKind, { label: string; icon: typeof IconNote; color: string }> = {
  note: { label: "Nota", icon: IconNote, color: "text-ink" },
  call: { label: "Llamada", icon: IconPhone, color: "text-brand" },
  email: { label: "Correo", icon: IconMail, color: "text-info-fg" },
  whatsapp: { label: "WhatsApp", icon: IconBrandWhatsapp, color: "text-success-fg" },
  linkedin: { label: "LinkedIn", icon: IconBrandLinkedin, color: "text-info-fg" },
  comm: { label: "Mensaje", icon: IconNote, color: "text-ink" },
  task: { label: "Tarea", icon: IconChecklist, color: "text-warning-fg" },
  meeting: { label: "Reunión", icon: IconCalendarEvent, color: "text-success-fg" },
};
const COMPOSE: { id: Kind; label: string }[] = [
  { id: "note", label: "Nota" }, { id: "whatsapp", label: "WhatsApp" }, { id: "linkedin", label: "LinkedIn" },
  { id: "email", label: "Correo enviado" }, { id: "task", label: "Próximo seguimiento (llega por correo)" },
];

const when = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(/^\d+$/.test(iso) ? Number(iso) : iso);
  return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
};
const isPast = (iso: string | null | undefined) => !!iso && new Date(/^\d+$/.test(iso) ? Number(iso) : iso).getTime() < Date.now();
const tomorrow = () => {
  const d = new Date(Date.now() + 86_400_000);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santiago" }).format(d);
};

export default function FichaDrawer({ rec, acct, canWrite, onClose, renderStatus }: {
  rec: Rec; acct: Acct | undefined; canWrite: boolean; onClose: () => void;
  renderStatus: (type: "company" | "contact", r: { c: string; hs: string; st: string }, onSaved: (st: string) => void) => React.ReactNode;
}) {
  const [data, setData] = useState<Ficha | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>("note");
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [contact, setContact] = useState("");
  const [due, setDue] = useState(`${tomorrow()}T09:30`);
  const [taskType, setTaskType] = useState<"CALL" | "TODO">("CALL");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [filter, setFilter] = useState<"" | FichaKind>("");

  const load = useCallback(async () => {
    if (!acct) { setErr("No se encontró la cuenta de este cliente."); setLoading(false); return; }
    setLoading(true); setErr(null);
    try {
      const qs = new URLSearchParams({ client_id: acct.id, hs: rec.hs, ...(acct.sub ? { sub: acct.sub } : {}) });
      const r = await fetch(`/api/sdr/dashboard/ficha?${qs}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
      setData(j);
    } catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
  }, [acct, rec.hs]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const post = async (payload: Record<string, unknown>) => {
    if (!acct) return false;
    setSaving(true); setMsg(null);
    try {
      const r = await fetch("/api/sdr/dashboard/ficha", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: acct.id, sub: acct.sub, hs: rec.hs, ...payload }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
      const parts = ["Guardado en HubSpot."];
      if (j.owner === false) parts.push("No se encontró al SDR entre los usuarios de ese HubSpot (ni por correo ni por la propiedad SDR): quedó sin propietario.");
      if (j.mailed) parts.push(`Correo con la invitación de calendario enviado a ${j.mailed}.`);
      if (j.mailError) parts.push(`No se pudo enviar el correo (${j.mailError}).`);
      setMsg({ ok: !j.mailError, t: parts.join(" ") });
      await load();
      return true;
    } catch (e) { setMsg({ ok: false, t: (e as Error).message }); return false; } finally { setSaving(false); }
  };
  const save = async () => {
    const ok = await post({ action: "create", kind, body, subject: subject || undefined, contact: contact || undefined, due: kind === "task" ? due : undefined, taskType });
    if (ok) { setBody(""); setSubject(""); }
  };

  const writable = canWrite && !!data?.writable;
  const portal = acct?.portal;
  const hsLink = (type: "0-1" | "0-2", id: string) => (portal ? `https://app.hubspot.com/contacts/${portal}/record/${type}/${id}` : null);
  const items = (data?.items ?? []).filter((i) => !filter || i.kind === filter || (filter === "comm" && (i.kind === "whatsapp" || i.kind === "linkedin")));

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`Ficha de ${rec.n}`}>
      <button type="button" aria-label="Cerrar" className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="relative w-full max-w-2xl h-full bg-[#F7F6FB] shadow-xl overflow-y-auto">
        <header className="sticky top-0 z-10 bg-white border-b px-5 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-ink-muted">{rec.c} · ficha de la empresa</div>
            <h2 className="text-lg font-semibold truncate flex items-center gap-1.5">
              {data?.company.n ?? rec.n}
              {hsLink("0-2", rec.hs) && <a href={hsLink("0-2", rec.hs)!} target="_blank" rel="noopener noreferrer" title="Abrir en HubSpot" className="text-brand"><IconExternalLink size={16} /></a>}
            </h2>
            {data && <div className="mt-1 flex items-center gap-2 text-sm">{renderStatus("company", { c: rec.c, hs: rec.hs, st: data.company.st ?? "Sin status" }, (st) => setData((d) => (d ? { ...d, company: { ...d.company, st } } : d)))}{data.company.dom && <span className="text-xs text-ink-muted">{data.company.dom}</span>}</div>}
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={load} disabled={loading} title="Volver a leer HubSpot" className="p-2 rounded-lg hover:bg-black/5 disabled:opacity-50">{loading ? <IconLoader2 size={16} className="animate-spin" /> : <IconRefresh size={16} />}</button>
            <button type="button" onClick={onClose} title="Cerrar (Esc)" className="p-2 rounded-lg hover:bg-black/5"><IconX size={16} /></button>
          </div>
        </header>

        <div className="p-5 space-y-4">
          {err && <div className="text-sm text-danger-fg bg-danger-bg rounded-lg p-3">{err}</div>}
          {loading && !data && <div className="flex items-center gap-2 text-sm text-ink-muted py-8 justify-center"><IconLoader2 size={16} className="animate-spin" /> Leyendo la empresa en HubSpot…</div>}

          {data && (
            <>
              {/* Registrar */}
              <section className="card space-y-3">
                <h3 className="text-sm font-semibold">Registrar</h3>
                {!writable ? (
                  <p className="text-sm text-ink-muted">{data.reason ?? "Solo el SDR de esta empresa, las líderes de célula e Ingri pueden registrar actividades."}</p>
                ) : (
                  <>
                    <div role="tablist" className="flex flex-wrap gap-1.5">
                      {COMPOSE.map((k) => (
                        <button key={k.id} role="tab" aria-selected={kind === k.id} type="button" onClick={() => setKind(k.id)}
                          className={`px-3 py-1 rounded-full text-sm border ${kind === k.id ? "bg-brand text-white border-brand" : "bg-white hover:bg-black/[0.03]"}`}>{k.label}</button>
                      ))}
                    </div>
                    <div className="grid sm:grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1 text-xs text-ink-muted">Contacto (opcional)
                        <select className="input" value={contact} onChange={(e) => setContact(e.target.value)}>
                          <option value="">Solo la empresa</option>
                          {data.contacts.map((c) => <option key={c.hs} value={c.hs}>{c.n}{c.cargo ? ` · ${c.cargo}` : ""}</option>)}
                        </select>
                      </label>
                      {(kind === "task" || kind === "email") && (
                        <label className="flex flex-col gap-1 text-xs text-ink-muted">{kind === "task" ? "Título" : "Asunto"}
                          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={kind === "task" ? "Ej. Llamar de nuevo al gerente de TI" : "Asunto del correo"} maxLength={200} />
                        </label>
                      )}
                      {kind === "task" && (
                        <>
                          <label className="flex flex-col gap-1 text-xs text-ink-muted">Fecha y hora (Chile)
                            <input className="input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
                          </label>
                          <label className="flex flex-col gap-1 text-xs text-ink-muted">Tipo
                            <select className="input" value={taskType} onChange={(e) => setTaskType(e.target.value as "CALL" | "TODO")}>
                              <option value="CALL">Llamar</option><option value="TODO">Por hacer</option>
                            </select>
                          </label>
                        </>
                      )}
                    </div>
                    <textarea className="input min-h-[96px] w-full" value={body} onChange={(e) => setBody(e.target.value)}
                      placeholder={kind === "note" ? "Qué pasó, qué dijo, qué sigue…" : kind === "task" ? "Detalle del seguimiento (opcional)" : "Resumen del mensaje"} />
                    <div className="flex items-center gap-3">
                      <button type="button" onClick={save} disabled={saving || (kind !== "task" && !body.trim()) || (kind === "task" && !due)}
                        className="px-4 py-2 rounded-lg bg-brand text-white text-sm disabled:opacity-50 flex items-center gap-1.5">
                        {saving && <IconLoader2 size={14} className="animate-spin" />} Guardar en HubSpot
                      </button>
                      {msg && <span className={`text-sm ${msg.ok ? "text-success-fg" : "text-danger-fg"}`}>{msg.t}</span>}
                    </div>
                  </>
                )}
              </section>

              {/* Seguimientos pendientes */}
              <section className="card space-y-2">
                <h3 className="text-sm font-semibold">Seguimientos pendientes ({data.tasks.length})</h3>
                {!data.tasks.length && <p className="text-sm text-ink-muted">Sin seguimientos pendientes. Agenda el próximo en «Próximo seguimiento».</p>}
                {data.tasks.map((t) => (
                  <div key={t.id} className={`flex items-start gap-3 rounded-lg border p-2.5 ${isPast(t.due) ? "border-warning-bg bg-warning-bg/30" : "bg-white"}`}>
                    <IconChecklist size={16} className="mt-0.5 text-warning-fg shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{t.title}</div>
                      <div className="text-xs text-ink-muted">{isPast(t.due) ? "Venció" : "Para"} el {when(t.due)}{t.owner ? ` · ${t.owner}` : ""}{t.contacts.length ? ` · ${t.contacts.join(", ")}` : ""}</div>
                      {t.body && <p className="text-sm mt-1 whitespace-pre-line">{t.body}</p>}
                    </div>
                    {writable && <button type="button" disabled={saving} onClick={() => post({ action: "complete", task: t.id })} className="text-xs px-2 py-1 rounded border hover:bg-black/5 flex items-center gap-1 disabled:opacity-50"><IconCheck size={12} /> Hecho</button>}
                  </div>
                ))}
              </section>

              {/* Contactos */}
              <section className="card space-y-2">
                <h3 className="text-sm font-semibold">Contactos de la cuenta ({data.contacts.length})</h3>
                {!data.contacts.length && <p className="text-sm text-ink-muted">Sin contactos de este cliente en la empresa.</p>}
                <div className="divide-y">
                  {data.contacts.map((c) => (
                    <div key={c.hs} className="py-2 flex items-center gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">
                          {hsLink("0-1", c.hs) ? <a href={hsLink("0-1", c.hs)!} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">{c.n}</a> : c.n}
                        </div>
                        <div className="text-xs text-ink-muted">{c.cargo || "Sin cargo"} · {[c.ph && "teléfono", c.ml && "correo", c.lk && "LinkedIn"].filter(Boolean).join(", ") || "sin datos de contacto"}</div>
                      </div>
                      <div className="text-sm">{renderStatus("contact", { c: rec.c, hs: c.hs, st: c.st ?? "Sin status" }, (st) => setData((d) => (d ? { ...d, contacts: d.contacts.map((k) => (k.hs === c.hs ? { ...k, st } : k)) } : d)))}</div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Historial */}
              <section className="card space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="text-sm font-semibold">Historial ({data.items.length})</h3>
                  <select className="input text-sm py-1" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filtrar historial">
                    <option value="">Todo</option><option value="call">Llamadas</option><option value="note">Notas</option><option value="email">Correos</option>
                    <option value="whatsapp">WhatsApp</option><option value="linkedin">LinkedIn</option><option value="meeting">Reuniones</option><option value="task">Tareas hechas</option>
                  </select>
                </div>
                {!items.length && <p className="text-sm text-ink-muted">Sin actividades registradas.</p>}
                <ol className="space-y-2">
                  {items.map((i) => <HistoryItem key={i.id} i={i} />)}
                </ol>
              </section>
              <p className="text-xs text-ink-muted">Leído de HubSpot {when(data.at)}. Lo que registras aquí se guarda en HubSpot a tu nombre (dispara los workflows que tenga).</p>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function HistoryItem({ i }: { i: FichaItem }) {
  const m = KIND_META[i.kind];
  const Icon = m.icon;
  const [open, setOpen] = useState(false);
  const long = i.body.length > 280;
  return (
    <li className="flex gap-3 rounded-lg bg-white border p-2.5">
      <Icon size={16} className={`mt-0.5 shrink-0 ${m.color}`} />
      <div className="min-w-0 flex-1">
        <div className="text-sm"><span className="font-medium">{i.title}</span>{i.dir ? <span className="text-xs text-ink-muted"> · {/IN/i.test(i.dir) ? "entrante" : "saliente"}</span> : null}{i.outcome ? <span className="text-xs text-ink-muted"> · {i.outcome}</span> : null}</div>
        <div className="text-xs text-ink-muted">{when(i.at)}{i.owner ? ` · ${i.owner}` : ""}{i.contacts.length ? ` · ${i.contacts.join(", ")}` : ""}</div>
        {i.body && <p className="text-sm mt-1 whitespace-pre-line break-words">{long && !open ? `${i.body.slice(0, 280)}…` : i.body}</p>}
        {long && <button type="button" onClick={() => setOpen(!open)} className="text-xs text-brand hover:underline mt-0.5">{open ? "Ver menos" : "Ver más"}</button>}
      </div>
    </li>
  );
}
