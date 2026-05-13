"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  IconArrowLeft,
  IconPhone,
  IconAlertCircle,
  IconRefresh,
  IconExternalLink,
  IconClock,
  IconUser,
  IconBuildingFactory2,
  IconStarFilled,
  IconBulb,
  IconCheck,
  IconAlertTriangle,
  IconQuote,
  IconArrowDownRight,
  IconArrowUpRight,
  IconTargetArrow
} from "@tabler/icons-react";

type Improvement = {
  area: string;
  suggestion: string;
  example_quote: string | null;
};

type CallDetail = {
  id: string;
  hubspot_call_id: string;
  call_timestamp: string | null;
  direction: string | null;
  duration_ms: number | null;
  disposition_label: string | null;
  status: string | null;
  call_title: string | null;
  body: string | null;
  recording_url: string | null;
  transcription: string | null;
  has_transcription: boolean;
  owner_name: string | null;
  hubspot_owner_id: string | null;

  analyzed_at: string | null;
  analysis_model: string | null;
  analysis_error: string | null;
  customer_response_category: string | null;
  customer_response_label: string | null;
  customer_response_summary: string | null;
  sdr_score_overall: number | null;
  sdr_score_opening: number | null;
  sdr_score_discovery: number | null;
  sdr_score_objection: number | null;
  sdr_score_next_step: number | null;
  sdr_strengths: string[] | null;
  sdr_improvements: Improvement[] | null;
  recommended_next_step: string | null;

  contact: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    job_title: string | null;
    linkedin_url: string | null;
    email: string | null;
    phone: string | null;
    fit_score: number | null;
    fit_action: string | null;
    status: string | null;
    company: {
      id: string;
      company_name: string;
      company_type: string | null;
      company_size: number | null;
      cad_software: string | null;
    } | null;
  } | null;
  company: {
    id: string;
    company_name: string;
    company_type: string | null;
    company_size: number | null;
    cad_software: string | null;
  } | null;
};

export default function CallDetailPage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<CallDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeMsg, setAnalyzeMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/calls/${params.id}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
        setData(null);
      } else {
        setData(json);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function rerunAnalysis() {
    setAnalyzing(true);
    setAnalyzeMsg(null);
    try {
      const res = await fetch(`/api/calls/${params.id}/analyze`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setAnalyzeMsg(`Error: ${json.error ?? `HTTP ${res.status}`}`);
      } else {
        setAnalyzeMsg(`Análisis actualizado (modelo: ${json.analysis?.model_used ?? "?"})`);
        load();
      }
    } catch (err) {
      setAnalyzeMsg(err instanceof Error ? err.message : "Network error");
    } finally {
      setAnalyzing(false);
    }
  }

  if (loading && !data) {
    return <div className="card text-ink-muted">Cargando…</div>;
  }
  if (error) {
    return (
      <div className="card border-l-4 border-danger-fg">
        <div className="flex items-center gap-2 text-danger-fg">
          <IconAlertCircle size={16} /> {error}
        </div>
        <Link href="/llamadas" className="btn-secondary mt-3 text-sm inline-flex">
          <IconArrowLeft size={14} /> Volver
        </Link>
      </div>
    );
  }
  if (!data) return null;

  const contactName =
    data.contact && [data.contact.first_name, data.contact.last_name].filter(Boolean).join(" ");
  const company = data.company ?? data.contact?.company;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link href="/llamadas" className="btn-secondary text-sm">
          <IconArrowLeft size={14} /> Volver
        </Link>
        <div className="flex items-center gap-2">
          {data.recording_url && (
            <a
              href={data.recording_url}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary text-sm"
            >
              <IconExternalLink size={14} /> Grabación
            </a>
          )}
          <button onClick={rerunAnalysis} disabled={analyzing} className="btn-primary text-sm">
            <IconRefresh size={14} className={analyzing ? "animate-spin" : ""} />
            {analyzing ? "Analizando…" : data.analyzed_at ? "Re-analizar" : "Analizar con IA"}
          </button>
        </div>
      </div>

      {analyzeMsg && (
        <div className="card text-sm" style={{ borderLeft: "4px solid #185FA5" }}>
          {analyzeMsg}
        </div>
      )}

      <header className="card">
        <div className="label flex items-center gap-1">
          <IconPhone size={12} /> Llamada · {formatDateTime(data.call_timestamp)}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">
          {contactName ?? data.call_title ?? "Llamada"}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-ink-muted">
          {data.direction && (
            <span className="inline-flex items-center gap-1">
              {data.direction === "OUTBOUND" ? <IconArrowUpRight size={13} /> : <IconArrowDownRight size={13} />}
              {data.direction === "OUTBOUND" ? "Saliente" : "Entrante"}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <IconClock size={13} /> {formatDuration(Math.round((data.duration_ms ?? 0) / 1000))}
          </span>
          {data.owner_name && (
            <span className="inline-flex items-center gap-1">
              <IconUser size={13} /> {data.owner_name}
            </span>
          )}
          {company && (
            <span className="inline-flex items-center gap-1">
              <IconBuildingFactory2 size={13} /> {company.company_name}
              {company.company_size != null && ` · ${company.company_size} empleados`}
            </span>
          )}
          {data.disposition_label && (
            <span className="chip text-[10px] bg-canvas">{data.disposition_label}</span>
          )}
          {data.status && (
            <span className="chip text-[10px] bg-canvas text-ink-muted">{data.status}</span>
          )}
        </div>
        {data.contact && (
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-ink-muted">
            {data.contact.job_title && <span>{data.contact.job_title}</span>}
            {data.contact.email && <span>· {data.contact.email}</span>}
            {data.contact.phone && <span>· {data.contact.phone}</span>}
            {data.contact.linkedin_url && (
              <a
                href={data.contact.linkedin_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[#3D2878]"
              >
                LinkedIn <IconExternalLink size={10} />
              </a>
            )}
            <Link
              href={`/contactos?focus=${data.contact.id}`}
              className="inline-flex items-center gap-1 text-[#3D2878]"
            >
              Abrir contacto <IconExternalLink size={10} />
            </Link>
          </div>
        )}
      </header>

      {/* Análisis IA */}
      {data.analyzed_at ? (
        <AnalysisSection data={data} />
      ) : data.analysis_error ? (
        <div className="card border-l-4 border-danger-fg">
          <div className="flex items-center gap-2 text-danger-fg font-medium mb-1">
            <IconAlertTriangle size={14} /> Falló el análisis con IA
          </div>
          <div className="text-sm text-ink-muted">{data.analysis_error}</div>
          <button onClick={rerunAnalysis} disabled={analyzing} className="btn-primary text-sm mt-3">
            Reintentar
          </button>
        </div>
      ) : (
        <div className="card text-center text-ink-muted py-6">
          Esta llamada todavía no se analizó con IA.
          <button onClick={rerunAnalysis} disabled={analyzing} className="btn-primary text-sm mt-3 mx-auto">
            <IconBulb size={14} /> Analizar con IA
          </button>
        </div>
      )}

      {/* Notas SDR */}
      {data.body && (
        <Section title="Notas del SDR">
          <div className="text-sm whitespace-pre-wrap text-ink">{data.body}</div>
        </Section>
      )}

      {/* Transcripción */}
      {data.transcription && data.transcription.trim() && (
        <Section title="Transcripción">
          <div className="text-sm whitespace-pre-wrap text-ink leading-relaxed">
            {data.transcription}
          </div>
        </Section>
      )}
    </div>
  );
}

function AnalysisSection({ data }: { data: CallDetail }) {
  const score = data.sdr_score_overall ?? 0;
  const scoreColor = score >= 7 ? "#0F6E56" : score < 5 ? "#993C1D" : "#854F0B";
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Respuesta del cliente */}
      <div className="card lg:col-span-1">
        <div className="label">Respuesta del cliente</div>
        <div
          className="mt-1 inline-block px-3 py-1 rounded-full text-sm font-semibold text-white"
          style={{ background: responseColor(data.customer_response_category) }}
        >
          {data.customer_response_label ?? "—"}
        </div>
        {data.customer_response_summary && (
          <div className="text-sm text-ink mt-3 leading-relaxed">
            {data.customer_response_summary}
          </div>
        )}
        {data.recommended_next_step && (
          <div className="mt-4 p-3 rounded-lg" style={{ background: "#EEEDFE" }}>
            <div className="label flex items-center gap-1" style={{ color: "#3D2878" }}>
              <IconTargetArrow size={11} /> Próximo paso recomendado
            </div>
            <div className="text-sm text-ink mt-1">{data.recommended_next_step}</div>
          </div>
        )}
        <div className="text-[10px] text-ink-muted mt-4">
          Analizado {data.analyzed_at && formatRelative(data.analyzed_at)}
          {data.analysis_model && ` · modelo: ${data.analysis_model}`}
        </div>
      </div>

      {/* Score SDR */}
      <div className="card lg:col-span-2">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <div className="label">Evaluación del SDR</div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-4xl font-semibold" style={{ color: scoreColor }}>
                {score.toFixed(1)}
              </span>
              <span className="text-ink-muted text-sm">/ 10</span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <SubScore label="Apertura" value={data.sdr_score_opening} />
          <SubScore label="Descubrimiento" value={data.sdr_score_discovery} />
          <SubScore label="Objeciones" value={data.sdr_score_objection} />
          <SubScore label="Próximo paso" value={data.sdr_score_next_step} />
        </div>

        {data.sdr_strengths && data.sdr_strengths.length > 0 && (
          <div className="mb-4">
            <div className="label flex items-center gap-1" style={{ color: "#0F6E56" }}>
              <IconCheck size={11} /> Fortalezas
            </div>
            <ul className="mt-1 space-y-1.5">
              {data.sdr_strengths.map((s, i) => (
                <li key={i} className="text-sm text-ink flex items-start gap-2">
                  <span style={{ color: "#0F6E56" }}>•</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {data.sdr_improvements && data.sdr_improvements.length > 0 && (
          <div>
            <div className="label flex items-center gap-1" style={{ color: "#854F0B" }}>
              <IconBulb size={11} /> Oportunidades de mejora
            </div>
            <div className="space-y-3 mt-2">
              {data.sdr_improvements.map((imp, i) => (
                <div
                  key={i}
                  className="p-3 rounded-lg"
                  style={{ background: "#FFF7E6", borderLeft: "3px solid #854F0B" }}
                >
                  <div className="font-semibold text-sm text-ink">{imp.area}</div>
                  <div className="text-sm text-ink mt-1">{imp.suggestion}</div>
                  {imp.example_quote && (
                    <div className="text-xs text-ink-muted mt-2 flex items-start gap-1.5">
                      <IconQuote size={11} className="shrink-0 mt-0.5" />
                      <em>{imp.example_quote}</em>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SubScore({ label, value }: { label: string; value: number | null }) {
  const v = value ?? 0;
  const pct = Math.min(100, Math.max(0, (v / 10) * 100));
  const color = v >= 7 ? "#0F6E56" : v < 5 ? "#993C1D" : "#854F0B";
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <div className="text-xs text-ink-muted">{label}</div>
        <div className="text-sm font-semibold" style={{ color }}>
          {value == null ? "—" : v.toFixed(1)}
        </div>
      </div>
      <div className="h-1.5 mt-1 bg-canvas rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="label mb-2">{title}</div>
      {children}
    </div>
  );
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-AR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "hace instantes";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.round(h / 24);
  return `hace ${d}d`;
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return "0s";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function responseColor(cat: string | null): string {
  switch (cat) {
    case "interested":
      return "#0F6E56";
    case "callback_requested":
      return "#185FA5";
    case "objection_price":
    case "objection_timing":
    case "objection_no_need":
    case "objection_existing_solution":
    case "objection_authority":
      return "#854F0B";
    case "not_interested":
    case "no_engagement":
    case "wrong_number":
      return "#993C1D";
    case "voicemail":
    case "gatekeeper":
      return "#6B6884";
    default:
      return "#3D2878";
  }
}
