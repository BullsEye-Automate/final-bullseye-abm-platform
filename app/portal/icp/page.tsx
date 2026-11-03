"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import IcpPublicForm from "@/app/forms/icp/[token]/IcpPublicForm";

type Industry = { id: string; name: string };
type Pending = { id: string; proposed_content: string; client_comment: string | null; submitted_by_email: string | null; updated_at: string };
type HistoryItem = { id: string; status: "approved" | "rejected"; review_note: string | null; submitted_by_email: string | null; created_at: string; reviewed_at: string | null };
type IcpState = { industries: Industry[]; current: string; pending: Pending | null; history: HistoryItem[] };

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "numeric" });

export default function PortalIcpPage() {
  const [industryId, setIndustryId] = useState<string>("");
  const [state, setState] = useState<IcpState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [justSent, setJustSent] = useState(false);
  // Fuerza a remontar el formulario cuando cambia el contenido base
  const [formKey, setFormKey] = useState(0);

  const load = useCallback(async (indId: string) => {
    setError(null);
    const r = await fetch(`/api/portal/icp${indId ? `?industry_id=${indId}` : ""}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) {
      setError(j.error ?? "No se pudo cargar el ICP");
      return;
    }
    setState(j);
    setComment(j.pending?.client_comment ?? "");
    setFormKey((k) => k + 1);
  }, []);

  useEffect(() => { load(industryId); }, [industryId, load]);

  async function submit(content: string): Promise<string | null> {
    const r = await fetch("/api/portal/icp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, comment, industry_id: industryId || null }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return j.error ?? "No se pudo enviar la propuesta";
    setJustSent(true);
    await load(industryId);
    window.scrollTo({ top: 0, behavior: "smooth" });
    return null;
  }

  // Si hay una propuesta pendiente, el cliente sigue editando sobre ella
  const baseContent = state ? state.pending?.proposed_content ?? state.current : null;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <Link href="/portal/radar?vista=icp-proyecto" className="text-xs text-gray-500 hover:text-gray-700 inline-block mb-1">← ICP del proyecto</Link>
          <h1 className="text-2xl font-semibold" style={{ color: "#251762" }}>Proponer cambios al ICP</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Este es el perfil con el que BullsEye prospecta para ustedes. Puedes proponer ajustes:
            el equipo los revisa y, una vez aprobados, se aplican a la prospección.
          </p>
        </div>
        {state && state.industries.length > 0 && (
          <label className="text-sm">
            <span className="block text-xs text-gray-500 mb-1">ICP</span>
            <select
              value={industryId}
              onChange={(e) => { setJustSent(false); setIndustryId(e.target.value); }}
              className="border border-gray-200 rounded-xl px-3 py-2 bg-white text-sm"
            >
              <option value="">General</option>
              {state.industries.map((i) => (
                <option key={i.id} value={i.id}>Industria: {i.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl mb-6">{error}</div>}
      {!state && !error && <div className="text-sm text-gray-400">Cargando…</div>}

      {state && (
        <>
          {state.pending ? (
            <div className="rounded-xl px-4 py-3 mb-6 text-sm border" style={{ background: "rgba(98,224,216,0.12)", borderColor: "rgba(98,224,216,0.4)", color: "#155e59" }}>
              {justSent ? "✓ Propuesta enviada. " : ""}
              Tienes una propuesta en revisión por BullsEye (último envío {fmtDate(state.pending.updated_at)}
              {state.pending.submitted_by_email ? ` por ${state.pending.submitted_by_email}` : ""}).
              Mientras tanto la prospección sigue con el ICP vigente. Si vuelves a enviar, se reemplaza la propuesta.
            </div>
          ) : (
            !state.current && (
              <div className="rounded-xl px-4 py-3 mb-6 text-sm bg-amber-50 text-amber-800 border border-amber-100">
                Aún no hay un ICP cargado. Puedes completarlo y enviarlo para revisión.
              </div>
            )
          )}

          {state.history.length > 0 && (
            <details className="mb-6 bg-white rounded-xl border border-gray-100 px-4 py-3 text-sm">
              <summary className="cursor-pointer font-medium" style={{ color: "#251762" }}>Historial de propuestas</summary>
              <ul className="mt-3 space-y-2">
                {state.history.map((h) => (
                  <li key={h.id} className="flex flex-wrap gap-2 items-baseline">
                    <span className={`text-xs font-semibold rounded px-2 py-0.5 ${h.status === "approved" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                      {h.status === "approved" ? "Aprobada" : "No aprobada"}
                    </span>
                    <span className="text-gray-500">{fmtDate(h.created_at)}{h.submitted_by_email ? ` · ${h.submitted_by_email}` : ""}</span>
                    {h.review_note && <span className="text-gray-700 w-full pl-1">“{h.review_note}”</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <IcpPublicForm
            key={formKey}
            clientName=""
            initialContent={baseContent || null}
            embedded={{
              onSubmitContent: submit,
              submitLabel: state.pending ? "Actualizar propuesta" : "Enviar propuesta a BullsEye",
              beforeSubmit: (
                <label className="block mt-6">
                  <div className="text-xs font-medium text-gray-600 mb-1">Comentario para el equipo BullsEye (opcional)</div>
                  <textarea
                    rows={3}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Ej: Queremos sumar Perú como geografía y dejar de prospectar retail."
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white outline-none focus:border-[#62E0D8]"
                  />
                </label>
              ),
            }}
          />
        </>
      )}
    </div>
  );
}
