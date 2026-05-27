"use client";

import { useEffect, useMemo, useState } from "react";
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
} from "@tabler/icons-react";

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
type Bucket = "pending" | "approved_pending" | "enriched" | "discarded";
type Preview = { emailSubject?: string; emailBody?: string; linkedinIcebreaker?: string; linkedinIcebreakerNoEmail?: string };

const BUCKET_LABELS: Record<Bucket, string> = {
  pending: "Pendientes",
  approved_pending: "Por aprobar",
  enriched: "En campaña",
  discarded: "Descartados",
};

export default function ContactosPage() {
  const { currentClient } = useClient();
  const [bucket, setBucket] = useState<Bucket>("approved_pending");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [counts, setCounts] = useState<Record<Bucket, number>>({ pending: 0, approved_pending: 0, enriched: 0, discarded: 0 });
  const [loading, setLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [approvedCompanies, setApprovedCompanies] = useState<Company[]>([]);

  // Acciones en curso
  const [bulkApproving, setBulkApproving] = useState(false);
  const [pushingId, setPushingId] = useState<string | null>(null);
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  const [pushingCompany, setPushingCompany] = useState<string | null>(null);

  // Colapsables
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());

  // Previews de mensajes
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, Preview>>({});

  async function load(forBucket: Bucket = bucket) {
    setLoading(true);
    const clientParam = currentClient ? `&client_id=${currentClient.id}` : "";
    const res = await fetch(`/api/contacts?bucket=${forBucket}${clientParam}`, { cache: "no-store" });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { setError(data.error ?? "Load failed"); return; }
    setContacts(data.contacts ?? []);
    if (data.counts) setCounts(data.counts);
    // Colapsar todo al cambiar bucket
    setExpandedCompanies(new Set());
    setPreviews({});
  }

  async function loadApprovedCompanies() {
    const clientParam = currentClient ? `&client_id=${currentClient.id}` : "";
    const res = await fetch(`/api/companies?status=approved${clientParam}`, { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setApprovedCompanies((data.companies ?? []).map((c: any) => ({ id: c.id, company_name: c.company_name })));
  }

  useEffect(() => { load(bucket); }, [bucket, currentClient?.id]);
  useEffect(() => { loadApprovedCompanies(); }, [currentClient?.id]);

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

  // ── Acciones ──────────────────────────────────────────────────────────────

  async function pushToLemlist(contactIds: string[], companyId?: string) {
    if (!currentClient) return;
    if (companyId) setPushingCompany(companyId);
    else if (contactIds.length === 1) setPushingId(contactIds[0]);
    else setBulkApproving(true);
    setNotice(null); setError(null);

    const res = await fetch("/api/lemlist/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: currentClient.id, contact_ids: contactIds }),
    });
    const data = await res.json();
    if (companyId) setPushingCompany(null);
    else if (contactIds.length === 1) setPushingId(null);
    else setBulkApproving(false);

    if (!res.ok) { setError(data.error ?? "Error al enviar"); return; }
    const pushed = data.pushed ?? 0;
    const errs = data.errors?.length ?? 0;
    setNotice(`${pushed} contacto${pushed !== 1 ? "s" : ""} enviado${pushed !== 1 ? "s" : ""} a Lemlist${errs > 0 ? ` · ${errs} con error` : ""}.`);
    await load();
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
    if (!res.ok) { setError("Error al descartar contacto"); return; }
    setContacts(prev => prev.filter(c => c.id !== id));
    setCounts(prev => ({ ...prev, approved_pending: Math.max(0, prev.approved_pending - 1) }));
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
      // Toggle: si ya tiene preview, ocultarlo
      setPreviews(prev => { const n = { ...prev }; delete n[contactId]; return n; });
      return;
    }
    setPreviewLoading(contactId);
    setError(null);
    const res = await fetch(`/api/contacts/${contactId}/preview-messages`, { method: "POST" });
    const data = await res.json();
    setPreviewLoading(null);
    if (!res.ok) { setError(data.error ?? "Error al generar preview"); return; }
    setPreviews(prev => ({ ...prev, [contactId]: data }));
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

      {/* Tabs + acciones globales */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {(["pending", "approved_pending", "enriched", "discarded"] as Bucket[]).map((b) => {
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
          {bucket === "approved_pending" && allIds.length > 0 && (
            <button onClick={() => pushToLemlist(allIds)} disabled={bulkApproving} className="btn-primary">
              <IconSend size={14} />
              {bulkApproving ? "Enviando…" : `Aprobar y enviar a Lemlist (${allIds.length})`}
            </button>
          )}
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

      {/* Expand / Collapse all */}
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
                {/* Header empresa */}
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
                      disabled={isCompanyPushing || bulkApproving}
                      onClick={(e) => { e.stopPropagation(); pushToLemlist(approvedIds, companyId); }}
                    >
                      <IconSend size={12} />
                      {isCompanyPushing ? "Enviando…" : `Enviar ${approvedIds.length} a Lemlist`}
                    </button>
                  )}
                </div>

                {/* Contactos */}
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
                        onPushLemlist={() => pushToLemlist([c.id])}
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

// ── ContactCard ────────────────────────────────────────────────────────────────

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
      {/* Cabecera */}
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

      {/* Mensajes ya guardados */}
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

      {/* Preview de mensajes generados */}
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

      {/* Acciones */}
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

// ── EmptyState ─────────────────────────────────────────────────────────────────

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

// ── ImportPanel ────────────────────────────────────────────────────────────────

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
