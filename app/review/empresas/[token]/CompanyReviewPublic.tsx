"use client";

import { useState } from "react";
import {
  IconCheck,
  IconX,
  IconExternalLink,
  IconBrandLinkedin,
  IconLoader2,
  IconAlertCircle,
  IconBuildingFactory2,
} from "@tabler/icons-react";

type Company = {
  id: string;
  company_name: string;
  company_website: string | null;
  company_linkedin_url: string | null;
  company_city: string | null;
  company_country: string | null;
  company_size: number | null;
  fit_score: "high" | "medium" | "low" | null;
  fit_signals: string | null;
  research_summary: string | null;
  status: string;
};

type Props = {
  token: string;
  clientName: string;
  initialCompanies: Company[];
  sessionLabel: string | null;
  expired?: boolean;
};

export default function CompanyReviewPublic({
  token,
  clientName,
  initialCompanies,
  sessionLabel,
  expired = false,
}: Props) {
  const [companies, setCompanies] = useState<Company[]>(initialCompanies);
  const [decisions, setDecisions] = useState<Record<string, "approved" | "rejected">>(() => {
    const init: Record<string, "approved" | "rejected"> = {};
    for (const c of initialCompanies) {
      if (c.status === "client_approved") init[c.id] = "approved";
      if (c.status === "client_rejected") init[c.id] = "rejected";
    }
    return init;
  });
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const total    = companies.length;
  const reviewed = Object.keys(decisions).length;
  const allDone  = total > 0 && reviewed === total;

  async function decide(companyId: string, decision: "approved" | "rejected") {
    setBusy((p) => ({ ...p, [companyId]: true }));
    setErrors((p) => { const n = { ...p }; delete n[companyId]; return n; });
    try {
      const res = await fetch(`/api/review/empresas/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: companyId, decision }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErrors((p) => ({ ...p, [companyId]: d.error ?? "Error al guardar" }));
      } else {
        setDecisions((p) => ({ ...p, [companyId]: decision }));
      }
    } catch {
      setErrors((p) => ({ ...p, [companyId]: "Error de red" }));
    }
    setBusy((p) => { const n = { ...p }; delete n[companyId]; return n; });
  }

  return (
    <div className="min-h-screen" style={{ background: "#F4F2FB" }}>
      {/* Header BullsEye */}
      <header
        className="px-6 py-4 flex items-center gap-3"
        style={{ background: "#251762" }}
      >
        <span className="text-xl font-bold tracking-tight text-white">
          Bulls<span style={{ color: "#62E0D8" }}>Eye</span>
        </span>
        {clientName && (
          <>
            <span className="text-white/30 mx-1">·</span>
            <span className="text-white/70 text-sm">{clientName}</span>
          </>
        )}
        {sessionLabel && (
          <>
            <span className="text-white/30 mx-1">·</span>
            <span className="text-white/50 text-sm">{sessionLabel}</span>
          </>
        )}
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Estado expirado */}
        {expired ? (
          <div className="card flex flex-col items-center gap-4 py-12 text-center">
            <div className="w-14 h-14 rounded-full flex items-center justify-center"
              style={{ background: "rgba(37,23,98,0.08)" }}>
              <IconAlertCircle size={28} style={{ color: "#251762" }} />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Este link ha expirado</h2>
              <p className="text-sm text-ink-muted mt-1">
                El link de revisión venció. Solicita uno nuevo a tu contacto en BullsEye.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Encabezado de revisión */}
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Revisión de empresas
              </h1>
              <p className="text-sm text-ink-muted mt-1">
                Revisa las empresas sugeridas y marca cada una como aprobada o rechazada.
                {total > 0 && ` · ${reviewed} de ${total} revisadas`}
              </p>
            </div>

            {/* Barra de progreso */}
            {total > 0 && (
              <div className="w-full bg-[#E5E2F0] rounded-full h-1.5">
                <div
                  className="h-1.5 rounded-full transition-all"
                  style={{
                    width: `${(reviewed / total) * 100}%`,
                    background: "#62E0D8",
                  }}
                />
              </div>
            )}

            {/* Mensaje de completado */}
            {allDone && (
              <div className="card flex items-center gap-3 border"
                style={{ borderColor: "#62E0D8", background: "rgba(98,224,216,0.08)" }}>
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: "#62E0D8" }}>
                  <IconCheck size={16} color="#251762" />
                </div>
                <div>
                  <div className="font-semibold text-sm">¡Revisión completa!</div>
                  <div className="text-xs text-ink-muted mt-0.5">
                    Gracias. BullsEye procesará tus decisiones en las próximas horas.
                  </div>
                </div>
              </div>
            )}

            {/* Lista vacía */}
            {total === 0 && (
              <div className="card flex flex-col items-center gap-3 py-12 text-center">
                <IconBuildingFactory2 size={28} className="text-ink-muted" />
                <p className="text-sm text-ink-muted">No hay empresas en este batch.</p>
              </div>
            )}

            {/* Tarjetas de empresas */}
            <div className="space-y-4">
              {companies.map((c) => {
                const decision = decisions[c.id];
                const isApproved = decision === "approved";
                const isRejected = decision === "rejected";
                const isLoading  = !!busy[c.id];
                const err        = errors[c.id];

                const scoreClass =
                  c.fit_score === "high"
                    ? "bg-success-bg text-success-fg"
                    : c.fit_score === "medium"
                    ? "bg-warning-bg text-warning-fg"
                    : "bg-danger-bg text-danger-fg";

                return (
                  <div
                    key={c.id}
                    className="card flex flex-col gap-3"
                    style={
                      isApproved
                        ? { outline: "2px solid #62E0D8", outlineOffset: "1px" }
                        : isRejected
                        ? { outline: "2px solid #F87171", outlineOffset: "1px", opacity: 0.7 }
                        : undefined
                    }
                  >
                    {/* Nombre + fit */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold">{c.company_name}</h3>
                          {c.fit_score && (
                            <span className={`badge ${scoreClass}`}>fit {c.fit_score}</span>
                          )}
                          {isApproved && (
                            <span className="badge" style={{ background: "rgba(98,224,216,0.15)", color: "#0E7A73" }}>
                              ✓ Aprobada
                            </span>
                          )}
                          {isRejected && (
                            <span className="badge bg-danger-bg text-danger-fg">
                              ✗ Rechazada
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-ink-muted mt-1 flex flex-wrap gap-x-2">
                          {c.company_size && <span>{c.company_size} empleados</span>}
                          {(c.company_city || c.company_country) && (
                            <span>· {[c.company_city, c.company_country].filter(Boolean).join(", ")}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {c.company_website && (
                          <a href={c.company_website} target="_blank" rel="noreferrer"
                            className="btn-secondary" title="Sitio web">
                            <IconExternalLink size={14} />
                          </a>
                        )}
                        {c.company_linkedin_url && (
                          <a href={c.company_linkedin_url} target="_blank" rel="noreferrer"
                            className="btn-secondary" title="LinkedIn">
                            <IconBrandLinkedin size={14} />
                          </a>
                        )}
                      </div>
                    </div>

                    {c.fit_signals && (
                      <div>
                        <div className="label mb-1">Señales detectadas</div>
                        <div className="text-sm">{c.fit_signals}</div>
                      </div>
                    )}

                    {c.research_summary && (
                      <div>
                        <div className="label mb-1">Razonamiento IA</div>
                        <p className="text-sm text-ink/90">{c.research_summary}</p>
                      </div>
                    )}

                    {err && (
                      <div className="flex items-center gap-2 text-xs text-danger-fg">
                        <IconAlertCircle size={12} /> {err}
                      </div>
                    )}

                    {/* Botones de decisión */}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => decide(c.id, "approved")}
                        disabled={isLoading || isApproved}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                          isApproved
                            ? "text-white cursor-default"
                            : "bg-white border border-[#E5E2F0] text-ink hover:border-[#62E0D8] hover:text-[#0E7A73]"
                        }`}
                        style={isApproved ? { background: "#62E0D8", color: "#251762" } : undefined}
                      >
                        {isLoading ? (
                          <IconLoader2 size={14} className="animate-spin" />
                        ) : (
                          <IconCheck size={14} />
                        )}
                        Aprobar
                      </button>
                      <button
                        onClick={() => decide(c.id, "rejected")}
                        disabled={isLoading || isRejected}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                          isRejected
                            ? "text-white cursor-default"
                            : "bg-white border border-[#E5E2F0] text-ink hover:border-red-300 hover:text-red-600"
                        }`}
                        style={isRejected ? { background: "#F87171", color: "#fff" } : undefined}
                      >
                        {isLoading ? (
                          <IconLoader2 size={14} className="animate-spin" />
                        ) : (
                          <IconX size={14} />
                        )}
                        Rechazar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
