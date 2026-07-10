"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useClient } from "@/lib/clientContext";
import {
  IconAlertCircle,
  IconRefresh,
  IconExternalLink,
  IconLoader2,
  IconCheck,
  IconX,
  IconDownload,
  IconCopy,
  IconUsers,
  IconSend,
  IconTrash,
  IconBook,
  IconSparkles,
} from "@tabler/icons-react";

// ─────────────────────────────────────────────────────────────────────────
// Tipos — Parte 1 (import-manual)
// ─────────────────────────────────────────────────────────────────────────

type ImportContact = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  email: string | null;
  linkedin_url: string | null;
  fit_score: number | null;
  name_email_mismatch: boolean;
  mismatch_reason: string | null;
};

type ImportCompany = {
  company_id?: string;
  company_name: string;
  created?: boolean;
  fit_score?: string | null;
  company_type?: string | null;
  contacts: ImportContact[];
  yes: number;
  no: number;
  skipped: number;
  error?: string;
};

// Mensajes generados/editables de un contacto — mismos campos que acepta
// PATCH /api/contacts/[id]/messages.
type GeneratedMessages = {
  email_subject: string | null;
  email_body: string | null;
  email_subject_2: string | null;
  email_body_2: string | null;
  email_subject_3: string | null;
  email_body_3: string | null;
  connect_message: string | null;
  linkedin_icebreaker: string | null;
  linkedin_msg_2: string | null;
};

type MessagePreview = {
  segment: { id: string | null; name: string | null; reasoning: string };
  messages: GeneratedMessages;
};

type ImportManualResponse = {
  staged_total: number;
  filtered_total: number;
  date_filter_active: boolean;
  date_filter_ignored: boolean;
  skipped_no_company: { name: string; job_title: string | null }[];
  companies: ImportCompany[];
  imported_companies_created: number;
  imported_companies_reused: number;
  imported_contacts_yes: number;
  imported_contacts_no: number;
  imported_contacts_skipped: number;
  contacts_ready: number;
  already_sent: number;
  matched_url: string;
  errors: string[];
  error?: string;
};

// ─────────────────────────────────────────────────────────────────────────
// Tipos — Parte 2 (cola de Clay)
// ─────────────────────────────────────────────────────────────────────────

type Company = {
  id: string;
  company_name: string;
  company_website: string | null;
  company_linkedin_url: string | null;
  company_city: string | null;
  company_country: string | null;
  company_size: number | null;
  company_type: string | null;
  fit_signals: string | null;
  research_summary: string | null;
  fit_score: "high" | "medium" | "low" | null;
  clay_pushed_at: string | null;
  clay_no_contacts_at: string | null;
  sales_nav_status: string | null;
  created_at: string;
};

type QueueItem = { company: Company; contact_count: number; signal?: "clay" | "inferred"; recent?: boolean };

type QueueData = { no_contacts: QueueItem[]; one_contact: QueueItem[]; no_fit: QueueItem[] };

type StagingLead = {
  key: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  companyName: string;
  linkedinUrl: string | null;
  email: string | null;
  matched: boolean;
};

const LOW_FIT_MAX = 4;
const HIGH_FIT_MIN = 8;

export default function BusquedaManualPage() {
  const { currentClient } = useClient();

  return (
    <div className="space-y-8">
      {!currentClient && (
        <div className="card flex items-center gap-3 border border-warning-bg bg-warning-bg/40 text-warning-fg text-sm">
          <IconAlertCircle size={16} className="shrink-0" />
          Selecciona un cliente en el sidebar para usar la búsqueda manual.
        </div>
      )}

      <header className="flex items-end justify-between">
        <div>
          <div className="label">Prospección</div>
          <h1 className="text-2xl font-semibold tracking-tight">Búsqueda manual</h1>
          <div className="text-sm text-ink-muted mt-1">
            Importa contactos encontrados a mano en Sales Navigator o Lemlist People, generá los mensajes con IA y envialos a la campaña real.
          </div>
        </div>
        <Link href="/busqueda-manual/instrucciones" className="btn-secondary">
          <IconBook size={15} /> Cómo prospectar
        </Link>
      </header>

      {currentClient && (
        <>
          <ImportManualPanel clientId={currentClient.id} />
          <ClayQueueSection clientId={currentClient.id} />
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Parte 1 — Importar desde Sales Navigator (manual)
// ─────────────────────────────────────────────────────────────────────────

function ImportManualPanel({ clientId }: { clientId: string }) {
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportManualResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [discarded, setDiscarded] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState<Set<string>>(new Set());
  const [discarding, setDiscarding] = useState<Set<string>>(new Set());
  const [sendErrors, setSendErrors] = useState<Record<string, string>>({});
  const [bulkBusy, setBulkBusy] = useState(false);

  // Generar mensaje (paso 1) — separado de enviar a Lemlist (paso 2).
  const [generating, setGenerating] = useState<Set<string>>(new Set());
  const [genErrors, setGenErrors] = useState<Record<string, string>>({});
  const [previews, setPreviews] = useState<Record<string, MessagePreview>>({});
  const [edited, setEdited] = useState<Record<string, GeneratedMessages>>({});

  async function handleImport() {
    setLoading(true);
    setError(null);
    setResult(null);
    setDiscarded(new Set());
    setSent(new Set());
    setSendErrors({});
    setGenerating(new Set());
    setGenErrors({});
    setPreviews({});
    setEdited({});
    try {
      const res = await fetch("/api/busqueda-manual/import-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          since: since || undefined,
          until: until || undefined,
        }),
      });
      const json = (await res.json()) as ImportManualResponse;
      if (!res.ok) setError(json.error ?? `Error ${res.status}`);
      else setResult(json);
    } catch {
      setError("Error de red al importar desde Lemlist");
    }
    setLoading(false);
  }

  const okCompanies = useMemo(() => (result?.companies ?? []).filter((c) => !c.error), [result]);

  // Agrupa primero por empresa y, dentro de cada empresa, por tier de fit:
  // bajo (1-4, para descartar en bloque), medio (5-7, revisión 1 a 1) y
  // alto (8-10, para enviar juntos). Sin score conocido cae en "medio"
  // (revisión 1 a 1, no se manda a ciegas en el envío masivo de alto fit).
  const companiesWithTiers = useMemo(
    () =>
      okCompanies
        .map((c) => {
          const low: ImportContact[] = [];
          const mid: ImportContact[] = [];
          const high: ImportContact[] = [];
          for (const ct of c.contacts) {
            if (ct.fit_score != null && ct.fit_score <= LOW_FIT_MAX) low.push(ct);
            else if (ct.fit_score != null && ct.fit_score >= HIGH_FIT_MIN) high.push(ct);
            else mid.push(ct);
          }
          return { ...c, low, mid, high };
        })
        .filter((c) => c.low.length + c.mid.length + c.high.length > 0),
    [okCompanies]
  );

  const pending = useCallback((list: ImportContact[]) => list.filter((ct) => !sent.has(ct.id) && !discarded.has(ct.id)), [sent, discarded]);

  const pendingHighAll = useMemo(
    () => companiesWithTiers.flatMap((c) => pending(c.high)),
    [companiesWithTiers, pending]
  );

  const allContacts = useMemo(
    () => companiesWithTiers.flatMap((c) => [...c.low, ...c.mid, ...c.high]),
    [companiesWithTiers]
  );
  const allDone = allContacts.length > 0 && pending(allContacts).length === 0;

  async function generateOne(id: string) {
    setGenerating((s) => new Set(s).add(id));
    setGenErrors((e) => { const n = { ...e }; delete n[id]; return n; });
    try {
      const res = await fetch(`/api/contacts/${id}/generate-message`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGenErrors((e) => ({ ...e, [id]: json.error ?? `Error ${res.status}` }));
      } else {
        setPreviews((p) => ({ ...p, [id]: json }));
        setEdited((ed) => ({ ...ed, [id]: json.messages }));
      }
    } catch {
      setGenErrors((e) => ({ ...e, [id]: "Error de red al generar el mensaje" }));
    }
    setGenerating((s) => { const n = new Set(s); n.delete(id); return n; });
  }

  function updateEditedField(id: string, field: keyof GeneratedMessages, value: string) {
    setEdited((ed) => ({ ...ed, [id]: { ...ed[id], [field]: value } }));
  }

  async function sendOne(id: string) {
    setSending((s) => new Set(s).add(id));
    setSendErrors((e) => { const n = { ...e }; delete n[id]; return n; });
    try {
      // Si el mensaje se generó/editó a mano antes de enviar, guardamos la
      // versión final ANTES de pushear — push-to-lemlist no regenera si ya
      // encuentra mensajes guardados, así que respeta lo editado.
      const draft = edited[id];
      if (draft) {
        await fetch(`/api/contacts/${id}/messages`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        });
      }
      const res = await fetch(`/api/contacts/${id}/push-to-lemlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setSendErrors((e) => ({ ...e, [id]: json.error ?? `Error ${res.status}` }));
      else setSent((s) => new Set(s).add(id));
    } catch {
      setSendErrors((e) => ({ ...e, [id]: "Error de red" }));
    }
    setSending((s) => { const n = new Set(s); n.delete(id); return n; });
  }

  async function sendMany(ids: string[]) {
    setBulkBusy(true);
    const CHUNK = 3;
    for (let i = 0; i < ids.length; i += CHUNK) {
      await Promise.all(ids.slice(i, i + CHUNK).map((id) => sendOne(id)));
    }
    setBulkBusy(false);
  }

  async function discardOne(id: string) {
    setDiscarding((s) => new Set(s).add(id));
    try {
      await fetch(`/api/contacts/${id}/discard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Bajo fit — descartado desde búsqueda manual" }),
      });
      setDiscarded((s) => new Set(s).add(id));
    } catch { /* silencia */ }
    setDiscarding((s) => { const n = new Set(s); n.delete(id); return n; });
  }

  async function discardMany(ids: string[]) {
    setBulkBusy(true);
    await Promise.all(ids.map((id) => discardOne(id)));
    setBulkBusy(false);
  }

  return (
    <div className="card border-l-4 flex flex-col gap-4" style={{ borderLeftColor: "#62E0D8" }}>
      <div>
        <h2 className="text-lg font-semibold">Importar desde Sales Navigator (manual)</h2>
        <p className="text-sm text-ink-muted mt-1">
          Trae los contactos que agregaste a mano a la Campaña puente de Lemlist, los pre-filtra con IA y los deja listos para generar mensajes y enviar.
        </p>
      </div>

      <div className="rounded-lg p-3 text-xs space-y-1.5" style={{ background: "rgba(37,23,98,0.04)", border: "1px solid rgba(37,23,98,0.08)" }}>
        <div className="font-semibold text-ink-muted uppercase tracking-wide mb-1">Cómo funciona</div>
        {[
          "Busca empresas y contactos fit en Sales Navigator (o Lemlist People).",
          "Con la extensión de Lemlist, agrégalos a la Campaña puente enriqueciendo LinkedIn + email.",
          "Vuelve aquí y haz clic en \"Importar desde Lemlist\".",
          "Revisa el resultado por empresa, genera los mensajes con IA y envíalos a la campaña real.",
        ].map((s, i) => (
          <div key={i} className="flex gap-2">
            <span className="font-bold text-brand shrink-0">{i + 1}.</span>
            <span>{s}</span>
          </div>
        ))}
        <Link href="/busqueda-manual/instrucciones" className="inline-flex items-center gap-1 text-brand hover:underline mt-1">
          Ver guía completa paso a paso →
        </Link>
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <label className="label block mb-1">Desde (opcional)</label>
          <input type="date" value={since} onChange={(e) => setSince(e.target.value)} className="rounded-md border border-[#D8D5EA] px-2.5 py-1.5 text-sm" />
        </div>
        <div>
          <label className="label block mb-1">Hasta (opcional)</label>
          <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="rounded-md border border-[#D8D5EA] px-2.5 py-1.5 text-sm" />
        </div>
        <button onClick={handleImport} disabled={loading} className="btn-primary">
          {loading ? <IconLoader2 size={15} className="animate-spin" /> : <IconDownload size={15} />}
          {loading ? "Importando…" : "Importar desde Lemlist"}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm bg-danger-bg text-danger-fg">
          <IconAlertCircle size={15} className="shrink-0" /> {error}
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-5">
          {result.date_filter_ignored && (
            <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs bg-warning-bg text-warning-fg">
              <IconAlertCircle size={13} className="shrink-0" />
              Lemlist no trajo fechas para estos leads — se ignoró el filtro de fechas y se importaron todos.
            </div>
          )}

          <div className="flex flex-wrap gap-4 text-xs text-ink-muted">
            <span><strong className="text-ink">{result.staged_total}</strong> en la puente</span>
            {result.date_filter_active && <span><strong className="text-ink">{result.filtered_total}</strong> tras filtro de fecha</span>}
            <span><strong className="text-ink">{result.already_sent}</strong> ya enviados (saltados)</span>
            <span><strong className="text-ink">{result.imported_companies_created}</strong> empresas nuevas · <strong className="text-ink">{result.imported_companies_reused}</strong> reusadas</span>
            <span><strong className="text-success-fg">{result.imported_contacts_yes}</strong> pasaron el pre-filter</span>
            <span><strong className="text-ink-muted">{result.imported_contacts_no}</strong> no pasaron</span>
            {result.skipped_no_company.length > 0 && (
              <span><strong className="text-warning-fg">{result.skipped_no_company.length}</strong> sin empresa (saltados)</span>
            )}
          </div>

          {result.errors.length > 0 && (
            <div className="rounded-lg border border-danger-bg text-xs divide-y divide-danger-bg overflow-hidden">
              {result.errors.map((e, i) => (
                <div key={i} className="px-3 py-1.5 text-danger-fg">{e}</div>
              ))}
            </div>
          )}

          {companiesWithTiers.length > 0 && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Por empresa</h3>
                {pendingHighAll.length > 0 && (
                  <button onClick={() => sendMany(pendingHighAll.map((c) => c.id))} disabled={bulkBusy} className="btn-primary text-xs">
                    {bulkBusy ? <IconLoader2 size={13} className="animate-spin" /> : <IconSend size={13} />}
                    Generar mensajes y enviar a Lemlist todos los fit {HIGH_FIT_MIN}-10 ({pendingHighAll.length})
                  </button>
                )}
              </div>

              {companiesWithTiers.map((c) => {
                const pendingHigh = pending(c.high);
                const pendingLow = pending(c.low);
                const total = c.low.length + c.mid.length + c.high.length;
                return (
                  <div key={c.company_id ?? c.company_name} className="rounded-lg border border-[#E5E2F0] overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2 bg-[#F9F8FC]">
                      <span className="font-semibold text-sm truncate">{c.company_name}</span>
                      {c.created && <span className="badge bg-brand-tint text-brand">nueva</span>}
                      <span className="text-xs text-ink-muted">{total} contacto{total === 1 ? "" : "s"}</span>
                    </div>

                    {c.low.length > 0 && (
                      <div className="border-t border-[#E5E2F0]">
                        <div className="flex items-center justify-between px-3 py-1.5 bg-warning-bg/40">
                          <span className="text-xs font-semibold text-warning-fg uppercase tracking-wide">
                            Bajo fit (1–{LOW_FIT_MAX})
                          </span>
                          {pendingLow.length > 0 && (
                            <button onClick={() => discardMany(pendingLow.map((ct) => ct.id))} disabled={bulkBusy} className="btn-danger text-xs">
                              <IconTrash size={12} /> Descartar todos ({pendingLow.length})
                            </button>
                          )}
                        </div>
                        <div className="divide-y divide-[#E5E2F0]">
                          {c.low.map((ct) => (
                            <ContactRow
                              key={ct.id}
                              contact={ct}
                              sending={sending.has(ct.id)}
                              discarding={discarding.has(ct.id)}
                              sent={sent.has(ct.id)}
                              discarded={discarded.has(ct.id)}
                              error={sendErrors[ct.id]}
                              onDiscard={() => discardOne(ct.id)}
                              lowFit
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {c.mid.length > 0 && (
                      <div className="border-t border-[#E5E2F0]">
                        <div className="px-3 py-1.5 bg-[#F1EEF7]">
                          <span className="text-xs font-semibold text-ink-muted uppercase tracking-wide">
                            Fit medio (5–{HIGH_FIT_MIN - 1}) — revisión 1 a 1
                          </span>
                        </div>
                        <div className="divide-y divide-[#E5E2F0]">
                          {c.mid.map((ct) => (
                            <ContactRow
                              key={ct.id}
                              contact={ct}
                              sending={sending.has(ct.id)}
                              discarding={discarding.has(ct.id)}
                              sent={sent.has(ct.id)}
                              discarded={discarded.has(ct.id)}
                              error={sendErrors[ct.id]}
                              onSend={() => sendOne(ct.id)}
                              onDiscard={() => discardOne(ct.id)}
                              generating={generating.has(ct.id)}
                              genError={genErrors[ct.id]}
                              preview={previews[ct.id]}
                              edited={edited[ct.id]}
                              onGenerate={() => generateOne(ct.id)}
                              onEditField={(field, value) => updateEditedField(ct.id, field, value)}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {c.high.length > 0 && (
                      <div className="border-t border-[#E5E2F0]">
                        <div className="flex items-center justify-between px-3 py-1.5 bg-success-bg/40">
                          <span className="text-xs font-semibold text-success-fg uppercase tracking-wide">
                            Fit alto ({HIGH_FIT_MIN}–10)
                          </span>
                          {pendingHigh.length > 0 && (
                            <button onClick={() => sendMany(pendingHigh.map((ct) => ct.id))} disabled={bulkBusy} className="btn-secondary text-xs">
                              <IconSend size={12} /> Generar y enviar {pendingHigh.length} a Lemlist
                            </button>
                          )}
                        </div>
                        <div className="divide-y divide-[#E5E2F0]">
                          {c.high.map((ct) => (
                            <ContactRow
                              key={ct.id}
                              contact={ct}
                              sending={sending.has(ct.id)}
                              discarding={discarding.has(ct.id)}
                              sent={sent.has(ct.id)}
                              discarded={discarded.has(ct.id)}
                              error={sendErrors[ct.id]}
                              onSend={() => sendOne(ct.id)}
                              onDiscard={() => discardOne(ct.id)}
                              generating={generating.has(ct.id)}
                              genError={genErrors[ct.id]}
                              preview={previews[ct.id]}
                              edited={edited[ct.id]}
                              onGenerate={() => generateOne(ct.id)}
                              onEditField={(field, value) => updateEditedField(ct.id, field, value)}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {allDone && (
            <div className="flex items-center gap-2 text-ink-muted text-sm">
              <IconCheck size={16} className="text-success-fg" /> Todos los contactos importados ya fueron enviados o descartados.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EditableField({
  label,
  value,
  onChange,
  textarea,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  textarea?: boolean;
}) {
  const className = "w-full rounded-md border border-[#D8D5EA] px-2 py-1 text-xs bg-white focus:outline-none focus:border-brand";
  return (
    <div>
      <div className="label mb-0.5">{label}</div>
      {textarea ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className={className} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} className={className} />
      )}
    </div>
  );
}

function ContactRow({
  contact,
  companyName,
  sending,
  discarding,
  sent,
  discarded,
  error,
  onSend,
  onDiscard,
  lowFit,
  generating,
  genError,
  preview,
  edited,
  onGenerate,
  onEditField,
}: {
  contact: ImportContact;
  companyName?: string;
  sending: boolean;
  discarding: boolean;
  sent: boolean;
  discarded: boolean;
  error?: string;
  onSend?: () => void;
  onDiscard: () => void;
  lowFit?: boolean;
  generating?: boolean;
  genError?: string;
  preview?: MessagePreview;
  edited?: GeneratedMessages;
  onGenerate?: () => void;
  onEditField?: (field: keyof GeneratedMessages, value: string) => void;
}) {
  const name = `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() || contact.email || "Sin nombre";
  return (
    <div className="flex flex-col gap-2 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-ink truncate">{name}</span>
            {contact.job_title && <span className="text-xs text-ink-muted">· {contact.job_title}</span>}
            {contact.fit_score != null && (
              <span className={`badge ${lowFit ? "bg-danger-bg text-danger-fg" : "bg-brand-tint text-brand"}`}>fit {contact.fit_score}</span>
            )}
            {contact.name_email_mismatch && (
              <span className="badge bg-warning-bg text-warning-fg" title={contact.mismatch_reason ?? undefined}>⚠ email no coincide</span>
            )}
            {sent && <span className="badge bg-success-bg text-success-fg">en Lemlist ✓</span>}
            {discarded && <span className="badge bg-[#F1EEF7] text-ink-muted">descartado ✗</span>}
          </div>
          {companyName && <div className="text-xs text-ink-muted mt-0.5">{companyName}</div>}
          {error && <div className="text-xs text-danger-fg mt-0.5">{error}</div>}
          {genError && <div className="text-xs text-danger-fg mt-0.5">{genError}</div>}
        </div>
        {!sent && !discarded && (
          <div className="flex items-center gap-1.5 shrink-0">
            {onGenerate && (
              <button onClick={onGenerate} disabled={generating || sending || discarding} className="btn-secondary text-xs">
                {generating ? <IconLoader2 size={12} className="animate-spin" /> : <IconSparkles size={12} />}
                {preview ? "Regenerar mensaje" : "Generar mensaje"}
              </button>
            )}
            {onSend && (
              <button onClick={onSend} disabled={!preview || sending || discarding || generating} className="btn-primary text-xs" title={!preview ? "Primero generá el mensaje" : undefined}>
                {sending ? <IconLoader2 size={12} className="animate-spin" /> : <IconSend size={12} />}
                Enviar a Lemlist
              </button>
            )}
            <button onClick={onDiscard} disabled={sending || discarding} className="btn-secondary text-xs">
              {discarding ? <IconLoader2 size={12} className="animate-spin" /> : <IconX size={12} />}
              Descartar
            </button>
          </div>
        )}
      </div>

      {!sent && !discarded && preview && edited && (
        <div className="rounded-lg border border-[#E5E2F0] bg-[#F8F6FC] p-3 space-y-2.5">
          <div className="text-xs text-ink-muted">
            <span className="font-semibold text-ink">Segmento usado: </span>
            {preview.segment.name ?? "Sin segmento (mensaje personalizado genérico)"}
            {preview.segment.reasoning && <span> — {preview.segment.reasoning}</span>}
          </div>

          <EditableField label="Asunto — Email 1" value={edited.email_subject ?? ""} onChange={(v) => onEditField?.("email_subject", v)} />
          <EditableField label="Cuerpo — Email 1" value={edited.email_body ?? ""} onChange={(v) => onEditField?.("email_body", v)} textarea />

          {edited.email_subject_2 != null && (
            <>
              <EditableField label="Asunto — Email 2" value={edited.email_subject_2 ?? ""} onChange={(v) => onEditField?.("email_subject_2", v)} />
              <EditableField label="Cuerpo — Email 2" value={edited.email_body_2 ?? ""} onChange={(v) => onEditField?.("email_body_2", v)} textarea />
            </>
          )}

          {edited.email_subject_3 != null && (
            <>
              <EditableField label="Asunto — Email 3" value={edited.email_subject_3 ?? ""} onChange={(v) => onEditField?.("email_subject_3", v)} />
              <EditableField label="Cuerpo — Email 3" value={edited.email_body_3 ?? ""} onChange={(v) => onEditField?.("email_body_3", v)} textarea />
            </>
          )}

          {edited.connect_message != null && (
            <EditableField label="Nota de invitación LinkedIn" value={edited.connect_message ?? ""} onChange={(v) => onEditField?.("connect_message", v)} textarea />
          )}

          <EditableField label="Icebreaker LinkedIn 1" value={edited.linkedin_icebreaker ?? ""} onChange={(v) => onEditField?.("linkedin_icebreaker", v)} textarea />

          {edited.linkedin_msg_2 != null && (
            <EditableField label="Icebreaker LinkedIn 2" value={edited.linkedin_msg_2 ?? ""} onChange={(v) => onEditField?.("linkedin_msg_2", v)} textarea />
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Parte 2 — Empresas que Clay no pudo prospectar
// ─────────────────────────────────────────────────────────────────────────

type Tab = "no_contacts" | "one_contact" | "no_fit";

function ClayQueueSection({ clientId }: { clientId: string }) {
  const [data, setData] = useState<QueueData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("no_contacts");
  const [includeRecent, setIncludeRecent] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ client_id: clientId });
      if (includeRecent) params.set("include_recent", "1");
      const res = await fetch(`/api/busqueda-manual?${params}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Error cargando datos");
      else setData(json);
    } catch {
      setError("Error de red al cargar datos");
    }
    setLoading(false);
  }, [clientId, includeRecent]);

  useEffect(() => { load(); }, [load]);

  const noContactsCount = data?.no_contacts.length ?? 0;
  const oneContactCount = data?.one_contact.length ?? 0;
  const noFitCount = data?.no_fit.length ?? 0;

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "no_contacts", label: "Sin contactos", count: noContactsCount },
    { key: "one_contact", label: "Con solo 1 contacto", count: oneContactCount },
    { key: "no_fit", label: "Sin contactos fit", count: noFitCount },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-lg font-semibold">Empresas que Clay no pudo prospectar</h2>
          <div className="text-sm text-ink-muted mt-1">Empresas ya aprobadas sin contactos suficientes — buscalos a mano y enviá directo a Lemlist.</div>
        </div>
        <button onClick={load} disabled={loading} className="btn-secondary" title="Refrescar datos">
          {loading ? <IconLoader2 size={15} className="animate-spin" /> : <IconRefresh size={15} />}
          Refrescar
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`btn ${activeTab === t.key ? "bg-brand text-white" : "bg-white border border-[#E5E2F0] text-ink hover:border-brand-soft"}`}
            >
              {t.label}
              <span className={`ml-1 inline-flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-full text-[11px] font-semibold ${activeTab === t.key ? "bg-white/20 text-white" : "bg-[#F1EEF7] text-ink-muted"}`}>
                {t.count}
              </span>
            </button>
          ))}
        </div>
        {activeTab === "no_contacts" && (
          <button
            onClick={() => setIncludeRecent((v) => !v)}
            className={`btn text-xs ${includeRecent ? "bg-brand text-white" : "bg-white border border-[#E5E2F0] text-ink-muted hover:border-brand-soft"}`}
            title="Por defecto se esperan 24h desde que la empresa fue a Clay."
          >
            Incluir las recién mandadas a Clay
          </button>
        )}
      </div>

      {error && (
        <div className="card flex items-center gap-3 border border-danger-bg bg-danger-bg/40 text-danger-fg text-sm">
          <IconAlertCircle size={16} className="shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-3 text-ink-muted py-10 justify-center">
          <IconLoader2 size={22} className="animate-spin" />
          <span>Cargando empresas…</span>
        </div>
      ) : (
        <>
          {activeTab === "no_contacts" && (
            <QueueList items={data?.no_contacts ?? []} emptyMsg="No hay empresas sin contactos. Clay está encontrando personas en todas." onReload={load} showMarkNoFit />
          )}
          {activeTab === "one_contact" && (
            <QueueList items={data?.one_contact ?? []} emptyMsg="No hay empresas con un solo contacto." onReload={load} showMarkNoFit />
          )}
          {activeTab === "no_fit" && <NoFitList items={data?.no_fit ?? []} onReload={load} />}
        </>
      )}
    </div>
  );
}

function QueueList({ items, emptyMsg, onReload, showMarkNoFit }: { items: QueueItem[]; emptyMsg: string; onReload: () => void; showMarkNoFit?: boolean }) {
  if (items.length === 0) {
    return (
      <div className="card flex items-center gap-3 text-ink-muted">
        <IconCheck size={18} className="text-success-fg" /> {emptyMsg}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {items.map((item) => (
        <CompanyCard key={item.company.id} company={item.company} contactCount={item.contact_count} signal={item.signal ?? "clay"} recent={item.recent ?? false} onReload={onReload} showMarkNoFit={showMarkNoFit} />
      ))}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }
  return (
    <button
      onClick={handleCopy}
      title="Copiar nombre de empresa"
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors"
      style={copied ? { background: "rgba(98,224,216,0.15)", color: "#16a34a" } : { background: "rgba(37,23,98,0.06)", color: "#6b7280" }}
    >
      {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
      {copied ? "Copiado" : "Copiar"}
    </button>
  );
}

function CompanyCard({
  company,
  contactCount,
  signal,
  recent,
  onReload,
  showMarkNoFit,
}: {
  company: Company;
  contactCount: number;
  signal: "clay" | "inferred";
  recent: boolean;
  onReload: () => void;
  showMarkNoFit?: boolean;
}) {
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [stagingLeads, setStagingLeads] = useState<StagingLead[] | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [leadsFilter, setLeadsFilter] = useState("");
  const [importing, setImporting] = useState(false);
  const [markingNoFit, setMarkingNoFit] = useState(false);
  const [importResult, setImportResult] = useState<{ summary?: { yes: number; no: number; duplicates?: number }; error?: string } | null>(null);

  const salesNavUrl = `https://www.linkedin.com/sales/search/people?keywords=${encodeURIComponent(company.company_name)}`;

  async function handleFetchLeads() {
    setLoadingLeads(true);
    setImportResult(null);
    setStagingLeads(null);
    try {
      const res = await fetch(`/api/busqueda-manual/${company.id}/import`);
      const json = await res.json();
      if (!res.ok) {
        setImportResult({ error: json.error ?? `Error ${res.status}` });
      } else {
        const leads: StagingLead[] = json.leads ?? [];
        setStagingLeads(leads);
        setSelectedKeys(new Set(leads.filter((l) => l.matched).map((l) => l.key)));
      }
    } catch {
      setImportResult({ error: "Error de red al cargar leads" });
    }
    setLoadingLeads(false);
  }

  async function handleImport() {
    setImporting(true);
    try {
      const res = await fetch(`/api/busqueda-manual/${company.id}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lemlist_lead_ids: Array.from(selectedKeys), auto_push_lemlist: true }),
      });
      const json = await res.json();
      if (!res.ok) {
        setImportResult({ error: json.error ?? `Error ${res.status}` });
      } else {
        setImportResult(json);
        setStagingLeads(null);
        if (json.summary?.yes > 0) setTimeout(() => onReload(), 1500);
      }
    } catch {
      setImportResult({ error: "Error de red al importar" });
    }
    setImporting(false);
  }

  function toggleKey(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  async function handleMarkNoFit() {
    setMarkingNoFit(true);
    try {
      await fetch(`/api/busqueda-manual/${company.id}/mark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "no_fit" }),
      });
      onReload();
    } catch { /* silencia — reload muestra estado actualizado */ }
    setMarkingNoFit(false);
  }

  const locationParts = [
    company.company_size ? `${company.company_size} empleados` : null,
    company.company_city,
    company.company_country,
  ].filter(Boolean);

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`badge ${signal === "clay" ? "bg-brand-tint text-brand" : "bg-warning-bg text-warning-fg"}`}>
              {signal === "clay" ? "Clay" : "Inferido"}
            </span>
            {contactCount > 0 && (
              <span className="badge bg-[#F1EEF7] text-ink-muted flex items-center gap-1">
                <IconUsers size={11} /> {contactCount} {contactCount === 1 ? "contacto" : "contactos"}
              </span>
            )}
            <h3 className="font-semibold">{company.company_name}</h3>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {locationParts.length > 0 && <span className="text-xs text-ink-muted">{locationParts.join(" · ")}</span>}
            <CopyButton text={company.company_name} />
          </div>
        </div>
      </div>

      {recent && (
        <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs bg-warning-bg text-warning-fg">
          <IconAlertCircle size={14} className="shrink-0 mt-0.5" />
          Recién mandada a Clay (hace menos de 24h) y todavía sin contactos. Puede que Clay siga procesándola — verificá en Clay antes de buscar a mano.
        </div>
      )}

      {company.fit_signals && (
        <div>
          <div className="label mb-1">Señales</div>
          <p className="text-sm text-ink/90">{company.fit_signals}</p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex gap-2 flex-wrap">
          <a href={salesNavUrl} target="_blank" rel="noreferrer" className="btn-secondary flex-1 justify-center">
            <IconExternalLink size={15} /> Buscar en Sales Navigator
          </a>
        </div>
        {!stagingLeads && (
          <button onClick={handleFetchLeads} disabled={loadingLeads} className="btn-secondary w-full justify-center">
            {loadingLeads ? <IconLoader2 size={15} className="animate-spin" /> : <IconDownload size={15} />}
            {loadingLeads ? "Cargando…" : "Ver leads de la Campaña puente"}
          </button>
        )}
        {showMarkNoFit && !stagingLeads && (
          <button onClick={handleMarkNoFit} disabled={markingNoFit} className="btn-danger self-start text-xs">
            {markingNoFit ? <IconLoader2 size={13} className="animate-spin" /> : <IconX size={13} />}
            No hay contactos fit
          </button>
        )}
      </div>

      {stagingLeads && (
        <div className="rounded-lg border border-[#E5E2F0] bg-[#F9F8FC] overflow-hidden">
          <div className="px-3 py-2 border-b border-[#E5E2F0] flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-ink-muted uppercase tracking-wide">
              Leads en la campaña puente ({stagingLeads.length})
            </span>
            <div className="flex gap-2 text-xs">
              <button onClick={() => setSelectedKeys(new Set(stagingLeads.map((l) => l.key)))} className="text-brand hover:underline">Marcar todos</button>
              <span className="text-ink-muted">·</span>
              <button onClick={() => setSelectedKeys(new Set())} className="text-brand hover:underline">Desmarcar todos</button>
            </div>
          </div>
          <div className="px-3 py-2 border-b border-[#E5E2F0]">
            <input
              type="text"
              placeholder='Filtrar por nombre, empresa o cargo (ej: "Director")'
              value={leadsFilter}
              onChange={(e) => setLeadsFilter(e.target.value)}
              className="w-full text-xs rounded-md border border-[#D8D5EA] px-2.5 py-1.5 bg-white placeholder:text-ink-muted focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          <div className="divide-y divide-[#E5E2F0] max-h-72 overflow-y-auto">
            {stagingLeads
              .filter((l) => {
                if (!leadsFilter.trim()) return true;
                const q = leadsFilter.toLowerCase();
                return (
                  `${l.firstName} ${l.lastName}`.toLowerCase().includes(q) ||
                  l.companyName.toLowerCase().includes(q) ||
                  l.jobTitle.toLowerCase().includes(q)
                );
              })
              .map((lead) => (
                <label key={lead.key} className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-white transition-colors">
                  <input type="checkbox" checked={selectedKeys.has(lead.key)} onChange={() => toggleKey(lead.key)} className="mt-0.5 accent-[#62E0D8] shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink leading-tight">
                      {(lead.firstName || lead.lastName) ? `${lead.firstName} ${lead.lastName}`.trim() : (lead.email ?? lead.linkedinUrl ?? "Sin nombre")}
                      {lead.jobTitle && <span className="font-normal text-ink-muted"> · {lead.jobTitle}</span>}
                    </div>
                    {lead.companyName && <div className="text-xs text-ink-muted mt-0.5">{lead.companyName}</div>}
                  </div>
                </label>
              ))}
          </div>
          <div className="px-3 py-2.5 border-t border-[#E5E2F0] flex gap-2 items-center">
            <button onClick={handleImport} disabled={importing || selectedKeys.size === 0} className="btn-primary text-xs flex-1 justify-center">
              {importing ? <IconLoader2 size={13} className="animate-spin" /> : <IconDownload size={13} />}
              {importing ? "Importando…" : `Importar y enviar directo a Lemlist (${selectedKeys.size})`}
            </button>
            <button onClick={() => { setStagingLeads(null); setLeadsFilter(""); setImportResult(null); }} className="text-xs text-ink-muted hover:text-ink">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {importResult && !stagingLeads && (
        <div className="flex flex-col gap-2">
          {importResult.error ? (
            <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm bg-danger-bg text-danger-fg">
              <IconAlertCircle size={15} className="shrink-0" /> {importResult.error}
            </div>
          ) : importResult.summary && importResult.summary.yes > 0 ? (
            <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm bg-success-bg text-success-fg">
              <IconCheck size={15} className="shrink-0" /> {importResult.summary.yes} contactos importados y enviados · {importResult.summary.no} no pasaron pre-filter
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm bg-warning-bg text-warning-fg">
              <IconAlertCircle size={15} className="shrink-0" /> 0 contactos importados
              {importResult.summary?.duplicates ? ` — ${importResult.summary.duplicates} ya existían en otra empresa de este cliente` : ""}
              {importResult.summary?.no ? ` — ${importResult.summary.no} no pasaron el pre-filter` : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NoFitList({ items, onReload }: { items: QueueItem[]; onReload: () => void }) {
  if (items.length === 0) {
    return (
      <div className="card flex items-center gap-3 text-ink-muted">
        <IconCheck size={18} className="text-success-fg" /> No hay empresas marcadas como sin contactos fit.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {items.map((item) => (
        <NoFitCard key={item.company.id} company={item.company} onReload={onReload} />
      ))}
    </div>
  );
}

function NoFitCard({ company, onReload }: { company: Company; onReload: () => void }) {
  const [unmarking, setUnmarking] = useState(false);

  async function handleUnmark() {
    setUnmarking(true);
    try {
      await fetch(`/api/busqueda-manual/${company.id}/mark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: null }),
      });
      onReload();
    } catch { /* silencia */ }
    setUnmarking(false);
  }

  const locationParts = [
    company.company_size ? `${company.company_size} empleados` : null,
    company.company_city,
    company.company_country,
  ].filter(Boolean);

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="font-semibold">{company.company_name}</h3>
            <CopyButton text={company.company_name} />
          </div>
          {locationParts.length > 0 && <div className="text-xs text-ink-muted">{locationParts.join(" · ")}</div>}
        </div>
        <span className="badge bg-danger-bg text-danger-fg shrink-0">sin fit</span>
      </div>
      {company.fit_signals && <p className="text-sm text-ink/80">{company.fit_signals}</p>}
      <button onClick={handleUnmark} disabled={unmarking} className="btn-secondary self-start text-xs">
        {unmarking ? <IconLoader2 size={13} className="animate-spin" /> : <IconX size={13} />}
        Reactivar
      </button>
    </div>
  );
}
