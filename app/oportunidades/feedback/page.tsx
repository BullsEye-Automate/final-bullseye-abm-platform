"use client";

import { useEffect, useState, useRef } from "react";
import { useClient } from "@/lib/clientContext";
import {
  IconCalendar, IconCheck, IconClock, IconLink, IconPlus,
  IconUpload, IconX, IconMessageCheck, IconAlertCircle, IconRefresh
} from "@tabler/icons-react";

type Meeting = {
  id: string;
  client_id: string;
  empresa: string;
  contacto_nombre: string | null;
  contacto_cargo: string | null;
  fecha_reunion: string | null;
  realizado: "Si" | "No" | "Pendiente" | "Reagendar";
  feedback_status: "pendiente" | "con_feedback";
  feedback_token: string;
  notas: string | null;
  sdr_nombre: string | null;
  meeting_feedback: any[];
};

const REALIZADO_COLORS: Record<string, string> = {
  Si:         "#22c55e",
  No:         "#ef4444",
  Pendiente:  "#f59e0b",
  Reagendar:  "#8b5cf6",
};

function NuevaReunionModal({ clientId, onClose, onSaved }: { clientId: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    empresa: "", contacto_nombre: "", contacto_cargo: "",
    fecha_reunion: "", realizado: "Pendiente", notas: "", sdr_nombre: ""
  });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch("/api/meetings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, client_id: clientId }),
    });
    setSaving(false);
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Nueva reunión</h2>
          <button onClick={onClose}><IconX size={18} className="text-gray-400" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600">Empresa *</label>
              <input required value={form.empresa} onChange={e => setForm(p => ({ ...p, empresa: e.target.value }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#62E0D8]" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Fecha reunión</label>
              <input type="date" value={form.fecha_reunion} onChange={e => setForm(p => ({ ...p, fecha_reunion: e.target.value }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#62E0D8]" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600">Nombre contacto</label>
              <input value={form.contacto_nombre} onChange={e => setForm(p => ({ ...p, contacto_nombre: e.target.value }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#62E0D8]" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Cargo</label>
              <input value={form.contacto_cargo} onChange={e => setForm(p => ({ ...p, contacto_cargo: e.target.value }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#62E0D8]" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600">Estado reunión</label>
              <select value={form.realizado} onChange={e => setForm(p => ({ ...p, realizado: e.target.value }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#62E0D8]">
                {["Pendiente", "Si", "No", "Reagendar"].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">SDR</label>
              <input value={form.sdr_nombre} onChange={e => setForm(p => ({ ...p, sdr_nombre: e.target.value }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#62E0D8]" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Notas</label>
            <textarea value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} rows={2}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#62E0D8] resize-none" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancelar</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm font-medium rounded-lg text-white disabled:opacity-50"
              style={{ background: "#251762" }}>
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function copiarLink(token: string) {
  const url = `${window.location.origin}/encuesta/${token}`;
  navigator.clipboard.writeText(url);
}

export default function FeedbackPage() {
  const { currentClient } = useClient();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading]   = useState(true);
  const [desde, setDesde]       = useState("");
  const [hasta, setHasta]       = useState("");
  const [showModal, setShowModal] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const [syncing, setSyncing]     = useState(false);
  const [copied, setCopied]       = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (currentClient?.id && currentClient.id !== "all") params.set("client_id", currentClient.id);
    if (desde) params.set("desde", desde);
    if (hasta) params.set("hasta", hasta);
    const res = await fetch(`/api/meetings?${params}`);
    const data = await res.json();
    setMeetings(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [currentClient, desde, hasta]);

  async function handleSync() {
    setSyncing(true);
    setImportMsg("");
    try {
      const res = await fetch("/api/cron/sync-meetings");
      const data = await res.json();
      if (data.error) setImportMsg(`Error: ${data.error}`);
      else {
        setImportMsg(`✓ Sync completado — ${data.synced} reuniones sincronizadas desde Google Sheets`);
        load();
      }
    } catch {
      setImportMsg("Error de conexión al hacer sync");
    }
    setSyncing(false);
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportMsg("");
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/meetings/import", { method: "POST", body: fd });
    const data = await res.json();
    setImporting(false);
    if (data.error) setImportMsg(`Error: ${data.error}`);
    else { setImportMsg(`✓ ${data.imported} reuniones importadas`); load(); }
    e.target.value = "";
  }

  function handleCopy(token: string) {
    copiarLink(token);
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
  }

  // Pendientes de feedback primero, luego con feedback
  const pendientes   = meetings.filter(m => m.realizado === "Si" && m.feedback_status === "pendiente");
  const conFeedback  = meetings.filter(m => m.feedback_status === "con_feedback");
  const otras        = meetings.filter(m => m.realizado !== "Si" && m.feedback_status === "pendiente");
  const ordenadas    = [...pendientes, ...otras, ...conFeedback];

  const totalRealizadas = meetings.filter(m => m.realizado === "Si").length;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Feedback de reuniones</h1>
          <p className="text-sm text-gray-500 mt-1">
            Comparte el link de encuesta con tu cliente después de cada reunión realizada
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleSync} disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-gray-200 hover:bg-gray-50 disabled:opacity-50">
            <IconRefresh size={15} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Sincronizando…" : "Sync Google Sheets"}
          </button>
          <button onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-gray-200 hover:bg-gray-50 disabled:opacity-50">
            <IconUpload size={15} /> {importing ? "Importando…" : "Importar CSV"}
          </button>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-white font-medium"
            style={{ background: "#251762" }}>
            <IconPlus size={15} /> Nueva reunión
          </button>
        </div>
      </div>

      {importMsg && (
        <div className={`mb-4 px-4 py-2 rounded-lg text-sm ${importMsg.startsWith("Error") ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
          {importMsg}
        </div>
      )}

      {/* Resumen */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="text-2xl font-bold text-gray-900">{meetings.length}</div>
          <div className="text-xs text-gray-500 mt-0.5">Total reuniones</div>
        </div>
        <div className="bg-amber-50 rounded-xl border border-amber-100 p-4">
          <div className="text-2xl font-bold text-amber-700">{pendientes.length}</div>
          <div className="text-xs text-amber-600 mt-0.5">Pendientes de feedback</div>
        </div>
        <div className="bg-green-50 rounded-xl border border-green-100 p-4">
          <div className="text-2xl font-bold text-green-700">{conFeedback.length}</div>
          <div className="text-xs text-green-600 mt-0.5">Con feedback recibido</div>
        </div>
      </div>

      {/* Filtros de fecha */}
      <div className="flex items-center gap-3 mb-5">
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Desde</label>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1 text-sm outline-none" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Hasta</label>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1 text-sm outline-none" />
        </div>
        {(desde || hasta) && (
          <button onClick={() => { setDesde(""); setHasta(""); }} className="text-xs text-gray-400 hover:text-gray-600">
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Lista de reuniones */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">Cargando reuniones…</div>
      ) : ordenadas.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <IconCalendar size={40} className="mx-auto mb-3 opacity-30" />
          <p>No hay reuniones registradas</p>
          <p className="text-sm mt-1">Importa un CSV o agrega una reunión manualmente</p>
        </div>
      ) : (
        <div className="space-y-2">
          {ordenadas.map(m => {
            const esPendiente = m.realizado === "Si" && m.feedback_status === "pendiente";
            const esFeedback  = m.feedback_status === "con_feedback";
            return (
              <div key={m.id}
                className="bg-white rounded-xl border shadow-sm p-4 flex items-center justify-between gap-4"
                style={{ borderColor: esPendiente ? "#fde68a" : esFeedback ? "#bbf7d0" : "#f1f5f9" }}>
                <div className="flex items-center gap-3 min-w-0">
                  {/* Estado feedback */}
                  <div className="shrink-0">
                    {esFeedback
                      ? <IconMessageCheck size={18} style={{ color: "#22c55e" }} />
                      : esPendiente
                        ? <IconAlertCircle size={18} style={{ color: "#f59e0b" }} />
                        : <IconClock size={18} className="text-gray-300" />
                    }
                  </div>
                  {/* Info reunión */}
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 truncate">{m.empresa}</div>
                    <div className="text-xs text-gray-500 truncate">
                      {[m.contacto_nombre, m.contacto_cargo].filter(Boolean).join(" · ")}
                      {m.fecha_reunion && ` · ${new Date(m.fecha_reunion + "T12:00:00").toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" })}`}
                      {m.sdr_nombre && ` · SDR: ${m.sdr_nombre}`}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/* Badge estado reunión */}
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-medium text-white"
                    style={{ background: REALIZADO_COLORS[m.realizado] ?? "#94a3b8" }}>
                    {m.realizado}
                  </span>
                  {/* Badge feedback */}
                  {esFeedback && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-100 text-green-700">
                      Con feedback
                    </span>
                  )}
                  {/* Link encuesta */}
                  {m.realizado === "Si" && (
                    <button onClick={() => handleCopy(m.feedback_token)}
                      title="Copiar link de encuesta"
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs border border-gray-200 hover:bg-gray-50 transition">
                      {copied === m.feedback_token ? <IconCheck size={13} className="text-green-500" /> : <IconLink size={13} />}
                      {copied === m.feedback_token ? "Copiado" : "Copiar link"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && currentClient?.id && currentClient.id !== "all" && (
        <NuevaReunionModal clientId={currentClient.id} onClose={() => setShowModal(false)} onSaved={load} />
      )}
      {showModal && (!currentClient?.id || currentClient.id === "all") && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl p-6 max-w-sm text-center">
            <p className="text-gray-700 mb-4">Selecciona un cliente específico para agregar reuniones.</p>
            <button onClick={() => setShowModal(false)} className="px-4 py-2 bg-gray-100 rounded-lg text-sm">Cerrar</button>
          </div>
        </div>
      )}

      {/* Instrucciones CSV */}
      <details className="mt-8">
        <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">Ver formato CSV para importar</summary>
        <div className="mt-3 p-4 bg-gray-50 rounded-xl text-xs text-gray-600 font-mono">
          <p className="mb-2 font-sans font-medium text-gray-700">Columnas esperadas (exporta tu Excel como CSV):</p>
          <p>ID Cliente, Empresa, Contacto Nombre, Contacto Cargo, Fecha Reunion, Realizado, SDR, Notas</p>
          <p className="mt-2 font-sans text-gray-500">• "Realizado" debe ser: Si / No / Pendiente / Reagendar</p>
          <p className="font-sans text-gray-500">• "ID Cliente" debe coincidir con el ID de cliente en la plataforma</p>
        </div>
      </details>
    </div>
  );
}
