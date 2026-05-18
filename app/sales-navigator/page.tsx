"use client";

import { useCallback, useEffect, useState } from "react";
import {
  IconRefresh,
  IconAlertCircle,
  IconCheck,
  IconCompass,
  IconBrandLinkedin,
  IconExternalLink,
  IconSend,
  IconDownload,
  IconArrowBackUp,
  IconBan
} from "@tabler/icons-react";

const TYPE_LABELS: Record<string, string> = {
  lab: "Laboratorio",
  multi_clinic: "Multi-clínica",
  dso: "DSO",
  other: "Otro"
};

function fitTone(score: string | null): string {
  if (score === "high") return "bg-success-bg text-success-fg";
  if (score === "medium") return "bg-warning-bg text-warning-fg";
  return "bg-[#F1EEF7] text-ink-muted";
}

type Company = {
  id: string;
  company_name: string;
  company_website: string | null;
  company_linkedin_url: string | null;
  company_city: string | null;
  company_country: string | null;
  company_size: number | null;
  company_type: string | null;
  cad_software: string | null;
  scanner_technology: string | null;
  fit_signals: string | null;
  fit_score: string | null;
  research_summary: string | null;
  clay_pushed_at: string | null;
  clay_no_contacts_at: string | null;
  sales_nav_status: string | null;
  sales_nav_checked_at: string | null;
  created_at: string;
  // Por qué la empresa está en la cola: 'clay' = Clay avisó por webhook;
  // 'inferred' = la app lo dedujo (pasó por Clay y sigue sin contactos).
  signal?: "clay" | "inferred";
  // Cuántos contactos hay en nuestra base para esta empresa. 0 en bucket
  // no_contacts, 1 en bucket one_contact, undefined si no aplica.
  contact_count?: number;
};

type ImportedContact = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  linkedin_url: string | null;
  email: string | null;
  prefilter_result: string | null;
  status: string | null;
  fit_action: string | null;
  lemlist_pushed_at: string | null;
  lemlist_push_error: string | null;
  clay_pushed_at: string | null;
};

type PreviewLead = {
  id: string | null;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  job_title: string | null;
  linkedin_url: string | null;
  email: string | null;
};

type AutoPushResult = {
  id: string;
  contact_name: string;
  lemlist: "pushed" | "error" | "skipped";
  lemlist_error?: string;
  hubspot: "synced" | "error" | "skipped";
  hubspot_error?: string;
};

type ImportResult = {
  summary: { inserted: number; yes: number; no: number; skipped: number };
  contacts: ImportedContact[];
  staged_total: number;
  selected_count: number;
  deleted: number;
  delete_errors: { lead: string; error: string }[];
  matched_url?: string;
  auto_pushed_lemlist?: boolean;
  auto_push_results?: AutoPushResult[];
};

type Counts = { no_contacts: number; one_contact: number; no_fit: number };
type Tab = "no_contacts" | "one_contact" | "no_fit";

export default function SalesNavigatorPage() {
  const [tab, setTab] = useState<Tab>("no_contacts");
  const [noContacts, setNoContacts] = useState<Company[]>([]);
  const [oneContact, setOneContact] = useState<Company[]>([]);
  const [noFit, setNoFit] = useState<Company[]>([]);
  const [counts, setCounts] = useState<Counts>({ no_contacts: 0, one_contact: 0, no_fit: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Por defecto se esperan 24h tras mandar la empresa a Clay (para no
  // mostrar empresas que Clay todavía está procesando). Este toggle baja
  // esa espera a 0 y trae todas las que pasaron por Clay sin contactos.
  // Solo aplica al bucket "Sin contactos" — 1 contacto significa que
  // Clay ya devolvió.
  const [includeRecent, setIncludeRecent] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/sales-navigator${includeRecent ? "?include_recent=1" : ""}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudieron cargar las empresas");
        return;
      }
      setNoContacts(data.no_contacts ?? []);
      setOneContact(data.one_contact ?? []);
      setNoFit(data.no_fit ?? []);
      setCounts(data.counts ?? { no_contacts: 0, one_contact: 0, no_fit: 0 });
    } catch {
      setError("No se pudieron cargar las empresas (error de red)");
    } finally {
      setLoading(false);
    }
  }, [includeRecent]);

  useEffect(() => {
    load();
  }, [load]);

  function dropFromNoContacts(id: string) {
    setNoContacts((prev) => prev.filter((c) => c.id !== id));
    setCounts((prev) => ({ ...prev, no_contacts: Math.max(0, prev.no_contacts - 1) }));
  }
  function dropFromOneContact(id: string) {
    setOneContact((prev) => prev.filter((c) => c.id !== id));
    setCounts((prev) => ({ ...prev, one_contact: Math.max(0, prev.one_contact - 1) }));
  }
  function dropFromNoFit(id: string) {
    setNoFit((prev) => prev.filter((c) => c.id !== id));
    setCounts((prev) => ({ ...prev, no_fit: Math.max(0, prev.no_fit - 1) }));
  }

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <div className="label">Prospección</div>
          <h1 className="text-2xl font-semibold tracking-tight">Sales Navigator</h1>
          <div className="text-sm text-ink-muted mt-1 max-w-2xl">
            Empresas que Clay no pudo prospectar (Find People no encontró
            contactos). Búscalas en LinkedIn Sales Navigator, manda los
            contactos fit a la campaña puente de Lemlist con la extensión, y la
            app los pre-filtra y los suma a la campaña real.
          </div>
        </div>
        <button onClick={load} disabled={loading} className="btn-secondary">
          <IconRefresh size={16} /> {loading ? "Cargando…" : "Refrescar"}
        </button>
      </header>

      {error && (
        <div className="card border border-danger-bg text-danger-fg flex items-start gap-2 text-sm">
          <IconAlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      <div className="flex items-center gap-1 bg-[#F4F2FB] rounded-lg p-1 w-fit flex-wrap">
        <button
          onClick={() => setTab("no_contacts")}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            tab === "no_contacts" ? "bg-white text-brand shadow-sm" : "text-ink-muted hover:text-ink"
          }`}
        >
          Empresas sin contactos ({counts.no_contacts})
        </button>
        <button
          onClick={() => setTab("one_contact")}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            tab === "one_contact" ? "bg-white text-brand shadow-sm" : "text-ink-muted hover:text-ink"
          }`}
          title="Empresas donde Clay solo encontró 1 contacto — conviene buscar más en Sales Nav"
        >
          Con solo 1 contacto ({counts.one_contact})
        </button>
        <button
          onClick={() => setTab("no_fit")}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            tab === "no_fit" ? "bg-white text-brand shadow-sm" : "text-ink-muted hover:text-ink"
          }`}
        >
          Sin contactos fit ({counts.no_fit})
        </button>
      </div>

      {tab === "no_contacts" && (
        <div className="flex items-start gap-2 flex-wrap">
          <button
            onClick={() => setIncludeRecent((v) => !v)}
            className={`text-xs px-2.5 py-1 rounded-md border transition-colors shrink-0 ${
              includeRecent
                ? "border-brand bg-[#EEEDFE] text-brand"
                : "border-divider text-ink-muted hover:text-ink"
            }`}
          >
            {includeRecent ? "✓ " : ""}Incluir las recién mandadas a Clay
          </button>
          <span className="text-xs text-ink-subtle">
            {includeRecent
              ? "Mostrando todas las que pasaron por Clay y siguen sin contactos, sin esperar 24h. Las recién mandadas pueden estar todavía en proceso en Clay."
              : "Por defecto se esperan 24h desde que la empresa fue a Clay, para no mostrar las que Clay todavía está procesando."}
          </span>
        </div>
      )}

      {loading ? (
        <div className="text-ink-muted">Cargando…</div>
      ) : tab === "no_contacts" ? (
        noContacts.length === 0 ? (
          <div className="card text-ink-muted space-y-2">
            <div className="flex items-center gap-2">
              <IconCompass size={18} /> No hay empresas esperando revisión.
            </div>
            <div className="text-sm">
              Cuando una empresa que mandaste a Clay no consigue contactos,
              aparece aquí automáticamente: la app lo detecta sola (empresa
              empujada a Clay hace 24h+ y sin ningún contacto en la base).
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {noContacts.map((c) => (
              <CompanyCard key={c.id} company={c} onRemoved={() => dropFromNoContacts(c.id)} />
            ))}
          </div>
        )
      ) : tab === "one_contact" ? (
        oneContact.length === 0 ? (
          <div className="card text-ink-muted space-y-2">
            <div className="flex items-center gap-2">
              <IconCompass size={18} /> Ninguna empresa con un solo contacto.
            </div>
            <div className="text-sm">
              Cuando Clay devuelve solo 1 contacto para una empresa, aparece
              aquí — sirve para buscar más decision-makers en Sales Nav y
              cubrir mejor a la empresa.
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {oneContact.map((c) => (
              <CompanyCard key={c.id} company={c} onRemoved={() => dropFromOneContact(c.id)} />
            ))}
          </div>
        )
      ) : noFit.length === 0 ? (
        <div className="card text-ink-muted flex items-center gap-2">
          <IconBan size={18} /> Ninguna empresa marcada como "sin contactos fit".
        </div>
      ) : (
        <div className="space-y-3">
          {noFit.map((c) => (
            <NoFitCard key={c.id} company={c} onReactivated={() => dropFromNoFit(c.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function CompanyHeader({ company }: { company: Company }) {
  const loc = [company.company_city, company.company_country].filter(Boolean).join(", ");
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold truncate">{company.company_name}</span>
          {company.company_type && (
            <span className="badge bg-[#EEEDFE] text-brand">
              {TYPE_LABELS[company.company_type] ?? company.company_type}
            </span>
          )}
          {company.fit_score && (
            <span className={`badge ${fitTone(company.fit_score)}`}>
              fit {company.fit_score}
            </span>
          )}
          {company.company_size != null && (
            <span className="badge bg-[#F1EEF7] text-ink-muted">
              {company.company_size} empl.
            </span>
          )}
        </div>
        <div className="text-xs text-ink-muted truncate">
          {loc || "—"}
          {company.cad_software ? ` · CAD: ${company.cad_software}` : ""}
        </div>
      </div>
    </div>
  );
}

function CompanyCard({
  company,
  onRemoved
}: {
  company: Company;
  onRemoved: () => void;
}) {
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewLead[] | null>(null);
  const [previewMatchedUrl, setPreviewMatchedUrl] = useState<string | undefined>();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Buscador del preview: filtra leads por nombre/empresa/cargo para encontrar
  // los de UNA empresa cuando la Campaña puente acumula muchos contactos.
  const [previewQuery, setPreviewQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [bulkPushing, setBulkPushing] = useState(false);
  const [marking, setMarking] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [pushState, setPushState] = useState<
    Record<string, { status: "idle" | "pushing" | "done" | "error"; msg?: string }>
  >({});

  const salesNavUrl = `https://www.linkedin.com/sales/search/people?keywords=${encodeURIComponent(
    company.company_name
  )}`;

  // Inferida pero mandada a Clay hace poco: Clay capaz sigue procesándola.
  const pushedRecently =
    company.signal === "inferred" &&
    company.clay_pushed_at != null &&
    Date.now() - new Date(company.clay_pushed_at).getTime() < 24 * 60 * 60 * 1000;

  async function openPreview() {
    setPreviewing(true);
    setCardError(null);
    setResult(null);
    try {
      const res = await fetch("/api/sales-navigator/staged-leads", {
        cache: "no-store"
      });
      const data = await res.json();
      if (!res.ok) {
        setCardError(
          data.error ?? "No se pudo leer la Campaña puente de Lemlist"
        );
        return;
      }
      const leads: PreviewLead[] = data.leads ?? [];
      setPreview(leads);
      setPreviewMatchedUrl(data.matched_url);
      // Todos chequeados por default.
      setSelectedIds(
        new Set(leads.map((l) => l.id).filter((x): x is string => !!x))
      );
    } catch {
      setCardError("No se pudo leer la Campaña puente (error de red)");
    } finally {
      setPreviewing(false);
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Leads que matchean el filtro actual del buscador. Cuando no hay filtro,
  // visibleLeads === preview.
  const visibleLeads: PreviewLead[] = (() => {
    if (!preview) return [];
    const q = previewQuery.trim().toLowerCase();
    if (!q) return preview;
    return preview.filter((l) => {
      const hay = [l.name, l.first_name, l.last_name, l.company_name, l.job_title, l.email]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  })();

  // IDs efectivos a importar: intersección de seleccionados y visibles. Si
  // el SDR filtra a 3 y hay 11 chequeados, solo importamos los 3 visibles.
  const effectiveSelectedIds: string[] = visibleLeads
    .map((l) => l.id)
    .filter((x): x is string => !!x && selectedIds.has(x));

  function selectAllVisible() {
    if (!preview) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const l of visibleLeads) {
        if (l.id) next.add(l.id);
      }
      return next;
    });
  }
  function deselectAllVisible() {
    if (!preview) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const l of visibleLeads) {
        if (l.id) next.delete(l.id);
      }
      return next;
    });
  }
  function cancelPreview() {
    setPreview(null);
    setSelectedIds(new Set());
    setPreviewQuery("");
    setCardError(null);
  }

  async function importSelected() {
    if (effectiveSelectedIds.length === 0) return;
    setImporting(true);
    setCardError(null);
    try {
      const res = await fetch(`/api/sales-navigator/${company.id}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lemlist_lead_ids: effectiveSelectedIds,
          // Sales Nav contactos ya curados manualmente — siempre van directo
          // a Lemlist + HubSpot sin pasar por Clay.
          auto_push_lemlist: true
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setCardError(data.error ?? "No se pudo importar");
        return;
      }
      setResult({
        summary: data.summary,
        contacts: data.contacts ?? [],
        staged_total: data.staged_total ?? 0,
        selected_count: data.selected_count ?? 0,
        deleted: data.deleted ?? 0,
        delete_errors: data.delete_errors ?? [],
        matched_url: data.matched_url,
        auto_pushed_lemlist: data.auto_pushed_lemlist,
        auto_push_results: data.auto_push_results
      });
      setPreview(null);
      setSelectedIds(new Set());
      setPreviewQuery("");
    } catch {
      setCardError("No se pudo importar (error de red)");
    } finally {
      setImporting(false);
    }
  }

  async function pushToLemlist(contactId: string) {
    setPushState((prev) => ({ ...prev, [contactId]: { status: "pushing" } }));
    try {
      const res = await fetch(`/api/contacts/${contactId}/push-to-lemlist`, {
        method: "POST"
      });
      const data = await res.json();
      const lemlistOk = res.ok && data?.lemlist_push?.ok;
      if (!lemlistOk) {
        const msg =
          data?.lemlist_push?.error ?? data?.error ?? "Lemlist rechazó el contacto";
        setPushState((prev) => ({ ...prev, [contactId]: { status: "error", msg } }));
        return;
      }
      setPushState((prev) => ({ ...prev, [contactId]: { status: "done" } }));
      setResult((prev) =>
        prev
          ? {
              ...prev,
              contacts: prev.contacts.map((c) =>
                c.id === contactId
                  ? { ...c, lemlist_pushed_at: new Date().toISOString() }
                  : c
              )
            }
          : prev
      );
    } catch {
      setPushState((prev) => ({
        ...prev,
        [contactId]: { status: "error", msg: "Error de red" }
      }));
    }
  }

  async function pushAllToLemlist() {
    if (!result) return;
    setBulkPushing(true);
    const pending = result.contacts.filter(
      (c) => !c.lemlist_pushed_at && pushState[c.id]?.status !== "done"
    );
    for (const c of pending) {
      await pushToLemlist(c.id);
    }
    setBulkPushing(false);
  }

  async function markNoFit() {
    setMarking(true);
    setCardError(null);
    try {
      const res = await fetch(`/api/sales-navigator/${company.id}/mark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "no_fit" })
      });
      const data = await res.json();
      if (!res.ok) {
        setCardError(data.error ?? "No se pudo marcar la empresa");
        return;
      }
      onRemoved();
    } catch {
      setCardError("No se pudo marcar la empresa (error de red)");
    } finally {
      setMarking(false);
    }
  }

  const pendingToPush = result
    ? result.contacts.filter(
        (c) => !c.lemlist_pushed_at && pushState[c.id]?.status !== "done"
      ).length
    : 0;

  return (
    <div className="card space-y-3">
      <CompanyHeader company={company} />

      {company.contact_count === 1 ? (
        <div className="text-xs text-warning-fg flex items-start gap-1">
          <IconAlertCircle size={12} className="mt-0.5 shrink-0" />
          Clay encontró 1 solo contacto. Conviene buscar más decision-makers
          en Sales Navigator para cubrir mejor esta empresa.
        </div>
      ) : company.signal === "inferred" ? (
        <div className="text-xs text-warning-fg flex items-start gap-1">
          <IconAlertCircle size={12} className="mt-0.5 shrink-0" />
          {pushedRecently
            ? "Recién mandada a Clay (hace menos de 24h) y todavía sin contactos. Puede que Clay siga procesándola — verifica en Clay antes de buscar a mano."
            : "Pasó por Clay y sigue sin contactos en la base — Clay no encontró a nadie."}
        </div>
      ) : (
        <div className="text-xs text-ink-muted flex items-start gap-1">
          <IconCheck size={12} className="mt-0.5 shrink-0 text-success-fg" />
          Clay avisó: Find People no encontró contactos.
        </div>
      )}

      {company.fit_signals && (
        <div className="text-sm text-ink">{company.fit_signals}</div>
      )}
      {company.research_summary && (
        <div className="text-xs text-ink-muted">
          {company.research_summary.length > 320
            ? company.research_summary.slice(0, 320) + "…"
            : company.research_summary}
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <a href={salesNavUrl} target="_blank" rel="noreferrer" className="btn-primary text-xs">
          <IconCompass size={13} /> Abrir en Sales Navigator
        </a>
        {company.company_linkedin_url && (
          <a
            href={company.company_linkedin_url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-brand inline-flex items-center gap-1"
          >
            <IconBrandLinkedin size={13} /> Empresa en LinkedIn
            <IconExternalLink size={10} />
          </a>
        )}
        {company.company_website && (
          <a
            href={company.company_website}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-ink-subtle hover:text-brand inline-flex items-center gap-1"
          >
            Sitio web <IconExternalLink size={10} />
          </a>
        )}
      </div>

      {cardError && (
        <div className="text-xs text-danger-fg flex items-start gap-1">
          <IconAlertCircle size={12} className="mt-0.5 shrink-0" /> {cardError}
        </div>
      )}

      {result ? (
        /* Resultado del import desde la Campaña puente */
        <div className="border border-divider rounded-md p-3 space-y-2">
          <div className="text-sm">
            <span className="font-medium text-success-fg">
              {result.summary.inserted} importados
            </span>
            {" "}de {result.selected_count} seleccionados
            {" "}· {result.summary.yes} pasaron el pre-filtro
            {" "}· {result.summary.no} descartados
            {result.summary.skipped > 0
              ? ` · ${result.summary.skipped} ya estaban`
              : ""}
          </div>
          <div className="text-xs text-ink-muted">
            {result.deleted === result.selected_count
              ? `Campaña puente: ${result.deleted} lead${result.deleted === 1 ? "" : "s"} eliminado${result.deleted === 1 ? "" : "s"} (la puente quedó limpia).`
              : `Campaña puente: ${result.deleted} de ${result.selected_count} eliminados.`}
          </div>
          {result.delete_errors.length > 0 && (
            <div className="text-xs text-warning-fg space-y-0.5">
              <div>No se pudieron borrar de la Campaña puente:</div>
              {result.delete_errors.map((e, i) => (
                <div key={i} className="pl-2">
                  · {e.lead}: <span className="text-ink-subtle">{e.error}</span>
                </div>
              ))}
            </div>
          )}

          {result.auto_pushed_lemlist && result.auto_push_results && result.auto_push_results.length > 0 && (
            <div className="border border-divider rounded-md p-2 bg-[#FAFAFE] space-y-1">
              <div className="label">Envío automático a Lemlist + HubSpot</div>
              {(() => {
                const okL = result.auto_push_results.filter((r) => r.lemlist === "pushed").length;
                const errL = result.auto_push_results.filter((r) => r.lemlist === "error").length;
                const okH = result.auto_push_results.filter((r) => r.hubspot === "synced").length;
                const errH = result.auto_push_results.filter((r) => r.hubspot === "error").length;
                return (
                  <div className="text-xs text-ink-muted">
                    Lemlist: <span className="text-success-fg font-medium">{okL} enviados</span>
                    {errL > 0 && <span className="text-danger-fg"> · {errL} con error</span>}
                    {" · "}
                    HubSpot: <span className="text-success-fg font-medium">{okH} sincronizados</span>
                    {errH > 0 && <span className="text-danger-fg"> · {errH} con error</span>}
                  </div>
                );
              })()}
              {result.auto_push_results.some((r) => r.lemlist === "error" || r.hubspot === "error") && (
                <div className="text-xs space-y-0.5 pt-1">
                  {result.auto_push_results
                    .filter((r) => r.lemlist === "error" || r.hubspot === "error")
                    .map((r) => (
                      <div key={r.id} className="text-danger-fg pl-2">
                        · {r.contact_name}:
                        {r.lemlist === "error" && <> Lemlist {r.lemlist_error}</>}
                        {r.hubspot === "error" && <> · HubSpot {r.hubspot_error}</>}
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {result.contacts.length > 0 && (
            <>
              <div className="space-y-1.5">
                {result.contacts.map((ct) => {
                  const ps = pushState[ct.id]?.status ?? "idle";
                  const inLemlist = !!ct.lemlist_pushed_at || ps === "done";
                  return (
                    <div
                      key={ct.id}
                      className="flex items-center gap-2 flex-wrap text-sm border-b border-divider last:border-0 pb-1.5 last:pb-0"
                    >
                      <span className="font-medium">
                        {[ct.first_name, ct.last_name].filter(Boolean).join(" ") ||
                          "(sin nombre)"}
                      </span>
                      <span className="text-xs text-ink-muted truncate">
                        {ct.job_title || "—"}
                      </span>
                      {ct.linkedin_url && (
                        <a
                          href={ct.linkedin_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-ink-subtle hover:text-brand"
                          title="LinkedIn"
                        >
                          <IconBrandLinkedin size={14} />
                        </a>
                      )}
                      <div className="ml-auto flex items-center gap-2">
                        {inLemlist ? (
                          <span className="badge bg-success-bg text-success-fg">
                            en Lemlist ✓
                          </span>
                        ) : (
                          <button
                            className="btn-secondary text-xs"
                            onClick={() => pushToLemlist(ct.id)}
                            disabled={ps === "pushing" || bulkPushing}
                          >
                            <IconSend size={12} />{" "}
                            {ps === "pushing" ? "Enviando…" : "Directo a Lemlist"}
                          </button>
                        )}
                      </div>
                      {ps === "error" && (
                        <div className="w-full text-xs text-danger-fg flex items-start gap-1">
                          <IconAlertCircle size={11} className="mt-0.5 shrink-0" />
                          Lemlist: {pushState[ct.id]?.msg}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {pendingToPush > 0 && (
                <button
                  className="btn-primary text-xs"
                  onClick={pushAllToLemlist}
                  disabled={bulkPushing}
                >
                  <IconSend size={13} />{" "}
                  {bulkPushing
                    ? "Enviando…"
                    : `Enviar todos a Lemlist (${pendingToPush})`}
                </button>
              )}
            </>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <button
              className="text-xs text-brand hover:underline inline-flex items-center gap-1"
              onClick={openPreview}
              disabled={previewing}
            >
              <IconRefresh size={12} />{" "}
              {previewing ? "Cargando…" : "Cargar más desde la Campaña puente"}
            </button>
            {result.contacts.length > 0 && (
              <span className="text-xs text-ink-subtle">
                Los contactos también aparecen en{" "}
                <a href="/contactos" className="text-brand">
                  /contactos
                </a>
                .
              </span>
            )}
          </div>
        </div>
      ) : preview ? (
        /* Preview con checkboxes — el usuario elige cuáles importar */
        <div className="border border-divider rounded-md p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="label">
              Leads en la Campaña puente ({preview.length})
            </div>
            {preview.length > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <button
                  className="text-brand hover:underline"
                  onClick={selectAllVisible}
                  disabled={importing}
                  title={previewQuery ? "Marca solo los que matchean el filtro" : "Marca todos"}
                >
                  {previewQuery ? "Marcar visibles" : "Marcar todos"}
                </button>
                <span className="text-ink-subtle">·</span>
                <button
                  className="text-brand hover:underline"
                  onClick={deselectAllVisible}
                  disabled={importing}
                  title={previewQuery ? "Desmarca solo los que matchean el filtro" : "Desmarca todos"}
                >
                  {previewQuery ? "Desmarcar visibles" : "Desmarcar todos"}
                </button>
              </div>
            )}
          </div>

          {preview.length === 0 ? (
            <div className="text-xs text-warning-fg">
              No hay leads en la Campaña puente. ¿Los enviaste con la extensión
              de Lemlist a la <em>campaña</em> (no a una lista)?
              {previewMatchedUrl && (
                <>
                  {" "}URL probada:{" "}
                  <code className="text-[11px]">{previewMatchedUrl}</code>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="text-xs text-ink-muted">
                Marca solo los leads que pertenecen a{" "}
                <strong className="text-ink">{company.company_name}</strong>.
                Los importados se borran automáticamente de la Campaña puente.
              </div>
              <input
                type="search"
                value={previewQuery}
                onChange={(e) => setPreviewQuery(e.target.value)}
                placeholder={`Filtrar por nombre, empresa o cargo (ej: "${company.company_name.split(/\s+/)[0]}")`}
                className="w-full px-2 py-1.5 border border-zinc-300 rounded text-sm"
              />
              <div className="space-y-1">
                {visibleLeads.length === 0 && previewQuery.trim() ? (
                  <div className="text-xs text-ink-muted py-3 text-center">
                    Ningún lead matchea "{previewQuery.trim()}". Prueba con
                    menos palabras o sin el sufijo (ej. "artisan" en vez de
                    "Artisan Dental Lab").
                  </div>
                ) : (
                  visibleLeads.map((l) => {
                    const checked = l.id ? selectedIds.has(l.id) : false;
                    return (
                      <label
                        key={l.id ?? l.linkedin_url ?? l.email ?? Math.random()}
                        className="flex items-start gap-2 text-sm cursor-pointer hover:bg-[#F4F2FB] rounded p-1.5"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => l.id && toggleSelect(l.id)}
                          disabled={!l.id || importing}
                          className="mt-1 shrink-0"
                        />
                        <div className="flex-1 min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">
                              {l.name || "(sin nombre)"}
                            </span>
                            <span className="text-xs text-ink-muted">
                              {l.job_title || "—"}
                            </span>
                            {l.linkedin_url && (
                              <a
                                href={l.linkedin_url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-ink-subtle hover:text-brand"
                                onClick={(e) => e.stopPropagation()}
                                title="LinkedIn"
                              >
                                <IconBrandLinkedin size={13} />
                              </a>
                            )}
                          </div>
                          <div className="text-xs">
                            {l.company_name ? (
                              <span className="badge bg-[#F1EEF7] text-ink-muted">
                                {l.company_name}
                              </span>
                            ) : (
                              <span className="text-warning-fg italic text-[11px]">
                                sin nombre de empresa en Lemlist
                              </span>
                            )}
                          </div>
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
            </>
          )}

          <div className="flex items-center gap-2 flex-wrap pt-1">
            <button
              className="btn-primary text-xs"
              onClick={importSelected}
              disabled={importing || effectiveSelectedIds.length === 0}
              title="Importa, genera icebreaker + email con IA, y los envía a Lemlist + HubSpot en un solo paso."
            >
              <IconSend size={13} />{" "}
              {importing
                ? "Importando y enviando…"
                : `Importar y enviar directo a Lemlist (${effectiveSelectedIds.length})`}
            </button>
            <button
              className="text-xs text-ink-muted hover:text-ink"
              onClick={cancelPreview}
              disabled={importing}
            >
              Cancelar
            </button>
          </div>
          <div className="text-xs text-ink-subtle">
            Los contactos de Sales Nav ya están curados por ti — entran directo
            a Lemlist + HubSpot sin pasar por Clay.
            {previewQuery.trim() && selectedIds.size > effectiveSelectedIds.length && (
              <>
                {" "}Con el filtro activo se importan solo los visibles
                ({effectiveSelectedIds.length} de {selectedIds.size} marcados).
              </>
            )}
          </div>
        </div>
      ) : (
        /* Estado inicial — instrucciones + botón "Importar desde Campaña puente" */
        <div className="border border-divider rounded-md p-3 space-y-2.5 bg-[#FAFAFE]">
          <div className="label">Cómo traer los contactos</div>
          <ol className="text-sm text-ink-muted space-y-1.5 list-decimal pl-4">
            <li>
              Haz clic en{" "}
              <strong className="text-ink">“Abrir en Sales Navigator”</strong>{" "}
              y busca los decision-makers fit de esta empresa.
            </li>
            <li>
              Selecciónalos (checkbox) y, con la extensión de Lemlist, mándalos
              a la campaña{" "}
              <strong className="text-ink">“Campaña puente”</strong> — a la{" "}
              <em>campaña</em>, no a una lista.
            </li>
            <li>
              Vuelve aquí y haz clic en{" "}
              <strong className="text-ink">
                “Importar desde Campaña puente”
              </strong>
              . La app te muestra los leads para que confirmes cuáles son de
              esta empresa, los pre-filtra con IA, y los borra de la puente.
            </li>
          </ol>
          <button
            className="btn-primary text-xs"
            onClick={openPreview}
            disabled={previewing}
          >
            <IconDownload size={13} />{" "}
            {previewing ? "Cargando…" : "Importar desde Campaña puente"}
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1 border-t border-divider">
        <button
          className="text-xs text-ink-muted hover:text-danger-fg inline-flex items-center gap-1"
          onClick={markNoFit}
          disabled={marking}
        >
          <IconBan size={13} /> {marking ? "Marcando…" : "No hay contactos fit"}
        </button>
        <span className="text-xs text-ink-subtle">
          la saca de la cola sin rechazar la empresa
        </span>
      </div>
    </div>
  );
}

function NoFitCard({
  company,
  onReactivated
}: {
  company: Company;
  onReactivated: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function reactivate() {
    setWorking(true);
    setErr(null);
    try {
      const res = await fetch(`/api/sales-navigator/${company.id}/mark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: null })
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "No se pudo reactivar");
        return;
      }
      onReactivated();
    } catch {
      setErr("No se pudo reactivar (error de red)");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="card space-y-2 opacity-90">
      <CompanyHeader company={company} />
      {company.fit_signals && (
        <div className="text-xs text-ink-muted">{company.fit_signals}</div>
      )}
      <div className="flex items-center gap-3 flex-wrap pt-1 border-t border-divider">
        <span className="badge bg-[#F1EEF7] text-ink-muted">
          sin contactos fit
          {company.sales_nav_checked_at
            ? ` · ${new Date(company.sales_nav_checked_at).toLocaleDateString("es", {
                day: "2-digit",
                month: "short"
              })}`
            : ""}
        </span>
        <button
          className="btn-secondary text-xs"
          onClick={reactivate}
          disabled={working}
        >
          <IconArrowBackUp size={13} /> {working ? "Reactivando…" : "Reactivar"}
        </button>
        {err && <span className="text-xs text-danger-fg">{err}</span>}
      </div>
    </div>
  );
}
