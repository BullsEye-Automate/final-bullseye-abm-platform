"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useClient } from "@/lib/clientContext";
import {
  IconUsers,
  IconUpload,
  IconCheck,
  IconAlertCircle,
  IconBrandLinkedin,
  IconBuildingFactory2,
  IconRefresh,
  IconSend,
  IconTrash,
  IconChevronDown,
  IconChevronRight,
  IconSparkles,
  IconLoader2,
  IconMail,
  IconMessage,
  IconX,
  IconSearch,
  IconPlayerStop,
} from "@tabler/icons-react";

type Segment = { id: string; name: string };

type GenResult = {
  contactId: string;
  emailSubject?: string;
  emailBody?: string;
  emailSubject2?: string;
  emailBody2?: string;
  emailSubject3?: string;
  emailBody3?: string;
  connectMessage?: string;
  linkedinIcebreaker?: string;
  linkedinMsg2?: string;
  error?: string;
  cancelled?: boolean;
};

type Contact = {
  id: string;
  company_id: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  linkedin_headline: string | null;
  linkedin_url: string | null;
  email: string | null;
  phone: string | null;
  seniority: string | null;
  prefilter_result: "yes" | "no" | null;
  fit_score: number | null;
  fit_reason: string | null;
  fit_action: string | null;
  linkedin_icebreaker: string | null;
  email_subject: string | null;
  email_body: string | null;
  status: string;
  clay_pushed_at: string | null;
  clay_push_error: string | null;
  lemlist_pushed_at: string | null;
  created_at: string;
};

type Company = { id: string; company_name: string };
type Bucket = "pending" | "manual_review" | "approved_pending" | "enriched" | "discarded";
type Preview = { emailSubject?: string; emailBody?: string; linkedinIcebreaker?: string; linkedinIcebreakerNoEmail?: string };

const BUCKET_LABELS: Record<Bucket, string> = {
  pending: "Pendientes",
  manual_review: "Revisión manual",
  approved_pending: "Por aprobar",
  enriched: "En campaña",
  discarded: "Descartados",
};

export default function ContactosPage() {
  const { currentClient, loading: clientLoading } = useClient();
  const [bucket, setBucket] = useState<Bucket>("approved_pending");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [counts, setCounts] = useState<Record<Bucket, number>>({ pending: 0, manual_review: 0, approved_pending: 0, enriched: 0, discarded: 0 });
  const [loading, setLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [approvedCompanies, setApprovedCompanies] = useState<Company[]>([]);

  const [bulkApproving, setBulkApproving] = useState(false);
  const [pushingId, setPushingId] = useState<string | null>(null);
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  const [pushingCompany, setPushingCompany] = useState<string | null>(null);

  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());

  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, Preview>>({});

  const [refreshing, setRefreshing] = useState(false);

  // Modal de generación antes de enviar a Lemlist
  const [sendModal, setSendModal] = useState<{ contactIds: string[]; companyId?: string } | null>(null);

  async function load(forBucket: Bucket = bucket) {
    setLoading(true);
    const clientParam = currentClient ? `&client_id=${currentClient.id}` : "";
    const res = await fetch(`/api/contacts?bucket=${forBucket}${clientParam}`, { cache: "no-store" });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { setError(data.error ?? "Load failed"); return; }
    setContacts(data.contacts ?? []);
    if (data.counts) setCounts(data.counts);
    setExpandedCompanies(new Set());
    setPreviews({});
  }

  async function loadApprovedCompanies() {
    const clientParam = currentClient ? `&client_id=${currentClient.id}` : "";
    const res = await fetch(`/api/companies?status=approved${clientParam}`, { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setApprovedCompanies((data.companies ?? []).map((c: any) => ({ id: c.id, company_name: c.company_name })));
  }

  useEffect(() => { if (!clientLoading) load(bucket); }, [bucket, currentClient?.id, clientLoading]);
  useEffect(() => { if (!clientLoading) loadApprovedCompanies(); }, [currentClient?.id, clientLoading]);

  function toggleCompany(id: string) {
    setExpandedCompanies(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const grouped = useMemo(() => {
    const map = new Map<string, Contact[]>();
    for (const c of contacts) {
      const arr = map.get(c.company_id) ?? [];
      arr.push(c);
      map.set(c.company_id, arr);
    }
    return Array.from(map.entries());
  }, [contacts]);

  const companyNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of approvedCompanies) m.set(c.id, c.company_name);
    return m;
  }, [approvedCompanies]);

  async function pushToLemlist(contactIds: string[], companyId?: string) {
    if (!currentClient) return;
    if (companyId) setPushingCompany(companyId);
    else if (contactIds.length === 1) setPushingId(contactIds[0]);
    else setBulkApproving(true);
    setNotice(null); setError(null);

    // Flujo: aprobar → Clay waterfall de teléfono → (callback) HubSpot + push a Lemlist automático
    const res = await fetch("/api/contacts/bulk-approve-enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: currentClient.id, contact_ids: contactIds }),
    });
    const data = await res.json();
    if (companyId) setPushingCompany(null);
    else if (contactIds.length === 1) setPushingId(null);
    else setBulkApproving(false);

    if (!res.ok) { setError(data.error ?? "Error al enviar"); return; }
    const pushed  = data.pushed  ?? 0;
    const skipped = 0;
    const errs    = data.errors ?? 0;
    if (data.message === "No hay contactos por aprobar") {
      setError("No se encontraron contactos listos para enviar.");
      return;
    }
    const phoneSent = data.phone_enrichment?.pushed ?? 0;
    const parts = [`${pushed} contacto${pushed !== 1 ? "s" : ""} aprobado${pushed !== 1 ? "s" : ""}`];
    if (phoneSent > 0) parts.push(`${phoneSent} enviado${phoneSent !== 1 ? "s" : ""} a Clay para enriquecer teléfono`);
    parts.push("Lemlist + HubSpot se actualizarán automáticamente al recibir el teléfono");
    if (errs > 0)      parts.push(`${errs} con error`);
    setNotice(parts.join(" · ") + ".");
    if (data.errors?.length > 0) {
      const detail = data.errors.map((e: any) => e.error).join(" | ");
      setError(`Errores: ${detail}`);
    }
    await load();
  }

  async function refreshFromLemlist() {
    if (!currentClient) return;
    setRefreshing(true);
    setNotice(null); setError(null);
    try {
      const res = await fetch("/api/lemlist/refresh-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: currentClient.id }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Error al sincronizar"); return; }
      const parts = [];
      if (data.updated   > 0) parts.push(`${data.updated} email${data.updated !== 1 ? "s" : ""} nuevos guardados`);
      if (data.generated > 0) parts.push(`${data.generated} mensaje${data.generated !== 1 ? "s" : ""} generados`);
      if (data.synced    > 0) parts.push(`${data.synced} contacto${data.synced !== 1 ? "s" : ""} sincronizados con HubSpot`);
      setNotice(parts.length > 0 ? parts.join(" · ") + "." : "Sin novedades de Lemlist.");
      if (data.errors?.length > 0) {
        const detail = data.errors.slice(0, 3).map((e: any) => e.error).join(" | ");
        setError(`Errores sync: ${detail}`);
      }
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  async function discardContact(id: string) {
    setDiscardingId(id);
    setNotice(null); setError(null);
    const res = await fetch(`/api/contacts/${id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "rejected" }),
    });
    setDiscardingId(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(`Error al descartar (${res.status}): ${body?.error ?? "sin detalle"}`);
      return;
    }
    setContacts(prev => prev.filter(c => c.id !== id));
    setCounts(prev => ({ ...prev, [bucket]: Math.max(0, prev[bucket] - 1), discarded: prev.discarded + 1 }));
  }

  async function recoverContact(id: string) {
    setPushingId(id);
    const res = await fetch(`/api/contacts/${id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "recovered" }),
    });
    setPushingId(null);
    if (!res.ok) { setError("Error al recuperar"); return; }
    setNotice("Contacto recuperado.");
    await load();
  }

  async function generatePreview(contactId: string) {
    if (previews[contactId]) {
      setPreviews(prev => { const n = { ...prev }; delete n[contactId]; return n; });
      return;
    }
    setPreviewLoading(contactId);
    setError(null);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 65_000);
      const res = await fetch(`/api/contacts/${contactId}/preview-messages`, {
        method: "POST",
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Error al generar preview"); return; }
      setPreviews(prev => ({ ...prev, [contactId]: data }));
    } catch (err: any) {
      setError(err?.name === "AbortError" ? "Timeout al generar preview (>65 s). Intenta de nuevo." : "Error de red al generar preview.");
    } finally {
      setPreviewLoading(null);
    }
  }

  const allIds = useMemo(() => contacts.map(c => c.id), [contacts]);

  return (
    <div className="space-y-6">
      {!currentClient && (
        <div className="card flex items-center gap-3 border border-warning-bg bg-warning-bg/40 text-warning-fg text-sm">
          <IconAlertCircle size={16} className="shrink-0" />
          Selecciona un cliente en el sidebar para ver y gestionar sus contactos.
        </div>
      )}

      <header className="flex items-end justify-between">
        <div>
          <div className="label">Prospección</div>
          <h1 className="text-2xl font-semibold tracking-tight">Contactos</h1>
          <div className="text-sm text-ink-muted mt-1">
            Decisores de cada empresa aprobada. El pre-filter Claude descarta roles no decisores antes de mandarlos a Clay.
          </div>
        </div>
        <button onClick={() => setImportOpen(true)} className="btn-primary">
          <IconUpload size={16} /> Importar contactos
        </button>
      </header>

      {importOpen && (
        <ImportPanel
          companies={approvedCompanies}
          onClose={() => setImportOpen(false)}
          onDone={() => { setImportOpen(false); load(); }}
        />
      )}

      {sendModal && currentClient && (
        <SendModal
          clientId={currentClient.id}
          contactIds={sendModal.contactIds}
          contacts={contacts}
          companyNameById={companyNameById}
          onClose={() => setSendModal(null)}
          onConfirm={async (ids) => {
            setSendModal(null);
            await pushToLemlist(ids, sendModal.companyId);
          }}
        />
      )}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {(["pending", "manual_review", "approved_pending", "enriched", "discarded"] as Bucket[]).map((b) => {
            const active = bucket === b;
            return (
              <button
                key={b}
                onClick={() => setBucket(b)}
                className={`btn ${active ? "bg-brand text-white" : "bg-white border border-[#E5E2F0] text-ink hover:border-brand-soft"}`}
              >
                {BUCKET_LABELS[b]}
                <span className={`ml-2 inline-flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-full text-[11px] font-semibold ${active ? "bg-white/20 text-white" : "bg-[#F1EEF7] text-ink-muted"}`}>
                  {counts[b]}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          {(bucket === "approved_pending" || bucket === "manual_review") && allIds.length > 0 && (
            <button onClick={() => setSendModal({ contactIds: allIds })} disabled={bulkApproving} className="btn-primary">
              <IconSend size={14} />
              {`Aprobar y enviar a Lemlist (${allIds.length})`}
            </button>
          )}
          <button className="btn-secondary" onClick={refreshFromLemlist} disabled={refreshing || !currentClient} title="Jala emails/teléfonos enriquecidos de Lemlist y sincroniza con HubSpot">
            <IconRefresh size={14} /> {refreshing ? "Sincronizando…" : "Sync Lemlist → HubSpot"}
          </button>
          <button className="btn-secondary" onClick={() => load()} disabled={loading}>
            <IconRefresh size={14} /> Refrescar
          </button>
        </div>
      </div>

      {error && (
        <div className="card border border-danger-bg text-danger-fg flex items-center gap-2">
          <IconAlertCircle size={16} /> {error}
        </div>
      )}
      {notice && (
        <div className="card border border-success-bg text-success-fg flex items-center gap-2">
          <IconCheck size={16} /> {notice}
        </div>
      )}

      {!loading && grouped.length > 0 && (
        <div className="flex items-center justify-between text-sm text-ink-muted">
          <span>{grouped.length} empresa{grouped.length !== 1 ? "s" : ""}</span>
          <div className="flex gap-3">
            <button className="hover:text-ink underline" onClick={() => setExpandedCompanies(new Set(grouped.map(([id]) => id)))}>
              Expandir todo
            </button>
            <button className="hover:text-ink underline" onClick={() => setExpandedCompanies(new Set())}>
              Colapsar todo
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-ink-muted flex items-center gap-2"><IconLoader2 size={16} className="animate-spin" /> Cargando…</div>
      ) : grouped.length === 0 ? (
        <EmptyState bucket={bucket} hasApproved={approvedCompanies.length > 0} />
      ) : (
        <div className="space-y-3">
          {grouped.map(([companyId, items]) => {
            const expanded = expandedCompanies.has(companyId);
            const companyName = companyNameById.get(companyId) ?? "Empresa";
            const isCompanyPushing = pushingCompany === companyId;
            const approvedIds = items.filter(c => c.fit_action === "enrich").map(c => c.id);

            return (
              <div key={companyId} className="card p-0 overflow-hidden">
                <div
                  className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[#F8F6FC] select-none"
                  onClick={() => toggleCompany(companyId)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {expanded
                      ? <IconChevronDown size={16} className="text-ink-muted shrink-0" />
                      : <IconChevronRight size={16} className="text-ink-muted shrink-0" />}
                    <IconBuildingFactory2 size={14} className="text-ink-muted shrink-0" />
                    <span className="font-medium text-ink truncate">{companyName}</span>
                    <span className="text-sm text-ink-muted shrink-0">· {items.length} contacto{items.length !== 1 ? "s" : ""}</span>
                  </div>
                  {bucket === "approved_pending" && approvedIds.length > 0 && (
                    <button
                      className="btn-primary text-xs py-1.5 px-3 shrink-0 ml-3"
                      onClick={(e) => { e.stopPropagation(); setSendModal({ contactIds: approvedIds, companyId }); }}
                    >
                      <IconSend size={12} />
                      {`Enviar ${approvedIds.length} a Lemlist`}
                    </button>
                  )}
                </div>

                {expanded && (
                  <div className="border-t border-[#F1EEF7] grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[#F1EEF7]">
                    {items.map((c) => (
                      <ContactCard
                        key={c.id}
                        c={c}
                        bucket={bucket}
                        isPushing={pushingId === c.id}
                        isDiscarding={discardingId === c.id}
                        isPreviewLoading={previewLoading === c.id}
                        preview={previews[c.id]}
                        onPushLemlist={() => setSendModal({ contactIds: [c.id] })}
                        onDiscard={() => discardContact(c.id)}
                        onRecover={() => recoverContact(c.id)}
                        onPreview={() => generatePreview(c.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ContactCard({
  c, bucket, isPushing, isDiscarding, isPreviewLoading, preview,
  onPushLemlist, onDiscard, onRecover, onPreview,
}: {
  c: Contact;
  bucket: Bucket;
  isPushing: boolean;
  isDiscarding: boolean;
  isPreviewLoading: boolean;
  preview?: Preview;
  onPushLemlist: () => void;
  onDiscard: () => void;
  onRecover: () => void;
  onPreview: () => void;
}) {
  const fullName = [c.first_name, c.last_name].filter(Boolean).join(" ") || "(sin nombre)";
  const scoreClass =
    c.fit_score === null ? "bg-[#F1EEF7] text-ink-muted"
    : c.fit_score >= 8   ? "bg-success-bg text-success-fg"
    : c.fit_score >= 5   ? "bg-warning-bg text-warning-fg"
    : "bg-danger-bg text-danger-fg";

  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold truncate">{fullName}</h3>
            {c.prefilter_result === "yes" && <span className="badge bg-success-bg text-success-fg">pre-filter ✓</span>}
            {c.prefilter_result === "no"  && <span className="badge bg-danger-bg text-danger-fg">pre-filter ✗</span>}
            {c.clay_pushed_at && <span className="badge bg-success-bg text-success-fg">en Clay ✓</span>}
            {bucket === "approved_pending" && c.fit_action === "enrich" && (
              <span className="badge" style={{ background: "rgba(98,224,216,0.15)", color: "#0F6E56" }}>enrich</span>
            )}
            {c.seniority && (
              <span className="badge bg-[#EEF2FF] text-[#4F46E5]">{c.seniority}</span>
            )}
            {c.fit_score !== null && <span className={`badge ${scoreClass}`}>score {c.fit_score}/10</span>}
          </div>
          <div className="text-xs text-ink-muted mt-1">
            {c.job_title ?? "(sin cargo)"}
          </div>
        </div>
        {c.linkedin_url && (
          <a href={c.linkedin_url} target="_blank" rel="noreferrer" className="btn-secondary shrink-0 py-1 px-2" title="LinkedIn">
            <IconBrandLinkedin size={14} />
          </a>
        )}
      </div>

      {c.linkedin_headline && (
        <div className="flex items-start gap-1.5 text-sm">
          <IconBrandLinkedin size={14} className="text-[#0A66C2] shrink-0 mt-0.5" />
          <span className="text-ink/80 italic">{c.linkedin_headline}</span>
        </div>
      )}

      {(c.email || c.phone) && (
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div><div className="label mb-0.5">Email</div><div className="truncate text-xs">{c.email || <span className="text-ink-subtle">—</span>}</div></div>
          <div><div className="label mb-0.5">Teléfono</div><div className="text-xs">{c.phone || <span className="text-ink-subtle">—</span>}</div></div>
        </div>
      )}

      {bucket === "enriched" && c.lemlist_pushed_at && (
        <div className="text-xs text-ink-muted">
          Enviado: {new Date(c.lemlist_pushed_at).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })}
        </div>
      )}

      {c.fit_reason && (
        <div>
          <div className="label mb-1">Razón IA</div>
          <p className="text-sm text-ink/90">{c.fit_reason}</p>
        </div>
      )}

      {(c.linkedin_icebreaker || (c.email_subject && c.email_body)) && (
        <details className="text-xs">
          <summary className="cursor-pointer text-ink-muted hover:text-ink">Ver mensajes guardados</summary>
          <div className="mt-2 space-y-2">
            {c.linkedin_icebreaker && (
              <div>
                <div className="label mb-1">Icebreaker LinkedIn</div>
                <p className="text-sm text-ink/90">{c.linkedin_icebreaker}</p>
              </div>
            )}
            {c.email_subject && c.email_body && (
              <div>
                <div className="label mb-1">Email</div>
                <div className="text-sm font-medium">{c.email_subject}</div>
                <p className="text-sm text-ink/90 whitespace-pre-line mt-1">{c.email_body}</p>
              </div>
            )}
          </div>
        </details>
      )}

      {preview && (
        <div className="rounded-lg border border-[#E5E2F0] bg-[#F8F6FC] p-3 space-y-3 text-sm">
          {(preview.emailSubject || preview.emailBody) && (
            <div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted mb-1.5">
                <IconMail size={13} /> Email preview
              </div>
              {preview.emailSubject && <div className="font-medium text-ink mb-1">{preview.emailSubject}</div>}
              {preview.emailBody && <p className="text-ink/90 whitespace-pre-line">{preview.emailBody}</p>}
            </div>
          )}
          {(preview.linkedinIcebreaker || preview.linkedinIcebreakerNoEmail) && (
            <div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted mb-1.5">
                <IconMessage size={13} /> Icebreaker LinkedIn
              </div>
              <p className="text-ink/90">{preview.linkedinIcebreaker ?? preview.linkedinIcebreakerNoEmail}</p>
            </div>
          )}
        </div>
      )}

      {c.clay_push_error && (
        <div className="text-xs text-danger-fg flex items-start gap-1.5">
          <IconAlertCircle size={13} className="shrink-0 mt-0.5" />
          <span className="break-words">{c.clay_push_error}</span>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap pt-1">
        {bucket === "approved_pending" && (
          <>
            <button
              className="text-xs font-medium text-brand hover:text-brand/70 flex items-center gap-1"
              onClick={onPreview}
              disabled={isPreviewLoading}
            >
              {isPreviewLoading
                ? <><IconLoader2 size={13} className="animate-spin" /> Generando…</>
                : <><IconSparkles size={13} /> {preview ? "Ocultar preview" : "Generar preview con IA"}</>}
            </button>
            <span className="text-ink-subtle text-xs">·</span>
            <button
              onClick={onPushLemlist}
              disabled={isPushing || isDiscarding}
              className="btn-primary text-xs py-1.5 px-3"
            >
              {isPushing ? <IconLoader2 size={12} className="animate-spin" /> : <IconSend size={12} />}
              {isPushing ? "Enviando…" : "Enviar a campaña"}
            </button>
            <button
              onClick={onDiscard}
              disabled={isDiscarding || isPushing}
              className="btn-secondary text-xs py-1.5 px-3 text-danger-fg"
            >
              {isDiscarding ? <IconLoader2 size={12} className="animate-spin" /> : <IconTrash size={12} />}
              {isDiscarding ? "Descartando…" : "Descartar"}
            </button>
          </>
        )}
        {bucket === "manual_review" && (
          <>
            <button
              onClick={onPushLemlist}
              disabled={isPushing || isDiscarding}
              className="btn-primary text-xs py-1.5 px-3"
            >
              {isPushing ? <IconLoader2 size={12} className="animate-spin" /> : <IconSend size={12} />}
              {isPushing ? "Enviando…" : "Aprobar y enviar"}
            </button>
            <button
              onClick={onDiscard}
              disabled={isDiscarding || isPushing}
              className="btn-secondary text-xs py-1.5 px-3 text-danger-fg"
            >
              {isDiscarding ? <IconLoader2 size={12} className="animate-spin" /> : <IconTrash size={12} />}
              {isDiscarding ? "Descartando…" : "Descartar"}
            </button>
          </>
        )}
        {bucket === "pending" && c.prefilter_result === "yes" && !c.clay_pushed_at && (
          <button onClick={onPushLemlist} disabled={isPushing} className="btn-primary text-xs">
            <IconSend size={12} /> {isPushing ? "Empujando…" : "Prospectar en Clay"}
          </button>
        )}
        {bucket === "discarded" && (
          <button onClick={onRecover} disabled={isPushing} className="btn-secondary text-xs">
            {isPushing ? "Recuperando…" : "Recuperar"}
          </button>
        )}
      </div>
    </div>
  );
}

function EmptyState({ bucket, hasApproved }: { bucket: Bucket; hasApproved: boolean }) {
  if (!hasApproved) {
    return (
      <div className="card text-ink-muted flex items-start gap-3">
        <IconAlertCircle size={18} className="text-warning-fg mt-0.5" />
        <div>
          <div className="font-medium text-ink">No hay empresas aprobadas todavía.</div>
          <div className="text-sm mt-1">Aprueba al menos una empresa en la pantalla de Empresas antes de importar contactos.</div>
        </div>
      </div>
    );
  }
  return (
    <div className="card text-ink-muted flex items-center gap-2">
      <IconUsers size={18} />
      No hay contactos en {BUCKET_LABELS[bucket].toLowerCase()}.
    </div>
  );
}

// ─── Modal de generación de mensajes antes de enviar a Lemlist ────────────────

function SendModal({
  clientId, contactIds, contacts, companyNameById, onClose, onConfirm,
}: {
  clientId: string;
  contactIds: string[];
  contacts: Contact[];
  companyNameById: Map<string, string>;
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
}) {
  type Stage = "setup" | "generating" | "preview";

  const selectedContacts = useMemo(
    () => contacts.filter((c) => contactIds.includes(c.id)),
    [contacts, contactIds]
  );

  const [stage, setStage]               = useState<Stage>("setup");
  const [segments, setSegments]         = useState<Segment[]>([]);
  const [segmentsLoading, setSegmentsLoading] = useState(true);
  const [segmentId, setSegmentId]       = useState("");
  const [deepSet, setDeepSet]           = useState<Set<number>>(new Set());
  const [results, setResults]           = useState<GenResult[]>([]);
  const [genProgress, setGenProgress]   = useState(0);
  const [genError, setGenError]         = useState<string | null>(null);
  const [saving, setSaving]             = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const skippedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    fetch(`/api/training/segments?client_id=${clientId}`)
      .then((r) => r.json())
      .then((d) => { setSegments(d.segments ?? []); if (d.segments?.length) setSegmentId(d.segments[0].id); })
      .finally(() => setSegmentsLoading(false));
  }, [clientId]);

  const toggleDeep = useCallback((i: number) => {
    setDeepSet((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }, []);

  async function startGeneration() {
    setStage("generating");
    setGenProgress(0);
    setGenError(null);
    skippedRef.current = new Set();

    const updated: GenResult[] = selectedContacts.map((c) => ({ contactId: c.id }));
    setResults([...updated]);

    for (let i = 0; i < selectedContacts.length; i++) {
      if (abortRef.current?.signal.aborted) {
        updated[i] = { ...updated[i], cancelled: true };
        continue;
      }
      if (skippedRef.current.has(i)) {
        updated[i] = { ...updated[i], cancelled: true };
        setResults([...updated]);
        setGenProgress(i + 1);
        continue;
      }

      if (i > 0) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 3000);
          abortRef.current?.signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
        });
      }

      if (abortRef.current?.signal.aborted || skippedRef.current.has(i)) {
        updated[i] = { ...updated[i], cancelled: true };
        setResults([...updated]);
        setGenProgress(i + 1);
        continue;
      }

      const c = selectedContacts[i];
      const ac = new AbortController();
      abortRef.current = ac;

      const parsedContact = {
        firstName:   c.first_name  ?? "",
        lastName:    c.last_name   ?? "",
        email:       c.email       ?? "",
        phone:       c.phone       ?? undefined,
        jobTitle:    c.job_title   ?? undefined,
        companyName: companyNameById.get(c.company_id) ?? undefined,
        linkedinUrl: c.linkedin_url ?? undefined,
      };

      try {
        const res = await fetch("/api/lemlist/csv-generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id:        clientId,
            contacts:         [parsedContact],
            segment_id:       segmentId || undefined,
            use_deep_research: deepSet.has(i),
          }),
          signal: ac.signal,
        });

        if (res.ok) {
          const { results: r } = await res.json();
          const g = r?.[0] ?? {};
          updated[i] = {
            contactId:         c.id,
            emailSubject:      g.emailSubject,
            emailBody:         g.emailBody,
            emailSubject2:     g.emailSubject2,
            emailBody2:        g.emailBody2,
            emailSubject3:     g.emailSubject3,
            emailBody3:        g.emailBody3,
            connectMessage:    g.connectMessage,
            linkedinIcebreaker: g.icebreaker ?? g.connectMessage,
            linkedinMsg2:      g.linkedinMsg2,
          };
        } else {
          updated[i] = { ...updated[i], error: `Error ${res.status}` };
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          updated[i] = { ...updated[i], cancelled: true };
        } else {
          updated[i] = { ...updated[i], error: "Error de red" };
        }
      }

      setResults([...updated]);
      setGenProgress(i + 1);
    }

    abortRef.current = null;
    setStage("preview");
  }

  function cancelOne(i: number) {
    skippedRef.current.add(i);
    setResults((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], cancelled: true };
      return next;
    });
  }

  function cancelAll() {
    abortRef.current?.abort();
  }

  async function handleConfirm() {
    setSaving(true);
    // Guardar mensajes en cada contacto antes de enviar a Lemlist
    await Promise.all(
      results
        .filter((r) => !r.error && !r.cancelled && (r.emailSubject || r.linkedinIcebreaker))
        .map((r) =>
          fetch(`/api/contacts/${r.contactId}/messages`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email_subject:      r.emailSubject      ?? null,
              email_body:         r.emailBody         ?? null,
              email_subject_2:    r.emailSubject2     ?? null,
              email_body_2:       r.emailBody2        ?? null,
              email_subject_3:    r.emailSubject3     ?? null,
              email_body_3:       r.emailBody3        ?? null,
              connect_message:    r.connectMessage    ?? null,
              linkedin_icebreaker: r.linkedinIcebreaker ?? null,
              linkedin_msg_2:     r.linkedinMsg2      ?? null,
            }),
          })
        )
    );
    setSaving(false);
    onConfirm(contactIds);
  }

  const successCount = results.filter((r) => !r.error && !r.cancelled && (r.emailSubject || r.linkedinIcebreaker)).length;
  const errorCount   = results.filter((r) => !!r.error).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F1EEF7]">
          <div>
            <h2 className="font-semibold text-lg text-ink">Preparar envío a Lemlist</h2>
            <p className="text-sm text-ink-muted mt-0.5">
              {stage === "setup"      && `${selectedContacts.length} contacto${selectedContacts.length !== 1 ? "s" : ""} · Configura el segmento y genera mensajes`}
              {stage === "generating" && `Generando mensajes… ${genProgress}/${selectedContacts.length}`}
              {stage === "preview"    && `${successCount} generado${successCount !== 1 ? "s" : ""}${errorCount > 0 ? ` · ${errorCount} con error` : ""} · Revisa y confirma`}
            </p>
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink p-1 rounded-lg hover:bg-[#F1EEF7]">
            <IconX size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Selector de segmento (setup + generating) */}
          {stage !== "preview" && (
            <div>
              <div className="label mb-1.5">Segmento</div>
              {segmentsLoading ? (
                <div className="text-sm text-ink-muted flex items-center gap-2"><IconLoader2 size={14} className="animate-spin" /> Cargando…</div>
              ) : segments.length === 0 ? (
                <div className="text-sm text-ink-muted">Sin segmentos creados para este cliente.</div>
              ) : (
                <select
                  className="input"
                  value={segmentId}
                  onChange={(e) => setSegmentId(e.target.value)}
                  disabled={stage === "generating"}
                >
                  <option value="">Sin segmento (configuración global)</option>
                  {segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
            </div>
          )}

          {/* Lista de contactos */}
          <div className="space-y-2">
            {selectedContacts.map((c, i) => {
              const fullName = [c.first_name, c.last_name].filter(Boolean).join(" ") || "(sin nombre)";
              const result   = results[i];
              const isDeep   = deepSet.has(i);
              const isDone   = stage === "preview" || (stage === "generating" && genProgress > i);
              const isCurrent = stage === "generating" && genProgress === i;
              const isPending = stage === "generating" && genProgress < i;

              return (
                <div key={c.id} className="rounded-xl border border-[#E5E2F0] overflow-hidden">
                  {/* Fila principal */}
                  <div className={`flex items-center gap-3 px-4 py-3 ${result?.cancelled ? "opacity-50" : ""}`}>
                    {/* Estado */}
                    <div className="shrink-0">
                      {isCurrent && <IconLoader2 size={15} className="animate-spin text-brand" />}
                      {isDone && !isCurrent && !result?.cancelled && !result?.error && (result?.emailSubject || result?.linkedinIcebreaker)
                        && <IconCheck size={15} className="text-success-fg" />}
                      {isDone && result?.error   && <IconAlertCircle size={15} className="text-danger-fg" />}
                      {isDone && result?.cancelled && <IconX size={15} className="text-ink-muted" />}
                      {isPending && <div className="w-3.5 h-3.5 rounded-full border-2 border-[#E5E2F0]" />}
                      {stage === "setup" && <div className="w-3.5 h-3.5 rounded-full border-2 border-[#E5E2F0]" />}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-ink truncate">{fullName}</span>
                        {c.job_title && <span className="text-xs text-ink-muted truncate">{c.job_title}</span>}
                        {result?.cancelled && <span className="text-xs text-ink-muted">Cancelado</span>}
                        {result?.error     && <span className="text-xs text-danger-fg">{result.error}</span>}
                      </div>
                      <div className="text-xs text-ink-muted">{companyNameById.get(c.company_id) ?? "—"}</div>
                    </div>

                    {/* Deep research toggle (solo en setup) */}
                    {stage === "setup" && (
                      <button
                        onClick={() => toggleDeep(i)}
                        className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border transition ${
                          isDeep
                            ? "border-[#62E0D8] text-[#0fa89a] bg-[rgba(98,224,216,0.1)]"
                            : "border-[#E5E2F0] text-ink-muted hover:border-[#62E0D8]"
                        }`}
                        title="Activar investigación profunda para este contacto"
                      >
                        <IconSearch size={11} />
                        Inv. profunda
                      </button>
                    )}

                    {/* Badge inv profunda (generating/preview) */}
                    {stage !== "setup" && deepSet.has(i) && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0"
                        style={{ background: "rgba(98,224,216,0.15)", color: "#0fa89a" }}>
                        <IconSearch size={9} className="inline mr-0.5 -mt-px" />Inv. profunda
                      </span>
                    )}

                    {/* Cancelar individual (generating, aún pendiente) */}
                    {stage === "generating" && (isCurrent || isPending) && !result?.cancelled && (
                      <button onClick={() => cancelOne(i)} className="text-ink-muted hover:text-danger-fg p-1 rounded" title="Cancelar este contacto">
                        <IconX size={13} />
                      </button>
                    )}
                  </div>

                  {/* Mensajes generados (preview) */}
                  {stage === "preview" && result && !result.cancelled && !result.error && (result.emailSubject || result.linkedinIcebreaker) && (
                    <div className="border-t border-[#F1EEF7] px-4 py-3 space-y-3 bg-[#FAFAFA] text-sm">
                      {result.emailSubject && (
                        <div>
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted mb-1">
                            <IconMail size={12} /> Email 1
                          </div>
                          <div className="font-medium text-ink text-xs">{result.emailSubject}</div>
                          <p className="text-xs text-ink/80 whitespace-pre-line mt-0.5">{result.emailBody}</p>
                        </div>
                      )}
                      {result.emailSubject2 && (
                        <div>
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted mb-1">
                            <IconMail size={12} /> Email 2
                          </div>
                          <div className="font-medium text-ink text-xs">{result.emailSubject2}</div>
                          <p className="text-xs text-ink/80 whitespace-pre-line mt-0.5">{result.emailBody2}</p>
                        </div>
                      )}
                      {result.linkedinIcebreaker && (
                        <div>
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted mb-1">
                            <IconMessage size={12} /> LinkedIn
                          </div>
                          <p className="text-xs text-ink/80">{result.linkedinIcebreaker}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {genError && (
            <div className="text-sm text-danger-fg flex items-center gap-2">
              <IconAlertCircle size={14} /> {genError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#F1EEF7] flex items-center justify-between gap-3">
          {stage === "setup" && (
            <>
              <button onClick={onClose} className="btn-secondary">Cancelar</button>
              <button
                onClick={startGeneration}
                disabled={segmentsLoading}
                className="btn-primary flex items-center gap-2"
              >
                <IconSparkles size={14} /> Generar mensajes
              </button>
            </>
          )}
          {stage === "generating" && (
            <>
              <div className="text-sm text-ink-muted">
                {genProgress}/{selectedContacts.length} contacto{selectedContacts.length !== 1 ? "s" : ""}
              </div>
              <button onClick={cancelAll} className="btn-secondary flex items-center gap-2 text-danger-fg">
                <IconPlayerStop size={14} /> Cancelar todo
              </button>
            </>
          )}
          {stage === "preview" && (
            <>
              <button onClick={onClose} className="btn-secondary">Cancelar</button>
              <button
                onClick={handleConfirm}
                disabled={saving || successCount === 0}
                className="btn-primary flex items-center gap-2"
              >
                {saving
                  ? <><IconLoader2 size={14} className="animate-spin" /> Guardando…</>
                  : <><IconSend size={14} /> Confirmar y enviar a Lemlist ({successCount})</>}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ImportPanel({ companies, onClose, onDone }: { companies: Company[]; onClose: () => void; onDone: () => void }) {
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [json, setJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ inserted: number; yes: number; no: number; skipped: number } | null>(null);

  async function run() {
    setBusy(true); setError(null); setResult(null);
    let parsed: unknown;
    try { parsed = JSON.parse(json); } catch { setBusy(false); setError("JSON inválido."); return; }
    const arr = Array.isArray(parsed) ? parsed : (parsed as any)?.contacts;
    if (!Array.isArray(arr)) { setBusy(false); setError("Debe ser un array o un objeto con clave 'contacts'."); return; }
    const res = await fetch("/api/contacts/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: companyId, contacts: arr }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setError(data.error ?? "Import failed"); return; }
    setResult(data);
  }

  return (
    <section className="card space-y-3 border-2 border-brand-soft">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2"><IconUpload size={16} /> Importar contactos desde Clay</h2>
        <button className="btn-secondary text-xs" onClick={onClose}>Cerrar</button>
      </div>
      {companies.length === 0 ? (
        <div className="text-sm text-ink-muted">No hay empresas aprobadas. Aprueba alguna primero.</div>
      ) : (
        <>
          <div>
            <div className="label mb-1">Empresa aprobada</div>
            <select className="input" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </div>
          <div>
            <div className="label mb-1">JSON de contactos</div>
            <textarea
              className="input min-h-[160px] font-mono text-xs"
              placeholder='[{"first_name":"Tom","last_name":"Wiand","job_title":"Owner","linkedin_url":"https://..."}]'
              value={json}
              onChange={(e) => setJson(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={run} disabled={busy || !companyId || !json.trim()} className="btn-primary">
              <IconUpload size={14} /> {busy ? "Procesando…" : "Procesar"}
            </button>
            {result && <button onClick={onDone} className="btn-secondary"><IconCheck size={14} /> Listo</button>}
          </div>
          {error && <div className="text-sm text-danger-fg flex items-center gap-2"><IconAlertCircle size={14} /> {error}</div>}
          {result && (
            <div className="text-sm text-success-fg flex flex-wrap items-center gap-3">
              <IconCheck size={14} />
              <span>{result.inserted} insertados</span>
              <span>· {result.yes} pre-filter YES</span>
              <span>· {result.no} pre-filter NO</span>
              {result.skipped > 0 && <span>· {result.skipped} duplicados</span>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
