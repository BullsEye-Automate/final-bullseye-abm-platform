"use client";

import { useCallback, useEffect, useState } from "react";
import {
  IconAlertCircle,
  IconBrandLinkedin,
  IconCheck,
  IconChevronDown,
  IconExternalLink,
  IconLoader2,
  IconRefresh,
  IconSearch,
  IconUserPlus,
  IconX,
} from "@tabler/icons-react";
import { useClient, ALL_CLIENTS } from "@/lib/clientContext";
import type { ManualCompany, ManualStatus } from "@/lib/manualProspecting";

// Búsqueda manual: empresas aprobadas donde la búsqueda automática encontró
// pocos contactos fit. Ordenadas por prioridad (fit de la empresa y tiempo
// en cola) para que el prospector vaya directo a LinkedIn / Sales Navigator
// y sume los contactos a mano.

const STATUS_LABEL: Record<ManualStatus, string> = {
  pending: "Por trabajar",
  in_progress: "En curso",
  done: "Terminada",
  no_contacts: "Sin contactos posibles",
};

const daysSince = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : null);

// Links de LinkedIn para prospectar la empresa
function linkedinLinks(c: ManualCompany) {
  const q = encodeURIComponent(c.company_name);
  const companyPage = c.linkedin_url ? c.linkedin_url.replace(/\/+$/, "") : null;
  return [
    companyPage && { label: "Empleados en LinkedIn", href: `${companyPage}/people/` },
    { label: "Sales Navigator", href: `https://www.linkedin.com/sales/search/people?keywords=${q}` },
    { label: "Buscar personas", href: `https://www.linkedin.com/search/results/people/?keywords=${q}` },
  ].filter(Boolean) as { label: string; href: string }[];
}

export default function BusquedaManualPage() {
  const { currentClient } = useClient();
  const clientId = currentClient && currentClient.id !== ALL_CLIENTS.id ? currentClient.id : null;
  const [view, setView] = useState<"open" | "closed">("open");
  const [items, setItems] = useState<ManualCompany[] | null>(null);
  const [fewContacts, setFewContacts] = useState(2);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentClient) return;
    setError(null);
    const r = await fetch(`/api/busqueda-manual?client_id=${clientId ?? "__all__"}&view=${view}`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setError(j.error ?? "Error al cargar");
    setItems(j.items);
    setFewContacts(j.few_contacts ?? 2);
  }, [currentClient, clientId, view]);

  useEffect(() => {
    setItems(null);
    load();
  }, [load]);

  async function setStatus(id: string, manual_status: ManualStatus) {
    const r = await fetch("/api/busqueda-manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "status", wishlist_id: id, manual_status }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setError(j.error ?? "No se pudo actualizar");
    load();
  }

  const q = query.trim().toLowerCase();
  const visible = (items ?? []).filter((c) => !q || c.company_name.toLowerCase().includes(q) || c.client_name.toLowerCase().includes(q));

  return (
    <div className="space-y-5 max-w-5xl">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label">Prospección</div>
          <h1 className="text-2xl font-semibold tracking-tight">Búsqueda manual</h1>
          <p className="text-sm text-ink-muted mt-1 max-w-2xl">
            Empresas aprobadas donde la búsqueda automática encontró menos de {fewContacts} contactos fit
            {clientId ? ` (${currentClient?.name})` : " (todos los clientes)"}. Están ordenadas por prioridad: búscalas en LinkedIn y agrega los contactos aquí.
          </p>
        </div>
        <button onClick={load} className="btn-secondary py-1.5 px-2.5" title="Actualizar">
          <IconRefresh size={16} />
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-sm bg-white">
          {([["open", "Por trabajar"], ["closed", "Cerradas"]] as const).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setView(k)}
              className="px-4 py-1.5"
              style={view === k ? { background: "#251762", color: "#fff" } : { color: "#6B6884" }}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="relative">
          <IconSearch size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar empresa o cliente…"
            className="pl-8 pr-3 py-1.5 text-sm rounded-lg border border-gray-200 outline-none focus:border-brand-soft"
          />
        </div>
        {items && <span className="text-sm text-ink-muted">{visible.length} empresas</span>}
      </div>

      {error && (
        <div className="card flex items-center gap-2 text-sm text-danger-fg bg-danger-bg">
          <IconAlertCircle size={16} className="shrink-0" /> {error}
        </div>
      )}
      {!items && !error && <IconLoader2 className="animate-spin text-ink-muted" />}
      {items && visible.length === 0 && (
        <div className="card text-sm text-ink-muted text-center py-10">
          {view === "open" ? "No hay empresas pendientes de búsqueda manual. 🎯" : "Aún no hay empresas cerradas."}
        </div>
      )}

      <div className="space-y-2">
        {visible.map((c, i) => (
          <CompanyRow
            key={c.id}
            rank={view === "open" ? i + 1 : null}
            company={c}
            showClient={!clientId}
            fewContacts={fewContacts}
            open={openId === c.id}
            onToggle={() => setOpenId(openId === c.id ? null : c.id)}
            onStatus={(s) => setStatus(c.id, s)}
            onChanged={load}
          />
        ))}
      </div>
    </div>
  );
}

function CompanyRow({
  rank,
  company: c,
  showClient,
  fewContacts,
  open,
  onToggle,
  onStatus,
  onChanged,
}: {
  rank: number | null;
  company: ManualCompany;
  showClient: boolean;
  fewContacts: number;
  open: boolean;
  onToggle: () => void;
  onStatus: (s: ManualStatus) => void;
  onChanged: () => void;
}) {
  const waiting = daysSince(c.contacts_searched_at);
  const manual = c.contacts.filter((x) => x.origin === "manual").length;
  const total = c.contacts.length;
  const enough = total >= fewContacts;

  return (
    <div className="card p-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        {rank != null && (
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0" style={{ background: "#EEEDFE", color: "#251762" }}>
            {rank}
          </div>
        )}
        <button onClick={onToggle} className="flex-1 min-w-[200px] text-left">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{c.company_name}</span>
            {c.fit_score != null && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-success-bg text-success-fg">fit {c.fit_score}%</span>
            )}
            <IconChevronDown size={14} className="text-ink-subtle transition-transform" style={{ transform: open ? "rotate(180deg)" : undefined }} />
          </div>
          <div className="text-xs text-ink-muted mt-0.5">
            {showClient && <span className="font-medium text-ink">{c.client_name} · </span>}
            {c.domain ?? "sin dominio"} · {c.contacts_found} automáticos · {manual} manuales
            {waiting != null && ` · en cola hace ${waiting} d`}
          </div>
        </button>

        <span
          className="text-[11px] px-2 py-0.5 rounded-full"
          style={enough ? { background: "#E1F5EE", color: "#0F6E56" } : { background: "#FAEEDA", color: "#854F0B" }}
        >
          {total} contacto{total === 1 ? "" : "s"}
        </span>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-ink-muted">{STATUS_LABEL[c.manual_status]}</span>

        <div className="flex gap-1.5">
          {linkedinLinks(c).slice(0, 2).map((l) => (
            <a
              key={l.label}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-white"
              style={{ background: "#0A66C2" }}
            >
              <IconBrandLinkedin size={14} /> {l.label}
            </a>
          ))}
        </div>
      </div>

      {open && (
        <div className="border-t border-gray-100 px-4 py-4 bg-[#FAFAFD] space-y-4">
          {(c.fit_reason || c.facts.length > 0) && (
            <div className="text-xs text-ink-muted space-y-1">
              {c.fit_reason && <p>{c.fit_reason}</p>}
              {c.facts.length > 0 && <p>{c.facts.map((f) => `${f.label}: ${f.value}`).join(" · ")}</p>}
            </div>
          )}

          <div className="flex flex-wrap gap-2 text-xs">
            {linkedinLinks(c).map((l) => (
              <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#0A66C2] hover:underline">
                <IconExternalLink size={12} /> {l.label}
              </a>
            ))}
            {c.domain && (
              <a href={`https://${c.domain}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-ink-muted hover:underline">
                <IconExternalLink size={12} /> {c.domain}
              </a>
            )}
          </div>

          <div>
            <div className="label mb-1.5">Contactos de la empresa</div>
            {c.contacts.length === 0 ? (
              <p className="text-xs text-ink-muted">Todavía no hay contactos.</p>
            ) : (
              <div className="divide-y divide-gray-100 bg-white rounded-lg border border-gray-100">
                {c.contacts.map((x) => (
                  <div key={x.id} className="px-3 py-2 flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{x.full_name}</span>
                    <span className="text-xs text-ink-muted">{x.title ?? ""}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-ink-muted">
                      {x.origin === "manual" ? "manual" : "automático"} · {x.status === "approved" ? "aprobado" : "sugerido"}
                    </span>
                    {x.linkedin_url && (
                      <a href={x.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-[#0A66C2]">
                        <IconBrandLinkedin size={14} />
                      </a>
                    )}
                    {(x.lemlist_error || x.hubspot_error) && (
                      <span className="text-[11px] text-danger-fg w-full">{[x.lemlist_error, x.hubspot_error].filter(Boolean).join(" · ")}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <AddContactForm wishlistId={c.id} onAdded={onChanged} />

          <div className="flex flex-wrap gap-2 pt-1">
            {c.manual_status !== "done" && (
              <button onClick={() => onStatus("done")} className="btn-primary py-1.5 text-sm flex items-center gap-1.5">
                <IconCheck size={15} /> Marcar terminada
              </button>
            )}
            {c.manual_status !== "no_contacts" && (
              <button onClick={() => onStatus("no_contacts")} className="btn-secondary py-1.5 text-sm flex items-center gap-1.5">
                <IconX size={15} /> Sin contactos posibles
              </button>
            )}
            {(c.manual_status === "done" || c.manual_status === "no_contacts") && (
              <button onClick={() => onStatus("pending")} className="btn-secondary py-1.5 text-sm">
                Volver a la cola
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const EMPTY_FORM = { full_name: "", title: "", linkedin_url: "", email: "", phone: "" };

function AddContactForm({ wishlistId, onAdded }: { wishlistId: string; onAdded: () => void }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/busqueda-manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add_contact", wishlist_id: wishlistId, ...form }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: j.error ?? "No se pudo agregar" });
    setForm(EMPTY_FORM);
    setMsg(
      j.error
        ? { ok: false, text: `Contacto guardado, pero: ${j.error}` }
        : { ok: true, text: "Contacto agregado: se envió a Lemlist y HubSpot y se pidió email + teléfono." }
    );
    onAdded();
  }

  const field = (k: keyof typeof EMPTY_FORM, placeholder: string, required = false) => (
    <input
      value={form[k]}
      onChange={(e) => setForm({ ...form, [k]: e.target.value })}
      placeholder={placeholder}
      required={required}
      className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 outline-none focus:border-brand-soft bg-white"
    />
  );

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="label">Agregar contacto encontrado en LinkedIn</div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {field("linkedin_url", "URL de LinkedIn")}
        {field("full_name", "Nombre y apellido *", true)}
        {field("title", "Cargo")}
        {field("email", "Email (opcional)")}
        {field("phone", "Teléfono (opcional)")}
        <button type="submit" disabled={busy} className="btn-primary py-1.5 text-sm flex items-center justify-center gap-1.5">
          {busy ? <IconLoader2 size={15} className="animate-spin" /> : <IconUserPlus size={15} />} Agregar
        </button>
      </div>
      {msg && <p className={`text-xs ${msg.ok ? "text-success-fg" : "text-danger-fg"}`}>{msg.text}</p>}
    </form>
  );
}
