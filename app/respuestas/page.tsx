"use client";

import { useCallback, useEffect, useState } from "react";
import {
  IconRefresh,
  IconAlertCircle,
  IconCheck,
  IconBrandLinkedin,
  IconMail,
  IconExternalLink,
  IconMessage2,
  IconSparkles,
  IconArrowBackUp
} from "@tabler/icons-react";

// Categorías de respuesta — mismas keys que lib/replyAnalyzer.ts (no se
// importa el lib server-side para no arrastrar el SDK de Anthropic al bundle).
const CATEGORY_LABELS: Record<string, string> = {
  interested: "Interesado",
  meeting_request: "Pide reunión",
  referral: "Deriva a otra persona",
  objection: "Objeción",
  not_interested: "No interesado",
  unsubscribe: "Pide baja",
  auto_reply: "Respuesta automática",
  question: "Pregunta",
  other: "Otro"
};
const POSITIVE = new Set(["interested", "meeting_request", "referral"]);
const NEGATIVE = new Set(["not_interested", "unsubscribe"]);

function categoryTone(cat: string | null): string {
  if (!cat) return "bg-[#F1EEF7] text-ink-muted";
  if (POSITIVE.has(cat)) return "bg-success-bg text-success-fg";
  if (NEGATIVE.has(cat)) return "bg-danger-bg text-danger-fg";
  if (cat === "objection" || cat === "question") return "bg-warning-bg text-warning-fg";
  return "bg-[#F1EEF7] text-ink-muted";
}

type ReplyContact = {
  id?: string;
  name: string | null;
  job_title?: string | null;
  email?: string | null;
  linkedin_url?: string | null;
  company_name?: string | null;
  fit_score?: number | null;
  status?: string | null;
  human_decision?: string | null;
  hubspot_contact_id?: string | null;
};

type Reply = {
  id: string;
  contact_id: string | null;
  channel: string | null;
  type: string;
  activity_at: string | null;
  reply_text: string | null;
  reply_category: string | null;
  reply_sentiment: string | null;
  reply_summary: string | null;
  reply_suggested_step: string | null;
  reply_analyzed_at: string | null;
  reply_analysis_error: string | null;
  reply_triage: string | null;
  reply_handled_at: string | null;
  effective_category: string | null;
  handled: boolean;
  contact: ReplyContact;
};

type Kpis = {
  total: number;
  linkedin: number;
  email: number;
  positive: number;
  needs_attention: number;
  with_text: number;
  analyzed: number;
  contacts_replied: number;
};

const CHANNELS = [
  { key: "all", label: "Todos" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "email", label: "Email" }
] as const;

const STATUSES = [
  { key: "all", label: "Todas" },
  { key: "pending", label: "Sin atender" },
  { key: "handled", label: "Atendidas" }
] as const;

export default function RespuestasPage() {
  const [channel, setChannel] = useState("all");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("pending");
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch(
      `/api/respuestas?channel=${channel}&category=${category}&status=${status}`,
      { cache: "no-store" }
    );
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "No se pudieron cargar las respuestas");
      return;
    }
    setKpis(data.kpis);
    setReplies(data.replies ?? []);
  }, [channel, category, status]);

  useEffect(() => {
    load();
  }, [load]);

  async function sync() {
    setSyncing(true);
    setError(null);
    setNotice(null);
    const res = await fetch("/api/respuestas/sync", { method: "POST" });
    const data = await res.json();
    setSyncing(false);
    if (!res.ok) {
      setError(
        data.error ??
          `La sincronización falló${data.stage ? ` (etapa: ${data.stage})` : ""}`
      );
      return;
    }
    const a = data.activities;
    const r = data.replies;
    setNotice(
      `Sincronizado: ${a.fetched} actividades de Lemlist · ${r.reply_activities} respuestas · ` +
        `${r.text_extracted} con texto · ${r.analyzed} clasificadas con IA` +
        (r.errors > 0 ? ` · ${r.errors} errores` : "")
    );
    await load();
  }

  async function triage(id: string, patch: { triage?: string | null; handled?: boolean }) {
    const res = await fetch(`/api/respuestas/${id}/triage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "No se pudo actualizar la respuesta");
      return;
    }
    setReplies((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r };
        if ("triage" in patch) {
          next.reply_triage = patch.triage ?? null;
          next.effective_category = patch.triage ?? r.reply_category ?? null;
        }
        if ("handled" in patch) {
          next.handled = !!patch.handled;
          next.reply_handled_at = patch.handled ? new Date().toISOString() : null;
        }
        return next;
      })
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <div className="label">Outreach</div>
          <h1 className="text-2xl font-semibold tracking-tight">Respuestas</h1>
          <div className="text-sm text-ink-muted mt-1">
            Inbox de respuestas de la cadencia de Lemlist (LinkedIn + email),
            clasificadas con IA para triage rápido.
          </div>
        </div>
        <button onClick={sync} disabled={syncing} className="btn-primary">
          <IconRefresh size={16} /> {syncing ? "Sincronizando…" : "Sincronizar respuestas"}
        </button>
      </header>

      {notice && (
        <div className="card text-sm flex items-center gap-2">
          <IconCheck size={16} className="text-success-fg" /> {notice}
        </div>
      )}
      {error && (
        <div className="card border border-danger-bg text-danger-fg flex items-start gap-2 text-sm">
          <IconAlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Kpi label="Respuestas" value={kpis.total} />
          <Kpi label="Positivas" value={kpis.positive} tone="success" />
          <Kpi label="Sin atender" value={kpis.needs_attention} tone="warning" />
          <Kpi label="LinkedIn" value={kpis.linkedin} tone="info" />
          <Kpi label="Email" value={kpis.email} tone="info" />
          <Kpi label="Clasificadas IA" value={kpis.analyzed} tone="muted" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 bg-[#F4F2FB] rounded-lg p-1">
          {CHANNELS.map((c) => (
            <button
              key={c.key}
              onClick={() => setChannel(c.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                channel === c.key ? "bg-white text-brand shadow-sm" : "text-ink-muted hover:text-ink"
              }`}
            >
              {c.key === "linkedin" && <IconBrandLinkedin size={14} />}
              {c.key === "email" && <IconMail size={14} />}
              {c.label}
            </button>
          ))}
        </div>
        <select
          className="input w-auto"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="all">Todas las categorías</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          className="input w-auto"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {STATUSES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <button className="btn-secondary" onClick={load} disabled={loading}>
          <IconRefresh size={14} /> Refrescar
        </button>
        <div className="text-sm text-ink-muted ml-auto">
          {replies.length} {replies.length === 1 ? "respuesta" : "respuestas"}
        </div>
      </div>

      {loading ? (
        <div className="text-ink-muted">Cargando…</div>
      ) : replies.length === 0 ? (
        <div className="card text-ink-muted space-y-2">
          <div className="flex items-center gap-2">
            <IconMessage2 size={18} /> No hay respuestas para mostrar con estos filtros.
          </div>
          {(!kpis || kpis.total === 0) && (
            <div className="text-sm">
              Si recién configurás esto: corré la migración{" "}
              <code className="bg-[#F4F2FB] px-1 rounded">
                supabase/lemlist_activities_replies_migration.sql
              </code>{" "}
              en Supabase y después tocá <strong>Sincronizar respuestas</strong>.
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {replies.map((r) => (
            <ReplyCard key={r.id} r={r} onTriage={triage} />
          ))}
        </div>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  tone = "default"
}: {
  label: string;
  value: number;
  tone?: "default" | "success" | "info" | "warning" | "muted";
}) {
  const toneClass =
    tone === "success"
      ? "text-success-fg"
      : tone === "info"
      ? "text-info-fg"
      : tone === "warning"
      ? "text-warning-fg"
      : tone === "muted"
      ? "text-ink-muted"
      : "text-ink";
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${toneClass}`}>{value}</div>
    </div>
  );
}

function ReplyCard({
  r,
  onTriage
}: {
  r: Reply;
  onTriage: (id: string, patch: { triage?: string | null; handled?: boolean }) => void;
}) {
  const c = r.contact;
  return (
    <div className={`card space-y-3 ${r.handled ? "opacity-70" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold truncate">{c?.name ?? "(sin contacto)"}</span>
            {c?.fit_score != null && (
              <span className="badge bg-[#EEEDFE] text-brand">fit {c.fit_score}</span>
            )}
            <span className="badge bg-[#F1EEF7] text-ink-muted flex items-center gap-1">
              {r.channel === "linkedin" ? (
                <IconBrandLinkedin size={11} />
              ) : r.channel === "email" ? (
                <IconMail size={11} />
              ) : null}
              {r.channel ?? r.type}
            </span>
            {r.handled && (
              <span className="badge bg-success-bg text-success-fg">atendida</span>
            )}
          </div>
          <div className="text-xs text-ink-muted truncate">
            {c?.job_title || "—"}
            {c?.company_name ? ` · ${c.company_name}` : ""}
          </div>
        </div>
        <div className="text-xs text-ink-subtle whitespace-nowrap">
          {r.activity_at
            ? new Date(r.activity_at).toLocaleString("es", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit"
              })
            : ""}
        </div>
      </div>

      {/* Clasificación IA */}
      <div className="flex items-center gap-2 flex-wrap">
        {r.effective_category && (
          <span className={`badge ${categoryTone(r.effective_category)}`}>
            {CATEGORY_LABELS[r.effective_category] ?? r.effective_category}
            {r.reply_triage && <span className="ml-1 opacity-70">(manual)</span>}
          </span>
        )}
        {r.reply_sentiment && (
          <span className="text-xs text-ink-muted">sentimiento: {r.reply_sentiment}</span>
        )}
        {!r.reply_analyzed_at && r.reply_text && (
          <span className="text-xs text-ink-subtle">sin clasificar aún</span>
        )}
        {r.reply_analysis_error && (
          <span className="text-xs text-danger-fg">IA: {r.reply_analysis_error}</span>
        )}
      </div>

      {/* Texto de la respuesta */}
      {r.reply_text ? (
        <blockquote className="text-sm text-ink border-l-2 border-brand-soft pl-3 whitespace-pre-wrap">
          {r.reply_text.length > 1200 ? r.reply_text.slice(0, 1200) + "…" : r.reply_text}
        </blockquote>
      ) : (
        <div className="text-xs text-ink-subtle italic">
          Lemlist no devolvió el texto de la respuesta. Abrí la conversación en Lemlist
          para leerla, o clasificá manualmente abajo.
        </div>
      )}

      {/* Resumen + próximo paso IA */}
      {(r.reply_summary || r.reply_suggested_step) && (
        <div className="bg-[#F4F2FB] rounded-md p-2.5 text-sm space-y-1">
          {r.reply_summary && (
            <div className="flex gap-1.5">
              <IconSparkles size={14} className="text-brand shrink-0 mt-0.5" />
              <span>{r.reply_summary}</span>
            </div>
          )}
          {r.reply_suggested_step && (
            <div className="text-ink-muted">
              <span className="font-medium text-ink">Próximo paso:</span>{" "}
              {r.reply_suggested_step}
            </div>
          )}
        </div>
      )}

      {/* Triage + links */}
      <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-divider">
        <span className="label">Triage:</span>
        <select
          className="input w-auto text-sm py-1"
          value={r.reply_triage ?? ""}
          onChange={(e) => onTriage(r.id, { triage: e.target.value || null })}
        >
          <option value="">— (usar IA)</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        {r.handled ? (
          <button
            className="btn-secondary text-xs"
            onClick={() => onTriage(r.id, { handled: false })}
          >
            <IconArrowBackUp size={13} /> Reabrir
          </button>
        ) : (
          <button
            className="btn-primary text-xs"
            onClick={() => onTriage(r.id, { handled: true })}
          >
            <IconCheck size={13} /> Marcar atendida
          </button>
        )}
        <div className="ml-auto flex items-center gap-3">
          {c?.linkedin_url && (
            <a
              href={c.linkedin_url}
              target="_blank"
              rel="noreferrer"
              className="text-ink-subtle hover:text-brand"
              title="LinkedIn"
            >
              <IconBrandLinkedin size={15} />
            </a>
          )}
          {c?.hubspot_contact_id && (
            <a
              href={`https://app.hubspot.com/contacts/contacts/${c.hubspot_contact_id}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-brand inline-flex items-center gap-0.5"
            >
              HubSpot <IconExternalLink size={11} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
