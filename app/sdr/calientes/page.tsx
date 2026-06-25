"use client";

import { useEffect, useState, useCallback } from "react";
import { useClient } from "@/lib/clientContext";
import {
  IconFlame, IconMail, IconMailOpened, IconClick, IconMessageReply,
  IconBrandLinkedin, IconUserCheck, IconEye, IconPhone, IconCopy,
  IconCheck, IconX, IconChevronDown, IconChevronUp, IconExternalLink,
  IconRefresh, IconSearch, IconFilter, IconCalendar, IconAlertCircle,
} from "@tabler/icons-react";

// ── Tipos ─────────────────────────────────────────────────────────────────────

type Activity = {
  type: string;
  score: number;
  label: string;
  color: string;
  createdAt: string | null;
  activityId: string | null;
  text: string | null;
};

type Messages = {
  email1:           { subject: string | null; body: string | null };
  email2:           { subject: string | null; body: string | null };
  email3:           { subject: string | null; body: string | null };
  linkedin_connect: string | null;
  linkedin_msg1:    string | null;
  linkedin_msg2:    string | null;
};

type Contact = {
  email: string;
  contact_id: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  company_name: string | null;
  phone: string | null;
  linkedin_url: string | null;
  hubspot_contact_id: string | null;
  total_score: number;
  activities: Activity[];
  messages: Messages | null;
  sdr_label: string | null;
  status: string | null;
};

// ── Constantes de etiquetas ───────────────────────────────────────────────────

const SDR_LABELS: { key: string; label: string; color: string; bg: string; border: string }[] = [
  { key: "reunion_agendada",  label: "Reunión agendada",  color: "#16a34a", bg: "#f0fdf4", border: "#86efac" },
  { key: "no_interesado",     label: "No interesado",     color: "#dc2626", bg: "#fef2f2", border: "#fca5a5" },
  { key: "sin_respuesta",     label: "Sin respuesta",     color: "#6b7280", bg: "#f9fafb", border: "#d1d5db" },
  { key: "numero_incorrecto", label: "Número incorrecto", color: "#d97706", bg: "#fffbeb", border: "#fcd34d" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const ACTIVITY_META: Record<string, { icon: any; shortLabel: string }> = {
  emailsReplied:          { icon: IconMessageReply,  shortLabel: "Respondió email" },
  linkedinReplied:        { icon: IconBrandLinkedin, shortLabel: "Respondió LinkedIn" },
  linkedinInviteAccepted: { icon: IconUserCheck,     shortLabel: "Aceptó conexión" },
  emailsClicked:          { icon: IconClick,         shortLabel: "Clic en email" },
  linkedinVisited:        { icon: IconEye,           shortLabel: "Vio perfil" },
  emailsOpened:           { icon: IconMailOpened,    shortLabel: "Abrió email" },
};

function scoreColor(score: number) {
  if (score >= 20) return { bg: "#dcfce7", border: "#86efac", text: "#16a34a", badge: "#22c55e" };
  if (score >= 12) return { bg: "#fff7ed", border: "#fdba74", text: "#c2410c", badge: "#f97316" };
  if (score >= 6)  return { bg: "#fefce8", border: "#fde047", text: "#a16207", badge: "#eab308" };
  return             { bg: "#f9fafb", border: "#e5e7eb", text: "#6b7280", badge: "#9ca3af" };
}

function scoreLabel(score: number) {
  if (score >= 20) return "🔥 Muy caliente";
  if (score >= 12) return "⚡ Caliente";
  if (score >= 6)  return "📈 Tibio";
  return "📧 Con actividad";
}

function relativeTime(dt: string | null) {
  if (!dt) return null;
  const diff = Date.now() - new Date(dt).getTime();
  const days  = Math.floor(diff / 86400000);
  const hours = Math.floor(diff / 3600000);
  const mins  = Math.floor(diff / 60000);
  if (days > 30) return `hace ${Math.floor(days / 30)}m`;
  if (days > 0)  return `hace ${days}d`;
  if (hours > 0) return `hace ${hours}h`;
  if (mins > 0)  return `hace ${mins}min`;
  return "justo ahora";
}

// Deduplica actividades del mismo tipo para mostrar "× N"
function dedupeActivities(activities: Activity[]) {
  const map = new Map<string, { activity: Activity; count: number }>();
  for (const act of activities) {
    const existing = map.get(act.type);
    if (existing) {
      existing.count++;
      // Mantener el más reciente
      if ((act.createdAt ?? "") > (existing.activity.createdAt ?? "")) {
        existing.activity = act;
      }
    } else {
      map.set(act.type, { activity: act, count: 1 });
    }
  }
  // Ordenar por score desc
  return Array.from(map.values()).sort((a, b) => b.activity.score - a.activity.score);
}

// ── Componente: LabelSelector ─────────────────────────────────────────────────

function LabelSelector({
  contactId, clientId, current, onChange,
}: {
  contactId: string; clientId: string; current: string | null; onChange: (l: string | null) => void;
}) {
  const [open, setOpen]   = useState(false);
  const [saving, setSaving] = useState(false);

  async function select(key: string | null) {
    setSaving(true);
    setOpen(false);
    await fetch("/api/sdr-labels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact_id: contactId, client_id: clientId, label: key }),
    });
    onChange(key);
    setSaving(false);
  }

  const currentMeta = SDR_LABELS.find(l => l.key === current);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        disabled={saving}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition disabled:opacity-50"
        style={currentMeta
          ? { background: currentMeta.bg, borderColor: currentMeta.border, color: currentMeta.color }
          : { background: "#f9fafb", borderColor: "#e5e7eb", color: "#6b7280" }}>
        {saving ? "…" : (currentMeta?.label ?? "Etiquetar")}
        <IconChevronDown size={11} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[180px]">
          {current && (
            <button onClick={() => select(null)}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-400 hover:bg-gray-50">
              <IconX size={12} /> Quitar etiqueta
            </button>
          )}
          {SDR_LABELS.map(l => (
            <button key={l.key} onClick={() => select(l.key)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-gray-50 transition"
              style={{ color: l.color }}>
              <span>{l.label}</span>
              {current === l.key && <IconCheck size={12} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Componente: MessagesPanel ─────────────────────────────────────────────────

function MessagesPanel({ messages }: { messages: Messages }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const sections = [
    { key: "email1",    label: "Email 1",              body: messages.email1.body,    subject: messages.email1.subject },
    { key: "email2",    label: "Email 2",              body: messages.email2.body,    subject: messages.email2.subject },
    { key: "email3",    label: "Email 3",              body: messages.email3.body,    subject: messages.email3.subject },
    { key: "lincon",    label: "Invitación LinkedIn",  body: messages.linkedin_connect },
    { key: "linmsg1",   label: "Mensaje LinkedIn 1",   body: messages.linkedin_msg1 },
    { key: "linmsg2",   label: "Mensaje LinkedIn 2",   body: messages.linkedin_msg2 },
  ].filter(s => s.body);

  if (sections.length === 0) return null;

  function copyText(key: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition font-medium">
        {open ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}
        {open ? "Ocultar mensajes enviados" : `Ver ${sections.length} mensaje${sections.length > 1 ? "s" : ""} enviado${sections.length > 1 ? "s" : ""}`}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {sections.map(s => (
            <div key={s.key} className="bg-gray-50 rounded-xl p-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">{s.label}</span>
                <button onClick={() => copyText(s.key, s.body!)}
                  className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 transition">
                  {copied === s.key ? <IconCheck size={11} className="text-green-500" /> : <IconCopy size={11} />}
                  {copied === s.key ? "Copiado" : "Copiar"}
                </button>
              </div>
              {"subject" in s && s.subject && (
                <p className="text-xs font-medium text-gray-700 mb-1">Asunto: {s.subject}</p>
              )}
              <p className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Componente: ContactCard ───────────────────────────────────────────────────

function ContactCard({
  contact, clientId, onLabelChange,
}: {
  contact: Contact; clientId: string; onLabelChange: (id: string, label: string | null) => void;
}) {
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);
  const colors  = scoreColor(contact.total_score);
  const dedupe  = dedupeActivities(contact.activities);
  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || contact.email;

  function copyPhone() {
    if (!contact.phone) return;
    navigator.clipboard.writeText(contact.phone);
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 1500);
  }

  function copyEmail() {
    navigator.clipboard.writeText(contact.email);
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 1500);
  }

  const hubspotUrl = contact.hubspot_contact_id
    ? `https://app.hubspot.com/contacts/search?query=${encodeURIComponent(contact.email)}`
    : `https://app.hubspot.com/contacts/search?query=${encodeURIComponent(contact.email)}`;

  return (
    <div className="bg-white rounded-2xl border-2 shadow-sm p-5 transition hover:shadow-md"
      style={{ borderColor: colors.border }}>

      {/* Fila superior: score + info + acciones */}
      <div className="flex items-start gap-4">
        {/* Badge de puntaje */}
        <div className="shrink-0 flex flex-col items-center gap-0.5">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-lg text-white"
            style={{ background: colors.badge }}>
            {contact.total_score}
          </div>
          <span className="text-[10px] font-medium" style={{ color: colors.text }}>pts</span>
        </div>

        {/* Info principal */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <h3 className="font-semibold text-gray-900 text-sm leading-tight">{fullName}</h3>
              {(contact.job_title || contact.company_name) && (
                <p className="text-xs text-gray-500 mt-0.5">
                  {[contact.job_title, contact.company_name].filter(Boolean).join(" · ")}
                </p>
              )}
              <span className="inline-block mt-1 text-[10px] font-medium px-2 py-0.5 rounded-full"
                style={{ background: colors.bg, color: colors.text }}>
                {scoreLabel(contact.total_score)}
              </span>
            </div>

            {/* Botones de acción */}
            <div className="flex items-center gap-2 shrink-0">
              <a href={hubspotUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white transition hover:opacity-90"
                style={{ background: "#ff7a59" }}
                title="Abrir en HubSpot">
                <IconExternalLink size={12} /> HubSpot
              </a>
            </div>
          </div>

          {/* Datos de contacto */}
          <div className="flex flex-wrap gap-2 mt-2.5">
            <button onClick={copyEmail}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border border-gray-200 bg-gray-50 hover:bg-gray-100 transition text-gray-600">
              {copiedEmail ? <IconCheck size={11} className="text-green-500" /> : <IconMail size={11} />}
              <span className="truncate max-w-[180px]">{contact.email}</span>
            </button>
            {contact.phone ? (
              <button onClick={copyPhone}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border border-gray-200 bg-gray-50 hover:bg-gray-100 transition text-gray-600">
                {copiedPhone ? <IconCheck size={11} className="text-green-500" /> : <IconPhone size={11} />}
                {contact.phone}
              </button>
            ) : (
              <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs border border-dashed border-gray-200 text-gray-400">
                <IconPhone size={11} /> Sin teléfono
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Actividad */}
      <div className="mt-4 pt-3 border-t border-gray-100">
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Actividad detectada</p>
        <div className="flex flex-wrap gap-2">
          {dedupe.map(({ activity: act, count }) => {
            const meta = ACTIVITY_META[act.type];
            const Icon = meta?.icon ?? IconMail;
            return (
              <div key={act.type}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium border"
                style={{ background: act.color + "12", borderColor: act.color + "40", color: act.color }}>
                <Icon size={12} />
                {count > 1 ? `${meta?.shortLabel ?? act.label} × ${count}` : (meta?.shortLabel ?? act.label)}
                {act.createdAt && (
                  <span className="opacity-60 ml-0.5">· {relativeTime(act.createdAt)}</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Texto de la respuesta si existe */}
        {contact.activities.find(a => a.text && (a.type === "emailsReplied" || a.type === "linkedinReplied")) && (
          <div className="mt-2.5 bg-green-50 border border-green-100 rounded-xl px-3 py-2">
            <p className="text-[11px] font-semibold text-green-700 mb-1">Respuesta recibida:</p>
            <p className="text-xs text-green-800 italic leading-relaxed">
              "{contact.activities.find(a => a.text && (a.type === "emailsReplied" || a.type === "linkedinReplied"))?.text}"
            </p>
          </div>
        )}
      </div>

      {/* Etiqueta + mensajes */}
      <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-gray-500">Gestión:</span>
          {contact.contact_id ? (
            <LabelSelector
              contactId={contact.contact_id}
              clientId={clientId}
              current={contact.sdr_label}
              onChange={(l) => onLabelChange(contact.contact_id!, l)}
            />
          ) : (
            <span className="text-[11px] text-gray-400 italic">Contacto no encontrado en plataforma</span>
          )}
        </div>
      </div>

      {/* Mensajes enviados */}
      {contact.messages && <MessagesPanel messages={contact.messages} />}
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────

const LABEL_FILTER_OPTS = [
  { key: "todos",           label: "Todos" },
  { key: "sin_etiqueta",    label: "Sin etiquetar" },
  { key: "reunion_agendada",  label: "Reunión agendada" },
  { key: "no_interesado",     label: "No interesado" },
  { key: "sin_respuesta",     label: "Sin respuesta" },
  { key: "numero_incorrecto", label: "Número incorrecto" },
];

const MIN_SCORE_OPTS = [
  { value: 0,  label: "Todos los puntajes" },
  { value: 6,  label: "Tibio o más (≥6)" },
  { value: 12, label: "Caliente o más (≥12)" },
  { value: 20, label: "Muy caliente (≥20)" },
];

export default function ContactosCalientesPage() {
  const { currentClient, loading: clientLoading } = useClient();
  const [contacts, setContacts]     = useState<Contact[]>([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");
  const [search, setSearch]         = useState("");
  const [labelFilter, setLabelFilter] = useState("todos");
  const [minScore, setMinScore]     = useState(0);

  const load = useCallback(async () => {
    if (clientLoading || !currentClient?.id || currentClient.id === "__all__") return;
    setLoading(true);
    setError("");
    const res = await fetch(`/api/lemlist/actividad?client_id=${currentClient.id}`);
    if (!res.ok) {
      const d = await res.json();
      setError(d.error ?? "Error al cargar datos");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setContacts(data.contacts ?? []);
    setLoading(false);
  }, [currentClient?.id, clientLoading]);

  useEffect(() => { load(); }, [load]);

  function handleLabelChange(contactId: string, label: string | null) {
    setContacts(prev => prev.map(c =>
      c.contact_id === contactId ? { ...c, sdr_label: label } : c
    ));
  }

  // Filtros
  const filtered = contacts.filter(c => {
    const q = search.toLowerCase();
    const matchSearch = !q
      || [c.first_name, c.last_name, c.company_name, c.email, c.job_title]
           .some(v => v?.toLowerCase().includes(q));
    const matchLabel = labelFilter === "todos"
      || (labelFilter === "sin_etiqueta" ? !c.sdr_label : c.sdr_label === labelFilter);
    const matchScore = c.total_score >= minScore;
    return matchSearch && matchLabel && matchScore;
  });

  // Stats
  const stats = {
    total:     contacts.length,
    calientes: contacts.filter(c => c.total_score >= 12).length,
    conResp:   contacts.filter(c => c.activities.some(a => a.type === "emailsReplied" || a.type === "linkedinReplied")).length,
    gestionados: contacts.filter(c => c.sdr_label).length,
  };

  const noClient = !clientLoading && (!currentClient?.id || currentClient.id === "__all__");

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <IconFlame size={22} className="text-orange-500" />
            <h1 className="text-2xl font-bold text-gray-900">Contactos calientes</h1>
          </div>
          <p className="text-sm text-gray-500">
            Leads priorizados por interacción con tus emails y LinkedIn. Gestiona el seguimiento directo desde aquí.
          </p>
        </div>
        <button onClick={load} disabled={loading || noClient}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition">
          <IconRefresh size={15} className={loading ? "animate-spin" : ""} />
          {loading ? "Cargando…" : "Actualizar"}
        </button>
      </div>

      {/* No client selected */}
      {noClient && (
        <div className="text-center py-20 text-gray-400">
          <IconFilter size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">Selecciona un cliente en el panel lateral</p>
          <p className="text-xs mt-1">Los contactos calientes se muestran por cliente</p>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl mb-5 flex items-center gap-2">
          <IconAlertCircle size={16} /> {error}
        </div>
      )}

      {/* Stats */}
      {!noClient && !loading && contacts.length > 0 && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label: "Con actividad",    value: stats.total,      color: "#251762", bg: "rgba(37,23,98,0.06)" },
            { label: "Calientes",        value: stats.calientes,  color: "#f97316", bg: "#fff7ed" },
            { label: "Con respuesta",    value: stats.conResp,    color: "#22c55e", bg: "#f0fdf4" },
            { label: "Gestionados",      value: stats.gestionados, color: "#6366f1", bg: "#eef2ff" },
          ].map(s => (
            <div key={s.label} className="rounded-2xl p-4" style={{ background: s.bg }}>
              <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
              <div className="text-xs mt-0.5" style={{ color: s.color, opacity: 0.7 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filtros */}
      {!noClient && !loading && contacts.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          <div className="flex-1 min-w-[200px] relative">
            <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nombre, empresa o email…"
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-[#62E0D8] bg-white" />
          </div>
          <select value={labelFilter} onChange={e => setLabelFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-[#62E0D8] bg-white text-gray-700">
            {LABEL_FILTER_OPTS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <select value={minScore} onChange={e => setMinScore(Number(e.target.value))}
            className="px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-[#62E0D8] bg-white text-gray-700">
            {MIN_SCORE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      )}

      {/* Resultados */}
      {!noClient && (
        <>
          {loading && (
            <div className="text-center py-20 text-gray-400">
              <IconFlame size={36} className="mx-auto mb-3 opacity-30 animate-pulse" />
              <p className="text-sm">Cargando actividad desde Lemlist…</p>
            </div>
          )}

          {!loading && contacts.length === 0 && !error && (
            <div className="text-center py-20 text-gray-400">
              <IconMailOpened size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">Sin actividad detectada aún</p>
              <p className="text-xs mt-1">Los contactos aparecerán aquí cuando abran emails, hagan clic o respondan</p>
            </div>
          )}

          {!loading && contacts.length > 0 && (
            <>
              {filtered.length === 0 ? (
                <div className="text-center py-16 text-gray-400 text-sm">
                  Sin resultados para esta búsqueda o filtro
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-xs text-gray-500 font-medium">
                    {filtered.length} contacto{filtered.length !== 1 ? "s" : ""} · ordenados por puntaje de interacción
                  </p>
                  {filtered.map(c => (
                    <ContactCard
                      key={c.email}
                      contact={c}
                      clientId={currentClient!.id}
                      onLabelChange={handleLabelChange}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
