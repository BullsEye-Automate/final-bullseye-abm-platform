"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { IconArrowLeft, IconCheck, IconDeviceFloppy, IconLoader2, IconPlus, IconSearch, IconTrash, IconX } from "@tabler/icons-react";
import type { RadarConfig } from "@/lib/radarAbm/types";

// Configuración del Radar ABM (global, tabla radar_abm_config): las metas y
// pesos del Health Score, los tramos de tamaño, el período y la tabla de
// cargos son supuestos a calibrar (§13); el mapeo de propiedades confirma
// los nombres internos de HubSpot (§3.1, Anexo A1).

type Component = { key: string; name: string; formula: string };
type PropertyDef = { key: string; object: string; label: string; required?: boolean; help: string; perClient?: unknown };
type Detected = { key: string; candidates?: { name: string; label: string }[]; property: string | null; found: boolean; manual: boolean; propLabel: string | null; type: string | null; options: { label: string }[] };

const AREAS = ["Tecnología", "Operaciones", "Finanzas", "Marketing", "Comercial", "RRHH", "Gerencia General"];
const SENS = ["C-Level", "Director", "Gerente", "Jefatura", "Especialista"];
const OBJ_LABEL: Record<string, string> = { companies: "Empresa", contacts: "Contacto", meetings: "Reunión" };

export default function RadarConfigPage() {
  const [cfg, setCfg] = useState<RadarConfig | null>(null);
  const [defaults, setDefaults] = useState<RadarConfig | null>(null);
  const [components, setComponents] = useState<Component[]>([]);
  const [propertyDefs, setPropertyDefs] = useState<PropertyDef[]>([]);
  const [detected, setDetected] = useState<Record<string, Detected> | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/radar-abm/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j.error) return setMsg({ ok: false, text: j.error });
        setCfg(j.config);
        setDefaults(j.defaults);
        setComponents(j.components);
        setPropertyDefs(j.propertyDefs);
      })
      .catch((e) => setMsg({ ok: false, text: e.message }));
  }, []);

  async function detect() {
    setDetecting(true);
    setMsg(null);
    try {
      const r = await fetch("/api/radar-abm/detect", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `Error ${r.status}`);
      setDetected(Object.fromEntries((j.properties as Detected[]).map((d) => [d.key, d])));
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setDetecting(false);
    }
  }

  async function save() {
    if (!cfg) return;
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/radar-abm/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: cfg }) });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `Error ${r.status}`);
      setCfg(j.config);
      setMsg({ ok: true, text: "Configuración guardada. Las métricas se recalculan al abrir el informe; el mapeo de propiedades se usa en la próxima sincronización." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  if (!cfg || !defaults) {
    return <div className="text-sm text-ink-muted flex items-center gap-2">{msg ? msg.text : <><IconLoader2 size={16} className="animate-spin" /> Cargando…</>}</div>;
  }

  const setHealth = (key: string, field: "weight" | "target", value: number) =>
    setCfg({ ...cfg, health: { ...cfg.health, [key]: { ...cfg.health[key], [field]: value } } });
  const totalWeight = components.reduce((n, c) => n + (cfg.health[c.key]?.weight ?? 0), 0);

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <Link href="/analisis/radar-abm" className="text-sm text-ink-muted hover:text-ink flex items-center gap-1 mb-2"><IconArrowLeft size={14} /> Radar ABM</Link>
        <h1 className="text-2xl font-semibold" style={{ color: "#251762" }}>Configuración del Radar ABM</h1>
        <p className="text-sm text-ink-muted mt-1">Global para todos los clientes. Metas, pesos y tramos son supuestos iniciales a calibrar con el histórico real.</p>
      </div>

      {msg && <div className={`text-sm px-4 py-3 rounded-xl ${msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{msg.text}</div>}

      {/* Health Score */}
      <section className="card space-y-3">
        <div>
          <h2 className="font-semibold">Health Score — pesos y metas</h2>
          <p className="text-sm text-ink-muted mt-1">Cada componente vale min(1, valor / meta) × 100 y se pondera por su peso. Sin datos suficientes, se excluye y el resto se re-pondera. Peso total: <b>{totalWeight}</b>.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-muted border-b border-[#ECEAF4]">
              <tr><th className="py-2 pr-3">Componente</th><th className="py-2 pr-3 w-24">Peso</th><th className="py-2 pr-3 w-28">Meta (%)</th><th className="py-2">Fórmula</th></tr>
            </thead>
            <tbody>
              {components.map((c) => (
                <tr key={c.key} className="border-b border-[#ECEAF4] last:border-0">
                  <td className="py-2 pr-3 font-medium">{c.name}</td>
                  <td className="py-2 pr-3"><input type="number" min={0} max={100} className="input w-20" value={cfg.health[c.key]?.weight ?? 0} onChange={(e) => setHealth(c.key, "weight", Number(e.target.value))} /></td>
                  <td className="py-2 pr-3"><input type="number" min={1} max={200} className="input w-24" value={Math.round((cfg.health[c.key]?.target ?? 0) * 1000) / 10} onChange={(e) => setHealth(c.key, "target", Number(e.target.value) / 100)} /></td>
                  <td className="py-2 text-xs text-ink-muted">{c.formula}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="text-xs text-brand hover:underline" onClick={() => setCfg({ ...cfg, health: defaults.health })}>Restaurar valores del prompt maestro</button>
      </section>

      {/* Tamaño y período */}
      <section className="card space-y-3">
        <h2 className="font-semibold">Tramos de tamaño y período</h2>
        <div className="flex flex-wrap gap-6 text-sm">
          <label className="flex flex-col gap-1">Pyme: hasta (empleados)
            <input type="number" min={1} className="input w-32" value={cfg.sizeTiers.pymeMax} onChange={(e) => setCfg({ ...cfg, sizeTiers: { ...cfg.sizeTiers, pymeMax: Number(e.target.value) } })} />
          </label>
          <label className="flex flex-col gap-1">Mid-market: hasta (empleados)
            <input type="number" min={1} className="input w-32" value={cfg.sizeTiers.midMax} onChange={(e) => setCfg({ ...cfg, sizeTiers: { ...cfg.sizeTiers, midMax: Number(e.target.value) } })} />
          </label>
          <label className="flex flex-col gap-1">Período del informe
            <select className="input w-40" value={cfg.periodMonths} onChange={(e) => setCfg({ ...cfg, periodMonths: Number(e.target.value) })}>
              <option value={3}>Últimos 3 meses</option>
              <option value={6}>Últimos 6 meses</option>
              <option value={12}>Últimos 12 meses</option>
            </select>
          </label>
        </div>
        <p className="text-xs text-ink-muted">Más de {cfg.sizeTiers.midMax} empleados = Enterprise. Tamaño y período se aplican en la próxima sincronización.</p>
      </section>

      {/* Propiedades HubSpot */}
      <section className="card space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Propiedades de HubSpot</h2>
            <p className="text-sm text-ink-muted mt-1">Se buscan por su etiqueta en el HubSpot de BullsEye. Si el nombre interno no se detecta (o hay dos parecidas), escríbelo a mano. Las propuestas del Anexo A4 pueden no existir todavía: el informe funciona igual y muestra “Sin información disponible”.</p>
          </div>
          <button onClick={detect} disabled={detecting} className="btn-secondary flex items-center gap-2 text-sm">
            {detecting ? <IconLoader2 size={15} className="animate-spin" /> : <IconSearch size={15} />} Detectar en HubSpot
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-muted border-b border-[#ECEAF4]">
              <tr><th className="py-2 pr-3">Objeto</th><th className="py-2 pr-3">Etiqueta</th><th className="py-2 pr-3">Nombre interno (manual)</th><th className="py-2">Detectado</th></tr>
            </thead>
            <tbody>
              {propertyDefs.map((d) => {
                const det = detected?.[d.key];
                return (
                  <tr key={d.key} className="border-b border-[#ECEAF4] last:border-0 align-top">
                    <td className="py-2 pr-3 text-xs text-ink-muted">{OBJ_LABEL[d.object]}</td>
                    <td className="py-2 pr-3">
                      <div className="font-medium">{d.label}{d.required && <span className="text-danger-fg"> *</span>}</div>
                      <div className="text-xs text-ink-muted">{d.help}</div>
                    </td>
                    <td className="py-2 pr-3">
                      {d.key === "companyStatus" ? (
                        <span className="text-xs text-ink-muted">Una por cliente: se elige en Configuración → Cliente → Radar ABM</span>
                      ) : (
                        <input className="input w-56 font-mono text-xs" placeholder="automático" value={cfg.properties[d.key] ?? ""} onChange={(e) => setCfg({ ...cfg, properties: { ...cfg.properties, [d.key]: e.target.value } })} />
                      )}
                    </td>
                    <td className="py-2 text-xs">
                      {det && d.key === "companyStatus" ? (
                        <span className={det.candidates?.length ? "text-success-fg" : "text-danger-fg"} title={(det.candidates ?? []).map((c) => c.label).join("\n")}>
                          {det.candidates?.length ? `${det.candidates.length} propiedades por cliente detectadas` : "no se encontró ninguna"}
                        </span>
                      ) : !det ? <span className="text-ink-subtle">—</span> : det.found ? (
                        <span className="text-success-fg flex items-start gap-1"><IconCheck size={14} className="shrink-0 mt-0.5" /><span><code>{det.property}</code> · {det.propLabel}{det.options.length ? ` · ${det.options.length} valores` : ""}</span></span>
                      ) : (
                        <span className="text-danger-fg flex items-center gap-1"><IconX size={14} /> {det.manual ? "no existe ese nombre interno" : "no encontrada"}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Cargos */}
      <section className="card space-y-3">
        <div>
          <h2 className="font-semibold">Cargos → área y seniority</h2>
          <p className="text-sm text-ink-muted mt-1">Se evalúan en orden y gana la primera palabra clave que aparezca en el cargo (sin tildes ni mayúsculas; las de 3 letras o menos deben ser palabra completa, ej. “ti”, “cio”). Una regla puede fijar solo el área o solo la seniority.</p>
        </div>
        <div className="max-h-[420px] overflow-y-auto border border-[#ECEAF4] rounded-xl">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-muted border-b border-[#ECEAF4] sticky top-0 bg-white">
              <tr><th className="py-2 px-3">Palabra clave</th><th className="py-2 px-3">Área</th><th className="py-2 px-3">Seniority</th><th /></tr>
            </thead>
            <tbody>
              {cfg.titleRules.map((r, i) => (
                <tr key={i} className="border-b border-[#ECEAF4] last:border-0">
                  <td className="py-1.5 px-3"><input className="input w-48" value={r.kw} onChange={(e) => setCfg({ ...cfg, titleRules: cfg.titleRules.map((x, j) => (j === i ? { ...x, kw: e.target.value } : x)) })} /></td>
                  <td className="py-1.5 px-3">
                    <select className="input w-44" value={r.area ?? ""} onChange={(e) => setCfg({ ...cfg, titleRules: cfg.titleRules.map((x, j) => (j === i ? { ...x, area: e.target.value || undefined } : x)) })}>
                      <option value="">—</option>
                      {AREAS.map((a) => <option key={a}>{a}</option>)}
                    </select>
                  </td>
                  <td className="py-1.5 px-3">
                    <select className="input w-36" value={r.sen ?? ""} onChange={(e) => setCfg({ ...cfg, titleRules: cfg.titleRules.map((x, j) => (j === i ? { ...x, sen: e.target.value || undefined } : x)) })}>
                      <option value="">—</option>
                      {SENS.map((a) => <option key={a}>{a}</option>)}
                    </select>
                  </td>
                  <td className="py-1.5 px-3 text-right">
                    <button className="text-ink-subtle hover:text-danger-fg" onClick={() => setCfg({ ...cfg, titleRules: cfg.titleRules.filter((_, j) => j !== i) })} aria-label="Quitar regla"><IconTrash size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-4">
          <button className="text-sm text-brand flex items-center gap-1 hover:underline" onClick={() => setCfg({ ...cfg, titleRules: [{ kw: "", area: "Tecnología" }, ...cfg.titleRules] })}><IconPlus size={14} /> Agregar regla al inicio</button>
          <button className="text-xs text-ink-muted hover:underline" onClick={() => setCfg({ ...cfg, titleRules: defaults.titleRules })}>Restaurar tabla por defecto</button>
        </div>
      </section>

      <div className="flex justify-end sticky bottom-4">
        <button onClick={save} disabled={saving} className="btn-primary flex items-center gap-2">
          {saving ? <IconLoader2 size={15} className="animate-spin" /> : <IconDeviceFloppy size={15} />} Guardar configuración
        </button>
      </div>
    </div>
  );
}
