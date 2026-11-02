"use client";

import { useCallback, useEffect, useState } from "react";
import { IconCheck, IconX, IconLoader2, IconAlertTriangle } from "@tabler/icons-react";

// Propuestas de ICP / buyer persona que los clientes envían desde /portal/icp.
// BullsEye aprueba (se escribe con saveIcpContent) o rechaza viendo el diff
// por campo contra el ICP vigente. Se muestra en Sistema → ICP.

type FieldDiff = { key: string; label: string; before: string; after: string };
type IcpRequest = {
  id: string;
  client_name: string;
  industry_name: string | null;
  status: "pending" | "approved" | "rejected";
  client_comment: string | null;
  submitted_by_email: string | null;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  updated_at: string;
  stale: boolean;
  diff: FieldDiff[];
};

const fmt = (iso: string) => new Date(iso).toLocaleString("es-CL", { dateStyle: "medium", timeStyle: "short" });

export default function IcpRequestsPanel({ clientId }: { clientId: string | null }) {
  const [status, setStatus] = useState<"pending" | "all">("pending");
  const [requests, setRequests] = useState<IcpRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRequests(null);
    const qs = new URLSearchParams({ status });
    if (clientId) qs.set("client_id", clientId);
    const r = await fetch(`/api/portal-admin/icp-requests?${qs}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) return setError(j.error ?? "Error al cargar");
    setError(null);
    setRequests(j.requests);
  }, [status, clientId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="flex gap-2 mb-4 text-sm">
        {(["pending", "all"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`px-3 py-1.5 rounded-full ${status === s ? "bg-[#251762] text-white" : "bg-gray-100 text-gray-600"}`}
          >
            {s === "pending" ? "Pendientes" : "Todas"}
          </button>
        ))}
      </div>
      {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl mb-4">{error}</div>}
      {!requests && !error && <IconLoader2 className="animate-spin text-gray-400" />}
      {requests?.length === 0 && <div className="text-sm text-gray-400">No hay propuestas {status === "pending" ? "pendientes" : ""}.</div>}
      <div className="space-y-4">
        {requests?.map((r) => <IcpRequestCard key={r.id} req={r} onDone={load} />)}
      </div>
    </div>
  );
}

function IcpRequestCard({ req, onDone }: { req: IcpRequest; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "approve" | "reject") {
    if (action === "approve" && req.stale && !confirm("El ICP fue editado por el equipo después de que el cliente envió la propuesta. Aprobar reemplaza esos cambios. ¿Continuar?")) return;
    setBusy(action);
    const r = await fetch(`/api/portal-admin/icp-requests/${req.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) return setError(j.error ?? "Error");
    onDone();
  }

  const statusBadge = {
    pending: "bg-amber-50 text-amber-700",
    approved: "bg-green-50 text-green-700",
    rejected: "bg-red-50 text-red-700",
  }[req.status];

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <span className="font-semibold" style={{ color: "#251762" }}>{req.client_name}</span>
          <span className="text-sm text-gray-500"> · {req.industry_name ? `ICP industria ${req.industry_name}` : "ICP general"}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>{req.submitted_by_email} · {fmt(req.updated_at)}</span>
          <span className={`rounded px-2 py-0.5 font-semibold ${statusBadge}`}>
            {req.status === "pending" ? "Pendiente" : req.status === "approved" ? "Aprobada" : "Rechazada"}
          </span>
        </div>
      </div>

      {req.client_comment && (
        <div className="text-sm bg-gray-50 rounded-xl px-3 py-2 mb-3"><span className="text-gray-500">Comentario del cliente:</span> {req.client_comment}</div>
      )}
      {req.stale && (
        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2 mb-3">
          <IconAlertTriangle size={14} /> El ICP vigente cambió después del envío: la comparación es contra el ICP actual.
        </div>
      )}

      {req.diff.length === 0 ? (
        <div className="text-sm text-gray-400 mb-3">Sin diferencias con el ICP {req.status === "pending" ? "vigente" : "anterior"}.</div>
      ) : (
        <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl mb-3">
          {req.diff.map((d) => (
            <div key={d.key} className="grid sm:grid-cols-[180px_1fr_1fr] gap-2 sm:gap-4 p-3 text-sm">
              <div className="font-medium text-gray-700">{d.label}</div>
              <div className="whitespace-pre-wrap text-red-700/80 bg-red-50/50 rounded-lg px-2 py-1">{d.before || <span className="italic text-gray-400">vacío</span>}</div>
              <div className="whitespace-pre-wrap text-green-800 bg-green-50/60 rounded-lg px-2 py-1">{d.after || <span className="italic text-gray-400">vacío</span>}</div>
            </div>
          ))}
        </div>
      )}

      {req.status === "pending" ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Nota para el cliente (opcional, la ve en su historial)"
            className="flex-1 min-w-[220px] border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-[#62E0D8]"
          />
          <button onClick={() => act("reject")} disabled={!!busy} className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm border border-gray-200 text-gray-700 disabled:opacity-50">
            {busy === "reject" ? <IconLoader2 size={14} className="animate-spin" /> : <IconX size={14} />} Rechazar
          </button>
          <button onClick={() => act("approve")} disabled={!!busy} className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm text-white disabled:opacity-50" style={{ background: "#251762" }}>
            {busy === "approve" ? <IconLoader2 size={14} className="animate-spin" /> : <IconCheck size={14} />} Aprobar y aplicar
          </button>
        </div>
      ) : (
        <div className="text-xs text-gray-500">
          Revisada por {req.reviewed_by} {req.reviewed_at ? `· ${fmt(req.reviewed_at)}` : ""}
          {req.review_note ? ` · “${req.review_note}”` : ""}
        </div>
      )}
      {error && <div className="text-sm text-red-600 mt-2">{error}</div>}
    </div>
  );
}

// ── Empresas solicitadas (wishlist) ──────────────────────────────────────

