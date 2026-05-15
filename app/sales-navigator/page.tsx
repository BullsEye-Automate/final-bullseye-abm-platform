"use client";

import { useCallback, useEffect, useState } from "react";
import {
  IconRefresh,
  IconAlertCircle,
  IconCheck,
  IconCompass,
  IconBrandLinkedin,
  IconExternalLink,
  IconSparkles,
  IconSend,
  IconTrash,
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
  clay_no_contacts_at: string | null;
  sales_nav_status: string | null;
  sales_nav_checked_at: string | null;
  created_at: string;
};

type ContactDraft = {
  linkedin_url: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  linkedin_headline: string | null;
  found: boolean;
  note: string | null;
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

type Counts = { pending: number; no_fit: number };

export default function SalesNavigatorPage() {
  const [tab, setTab] = useState<"pending" | "no_fit">("pending");
  const [pending, setPending] = useState<Company[]>([]);
  const [noFit, setNoFit] = useState<Company[]>([]);
  const [counts, setCounts] = useState<Counts>({ pending: 0, no_fit: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sales-navigator", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudieron cargar las empresas");
        return;
      }
      setPending(data.pending ?? []);
      setNoFit(data.no_fit ?? []);
      setCounts(data.counts ?? { pending: 0, no_fit: 0 });
    } catch {
      setError("No se pudieron cargar las empresas (error de red)");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // La empresa salió de "Por revisar": importó contactos o se marcó no_fit.
  function dropFromPending(id: string) {
    setPending((prev) => prev.filter((c) => c.id !== id));
    setCounts((prev) => ({ ...prev, pending: Math.max(0, prev.pending - 1) }));
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
            contactos). Buscalas a mano en LinkedIn Sales Navigator, pegá las
            URLs de los decision-makers fit y la app los importa, pre-filtra y
            los manda directo a Lemlist.
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

      <div className="flex items-center gap-1 bg-[#F4F2FB] rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab("pending")}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            tab === "pending" ? "bg-white text-brand shadow-sm" : "text-ink-muted hover:text-ink"
          }`}
        >
          Por revisar ({counts.pending})
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

      {loading ? (
        <div className="text-ink-muted">Cargando…</div>
      ) : tab === "pending" ? (
        pending.length === 0 ? (
          <div className="card text-ink-muted space-y-2">
            <div className="flex items-center gap-2">
              <IconCompass size={18} /> No hay empresas esperando revisión.
            </div>
            <div className="text-sm">
              Cuando Clay Find People no encuentre contactos para una empresa,
              va a aparecer acá. Requiere la columna HTTP API en Clay con run
              condition <code className="bg-[#F4F2FB] px-1 rounded">Find People result count = 0</code>{" "}
              apuntando a <code className="bg-[#F4F2FB] px-1 rounded">/api/clay/company-no-contacts</code>.
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {pending.map((c) => (
              <CompanyCard key={c.id} company={c} onRemoved={() => dropFromPending(c.id)} />
            ))}
          </div>
        )
      ) : noFit.length === 0 ? (
        <div className="card text-ink-muted flex items-center gap-2">
          <IconBan size={18} /> Ninguna empresa marcada como “sin contactos fit”.
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
  const [urlsText, setUrlsText] = useState("");
  const [researching, setResearching] = useState(false);
  const [drafts, setDrafts] = useState<ContactDraft[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<ImportedContact[] | null>(null);
  const [importSummary, setImportSummary] = useState<{
    inserted: number;
    yes: number;
    no: number;
    skipped: number;
  } | null>(null);
  const [marking, setMarking] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [pushState, setPushState] = useState<
    Record<string, { status: "idle" | "pushing" | "done" | "error"; msg?: string }>
  >({});

  const salesNavUrl = `https://www.linkedin.com/sales/search/people?keywords=${encodeURIComponent(
    company.company_name
  )}`;

  async function research() {
    const urls = urlsText.split(/[\s,]+/).map((u) => u.trim()).filter(Boolean);
    if (urls.length === 0) {
      setCardError("Pegá al menos una URL de perfil de LinkedIn");
      return;
    }
    setResearching(true);
    setCardError(null);
    try {
      const res = await fetch("/api/sales-navigator/research-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: company.id, linkedin_urls: urls })
      });
      const data = await res.json();
      if (!res.ok) {
        setCardError(data.error ?? "No se pudo investigar los perfiles");
        return;
      }
      setDrafts(data.drafts ?? []);
    } catch {
      setCardError("No se pudo investigar los perfiles (error de red)");
    } finally {
      setResearching(false);
    }
  }

  function updateDraft(idx: number, patch: Partial<ContactDraft>) {
    setDrafts((prev) =>
      prev ? prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)) : prev
    );
  }
  function removeDraft(idx: number) {
    setDrafts((prev) => (prev ? prev.filter((_, i) => i !== idx) : prev));
  }

  async function importContacts() {
    if (!drafts || drafts.length === 0) return;
    setImporting(true);
    setCardError(null);
    try {
      const payload = drafts.map((d) => ({
        first_name: d.first_name,
        last_name: d.last_name,
        job_title: d.job_title,
        linkedin_url: d.linkedin_url,
        linkedin_headline: d.linkedin_headline
      }));
      const res = await fetch(`/api/sales-navigator/${company.id}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contacts: payload })
      });
      const data = await res.json();
      if (!res.ok) {
        setCardError(data.error ?? "No se pudieron importar los contactos");
        return;
      }
      setImportSummary(data.summary ?? null);
      setImported(data.contacts ?? []);
      setDrafts(null);
    } catch {
      setCardError("No se pudieron importar los contactos (error de red)");
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
        setPushState((prev) => ({
          ...prev,
          [contactId]: { status: "error", msg }
        }));
        return;
      }
      setPushState((prev) => ({ ...prev, [contactId]: { status: "done" } }));
      setImported((prev) =>
        prev
          ? prev.map((c) =>
              c.id === contactId
                ? { ...c, lemlist_pushed_at: new Date().toISOString() }
                : c
            )
          : prev
      );
    } catch {
      setPushState((prev) => ({
        ...prev,
        [contactId]: { status: "error", msg: "Error de red" }
      }));
    }
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

  return (
    <div className="card space-y-3">
      <CompanyHeader company={company} />

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

      {/* Resultado del import — la empresa ya salió de la cola */}
      {imported ? (
        <div className="border border-divider rounded-md p-3 space-y-2">
          {importSummary && (
            <div className="text-sm">
              <span className="font-medium text-success-fg">
                {importSummary.inserted} importados
              </span>{" "}
              · {importSummary.yes} pasaron el pre-filtro · {importSummary.no}{" "}
              descartados
              {importSummary.skipped > 0 ? ` · ${importSummary.skipped} duplicados` : ""}
            </div>
          )}
          {imported.length === 0 ? (
            <div className="text-xs text-ink-muted">
              Ningún contacto pasó el pre-filtro. La empresa salió de la cola;
              si querés, marcala como sin contactos fit con el botón de abajo.
            </div>
          ) : (
            <div className="space-y-1.5">
              {imported.map((ct) => {
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
                          className="btn-primary text-xs"
                          onClick={() => pushToLemlist(ct.id)}
                          disabled={ps === "pushing"}
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
          )}
          <div className="text-xs text-ink-subtle">
            Estos contactos también aparecen en{" "}
            <a href="/contactos" className="text-brand">
              /contactos
            </a>
            . La empresa ya salió de la cola.
          </div>
        </div>
      ) : (
        /* Cargar contactos desde Sales Navigator */
        <div className="border border-divider rounded-md p-3 space-y-2">
          <div className="label">Contactos encontrados en Sales Navigator</div>
          <textarea
            className="input text-sm min-h-[70px] resize-y"
            placeholder="Pegá las URLs de los perfiles de LinkedIn (una por línea)…"
            value={urlsText}
            onChange={(e) => setUrlsText(e.target.value)}
          />
          <div className="flex items-center gap-2 flex-wrap">
            <button
              className="btn-secondary text-xs"
              onClick={research}
              disabled={researching || importing || !urlsText.trim()}
            >
              <IconSparkles size={13} />{" "}
              {researching ? "Investigando…" : "Buscar con IA"}
            </button>
            <span className="text-xs text-ink-subtle">
              La IA intenta sacar nombre y cargo de cada URL. Revisá y corregí
              antes de importar.
            </span>
          </div>

          {drafts && drafts.length > 0 && (
            <div className="space-y-2 pt-1">
              {drafts.map((d, idx) => (
                <div
                  key={`${d.linkedin_url}-${idx}`}
                  className="bg-[#F4F2FB] rounded-md p-2 space-y-1.5"
                >
                  <div className="flex items-center gap-2">
                    {d.found ? (
                      <IconCheck size={13} className="text-success-fg shrink-0" />
                    ) : (
                      <IconAlertCircle
                        size={13}
                        className="text-warning-fg shrink-0"
                      />
                    )}
                    <a
                      href={d.linkedin_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-brand truncate"
                    >
                      {d.linkedin_url}
                    </a>
                    <button
                      className="ml-auto text-ink-subtle hover:text-danger-fg"
                      onClick={() => removeDraft(idx)}
                      title="Quitar"
                    >
                      <IconTrash size={13} />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                    <input
                      className="input text-sm py-1"
                      placeholder="Nombre"
                      value={d.first_name ?? ""}
                      onChange={(e) =>
                        updateDraft(idx, { first_name: e.target.value || null })
                      }
                    />
                    <input
                      className="input text-sm py-1"
                      placeholder="Apellido"
                      value={d.last_name ?? ""}
                      onChange={(e) =>
                        updateDraft(idx, { last_name: e.target.value || null })
                      }
                    />
                    <input
                      className="input text-sm py-1"
                      placeholder="Cargo"
                      value={d.job_title ?? ""}
                      onChange={(e) =>
                        updateDraft(idx, { job_title: e.target.value || null })
                      }
                    />
                  </div>
                  {d.note && (
                    <div className="text-xs text-ink-subtle">{d.note}</div>
                  )}
                </div>
              ))}
              <button
                className="btn-primary text-xs"
                onClick={importContacts}
                disabled={importing}
              >
                <IconCheck size={13} />{" "}
                {importing
                  ? "Importando…"
                  : `Importar ${drafts.length} ${
                      drafts.length === 1 ? "contacto" : "contactos"
                    }`}
              </button>
            </div>
          )}
          {drafts && drafts.length === 0 && (
            <div className="text-xs text-ink-muted">
              No quedó ningún contacto para importar.
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1 border-t border-divider">
        <button
          className="text-xs text-ink-muted hover:text-danger-fg inline-flex items-center gap-1"
          onClick={markNoFit}
          disabled={marking}
        >
          <IconBan size={13} />{" "}
          {marking ? "Marcando…" : "No hay contactos fit"}
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
          <IconArrowBackUp size={13} />{" "}
          {working ? "Reactivando…" : "Reactivar"}
        </button>
        {err && <span className="text-xs text-danger-fg">{err}</span>}
      </div>
    </div>
  );
}
