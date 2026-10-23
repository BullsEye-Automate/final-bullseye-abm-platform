"use client";

import { useCallback, useEffect, useState } from "react";
import { IconCheck, IconX, IconLoader2, IconAlertTriangle, IconCopy, IconUserPlus, IconRefresh, IconExternalLink } from "@tabler/icons-react";
import { useClient, ALL_CLIENTS } from "@/lib/clientContext";
import WishlistContactsTab from "@/components/portalAdmin/WishlistContactsTab";

// Módulo interno del portal de clientes:
//  - Propuestas de ICP enviadas desde /portal/icp (aprobar / rechazar)
//  - Empresas solicitadas (wishlist de cada cliente)
//  - Contactos IA (contactos del buyer persona en las empresas de la wishlist)
//  - Accesos al portal (usuarios por cliente)
//  - Base HubSpot (sincronización del pool que usa la wishlist + diagnóstico Lemlist)

type Tab = "empresas" | "contactos" | "icp" | "accesos" | "base";

export default function SolicitudesClientesPage() {
  const [tab, setTab] = useState<Tab>("empresas");
  const { currentClient } = useClient();
  const clientId = currentClient && currentClient.id !== ALL_CLIENTS.id ? currentClient.id : null;

  return (
    <div>
      <h1 className="text-2xl font-semibold" style={{ color: "#251762" }}>Solicitudes de clientes</h1>
      <p className="text-sm text-gray-500 mt-1 mb-6">
        Lo que los clientes envían desde el portal ({clientId ? currentClient?.name : "todos los clientes"}).
      </p>

      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {([
          ["empresas", "Empresas solicitadas"],
          ["contactos", "Contactos IA"],
          ["icp", "Propuestas de ICP"],
          ["accesos", "Accesos al portal"],
          ["base", "Base HubSpot"],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px ${tab === key ? "border-[#251762] text-[#251762] font-medium" : "border-transparent text-gray-500"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "empresas" && <WishlistRequestsTab clientId={clientId} />}
      {tab === "contactos" && <WishlistContactsTab clientId={clientId} clientName={currentClient?.name ?? null} />}
      {tab === "icp" && <IcpRequestsTab clientId={clientId} />}
      {tab === "accesos" && <AccessTab clientId={clientId} clientName={currentClient?.name ?? null} />}
      {tab === "base" && <PoolTab clientId={clientId} clientName={currentClient?.name ?? null} />}
    </div>
  );
}

// ── Propuestas de ICP ────────────────────────────────────────────────────

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

function IcpRequestsTab({ clientId }: { clientId: string | null }) {
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

// ── Accesos al portal ────────────────────────────────────────────────────

type PortalUserRow = { id: string; client_name: string; email: string; full_name: string | null; is_active: boolean; created_by: string | null; created_at: string };

function AccessTab({ clientId, clientName }: { clientId: string | null; clientName: string | null }) {
  const [users, setUsers] = useState<PortalUserRow[] | null>(null);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);

  const load = useCallback(async () => {
    const qs = clientId ? `?client_id=${clientId}` : "";
    const r = await fetch(`/api/portal-admin/users${qs}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) return setError(j.error ?? "Error al cargar");
    setUsers(j.users);
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId) return;
    setBusy(true);
    setError(null);
    const r = await fetch("/api/portal-admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, email, full_name: fullName }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setError(j.error ?? "Error");
    setCredentials({ email: j.email, password: j.password });
    setEmail("");
    setFullName("");
    load();
  }

  async function act(u: PortalUserRow, action: "deactivate" | "activate" | "reset_password" | "delete") {
    if (action === "delete" && !confirm(`¿Eliminar el acceso de ${u.email}?`)) return;
    setError(null);
    const r = await fetch(`/api/portal-admin/users/${u.id}`, {
      method: action === "delete" ? "DELETE" : "POST",
      headers: { "Content-Type": "application/json" },
      body: action === "delete" ? undefined : JSON.stringify({ action }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setError(j.error ?? "Error");
    if (action === "reset_password") setCredentials({ email: u.email, password: j.password });
    load();
  }

  const loginUrl = typeof window !== "undefined" ? `${window.location.origin}/login` : "/login";

  return (
    <div className="space-y-6">
      {clientId ? (
        <form onSubmit={create} className="bg-white rounded-2xl border border-gray-100 p-5 flex flex-wrap items-end gap-3">
          <div className="w-full text-sm font-medium" style={{ color: "#251762" }}>Nuevo acceso para {clientName}</div>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nombre" className="flex-1 min-w-[180px] border border-gray-200 rounded-xl px-3 py-2 text-sm" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@cliente.com" type="email" required className="flex-1 min-w-[220px] border border-gray-200 rounded-xl px-3 py-2 text-sm" />
          <button disabled={busy} className="flex items-center gap-1 px-4 py-2 rounded-xl text-sm text-white disabled:opacity-50" style={{ background: "#251762" }}>
            {busy ? <IconLoader2 size={14} className="animate-spin" /> : <IconUserPlus size={14} />} Crear acceso
          </button>
        </form>
      ) : (
        <div className="text-sm text-gray-500 bg-gray-50 rounded-xl px-4 py-3">Selecciona un cliente en el menú lateral para crearle accesos.</div>
      )}

      {credentials && (
        <div className="rounded-2xl border p-5 text-sm" style={{ background: "rgba(98,224,216,0.1)", borderColor: "rgba(98,224,216,0.4)" }}>
          <div className="font-medium mb-2" style={{ color: "#251762" }}>Credenciales (se muestran una sola vez)</div>
          <pre className="bg-white rounded-xl p-3 text-xs whitespace-pre-wrap">{`Portal BullsEye: ${loginUrl}\nUsuario: ${credentials.email}\nContraseña temporal: ${credentials.password}\n\nTe recomendamos cambiarla en "Mi cuenta" al ingresar.`}</pre>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => navigator.clipboard.writeText(`Portal BullsEye: ${loginUrl}\nUsuario: ${credentials.email}\nContraseña temporal: ${credentials.password}`)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-white border border-gray-200"
            >
              <IconCopy size={13} /> Copiar
            </button>
            <button onClick={() => setCredentials(null)} className="px-3 py-1.5 rounded-lg text-xs text-gray-500">Cerrar</button>
          </div>
        </div>
      )}

      {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl">{error}</div>}

      <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-gray-500 border-b border-gray-100">
            <tr>
              {!clientId && <th className="p-3">Cliente</th>}
              <th className="p-3">Usuario</th>
              <th className="p-3">Estado</th>
              <th className="p-3">Creado</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {users?.length === 0 && (
              <tr><td colSpan={5} className="p-4 text-gray-400">Sin accesos todavía.</td></tr>
            )}
            {users?.map((u) => (
              <tr key={u.id} className="border-b border-gray-50 last:border-0">
                {!clientId && <td className="p-3">{u.client_name}</td>}
                <td className="p-3">
                  <div>{u.full_name ?? "—"}</div>
                  <div className="text-xs text-gray-500">{u.email}</div>
                </td>
                <td className="p-3">
                  <span className={`text-xs rounded px-2 py-0.5 ${u.is_active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                    {u.is_active ? "Activo" : "Desactivado"}
                  </span>
                </td>
                <td className="p-3 text-xs text-gray-500">{new Date(u.created_at).toLocaleDateString("es-CL")}{u.created_by ? ` · ${u.created_by}` : ""}</td>
                <td className="p-3 text-right whitespace-nowrap text-xs space-x-3">
                  <button onClick={() => act(u, "reset_password")} className="text-[#251762] hover:underline">Nueva contraseña</button>
                  <button onClick={() => act(u, u.is_active ? "deactivate" : "activate")} className="text-gray-600 hover:underline">
                    {u.is_active ? "Desactivar" : "Activar"}
                  </button>
                  <button onClick={() => act(u, "delete")} className="text-red-600 hover:underline">Eliminar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Empresas solicitadas (wishlist) ──────────────────────────────────────

type WishlistRequest = {
  id: string;
  client_name: string;
  company_name: string;
  domain: string | null;
  linkedin_url: string | null;
  source: "hubspot" | "lemlist" | "manual";
  mode: "manual" | "ai";
  fit_score: number | null;
  fit_reason: string | null;
  snapshot: { facts?: { label: string; value: string }[]; client_comment?: string };
  status: "new" | "in_lemlist" | "in_progress" | "contacts_found" | "discarded";
  lemlist_status: string | null;
  lemlist_error: string | null;
  internal_note: string | null;
  requested_by_email: string | null;
  created_at: string;
};

const WISHLIST_STATUSES: { value: WishlistRequest["status"]; label: string }[] = [
  { value: "new", label: "Nueva" },
  { value: "in_lemlist", label: "En Lemlist" },
  { value: "in_progress", label: "En prospección" },
  { value: "contacts_found", label: "Contactos encontrados" },
  { value: "discarded", label: "Descartada" },
];

function WishlistRequestsTab({ clientId }: { clientId: string | null }) {
  const [status, setStatus] = useState<string>("new");
  const [items, setItems] = useState<WishlistRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setItems(null);
    const qs = new URLSearchParams({ status });
    if (clientId) qs.set("client_id", clientId);
    const r = await fetch(`/api/portal-admin/wishlist?${qs}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) return setError(j.error ?? "Error al cargar");
    setError(null);
    setItems(j.items);
  }, [status, clientId]);

  useEffect(() => { load(); }, [load]);

  async function update(id: string, patch: { status?: string; internal_note?: string; action?: string }) {
    const r = await fetch(`/api/portal-admin/wishlist/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!r.ok) setError((await r.json().catch(() => ({}))).error ?? "Error al actualizar");
    else if (patch.status || patch.action) load();
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4 text-sm">
        {[{ value: "new", label: "Nuevas" }, ...WISHLIST_STATUSES.slice(1), { value: "all", label: "Todas" }].map((s) => (
          <button
            key={s.value}
            onClick={() => setStatus(s.value)}
            className={`px-3 py-1.5 rounded-full ${status === s.value ? "bg-[#251762] text-white" : "bg-gray-100 text-gray-600"}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl mb-4">{error}</div>}
      {!items && !error && <IconLoader2 className="animate-spin text-gray-400" />}
      {items?.length === 0 && <div className="text-sm text-gray-400">No hay empresas en este estado.</div>}
      {items && items.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500 border-b border-gray-100">
              <tr>
                {!clientId && <th className="p-3">Cliente</th>}
                <th className="p-3">Empresa</th>
                <th className="p-3">Fit</th>
                <th className="p-3">Solicitada</th>
                <th className="p-3">Estado</th>
                <th className="p-3">Nota interna</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-b border-gray-50 last:border-0 align-top">
                  {!clientId && <td className="p-3 whitespace-nowrap">{i.client_name}</td>}
                  <td className="p-3 min-w-[220px]">
                    <div className="font-medium" style={{ color: "#251762" }}>{i.company_name}</div>
                    <div className="text-xs text-gray-500 flex flex-wrap gap-x-2">
                      {i.domain && (
                        <a href={`https://${i.domain}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-[#251762]">
                          {i.domain} <IconExternalLink size={10} />
                        </a>
                      )}
                      {i.linkedin_url && <a href={i.linkedin_url} target="_blank" rel="noreferrer" className="hover:text-[#251762]">LinkedIn</a>}
                      <span>{i.source === "hubspot" ? "Base HubSpot" : i.source === "lemlist" ? "Base Lemlist" : "Solicitud manual del cliente"}{i.mode === "ai" ? " · IA" : ""}</span>
                    </div>
                    {i.snapshot?.facts?.length ? (
                      <div className="text-xs text-gray-500 mt-1 line-clamp-2">
                        {i.snapshot.facts.slice(0, 3).map((f) => `${f.label}: ${f.value}`).join(" · ")}
                      </div>
                    ) : null}
                  </td>
                  <td className="p-3 max-w-xs">
                    {i.fit_score != null ? <div className="font-semibold">{i.fit_score}%</div> : "—"}
                    {i.fit_reason && <div className="text-xs text-gray-500 line-clamp-3">{i.fit_reason}</div>}
                  </td>
                  <td className="p-3 text-xs text-gray-500 whitespace-nowrap">
                    {fmt(i.created_at)}
                    <div>{i.requested_by_email}</div>
                  </td>
                  <td className="p-3">
                    <select
                      value={i.status}
                      onChange={(e) => update(i.id, { status: e.target.value })}
                      className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white"
                    >
                      {WISHLIST_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                    <LemlistBadge item={i} onRetry={() => update(i.id, { action: "push_lemlist" })} />
                  </td>
                  <td className="p-3 min-w-[200px]">
                    <textarea
                      defaultValue={i.internal_note ?? ""}
                      onBlur={(e) => e.target.value !== (i.internal_note ?? "") && update(i.id, { internal_note: e.target.value })}
                      rows={2}
                      placeholder="Solo la ve el equipo"
                      className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Base HubSpot + diagnóstico Lemlist ───────────────────────────────────

type PoolState = {
  status: "idle" | "running" | "done" | "error";
  synced_count: number;
  started_at: string | null;
  finished_at: string | null;
  last_error: string | null;
  total_in_pool: number;
};

function PoolTab({ clientId, clientName }: { clientId: string | null; clientName: string | null }) {
  const [state, setState] = useState<PoolState | null>(null);
  const [props, setProps] = useState<{ name: string; label: string; filled_count: number }[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<unknown>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/portal-admin/hubspot-pool", { cache: "no-store" });
    const j = await r.json();
    if (r.ok) {
      setState(j.state);
      setProps(j.properties);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Sincroniza por tramos hasta terminar (cada llamada ~2.000 empresas)
  async function sync() {
    setSyncing(true);
    setError(null);
    let restart = true;
    for (let i = 0; i < 40; i++) {
      const r = await fetch("/api/portal-admin/hubspot-pool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restart }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j.error ?? "Error sincronizando");
        break;
      }
      restart = false;
      setProgress(j.synced_count);
      if (j.done) break;
    }
    setSyncing(false);
    setProgress(null);
    load();
  }

  async function runCheck() {
    if (!clientId) return;
    setChecking(true);
    const r = await fetch(`/api/portal-admin/lemlist-check?client_id=${clientId}`, { cache: "no-store" });
    setCheck(await r.json().catch(() => ({ error: "Respuesta inválida" })));
    setChecking(false);
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-medium" style={{ color: "#251762" }}>Base de empresas HubSpot</div>
            <div className="text-sm text-gray-500">
              {state ? `${state.total_in_pool.toLocaleString("es-CL")} empresas disponibles para la wishlist` : "Cargando…"}
              {state?.finished_at ? ` · última sincronización ${fmt(state.finished_at)}` : ""}
            </div>
          </div>
          <button
            onClick={sync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm text-white disabled:opacity-60"
            style={{ background: "#251762" }}
          >
            {syncing ? <IconLoader2 size={15} className="animate-spin" /> : <IconRefresh size={15} />}
            {syncing ? `Sincronizando… ${progress != null ? progress.toLocaleString("es-CL") : ""}` : "Sincronizar ahora"}
          </button>
        </div>
        {(error || state?.last_error) && (
          <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl mt-4">{error ?? state?.last_error}</div>
        )}
        <p className="text-xs text-gray-400 mt-3">
          Solo se copian datos de la empresa (grupo &quot;Información de la empresa&quot; + Tecnologías). Nunca owner, etapa, negocios, notas ni propiedades bullseye_*.
        </p>
        {props.length > 0 && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-gray-600">Propiedades filtrables ({props.length})</summary>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {props.map((p) => (
                <span key={p.name} className="text-xs bg-gray-100 rounded-full px-2.5 py-1 text-gray-600">
                  {p.label} · {p.filled_count.toLocaleString("es-CL")}
                </span>
              ))}
            </div>
          </details>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-medium" style={{ color: "#251762" }}>Base de Lemlist del cliente</div>
            <div className="text-sm text-gray-500">
              Usa la API key de Lemlist del cliente (Config. cliente). Prueba los filtros y la búsqueda de empresas.
            </div>
          </div>
          <button
            onClick={runCheck}
            disabled={!clientId || checking}
            className="px-4 py-2 rounded-xl text-sm border border-gray-200 disabled:opacity-50"
          >
            {checking ? "Probando…" : clientId ? `Probar con ${clientName}` : "Selecciona un cliente"}
          </button>
        </div>
        {check !== null && (
          <pre className="mt-4 bg-gray-50 rounded-xl p-3 text-xs overflow-x-auto max-h-80">{JSON.stringify(check, null, 2)}</pre>
        )}
      </div>
    </div>
  );
}

function LemlistBadge({ item, onRetry }: { item: WishlistRequest; onRetry: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const retry = async () => { setBusy(true); await onRetry(); setBusy(false); };
  if (item.lemlist_status === "ok") return <div className="text-[10px] text-green-700 mt-1">✓ En Lemlist (Wishlist BullsEye)</div>;
  const label =
    item.lemlist_status === "sin_key" ? "Lemlist: cliente sin API key" :
    item.lemlist_status === "error" ? "Lemlist: error al enviar" : "Lemlist: envío pendiente";
  return (
    <div className="text-[10px] mt-1">
      <span className={item.lemlist_status === "error" ? "text-red-600" : "text-gray-400"} title={item.lemlist_error ?? undefined}>{label}</span>
      <button onClick={retry} disabled={busy} className="ml-2 text-[#251762] underline disabled:opacity-50">{busy ? "Enviando…" : "Reintentar"}</button>
    </div>
  );
}
