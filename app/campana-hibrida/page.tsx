"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useClient } from "@/lib/clientContext";
import {
  IconUpload, IconSparkles, IconSend, IconCheck, IconX,
  IconLoader2, IconEdit, IconChevronDown, IconAlertTriangle,
  IconDownload, IconRefresh,
} from "@tabler/icons-react";
import type { MatrixRow, ContactRow } from "@/app/api/campana-hibrida/generate/route";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Step = "config" | "upload" | "generate" | "review";

type Campaign = { id: string; name: string };

// ─── Helpers CSV ──────────────────────────────────────────────────────────────

const REQUIRED_COLS = ["empresa", "sitio_web", "linkedin_url", "nombre", "apellido", "cargo", "email"];

function parseCSV(text: string): ContactRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(/[,;]/).map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = line.split(/[,;]/).map(v => v.trim().replace(/^"|"$/g, ""));
    const obj: any = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
    return {
      empresa:      obj.empresa      ?? "",
      sitio_web:    obj.sitio_web    ?? obj.website ?? "",
      linkedin_url: obj.linkedin_url ?? obj.linkedin ?? "",
      nombre:       obj.nombre       ?? obj.first_name ?? "",
      apellido:     obj.apellido     ?? obj.last_name  ?? "",
      cargo:        obj.cargo        ?? obj.title      ?? "",
      email:        obj.email        ?? "",
    } as ContactRow;
  }).filter(r => r.email && r.empresa);
}

function toCSV(rows: MatrixRow[]): string {
  const headers = ["empresa", "sitio_web", "linkedin_url", "nombre", "apellido", "cargo", "email", "senalEmpresa", "hipotesisDolor", "status"];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(headers.map(h => `"${((r as any)[h] ?? "").replace(/"/g, '""')}"`).join(","));
  }
  return lines.join("\n");
}

// ─── Componentes menores ──────────────────────────────────────────────────────

function StepBadge({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  return (
    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0
      ${done ? "bg-[#62E0D8] text-[#251762]" : active ? "bg-[#62E0D8]/20 text-[#62E0D8] border border-[#62E0D8]" : "bg-surface-2 text-ink-muted"}`}>
      {done ? <IconCheck size={16} /> : n}
    </div>
  );
}

function StepHeader({ n, title, active, done }: { n: number; title: string; active: boolean; done: boolean }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <StepBadge n={n} active={active} done={done} />
      <h2 className={`font-semibold ${active ? "text-ink" : done ? "text-ink-muted" : "text-ink-muted"}`}>{title}</h2>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function CampanaHibridaPage() {
  const { currentClient } = useClient();
  const clientId   = currentClient?.id   ?? null;
  const clientName = currentClient?.name ?? null;

  const [step, setStep] = useState<Step>("config");

  // Config
  const [campaigns, setCampaigns]     = useState<Campaign[]>([]);
  const [campaignId, setCampaignId]   = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [loadingCamps, setLoadingCamps] = useState(false);
  const [icpLoaded, setIcpLoaded]       = useState(false);
  const [icpSummary, setIcpSummary]     = useState("");
  const [sourcesCount, setSourcesCount] = useState<number | null>(null);

  // Upload
  const fileRef = useRef<HTMLInputElement>(null);
  const [contacts, setContacts]       = useState<ContactRow[]>([]);
  const [csvError, setCsvError]       = useState("");

  // Generación
  const [generating, setGenerating]   = useState(false);
  const [genError, setGenError]       = useState("");
  const [matrix, setMatrix]           = useState<MatrixRow[]>([]);

  // Push
  const [pushing, setPushing]         = useState(false);
  const [pushResult, setPushResult]   = useState<{ ok: number; error: number } | null>(null);

  // Cargar campañas y ICP al cambiar cliente
  useEffect(() => {
    if (!clientId || clientId === "__all__") return;
    setIcpLoaded(false);
    setIcpSummary("");
    setSourcesCount(null);
    setCampaigns([]);
    setCampaignId("");

    setLoadingCamps(true);
    // Contar fuentes de conocimiento del cliente
    fetch(`/api/training/segments?client_id=${clientId}`)
      .then(r => r.json())
      .then(async d => {
        const segs = d.segments ?? [];
        if (!segs.length) { setSourcesCount(0); return; }
        const counts = await Promise.all(segs.map((s: any) =>
          fetch(`/api/training/segments/${s.id}/sources`)
            .then(r => r.json())
            .then(d2 => (d2.sources ?? []).length)
            .catch(() => 0)
        ));
        setSourcesCount(counts.reduce((a: number, b: number) => a + b, 0));
      })
      .catch(() => setSourcesCount(0));

    fetch(`/api/lemlist/campaigns?client_id=${clientId}`)
      .then(r => r.json())
      .then(d => { setCampaigns(d.campaigns ?? []); })
      .finally(() => setLoadingCamps(false));

    fetch(`/api/icp?client_id=${clientId}`)
      .then(r => r.json())
      .then(d => {
        const notes = d.icp?.notes ?? "";
        if (notes) {
          setIcpSummary(notes.slice(0, 150) + (notes.length > 150 ? "…" : ""));
          setIcpLoaded(true);
        } else {
          setIcpSummary("Sin notas en el ICP — agrega contexto en Sistema → ICP");
          setIcpLoaded(false);
        }
      })
      .catch(() => {
        setIcpSummary("Error al cargar ICP");
        setIcpLoaded(false);
      });
  }, [clientId]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvError("");
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      const parsed = parseCSV(text);
      if (!parsed.length) {
        setCsvError("No se encontraron filas válidas. Verifica que el CSV tenga las columnas requeridas y al menos una fila.");
        return;
      }
      setContacts(parsed);
    };
    reader.readAsText(file);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!clientId || !contacts.length) return;
    setGenerating(true);
    setGenError("");
    setMatrix([]);
    try {
      const res = await fetch("/api/campana-hibrida/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, contacts }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error generando matriz");
      setMatrix(data.matrix ?? []);
      setStep("review");
    } catch (e: any) {
      setGenError(e.message);
    } finally {
      setGenerating(false);
    }
  }, [clientId, contacts]);

  const handlePush = useCallback(async () => {
    if (!clientId || !campaignId || !matrix.length) return;
    setPushing(true);
    setPushResult(null);
    try {
      const okRows = matrix.filter(r => r.status === "ok");
      const res = await fetch("/api/campana-hibrida/push-lemlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, campaign_id: campaignId, rows: okRows }),
      });
      const data = await res.json();
      setPushResult({ ok: data.ok ?? 0, error: data.error ?? 0 });
    } catch {
      setPushResult({ ok: 0, error: matrix.filter(r => r.status === "ok").length });
    } finally {
      setPushing(false);
    }
  }, [clientId, campaignId, matrix]);

  const downloadCSV = useCallback(() => {
    const csv = toCSV(matrix);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `matriz-hibrida-${clientName ?? "cliente"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [matrix, clientName]);

  const updateCell = useCallback((idx: number, field: "senalEmpresa" | "hipotesisDolor", value: string) => {
    setMatrix(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value, status: "ok" } : r));
  }, []);

  const configReady = icpLoaded && campaignId;
  const uploadReady = contacts.length > 0;

  if (!clientId || clientId === "__all__") {
    return (
      <main className="p-6">
        <div className="card px-6 py-10 text-center text-ink-muted">
          Selecciona un cliente específico en la barra lateral para usar Campaña Híbrida.
        </div>
      </main>
    );
  }

  return (
    <main className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Campaña Híbrida</h1>
        <p className="text-sm text-ink-muted mt-1">
          Genera una matriz ABM personalizada y envía las variables a tu campaña de Lemlist.
        </p>
      </div>

      {/* ── Paso 1: Configuración ── */}
      <div className="card px-6 py-5">
        <StepHeader n={1} title="Configuración" active={step === "config"} done={configReady && step !== "config"} />

        <div className="space-y-4">
          {/* ICP */}
          <div className="rounded-lg bg-surface-2 px-4 py-3 flex items-start gap-3">
            <IconSparkles size={18} className="text-[#62E0D8] shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-0.5">ICP del cliente</div>
              <div className="text-sm text-ink">
                {icpLoaded
                  ? icpSummary
                  : <span className="text-amber-500">{icpSummary || "Cargando…"}</span>}
              </div>
              {sourcesCount !== null && sourcesCount > 0 && (
                <div className="text-xs text-[#62E0D8] mt-1">
                  + {sourcesCount} fuente{sourcesCount !== 1 ? "s" : ""} de conocimiento cargada{sourcesCount !== 1 ? "s" : ""}
                </div>
              )}
            </div>
          </div>

          {/* Campaña */}
          <div>
            <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1.5">
              Campaña de Lemlist
            </label>
            {loadingCamps ? (
              <div className="flex items-center gap-2 text-sm text-ink-muted">
                <IconLoader2 size={16} className="animate-spin" /> Cargando campañas…
              </div>
            ) : (
              <div className="relative">
                <select
                  value={campaignId}
                  onChange={e => {
                    setCampaignId(e.target.value);
                    setCampaignName(campaigns.find(c => c.id === e.target.value)?.name ?? "");
                  }}
                  className="input w-full appearance-none pr-8"
                >
                  <option value="">Selecciona una campaña…</option>
                  {campaigns.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <IconChevronDown size={16} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none" />
              </div>
            )}
          </div>

          {configReady && (
            <button
              className="btn-primary text-sm"
              onClick={() => setStep("upload")}
            >
              Continuar →
            </button>
          )}
        </div>
      </div>

      {/* ── Paso 2: Carga CSV ── */}
      {(step === "upload" || step === "generate" || step === "review") && (
        <div className="card px-6 py-5">
          <StepHeader n={2} title="Cargar contactos" active={step === "upload"} done={uploadReady && step !== "upload"} />

          <div className="space-y-4">
            <div className="text-xs text-ink-muted bg-surface-2 rounded-lg px-4 py-3">
              <span className="font-semibold">Columnas requeridas:</span>{" "}
              {REQUIRED_COLS.join(", ")}
            </div>

            <div
              className="border-2 border-dashed border-surface-3 rounded-xl px-6 py-10 text-center cursor-pointer hover:border-[#62E0D8]/50 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <IconUpload size={28} className="mx-auto text-ink-muted mb-2" />
              <div className="text-sm text-ink">Haz clic para seleccionar un archivo CSV</div>
              <div className="text-xs text-ink-muted mt-1">Separado por comas o punto y coma</div>
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
            </div>

            {csvError && (
              <div className="flex items-center gap-2 text-sm text-red-500 bg-red-50 rounded-lg px-4 py-2">
                <IconAlertTriangle size={16} /> {csvError}
              </div>
            )}

            {contacts.length > 0 && (
              <>
                <div className="text-sm text-ink font-medium">
                  {contacts.length} contacto{contacts.length !== 1 ? "s" : ""} cargado{contacts.length !== 1 ? "s" : ""} en{" "}
                  {new Set(contacts.map(c => c.empresa.toLowerCase())).size} empresa{new Set(contacts.map(c => c.empresa.toLowerCase())).size !== 1 ? "s" : ""}
                </div>

                <div className="overflow-x-auto rounded-lg border border-surface-3">
                  <table className="w-full text-xs">
                    <thead className="bg-surface-2">
                      <tr>
                        {["Empresa", "Cargo", "Nombre", "Email"].map(h => (
                          <th key={h} className="text-left px-3 py-2 font-semibold text-ink-muted uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-2">
                      {contacts.slice(0, 8).map((c, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2 font-medium text-ink">{c.empresa}</td>
                          <td className="px-3 py-2 text-ink-muted">{c.cargo}</td>
                          <td className="px-3 py-2 text-ink-muted">{c.nombre} {c.apellido}</td>
                          <td className="px-3 py-2 text-ink-muted">{c.email}</td>
                        </tr>
                      ))}
                      {contacts.length > 8 && (
                        <tr>
                          <td colSpan={4} className="px-3 py-2 text-ink-muted text-center">
                            + {contacts.length - 8} más…
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {step === "upload" && (
                  <button className="btn-primary text-sm" onClick={() => setStep("generate")}>
                    Continuar →
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Paso 3: Generar ── */}
      {(step === "generate" || step === "review") && (
        <div className="card px-6 py-5">
          <StepHeader n={3} title="Generar matriz" active={step === "generate"} done={matrix.length > 0} />

          <div className="space-y-4">
            <div className="text-sm text-ink-muted">
              Se investigará cada empresa con Perplexity y se generará la SenalEmpresa e HipótesisDolor
              por cada combinación empresa-cargo usando Claude.
            </div>

            <div className="rounded-lg bg-surface-2 px-4 py-3 text-sm space-y-1">
              <div className="text-ink font-medium">{campaignName}</div>
              <div className="text-ink-muted text-xs">{contacts.length} contactos · {new Set(contacts.map(c => c.empresa.toLowerCase())).size} empresas a investigar</div>
            </div>

            {genError && (
              <div className="flex items-center gap-2 text-sm text-red-500 bg-red-50 rounded-lg px-4 py-2">
                <IconAlertTriangle size={16} /> {genError}
              </div>
            )}

            {step === "generate" && (
              <button
                className="btn-primary text-sm flex items-center gap-2"
                onClick={handleGenerate}
                disabled={generating}
              >
                {generating
                  ? <><IconLoader2 size={16} className="animate-spin" /> Generando… puede tomar varios minutos</>
                  : <><IconSparkles size={16} /> Generar matriz con IA</>}
              </button>
            )}

            {generating && (
              <div className="text-xs text-ink-muted animate-pulse">
                Investigando empresas y construyendo hipótesis de dolor… no cierre esta ventana.
              </div>
            )}

            {matrix.length > 0 && step === "review" && (
              <div className="flex items-center gap-2 text-sm text-green-600 font-medium">
                <IconCheck size={16} /> Matriz generada con {matrix.filter(r => r.status === "ok").length} filas correctas
                {matrix.filter(r => r.status === "error").length > 0 && (
                  <span className="text-amber-500">
                    · {matrix.filter(r => r.status === "error").length} con error
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Paso 4: Revisión y envío ── */}
      {step === "review" && matrix.length > 0 && (
        <div className="card px-6 py-5">
          <StepHeader n={4} title="Revisar y enviar a Lemlist" active={true} done={!!pushResult} />

          <div className="space-y-4">
            <p className="text-sm text-ink-muted">
              Revisa y edita la matriz antes de enviarla. Los campos son editables.
            </p>

            {/* Tabla de revisión */}
            <div className="space-y-3">
              {matrix.map((row, i) => (
                <div key={i} className={`rounded-xl border px-5 py-4 space-y-3 ${row.status === "error" ? "border-amber-200 bg-amber-50/50" : "border-surface-3"}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <span className="font-semibold text-ink">{row.empresa}</span>
                      <span className="text-ink-muted mx-2">·</span>
                      <span className="text-sm text-ink-muted">{row.cargo}</span>
                      <span className="text-ink-muted mx-2">·</span>
                      <span className="text-xs text-ink-muted">{row.nombre} {row.apellido}</span>
                    </div>
                    {row.status === "error" && (
                      <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full shrink-0">
                        <IconAlertTriangle size={12} /> Sin evidencia
                      </span>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted mb-1">
                        SenalEmpresa <IconEdit size={10} className="inline" />
                      </div>
                      <textarea
                        value={row.senalEmpresa}
                        onChange={e => updateCell(i, "senalEmpresa", e.target.value)}
                        rows={2}
                        className="input w-full text-sm resize-none"
                        placeholder="Señal de la empresa…"
                      />
                    </div>
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted mb-1">
                        HipótesisDolor <IconEdit size={10} className="inline" />
                      </div>
                      <textarea
                        value={row.hipotesisDolor}
                        onChange={e => updateCell(i, "hipotesisDolor", e.target.value)}
                        rows={2}
                        className="input w-full text-sm resize-none"
                        placeholder="Hipótesis de dolor…"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Acciones */}
            <div className="flex items-center gap-3 flex-wrap pt-2">
              <button
                className="btn-primary text-sm flex items-center gap-2"
                onClick={handlePush}
                disabled={pushing || !!pushResult}
              >
                {pushing
                  ? <><IconLoader2 size={16} className="animate-spin" /> Enviando…</>
                  : <><IconSend size={16} /> Enviar a Lemlist ({matrix.filter(r => r.status === "ok").length} leads)</>}
              </button>

              <button
                className="btn-secondary text-sm flex items-center gap-2"
                onClick={downloadCSV}
              >
                <IconDownload size={16} /> Descargar CSV
              </button>

              <button
                className="btn-ghost text-sm flex items-center gap-2"
                onClick={() => { setMatrix([]); setStep("generate"); setPushResult(null); }}
              >
                <IconRefresh size={16} /> Regenerar
              </button>
            </div>

            {pushResult && (
              <div className={`rounded-lg px-4 py-3 text-sm font-medium flex items-center gap-2
                ${pushResult.error === 0 ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
                {pushResult.error === 0
                  ? <><IconCheck size={16} /> {pushResult.ok} leads enviados correctamente a Lemlist</>
                  : <><IconAlertTriangle size={16} /> {pushResult.ok} enviados · {pushResult.error} con error</>}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
