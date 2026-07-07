"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useClient } from "@/lib/clientContext";
import { useGeneration } from "@/lib/generationContext";
import * as XLSX from "xlsx";
import {
  IconUpload,
  IconFileSpreadsheet,
  IconSparkles,
  IconSend,
  IconLoader2,
  IconCheck,
  IconAlertCircle,
  IconChevronDown,
  IconChevronUp,
  IconX,
  IconArrowLeft,
  IconEdit,
  IconSearch,
  IconPlayerStop,
  IconShare,
  IconLink,
  IconClipboard,
} from "@tabler/icons-react";
import Link from "next/link";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type ParsedContact = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  jobTitle?: string;
  companyName?: string;
  linkedinUrl?: string;
  industry?: string;
};

type GeneratedContact = ParsedContact & {
  emailSubject?: string;
  emailBody?: string;
  emailSubject2?: string;
  emailBody2?: string;
  emailSubject3?: string;
  emailBody3?: string;
  connectMessage?: string;
  icebreaker?: string;
  linkedinMsg2?: string;
  segmentName?: string;
  deepResearchUsed?: boolean;
  error?: string;
  cancelled?: boolean;
};

type Stage = "idle" | "parsed" | "segment" | "preview" | "pushing" | "done";

type SegmentOption = { id: string; name: string };

// ─── Mapeo de columnas del CSV/Excel ──────────────────────────────────────────

const COL_MAP: Record<string, keyof ParsedContact> = {
  "first name":      "firstName",
  "firstname":       "firstName",
  "nombre":          "firstName",
  "last name":       "lastName",
  "lastname":        "lastName",
  "apellido":        "lastName",
  "email":           "email",
  "correo":          "email",
  "e-mail":          "email",
  "phone":           "phone",
  "teléfono lemlist":"phone",
  "telefono":        "phone",
  "cargo":           "jobTitle",
  "position":        "jobTitle",
  "job title":       "jobTitle",
  "jobtitle":        "jobTitle",
  "título":          "jobTitle",
  "company name":    "companyName",
  "companyname":     "companyName",
  "empresa":         "companyName",
  "company":         "companyName",
  "url linkedin":    "linkedinUrl",
  "linkedin":        "linkedinUrl",
  "linkedinurl":     "linkedinUrl",
  "url del linkedin":"linkedinUrl",
  "industria bullseye": "industry",
  "indsutria bullseye": "industry",
  "industria":       "industry",
  "industry":        "industry",
};

function parseSheet(wb: XLSX.WorkBook): ParsedContact[] {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
  if (rows.length < 2) return [];

  const headers = (rows[0] as string[]).map((h) => String(h ?? "").toLowerCase().trim());
  const fieldIndexes: Partial<Record<keyof ParsedContact, number>> = {};

  headers.forEach((h, i) => {
    const field = COL_MAP[h];
    if (field && !(field in fieldIndexes)) fieldIndexes[field] = i;
  });

  const contacts: ParsedContact[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as any[];
    const get = (f: keyof ParsedContact) => {
      const idx = fieldIndexes[f];
      return idx !== undefined ? String(row[idx] ?? "").trim() : "";
    };
    const email = get("email");
    const firstName = get("firstName");
    if (!email && !firstName) continue;
    contacts.push({
      firstName:   get("firstName"),
      lastName:    get("lastName"),
      email:       get("email"),
      phone:       get("phone")      || undefined,
      jobTitle:    get("jobTitle")   || undefined,
      companyName: get("companyName")|| undefined,
      linkedinUrl: get("linkedinUrl")|| undefined,
      industry:    get("industry")   || undefined,
    });
  }
  return contacts;
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function ContactRow({
  contact,
  index,
  pending,
  deepResearch,
  onChange,
}: {
  contact: GeneratedContact;
  index: number;
  pending?: boolean;
  deepResearch?: boolean;
  onChange: (i: number, field: keyof GeneratedContact, val: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasError = Boolean(contact.error) && !contact.cancelled;

  // Contacto cancelado
  if (contact.cancelled) {
    return (
      <div className="card border border-gray-200 px-4 py-3 flex items-center gap-3 opacity-50">
        <div
          className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-bold bg-gray-300"
        >
          {[contact.firstName?.[0], contact.lastName?.[0]].filter(Boolean).join("").toUpperCase() || "?"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-ink line-through">
            {[contact.firstName, contact.lastName].filter(Boolean).join(" ") || "—"}
            {contact.companyName && <span className="text-ink-muted font-normal"> · {contact.companyName}</span>}
          </div>
          <div className="text-xs text-ink-muted">{contact.email}</div>
        </div>
        <span className="text-xs text-gray-400 shrink-0">Cancelado</span>
      </div>
    );
  }

  // Tarjeta simplificada mientras se está generando
  if (pending) {
    return (
      <div className="card border border-[#E5E2F0] px-4 py-3 flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-bold"
          style={{ background: "#251762" }}
        >
          {[contact.firstName?.[0], contact.lastName?.[0]].filter(Boolean).join("").toUpperCase() || "?"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-ink">
            {[contact.firstName, contact.lastName].filter(Boolean).join(" ") || "—"}
            {contact.companyName && <span className="text-ink-muted font-normal"> · {contact.companyName}</span>}
          </div>
          <div className="text-xs text-ink-muted">
            {contact.jobTitle && <span className="mr-2">{contact.jobTitle}</span>}
            {contact.email}
          </div>
        </div>
        {deepResearch && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0" style={{ background: "rgba(98,224,216,0.15)", color: "#0fa89a" }}>
            <IconSearch size={9} className="inline mr-0.5 -mt-px" />Inv. profunda
          </span>
        )}
        <IconLoader2 size={16} className="animate-spin shrink-0" style={{ color: "#62E0D8" }} />
      </div>
    );
  }

  return (
    <div className={`card border ${hasError ? "border-red-200" : "border-[#E5E2F0]"}`}>
      {/* Cabecera */}
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition rounded-xl"
      >
        <div
          className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-bold"
          style={{ background: "#251762" }}
        >
          {[contact.firstName?.[0], contact.lastName?.[0]].filter(Boolean).join("").toUpperCase() || "?"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-ink">
            {[contact.firstName, contact.lastName].filter(Boolean).join(" ") || "—"}
            {contact.companyName && <span className="text-ink-muted font-normal"> · {contact.companyName}</span>}
          </div>
          <div className="text-xs text-ink-muted">
            {contact.jobTitle && <span className="mr-2">{contact.jobTitle}</span>}
            {contact.email}
          </div>
        </div>
        {deepResearch && (
          contact.deepResearchUsed === true ? (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0" style={{ background: "rgba(98,224,216,0.15)", color: "#0fa89a" }}>
              <IconSearch size={9} className="inline mr-0.5 -mt-px" />Inv. profunda
            </span>
          ) : contact.deepResearchUsed === false ? (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0 bg-amber-50 text-amber-600">
              <IconSearch size={9} className="inline mr-0.5 -mt-px" />Sin datos
            </span>
          ) : (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0" style={{ background: "rgba(98,224,216,0.08)", color: "#62b8b0" }}>
              <IconSearch size={9} className="inline mr-0.5 -mt-px" />Investigando…
            </span>
          )
        )}
        {hasError ? (
          <span className="text-xs text-red-500 flex items-center gap-1">
            <IconAlertCircle size={12} /> Error
          </span>
        ) : contact.emailSubject ? (
          <span className="text-xs text-green-600 flex items-center gap-1">
            <IconCheck size={12} /> Generado
          </span>
        ) : null}
        {open ? <IconChevronUp size={14} className="text-ink-muted shrink-0" /> : <IconChevronDown size={14} className="text-ink-muted shrink-0" />}
      </button>

      {/* Detalle editable */}
      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-[#E5E2F0] pt-3">
          {hasError && (
            <div className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{contact.error}</div>
          )}
          {contact.segmentName && (
            <div className="text-[11px] text-ink-muted">Segmento: <span className="font-medium text-ink">{contact.segmentName}</span></div>
          )}
          {deepResearch && contact.deepResearchUsed === false && (
            <div className="text-[11px] text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
              No se encontró la empresa en Supabase ni en Perplexity — el mensaje se generó sin investigación profunda.
            </div>
          )}

          {/* Emails */}
          {[
            { subjectKey: "emailSubject" as const, bodyKey: "emailBody" as const, label: "Email 1", subjectVar: "emailSubject_1", bodyVar: "emailBody_1" },
            { subjectKey: "emailSubject2" as const, bodyKey: "emailBody2" as const, label: "Email 2 (follow-up)", subjectVar: "emailSubject_2", bodyVar: "emailBody_2" },
            { subjectKey: "emailSubject3" as const, bodyKey: "emailBody3" as const, label: "Email 3 (follow-up)", subjectVar: "emailSubject_3", bodyVar: "emailBody_3" },
          ].map(({ subjectKey, bodyKey, label, subjectVar, bodyVar }) =>
            contact[subjectKey] !== undefined ? (
              <div key={subjectKey} className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
                <input
                  value={contact[subjectKey] ?? ""}
                  onChange={(e) => onChange(index, subjectKey, e.target.value)}
                  className="w-full text-sm border border-[#E5E2F0] rounded-lg px-3 py-2 outline-none focus:border-[#62E0D8]"
                  placeholder={`Asunto — {{${subjectVar}}}`}
                />
                <textarea
                  value={contact[bodyKey] ?? ""}
                  onChange={(e) => onChange(index, bodyKey, e.target.value)}
                  rows={4}
                  className="w-full text-sm border border-[#E5E2F0] rounded-lg px-3 py-2 outline-none focus:border-[#62E0D8] resize-y"
                  placeholder={`Cuerpo — {{${bodyVar}}}`}
                />
              </div>
            ) : null
          )}

          {/* Invitación a conectar */}
          {contact.connectMessage !== undefined && (
            <div className="space-y-1">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                Invitación a conectar ({`{{connectMessage}}`})
              </label>
              <div className="relative">
                <textarea
                  value={contact.connectMessage ?? ""}
                  onChange={(e) => onChange(index, "connectMessage", e.target.value)}
                  rows={2}
                  maxLength={190}
                  className="w-full text-sm border border-[#E5E2F0] rounded-lg px-3 py-2 outline-none focus:border-[#62E0D8] resize-none"
                  placeholder="Nota de invitación LinkedIn…"
                />
                <span className="absolute bottom-2 right-3 text-[10px] text-ink-muted">
                  {(contact.connectMessage ?? "").length}/190
                </span>
              </div>
            </div>
          )}

          {/* Mensajes LinkedIn */}
          {[
            { key: "icebreaker" as const, label: "LinkedIn msg 1", varName: "linkedinMsg_1", max: 400 },
            { key: "linkedinMsg2" as const, label: "LinkedIn msg 2", varName: "linkedinMsg_2", max: 400 },
          ].map(({ key, label, varName, max }) =>
            contact[key] !== undefined ? (
              <div key={key} className="space-y-1">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  {label} ({`{{${varName}}}`})
                </label>
                <div className="relative">
                  <textarea
                    value={contact[key] ?? ""}
                    onChange={(e) => onChange(index, key, e.target.value)}
                    rows={2}
                    maxLength={max}
                    className="w-full text-sm border border-[#E5E2F0] rounded-lg px-3 py-2 outline-none focus:border-[#62E0D8] resize-none"
                    placeholder={`Mensaje LinkedIn…`}
                  />
                  <span className="absolute bottom-2 right-3 text-[10px] text-ink-muted">
                    {(contact[key] ?? "").length}/{max}
                  </span>
                </div>
              </div>
            ) : null
          )}
        </div>
      )}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function SubirCampanaPage() {
  const { currentClient } = useClient();
  const generation = useGeneration();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Estado local de UI (no necesita sobrevivir navegación)
  const [stage, setStage]           = useState<Stage>("idle");
  const [parsed, setParsed]         = useState<ParsedContact[]>([]);
  const [pushResult, setPushResult] = useState<{ pushed: number; skipped: number; errors: any[] } | null>(null);
  const [fileError, setFileError]   = useState<string | null>(null);
  const [segments, setSegments]         = useState<SegmentOption[]>([]);
  const [segmentsLoading, setSegmentsLoading] = useState(false);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string>("");
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(new Set());
  const [deepResearchSet, setDeepResearchSet] = useState<Set<number>>(new Set());
  const [localEdits, setLocalEdits] = useState<Record<number, Partial<GeneratedContact>>>({});
  const [reviewModalOpen, setReviewModalOpen] = useState(false);

  // Si hay una generación activa para este cliente, mostrar directamente la preview
  const isActiveGeneration =
    generation.stage !== "idle" && generation.clientId === currentClient?.id;

  // Alias para facilitar acceso a datos del contexto cuando está activo
  const contacts = isActiveGeneration ? generation.contacts : [];
  const isGenerating = isActiveGeneration ? generation.isGenerating : false;
  const genProgress = isActiveGeneration ? generation.genProgress : 0;
  const genErrors = isActiveGeneration ? generation.genErrors : 0;

  // Seleccionar automáticamente los contactos exitosos cuando termina la generación
  useEffect(() => {
    if (isActiveGeneration && !isGenerating && contacts.length > 0 && selectedIndexes.size === 0) {
      setSelectedIndexes(new Set(contacts.map((c, i) => (!c.error ? i : -1)).filter((i) => i >= 0)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGenerating, isActiveGeneration]);

  // ── Cargar segmentos del cliente (se ejecuta al montar y cuando cambia el cliente) ──
  useEffect(() => {
    if (!currentClient?.id) return;
    setSegmentsLoading(true);
    (async () => {
      const MAX_ATTEMPTS = 4;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
          const r = await fetch(`/api/training/segments?client_id=${currentClient.id}`);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const { segments: segs } = await r.json();
          const mapped = (segs ?? []).map((s: { id: string; name: string }) => ({ id: s.id, name: s.name }));
          setSegments(mapped);
          setSelectedSegmentId((prev) => prev || mapped[0]?.id || "");
          break;
        } catch {
          if (attempt < MAX_ATTEMPTS - 1) await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
        }
      }
      setSegmentsLoading(false);
    })();
  }, [currentClient?.id]);

  // ── Procesar archivo ──
  const handleFile = useCallback((file: File) => {
    setFileError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const wb = XLSX.read(data, { type: "array" });
        const rows = parseSheet(wb);
        if (rows.length === 0) {
          setFileError("No se encontraron contactos en el archivo. Verificá que el formato de columnas sea correcto.");
          return;
        }
        setParsed(rows);
        setDeepResearchSet(new Set());
        setStage("segment");
      } catch {
        setFileError("Error al leer el archivo. Asegurate de que sea un CSV o Excel válido.");
      }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  // ── Generar mensajes — delega al contexto global para que sobreviva navegación ──
  function handleGenerate() {
    if (!currentClient?.id) return;
    // Pasar a vista preview local
    setStage("preview");
    // Iniciar loop en el contexto global
    generation.startGeneration({
      clientId: currentClient.id,
      parsed,
      segmentId: selectedSegmentId,
      deepResearchSet,
    });
  }

  // ── Editar mensaje generado (los datos viven en el contexto) ──
  // Nota: la edición in-place no requiere persistencia en el contexto;
  // se usa un estado local de overrides para no interferir con el loop.
  function handleChange(index: number, field: keyof GeneratedContact, val: string) {
    setLocalEdits((prev) => ({
      ...prev,
      [index]: { ...prev[index], [field]: val },
    }));
  }

  // Mezclar datos del contexto con ediciones locales
  const displayContacts = contacts.map((c, i) =>
    localEdits[i] ? { ...c, ...localEdits[i] } : c
  );

  // ── Push a Lemlist (solo los seleccionados) ──
  async function handlePush() {
    if (!currentClient?.id) return;
    setStage("pushing");
    const toSend = displayContacts.filter((_, i) => selectedIndexes.has(i));
    const res = await fetch("/api/lemlist/csv-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: currentClient.id, contacts: toSend }),
    });
    const d = await res.json();
    setPushResult(d);
    // Limpiar contexto de generación para que el indicador del sidebar desaparezca
    generation.resetGeneration();
    setStage("done");
  }

  function toggleSelect(i: number) {
    setSelectedIndexes((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIndexes((prev) =>
      prev.size === displayContacts.length ? new Set() : new Set(displayContacts.map((_, i) => i))
    );
  }

  function toggleDeepResearch(i: number) {
    setDeepResearchSet((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  function toggleDeepResearchAll() {
    setDeepResearchSet((prev) =>
      prev.size === parsed.length ? new Set() : new Set(parsed.map((_, i) => i))
    );
  }

  // ── Reset ──
  function reset() {
    generation.resetGeneration();
    setParsed([]);
    setPushResult(null);
    setFileError(null);
    setSegments([]);
    setSelectedSegmentId("");
    setSelectedIndexes(new Set());
    setDeepResearchSet(new Set());
    setLocalEdits({});
    setStage("idle");
  }

  if (!currentClient) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-ink-muted">Selecciona un cliente en el sidebar.</p>
      </div>
    );
  }

  // Si hay una generación activa para este cliente, redirigir a vista preview.
  // Solo aplica cuando el stage local es "idle" (no ha arrancado el push).
  const effectiveStage: Stage = (isActiveGeneration && stage === "idle") ? "preview" : stage;

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Header */}
      <header>
        <Link
          href="/campanas"
          className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink mb-3 transition"
        >
          <IconArrowLeft size={14} /> Volver a Campañas
        </Link>
        <div className="label">Outreach</div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <IconFileSpreadsheet size={22} style={{ color: "#62E0D8" }} /> Carga masiva desde Excel
        </h1>
        <p className="text-sm text-ink-muted mt-0.5">
          Sube un Excel/CSV, genera mensajes personalizados con IA y envía directo a Lemlist.
        </p>
      </header>

      {/* ── ETAPA: idle — drop zone ── */}
      {effectiveStage === "idle" && (
        <div
          className="card border-2 border-dashed border-[#E5E2F0] rounded-2xl flex flex-col items-center justify-center py-16 gap-4 cursor-pointer hover:border-[#62E0D8] transition"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: "rgba(98,224,216,0.12)" }}
          >
            <IconUpload size={26} style={{ color: "#62E0D8" }} />
          </div>
          <div className="text-center">
            <p className="font-semibold text-ink">Arrastra tu archivo aquí o haz clic</p>
            <p className="text-sm text-ink-muted mt-1">CSV o Excel (.csv, .xlsx, .xls)</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          {fileError && (
            <p className="text-sm text-red-500 flex items-center gap-1.5">
              <IconAlertCircle size={14} /> {fileError}
            </p>
          )}
        </div>
      )}

      {/* ── ETAPA: parsed — confirmar contactos ── */}
      {effectiveStage === "parsed" && (
        <div className="space-y-4">
          <div className="card px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <IconCheck size={16} style={{ color: "#62E0D8" }} />
              <span className="text-sm font-medium text-ink">
                {parsed.length} contactos cargados del archivo
              </span>
            </div>
            <button onClick={reset} className="text-xs text-ink-muted hover:text-ink transition flex items-center gap-1">
              <IconX size={12} /> Cambiar archivo
            </button>
          </div>

          {/* Preview tabla */}
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E5E2F0]">
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Nombre</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Empresa</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Cargo</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Email</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {parsed.map((c, i) => (
                  <tr key={i} className="border-b border-[#F0EEF8] last:border-0 group">
                    <td className="px-4 py-2.5 font-medium text-ink">{[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{c.companyName || "—"}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{c.jobTitle || "—"}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{c.email || <span className="text-red-400">Sin email</span>}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => setParsed((prev) => prev.filter((_, j) => j !== i))}
                        className="opacity-0 group-hover:opacity-100 transition text-gray-400 hover:text-red-500"
                        title="Eliminar contacto"
                      >
                        <IconX size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            onClick={handleGenerate}
            className="btn-primary flex items-center gap-2 text-sm"
            disabled={parsed.length === 0}
          >
            <IconSparkles size={15} />
            Generar mensajes con IA para {parsed.length} contacto{parsed.length !== 1 ? "s" : ""}
          </button>
        </div>
      )}

      {/* ── ETAPA: segment — elegir segmento ── */}
      {effectiveStage === "segment" && (
        <div className="space-y-4">
          <div className="card px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <IconCheck size={16} style={{ color: "#62E0D8" }} />
              <span className="text-sm font-medium text-ink">
                {parsed.length} contactos cargados
              </span>
            </div>
            <button onClick={reset} className="text-xs text-ink-muted hover:text-ink transition flex items-center gap-1">
              <IconX size={12} /> Cambiar archivo
            </button>
          </div>

          <div className="card px-5 py-5 space-y-4">
            <div>
              <p className="font-semibold text-ink">Elige el segmento para esta carga</p>
              <p className="text-sm text-ink-muted mt-0.5">
                Claude usará las fuentes de conocimiento, ejemplos y guía de estilo del segmento seleccionado para generar todos los mensajes.
              </p>
            </div>

            {segmentsLoading ? (
              <div className="flex items-center gap-2 text-sm text-ink-muted py-1">
                <IconLoader2 size={14} className="animate-spin shrink-0" style={{ color: "#62E0D8" }} />
                Cargando segmentos…
              </div>
            ) : segments.length === 0 ? (
              <p className="text-sm text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
                No hay segmentos configurados. Los mensajes se generarán con el contexto general del cliente.
              </p>
            ) : (
              <div className="space-y-2">
                {segments.map((seg) => (
                  <button
                    key={seg.id}
                    onClick={() => setSelectedSegmentId(seg.id)}
                    className={`w-full text-left px-4 py-3 rounded-xl border transition text-sm font-medium ${
                      selectedSegmentId === seg.id
                        ? "border-[#62E0D8] bg-[rgba(98,224,216,0.08)] text-ink"
                        : "border-[#E5E2F0] hover:border-[#62E0D8] text-ink"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full border-2 shrink-0 ${selectedSegmentId === seg.id ? "border-[#62E0D8] bg-[#62E0D8]" : "border-gray-300"}`} />
                      {seg.name}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* ── Investigación profunda por contacto ── */}
            <div className="border border-[#E5E2F0] rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-[#E5E2F0]">
                <div className="flex items-center gap-2">
                  <IconSearch size={14} style={{ color: "#62E0D8" }} />
                  <p className="font-semibold text-sm text-ink">Investigación profunda por contacto (Perplexity)</p>
                </div>
                <p className="text-xs text-ink-muted mt-0.5">
                  Actívala para los contactos más importantes. Consume créditos de Perplexity y agrega ~30s por contacto.
                </p>
              </div>

              {/* Seleccionar todos */}
              <div className="px-4 py-2.5 border-b border-[#E5E2F0] flex items-center gap-2">
                <button
                  onClick={toggleDeepResearchAll}
                  className="flex items-center gap-2 text-sm text-ink-muted hover:text-ink transition"
                >
                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition ${deepResearchSet.size === parsed.length && parsed.length > 0 ? "border-[#62E0D8] bg-[#62E0D8]" : "border-gray-300"}`}>
                    {deepResearchSet.size === parsed.length && parsed.length > 0 && <IconCheck size={10} className="text-white" strokeWidth={3} />}
                  </div>
                  Activar para todos
                </button>
              </div>

              {/* Lista por contacto */}
              <div className="divide-y divide-[#F0EEF8]">
                {parsed.map((c, i) => (
                  <div key={i} className="group flex items-center hover:bg-gray-50 transition">
                    <button
                      onClick={() => toggleDeepResearch(i)}
                      className="flex-1 flex items-center gap-3 px-4 py-2.5 text-left"
                    >
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition ${deepResearchSet.has(i) ? "border-[#62E0D8] bg-[#62E0D8]" : "border-gray-300"}`}>
                        {deepResearchSet.has(i) && <IconCheck size={10} className="text-white" strokeWidth={3} />}
                      </div>
                      <span className="text-sm text-ink font-medium">
                        {[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"}
                      </span>
                      {c.companyName && (
                        <span className="text-sm text-ink-muted">· {c.companyName}</span>
                      )}
                      {c.jobTitle && (
                        <span className="text-xs text-ink-muted ml-auto shrink-0">{c.jobTitle}</span>
                      )}
                    </button>
                    <button
                      onClick={() => setParsed((prev) => prev.filter((_, j) => j !== i))}
                      className="opacity-0 group-hover:opacity-100 transition px-3 text-gray-400 hover:text-red-500 shrink-0"
                      title="Eliminar contacto"
                    >
                      <IconX size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={handleGenerate}
              disabled={segmentsLoading || parsed.length === 0}
              className="btn-primary flex items-center gap-2 text-sm w-full justify-center disabled:opacity-50"
            >
              {segmentsLoading ? <IconLoader2 size={15} className="animate-spin" /> : <IconSparkles size={15} />}
              {segmentsLoading ? "Cargando segmentos…" : `Generar mensajes con IA para ${parsed.length} contactos`}
            </button>
          </div>
        </div>
      )}

      {/* ── ETAPA: preview — revisar y editar (también muestra progreso mientras isGenerating) ── */}
      {effectiveStage === "preview" && (
        <div className="space-y-4">
          {/* Barra de progreso — solo visible mientras genera */}
          {isGenerating && (
            <div className="card px-5 py-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <IconLoader2 size={15} className="animate-spin" style={{ color: "#62E0D8" }} />
                  <span className="font-medium text-sm text-ink">Generando mensajes…</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-ink-muted">
                    {genProgress} de {generation.contacts.length}
                    {genErrors > 0 && <span className="text-red-500 ml-2">· {genErrors} errores</span>}
                    {" · "}Tiempo estimado: ~{Math.ceil((generation.contacts.length - genProgress) * 20 / 60)} min
                  </span>
                  <button
                    onClick={() => generation.cancelAll()}
                    className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 px-2.5 py-1 rounded-lg transition"
                  >
                    <IconPlayerStop size={12} />
                    Cancelar todo
                  </button>
                </div>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5">
                <div
                  className="h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${generation.contacts.length > 0 ? (genProgress / generation.contacts.length) * 100 : 0}%`, background: "#62E0D8" }}
                />
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-ink">
                {isGenerating ? "Los mensajes aparecen a medida que se generan" : "Revisa y edita los mensajes antes de enviar"}
              </p>
              <p className="text-sm text-ink-muted">
                Selecciona los contactos que quieres enviar a Lemlist.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!isGenerating && generation.contacts.some(c => !c.error && !c.cancelled && (c.emailSubject || c.connectMessage)) && (
                <button
                  onClick={() => setReviewModalOpen(true)}
                  className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-[#E5E2F0] hover:border-[#62E0D8] text-ink-muted hover:text-ink transition"
                >
                  <IconShare size={14} />
                  Compartir revisión
                </button>
              )}
              <button
                onClick={handlePush}
                disabled={isGenerating || selectedIndexes.size === 0}
                className="btn-primary flex items-center gap-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <IconSend size={14} />
                Enviar {selectedIndexes.size} a Lemlist
              </button>
            </div>
          </div>

          {/* Barra de selección */}
          <div className="card px-4 py-2.5 flex items-center justify-between">
            <button
              onClick={toggleSelectAll}
              className="text-sm flex items-center gap-2 text-ink-muted hover:text-ink transition"
            >
              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition ${displayContacts.length > 0 && selectedIndexes.size === displayContacts.length ? "border-[#62E0D8] bg-[#62E0D8]" : "border-gray-300"}`}>
                {displayContacts.length > 0 && selectedIndexes.size === displayContacts.length && <IconCheck size={10} className="text-white" strokeWidth={3} />}
              </div>
              {displayContacts.length > 0 && selectedIndexes.size === displayContacts.length ? "Deseleccionar todos" : "Seleccionar todos"}
            </button>
            <span className="text-xs text-ink-muted">
              {selectedIndexes.size} de {displayContacts.length} seleccionados
            </span>
          </div>

          <div className="space-y-2">
            {displayContacts.map((c, i) => {
              // Contacto aún no generado (sin emailSubject y sin error): mostrar spinner
              const isPending = isGenerating && i >= genProgress;

              const isCancelled = Boolean(c.cancelled);

              return (
                <div key={i} className="flex items-start gap-3">
                  <button
                    onClick={() => !isPending && !isCancelled && toggleSelect(i)}
                    disabled={isPending || isCancelled}
                    className={`mt-3.5 w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition ${isPending || isCancelled ? "border-gray-200 cursor-not-allowed" : selectedIndexes.has(i) ? "border-[#62E0D8] bg-[#62E0D8]" : "border-gray-300 hover:border-[#62E0D8]"}`}
                  >
                    {!isPending && !isCancelled && selectedIndexes.has(i) && <IconCheck size={10} className="text-white" strokeWidth={3} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <ContactRow contact={c} index={i} pending={isPending} deepResearch={generation.deepResearchSet.has(i)} onChange={handleChange} />
                  </div>
                  {/* Botón cancelar contacto individual — solo para pendientes */}
                  {isPending && !isCancelled && (
                    <button
                      onClick={() => generation.cancelContact(i)}
                      title="Cancelar este contacto"
                      className="mt-3 p-1 rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 transition shrink-0"
                    >
                      <IconX size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {!isGenerating && (
            <div className="flex items-center justify-between pt-2">
              {/* Botón de nueva carga cuando la generación en contexto ya terminó */}
              {generation.stage === "done" && isActiveGeneration ? (
                <button
                  onClick={reset}
                  className="text-sm border border-[#E5E2F0] px-4 py-2 rounded-lg hover:bg-gray-50 transition flex items-center gap-1.5"
                >
                  <IconX size={13} /> Nueva carga
                </button>
              ) : (
                <div />
              )}
              <button
                onClick={handlePush}
                disabled={selectedIndexes.size === 0}
                className="btn-primary flex items-center gap-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <IconSend size={14} />
                Enviar {selectedIndexes.size} a Lemlist
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── ETAPA: pushing ── */}
      {effectiveStage === "pushing" && (
        <div className="card px-6 py-10 flex flex-col items-center gap-4">
          <IconLoader2 size={32} className="animate-spin" style={{ color: "#62E0D8" }} />
          <p className="font-semibold text-ink">Enviando contactos a Lemlist…</p>
        </div>
      )}

      {/* ── ETAPA: done ── */}
      {effectiveStage === "done" && pushResult && (
        <div className="space-y-4">
          <div
            className="card px-5 py-5 border-l-4 space-y-2"
            style={{ borderColor: "#62E0D8" }}
          >
            <div className="flex items-center gap-2">
              <IconCheck size={20} style={{ color: "#62E0D8" }} />
              <span className="font-semibold text-ink text-lg">
                {pushResult.pushed} contactos enviados a Lemlist
              </span>
            </div>
            {pushResult.skipped > 0 && (
              <p className="text-sm text-ink-muted">{pushResult.skipped} saltados (sin email)</p>
            )}
          </div>

          {pushResult.errors.length > 0 && (
            <div className="card border-l-4 border-red-300 px-5 py-4 space-y-1">
              <p className="text-sm font-semibold text-red-600">{pushResult.errors.length} errores:</p>
              {pushResult.errors.map((e, i) => (
                <p key={i} className="text-xs text-red-500">{e.email}: {e.error}</p>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            <Link href="/campanas" className="btn-primary text-sm flex items-center gap-2">
              <IconSend size={14} /> Ver campaña
            </Link>
            <button onClick={reset} className="text-sm border border-[#E5E2F0] px-4 py-2 rounded-lg hover:bg-gray-50 transition">
              Subir otro archivo
            </button>
          </div>
        </div>
      )}

      {reviewModalOpen && (
        <ReviewModal
          contacts={generation.contacts}
          clientId={currentClient?.id ?? ""}
          clientName={currentClient?.name ?? ""}
          onClose={() => setReviewModalOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Modal de revisión compartible ────────────────────────────────────────────

function ReviewModal({
  contacts, clientId, clientName, onClose,
}: {
  contacts: GeneratedContact[];
  clientId: string;
  clientName: string;
  onClose: () => void;
}) {
  const eligible = contacts.filter((c) => !c.error && !c.cancelled && (c.emailSubject || c.connectMessage));
  const [selected, setSelected] = useState<Set<number>>(new Set(eligible.map((_, i) => i)));
  const [creating, setCreating] = useState(false);
  const [link, setLink]         = useState<string | null>(null);
  const [copied, setCopied]     = useState(false);

  function toggleOne(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => prev.size === eligible.length ? new Set() : new Set(eligible.map((_, i) => i)));
  }

  async function createLink() {
    setCreating(true);
    const toShare = eligible.filter((_, i) => selected.has(i));
    const res = await fetch("/api/review-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId || null, client_name: clientName || null, contacts: toShare }),
    });
    const data = await res.json();
    setCreating(false);
    if (res.ok) {
      const url = `${window.location.origin}/revision/${data.token}`;
      setLink(url);
    }
  }

  async function copyLink() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F1EEF7]">
          <div>
            <h2 className="font-semibold text-lg text-ink">Compartir para revisión</h2>
            <p className="text-sm text-ink-muted mt-0.5">Elige qué contactos incluir en el link</p>
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink p-1 rounded-lg hover:bg-[#F1EEF7]">
            <IconX size={18} />
          </button>
        </div>

        {!link && (
          <>
            <div className="px-6 py-3 border-b border-[#F1EEF7] flex items-center justify-between">
              <button onClick={toggleAll} className="text-sm text-ink-muted hover:text-ink flex items-center gap-2">
                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition ${selected.size === eligible.length ? "border-[#62E0D8] bg-[#62E0D8]" : "border-gray-300"}`}>
                  {selected.size === eligible.length && <IconCheck size={10} className="text-white" strokeWidth={3} />}
                </div>
                {selected.size === eligible.length ? "Deseleccionar todos" : "Seleccionar todos"}
              </button>
              <span className="text-xs text-ink-muted">{selected.size} seleccionado{selected.size !== 1 ? "s" : ""}</span>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-3 space-y-1">
              {eligible.map((c, i) => {
                const fullName = [c.firstName, c.lastName].filter(Boolean).join(" ") || "(sin nombre)";
                const isSelected = selected.has(i);
                return (
                  <button
                    key={i}
                    onClick={() => toggleOne(i)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition text-left ${isSelected ? "bg-[rgba(98,224,216,0.08)] border border-[rgba(98,224,216,0.3)]" : "hover:bg-[#F8F6FC] border border-transparent"}`}
                  >
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition ${isSelected ? "border-[#62E0D8] bg-[#62E0D8]" : "border-gray-300"}`}>
                      {isSelected && <IconCheck size={10} className="text-white" strokeWidth={3} />}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-sm text-ink truncate">{fullName}</div>
                      {c.companyName && <div className="text-xs text-ink-muted truncate">{c.companyName}</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {link && (
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 space-y-4">
            <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "rgba(98,224,216,0.15)" }}>
              <IconLink size={22} style={{ color: "#62E0D8" }} />
            </div>
            <div className="text-center">
              <p className="font-semibold text-ink">Link generado</p>
              <p className="text-sm text-ink-muted mt-1">Válido por 7 días · {selected.size} contacto{selected.size !== 1 ? "s" : ""}</p>
            </div>
            <div className="w-full bg-[#F8F6FC] rounded-xl px-4 py-3 text-xs text-ink-muted font-mono break-all border border-[#E5E2F0]">
              {link}
            </div>
            <button onClick={copyLink} className="btn-primary w-full flex items-center justify-center gap-2">
              {copied ? <><IconCheck size={14} /> Copiado</> : <><IconClipboard size={14} /> Copiar link</>}
            </button>
          </div>
        )}

        {!link && (
          <div className="px-6 py-4 border-t border-[#F1EEF7] flex items-center justify-between">
            <button onClick={onClose} className="btn-secondary">Cancelar</button>
            <button
              onClick={createLink}
              disabled={creating || selected.size === 0}
              className="btn-primary flex items-center gap-2 disabled:opacity-40"
            >
              {creating
                ? <><IconLoader2 size={14} className="animate-spin" /> Generando…</>
                : <><IconShare size={14} /> Generar link ({selected.size})</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
