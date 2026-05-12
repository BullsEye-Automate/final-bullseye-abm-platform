"use client";

import { useEffect, useMemo, useState } from "react";
import {
  IconUsers,
  IconUpload,
  IconCheck,
  IconAlertCircle,
  IconBrandLinkedin,
  IconBuildingFactory2,
  IconRefresh,
  IconSend
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
  created_at: string;
};

type Company = { id: string; company_name: string };

type Bucket = "pending" | "manual_review" | "enriched" | "discarded";

const BUCKET_LABELS: Record<Bucket, string> = {
  pending: "Pendientes",
  manual_review: "Revisión manual",
  enriched: "En campaña",
  discarded: "Descartados"
};

export default function ContactosPage() {
  const [bucket, setBucket] = useState<Bucket>("pending");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [counts, setCounts] = useState<Record<Bucket, number>>({
    pending: 0,
    manual_review: 0,
    enriched: 0,
    discarded: 0
  });
  const [approvedCompanies, setApprovedCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushingId, setPushingId] = useState<string | null>(null);
  const [bulkPushing, setBulkPushing] = useState(false);
  const [pushNotice, setPushNotice] = useState<string | null>(null);

  async function load(forBucket: Bucket = bucket) {
    setLoading(true);
    const res = await fetch(`/api/contacts?bucket=${forBucket}`, { cache: "no-store" });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Load failed");
      return;
    }
    setContacts(data.contacts ?? []);
    if (data.counts) setCounts(data.counts);
  }

  async function pushOne(contactId: string) {
    setPushingId(contactId);
    setPushNotice(null);
    setError(null);
    const res = await fetch("/api/clay/push-contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact_id: contactId })
    });
    const data = await res.json();
    setPushingId(null);
    if (!res.ok) {
      setError(data.error ?? "Push failed");
      return;
    }
    setPushNotice("Contacto empujado a Clay.");
    await load();
  }

  async function pushAllPending() {
    setBulkPushing(true);
    setPushNotice(null);
    setError(null);
    const res = await fetch("/api/clay/push-contacts", { method: "POST" });
    const data = await res.json();
    setBulkPushing(false);
    if (!res.ok) {
      setError(data.error ?? "Bulk push failed");
      return;
    }
    const errs = (data.errors ?? []) as { error: string }[];
    const total = data.total ?? 0;
    const pushed = data.pushed ?? 0;
    setPushNotice(
      `${pushed} de ${total} contactos empujados a Clay${errs.length > 0 ? ` · ${errs.length} con error` : ""}.`
    );
    await load();
  }

  async function loadApprovedCompanies() {
    const res = await fetch("/api/companies?status=approved", { cache: "no-store" });
    const data = await res.json();
    if (res.ok) {
      setApprovedCompanies(
        (data.companies ?? []).map((c: any) => ({ id: c.id, company_name: c.company_name }))
      );
    }
  }

  useEffect(() => {
    load(bucket);
  }, [bucket]);

  useEffect(() => {
    loadApprovedCompanies();
  }, []);

  const pushablePendingCount = useMemo(() => {
    if (bucket !== "pending") return 0;
    return contacts.filter(
      (c) => c.prefilter_result === "yes" && !c.clay_pushed_at
    ).length;
  }, [contacts, bucket]);

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

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <div className="label">Prospección</div>
          <h1 className="text-2xl font-semibold tracking-tight">Contactos</h1>
          <div className="text-sm text-ink-muted mt-1">
            Decisores de cada empresa aprobada. El pre-filter Claude descarta roles no decisores
            antes de mandarlos a Clay.
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
          onDone={() => {
            setImportOpen(false);
            load();
          }}
        />
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          {(["pending", "manual_review", "enriched", "discarded"] as const).map((b) => {
            const active = bucket === b;
            return (
              <button
                key={b}
                onClick={() => setBucket(b)}
                className={`btn ${
                  active
                    ? "bg-brand text-white"
                    : "bg-white border border-[#E5E2F0] text-ink hover:border-brand-soft"
                }`}
              >
                {BUCKET_LABELS[b]}
                <span
                  className={`ml-2 inline-flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-full text-[11px] font-semibold ${
                    active ? "bg-white/20 text-white" : "bg-[#F1EEF7] text-ink-muted"
                  }`}
                >
                  {counts[b]}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          {bucket === "pending" && pushablePendingCount > 0 && (
            <button
              onClick={pushAllPending}
              disabled={bulkPushing}
              className="btn-primary"
              title="Empuja a Clay todos los contactos pre-filter YES que aún no fueron enviados"
            >
              <IconSend size={14} />
              {bulkPushing
                ? "Empujando…"
                : `Prospectar todos en Clay (${pushablePendingCount})`}
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

      {pushNotice && (
        <div className="card border border-success-bg text-success-fg flex items-center gap-2">
          <IconCheck size={16} /> {pushNotice}
        </div>
      )}

      {loading ? (
        <div className="text-ink-muted">Cargando…</div>
      ) : grouped.length === 0 ? (
        <EmptyState bucket={bucket} hasApproved={approvedCompanies.length > 0} />
      ) : (
        <div className="space-y-6">
          {grouped.map(([companyId, items]) => (
            <section key={companyId} className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-ink-muted">
                <IconBuildingFactory2 size={14} />
                <span className="font-medium text-ink">
                  {companyNameById.get(companyId) ?? "Empresa"}
                </span>
                <span>· {items.length} contactos</span>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {items.map((c) => (
                  <ContactCard
                    key={c.id}
                    c={c}
                    onPush={pushOne}
                    isPushing={pushingId === c.id}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
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
          <div className="text-sm mt-1">
            Aprueba al menos una empresa en la pantalla de Empresas antes de importar contactos.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="card text-ink-muted flex items-center gap-2">
      <IconUsers size={18} />
      No hay contactos en {BUCKET_LABELS[bucket].toLowerCase()}. Usa "Importar contactos" arriba
      para cargar los resultados de Clay.
    </div>
  );
}

function ContactCard({
  c,
  onPush,
  isPushing
}: {
  c: Contact;
  onPush: (id: string) => void | Promise<void>;
  isPushing: boolean;
}) {
  const fullName = [c.first_name, c.last_name].filter(Boolean).join(" ") || "(sin nombre)";
  const scoreClass =
    c.fit_score === null
      ? "bg-[#F1EEF7] text-ink-muted"
      : c.fit_score >= 8
      ? "bg-success-bg text-success-fg"
      : c.fit_score >= 5
      ? "bg-warning-bg text-warning-fg"
      : "bg-danger-bg text-danger-fg";
  const canPush = c.prefilter_result === "yes" && !c.clay_pushed_at;
  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold truncate">{fullName}</h3>
            {c.prefilter_result === "yes" && (
              <span className="badge bg-success-bg text-success-fg">pre-filter ✓</span>
            )}
            {c.prefilter_result === "no" && (
              <span className="badge bg-danger-bg text-danger-fg">pre-filter ✗</span>
            )}
            {c.clay_pushed_at && (
              <span className="badge bg-success-bg text-success-fg">en Clay ✓</span>
            )}
            {c.fit_score !== null && (
              <span className={`badge ${scoreClass}`}>score {c.fit_score}/10</span>
            )}
          </div>
          <div className="text-xs text-ink-muted mt-1">
            {c.job_title ?? "(sin cargo)"}
            {c.seniority ? ` · ${c.seniority}` : ""}
          </div>
        </div>
        {c.linkedin_url && (
          <a
            href={c.linkedin_url}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary shrink-0"
            title="LinkedIn"
          >
            <IconBrandLinkedin size={14} />
          </a>
        )}
      </div>

      {c.linkedin_headline && (
        <div className="text-sm text-ink/90">{c.linkedin_headline}</div>
      )}

      {(c.email || c.phone) && (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="label mb-1">Email</div>
            <div className="truncate">{c.email || <span className="text-ink-subtle">—</span>}</div>
          </div>
          <div>
            <div className="label mb-1">Teléfono</div>
            <div>{c.phone || <span className="text-ink-subtle">—</span>}</div>
          </div>
        </div>
      )}

      {c.fit_reason && (
        <div>
          <div className="label mb-1">Razón IA</div>
          <p className="text-sm text-ink/90">{c.fit_reason}</p>
        </div>
      )}

      {c.linkedin_icebreaker && (
        <details className="text-xs text-ink-muted">
          <summary className="cursor-pointer hover:text-ink">Icebreaker LinkedIn</summary>
          <p className="mt-2 text-ink/90 text-sm">{c.linkedin_icebreaker}</p>
        </details>
      )}

      {c.email_subject && c.email_body && (
        <details className="text-xs text-ink-muted">
          <summary className="cursor-pointer hover:text-ink">Email generado</summary>
          <div className="mt-2 text-sm">
            <div className="font-medium">{c.email_subject}</div>
            <p className="text-ink/90 whitespace-pre-line mt-1">{c.email_body}</p>
          </div>
        </details>
      )}

      {c.clay_push_error && (
        <div className="text-xs text-danger-fg flex items-start gap-2">
          <IconAlertCircle size={14} className="shrink-0 mt-0.5" />
          <span className="break-words">{c.clay_push_error}</span>
        </div>
      )}

      {canPush && (
        <div className="flex justify-end">
          <button
            onClick={() => onPush(c.id)}
            disabled={isPushing}
            className="btn-primary text-xs"
          >
            <IconSend size={12} />
            {isPushing ? "Empujando…" : "Prospectar en Clay"}
          </button>
        </div>
      )}
    </div>
  );
}

function ImportPanel({
  companies,
  onClose,
  onDone
}: {
  companies: Company[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [json, setJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ inserted: number; yes: number; no: number; skipped: number } | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      setBusy(false);
      setError("El JSON no es válido. Debe ser un array de objetos de contacto.");
      return;
    }
    const arr = Array.isArray(parsed) ? parsed : (parsed as any)?.contacts;
    if (!Array.isArray(arr)) {
      setBusy(false);
      setError("Debe ser un array o un objeto con la clave 'contacts'.");
      return;
    }
    const res = await fetch("/api/contacts/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: companyId, contacts: arr })
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Import failed");
      return;
    }
    setResult(data);
  }

  return (
    <section className="card space-y-3 border-2 border-brand-soft">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2">
          <IconUpload size={16} /> Importar contactos desde Clay
        </h2>
        <button className="btn-secondary text-xs" onClick={onClose}>
          Cerrar
        </button>
      </div>

      {companies.length === 0 ? (
        <div className="text-sm text-ink-muted">
          No hay empresas aprobadas todavía. Aprueba alguna primero en la pantalla de Empresas.
        </div>
      ) : (
        <>
          <div>
            <div className="label mb-1">Empresa aprobada</div>
            <select
              className="input"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="label mb-1">JSON de contactos (de Clay "Find people at company")</div>
            <textarea
              className="input min-h-[180px] font-mono text-xs"
              placeholder='[{"first_name":"Tom","last_name":"Wiand","job_title":"Owner","linkedin_url":"https://...","linkedin_headline":"...","email":"tom@wiand.com"}]'
              value={json}
              onChange={(e) => setJson(e.target.value)}
            />
            <div className="text-xs text-ink-muted mt-1">
              Acepta array directo o un objeto con la clave <code>contacts</code>. Campos
              soportados: first_name, last_name, job_title, linkedin_url, linkedin_headline,
              email, phone, seniority, tenure.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={run} disabled={busy || !companyId || !json.trim()} className="btn-primary">
              <IconUpload size={14} /> {busy ? "Procesando…" : "Procesar (corre pre-filter)"}
            </button>
            {result && (
              <button onClick={onDone} className="btn-secondary">
                <IconCheck size={14} /> Listo, ver contactos
              </button>
            )}
          </div>
          {error && (
            <div className="text-sm text-danger-fg flex items-center gap-2">
              <IconAlertCircle size={14} /> {error}
            </div>
          )}
          {result && (
            <div className="text-sm text-success-fg flex flex-wrap items-center gap-3">
              <IconCheck size={14} />
              <span>{result.inserted} insertados</span>
              <span>· {result.yes} pre-filter YES</span>
              <span>· {result.no} pre-filter NO</span>
              {result.skipped > 0 && <span>· {result.skipped} duplicados omitidos</span>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
