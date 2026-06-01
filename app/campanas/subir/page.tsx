"use client";

import { useCallback, useRef, useState } from "react";
import { useClient } from "@/lib/clientContext";
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
  icebreaker?: string;
  error?: string;
};

type Stage = "idle" | "parsed" | "generating" | "preview" | "pushing" | "done";

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
  onChange,
}: {
  contact: GeneratedContact;
  index: number;
  onChange: (i: number, field: keyof GeneratedContact, val: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasError = Boolean(contact.error);

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
          <div className="text-xs text-ink-muted">{contact.email}</div>
        </div>
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
        <div className="px-4 pb-4 space-y-3 border-t border-[#E5E2F0] pt-3">
          {hasError && (
            <div className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{contact.error}</div>
          )}

          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Subject ({`{{emailSubject}}`})
            </label>
            <input
              value={contact.emailSubject ?? ""}
              onChange={(e) => onChange(index, "emailSubject", e.target.value)}
              className="mt-1 w-full text-sm border border-[#E5E2F0] rounded-lg px-3 py-2 outline-none focus:border-[#62E0D8]"
              placeholder="Asunto del email…"
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Email body ({`{{emailBody}}`})
            </label>
            <textarea
              value={contact.emailBody ?? ""}
              onChange={(e) => onChange(index, "emailBody", e.target.value)}
              rows={5}
              className="mt-1 w-full text-sm border border-[#E5E2F0] rounded-lg px-3 py-2 outline-none focus:border-[#62E0D8] resize-y"
              placeholder="Cuerpo del email…"
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              LinkedIn icebreaker ({`{{icebreaker}}`})
            </label>
            <div className="relative">
              <textarea
                value={contact.icebreaker ?? ""}
                onChange={(e) => onChange(index, "icebreaker", e.target.value)}
                rows={2}
                maxLength={180}
                className="mt-1 w-full text-sm border border-[#E5E2F0] rounded-lg px-3 py-2 outline-none focus:border-[#62E0D8] resize-none"
                placeholder="Icebreaker de LinkedIn…"
              />
              <span className="absolute bottom-2 right-3 text-[10px] text-ink-muted">
                {(contact.icebreaker ?? "").length}/180
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function SubirCampanaPage() {
  const { currentClient } = useClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stage, setStage]           = useState<Stage>("idle");
  const [parsed, setParsed]         = useState<ParsedContact[]>([]);
  const [contacts, setContacts]     = useState<GeneratedContact[]>([]);
  const [genProgress, setGenProgress] = useState(0);
  const [pushResult, setPushResult] = useState<{ pushed: number; skipped: number; errors: any[] } | null>(null);
  const [fileError, setFileError]   = useState<string | null>(null);

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
        setContacts(rows.map((r) => ({ ...r })));
        setStage("parsed");
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

  // ── Generar mensajes ──
  async function handleGenerate() {
    if (!currentClient?.id) return;
    setStage("generating");
    setGenProgress(0);

    const BATCH = 5;
    const updated = [...contacts];

    for (let i = 0; i < parsed.length; i += BATCH) {
      const batch = parsed.slice(i, i + BATCH);
      const res = await fetch("/api/lemlist/csv-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: currentClient.id, contacts: batch }),
      });
      if (res.ok) {
        const { results } = await res.json();
        results.forEach((r: GeneratedContact, j: number) => {
          updated[i + j] = { ...updated[i + j], ...r };
        });
      }
      setGenProgress(Math.min(i + BATCH, parsed.length));
      setContacts([...updated]);
    }

    setStage("preview");
  }

  // ── Editar mensaje generado ──
  function handleChange(index: number, field: keyof GeneratedContact, val: string) {
    setContacts((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: val };
      return next;
    });
  }

  // ── Push a Lemlist ──
  async function handlePush() {
    if (!currentClient?.id) return;
    setStage("pushing");
    const res = await fetch("/api/lemlist/csv-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: currentClient.id, contacts }),
    });
    const d = await res.json();
    setPushResult(d);
    setStage("done");
  }

  // ── Reset ──
  function reset() {
    setParsed([]);
    setContacts([]);
    setPushResult(null);
    setGenProgress(0);
    setFileError(null);
    setStage("idle");
  }

  if (!currentClient) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-ink-muted">Selecciona un cliente en el sidebar.</p>
      </div>
    );
  }

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
          Subí un Excel/CSV, generá mensajes personalizados con IA y enviá directo a Lemlist.
        </p>
      </header>

      {/* ── ETAPA: idle — drop zone ── */}
      {stage === "idle" && (
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
            <p className="font-semibold text-ink">Arrastrá tu archivo aquí o hacé click</p>
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
      {stage === "parsed" && (
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
                </tr>
              </thead>
              <tbody>
                {parsed.slice(0, 8).map((c, i) => (
                  <tr key={i} className="border-b border-[#F0EEF8] last:border-0">
                    <td className="px-4 py-2.5 font-medium text-ink">{[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{c.companyName || "—"}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{c.jobTitle || "—"}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{c.email || <span className="text-red-400">Sin email</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.length > 8 && (
              <p className="text-xs text-center text-ink-muted py-2 border-t border-[#E5E2F0]">
                …y {parsed.length - 8} más
              </p>
            )}
          </div>

          <button
            onClick={handleGenerate}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <IconSparkles size={15} />
            Generar mensajes con IA para {parsed.length} contactos
          </button>
        </div>
      )}

      {/* ── ETAPA: generating ── */}
      {stage === "generating" && (
        <div className="card px-6 py-10 flex flex-col items-center gap-5">
          <IconLoader2 size={32} className="animate-spin" style={{ color: "#62E0D8" }} />
          <div className="text-center">
            <p className="font-semibold text-ink">Generando mensajes con IA…</p>
            <p className="text-sm text-ink-muted mt-1">
              {genProgress} de {parsed.length} contactos procesados
            </p>
          </div>
          {/* Barra de progreso */}
          <div className="w-full max-w-sm bg-gray-100 rounded-full h-2">
            <div
              className="h-2 rounded-full transition-all duration-300"
              style={{ width: `${(genProgress / parsed.length) * 100}%`, background: "#62E0D8" }}
            />
          </div>
          <p className="text-xs text-ink-muted">Esto puede tomar {Math.ceil(parsed.length * 2.5 / 60)} minuto{parsed.length > 24 ? "s" : ""}…</p>
        </div>
      )}

      {/* ── ETAPA: preview — revisar y editar ── */}
      {stage === "preview" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-ink">
                Revisá y editá los mensajes antes de enviar
              </p>
              <p className="text-sm text-ink-muted">
                Hacé click en cada contacto para ver y editar el subject, body e icebreaker.
              </p>
            </div>
            <button
              onClick={handlePush}
              className="btn-primary flex items-center gap-2 text-sm shrink-0"
            >
              <IconSend size={14} />
              Enviar {contacts.length} a Lemlist
            </button>
          </div>

          <div className="space-y-2">
            {contacts.map((c, i) => (
              <ContactRow key={i} contact={c} index={i} onChange={handleChange} />
            ))}
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={handlePush}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              <IconSend size={14} />
              Enviar {contacts.length} a Lemlist
            </button>
          </div>
        </div>
      )}

      {/* ── ETAPA: pushing ── */}
      {stage === "pushing" && (
        <div className="card px-6 py-10 flex flex-col items-center gap-4">
          <IconLoader2 size={32} className="animate-spin" style={{ color: "#62E0D8" }} />
          <p className="font-semibold text-ink">Enviando contactos a Lemlist…</p>
        </div>
      )}

      {/* ── ETAPA: done ── */}
      {stage === "done" && pushResult && (
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
    </div>
  );
}
