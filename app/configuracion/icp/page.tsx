"use client";

import { useEffect, useState } from "react";
import {
  IconDeviceFloppy,
  IconPlus,
  IconTrash,
  IconAlertCircle,
  IconCheck
} from "@tabler/icons-react";

type OrgType = { key: string; label: string; accept: boolean; note?: string };
type SizeRule = { min: number; max: number | null; decision: "approve" | "reject"; note?: string };
type Competitor = { name: string; note?: string };
type PipelineMix = { label: string; share: number; velocity: string };

type Icp = {
  id: string;
  version: number;
  org_types: OrgType[];
  signals_strong: string[];
  signals_medium: string[];
  signals_weak: string[];
  size_rules: SizeRule[];
  pipeline_mix: PipelineMix[];
  competitors: Competitor[];
  geographies: { region: string; priority: string; note?: string }[];
  notes: string;
};

export default function IcpPage() {
  const [icp, setIcp] = useState<Icp | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/icp", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setIcp(d.icp);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  async function seed() {
    setSeeding(true);
    setError(null);
    const res = await fetch("/api/icp/seed", { method: "POST" });
    const data = await res.json();
    setSeeding(false);
    if (!res.ok) {
      setError(data.error ?? "No se pudo crear el ICP v1");
      return;
    }
    setIcp(data.icp);
  }

  async function save() {
    if (!icp) return;
    setSaving(true);
    setError(null);
    const res = await fetch("/api/icp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(icp)
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? "Save failed");
      return;
    }
    setIcp(data.icp);
    setSavedAt(new Date().toLocaleTimeString());
  }

  if (loading) return <div className="text-ink-muted">Cargando ICP…</div>;
  if (!icp) {
    return (
      <div className="card space-y-4">
        <div className="text-ink flex items-start gap-2">
          <IconAlertCircle size={18} className="mt-0.5 text-danger-fg" />
          <div>
            <div className="font-medium">No hay ICP configurado todavía.</div>
            <div className="text-sm text-ink-muted mt-1">
              Crea la versión v1 con los valores por defecto del documento weCAD4you_ICP. Después
              podrás editarla y guardar versiones nuevas desde esta misma pantalla.
            </div>
          </div>
        </div>
        {error && (
          <div className="text-danger-fg text-sm flex items-center gap-2">
            <IconAlertCircle size={14} /> {error}
          </div>
        )}
        <button onClick={seed} disabled={seeding} className="btn-primary">
          <IconPlus size={16} /> {seeding ? "Creando…" : "Crear ICP v1 con valores por defecto"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <div className="label">Sistema · Configuración</div>
          <h1 className="text-2xl font-semibold tracking-tight">ICP — Ideal Customer Profile</h1>
          <div className="text-sm text-ink-muted mt-1">
            Versión activa: <span className="font-medium text-ink">v{icp.version}</span>. Cada
            cambio guarda una versión nueva.
          </div>
        </div>
        <div className="flex items-center gap-3">
          {savedAt && (
            <div className="text-xs text-success-fg flex items-center gap-1">
              <IconCheck size={14} /> Guardado {savedAt}
            </div>
          )}
          <button onClick={save} disabled={saving} className="btn-primary">
            <IconDeviceFloppy size={16} /> {saving ? "Guardando…" : "Guardar nueva versión"}
          </button>
        </div>
      </header>

      {error && (
        <div className="card border border-danger-bg text-danger-fg flex items-center gap-2">
          <IconAlertCircle size={16} /> {error}
        </div>
      )}

      <section className="card">
        <h2 className="font-semibold mb-3">Filtro 1 · Tipos de organización</h2>
        <div className="space-y-2">
          {icp.org_types.map((o, i) => (
            <div key={i} className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={o.accept}
                onChange={(e) => {
                  const next = [...icp.org_types];
                  next[i] = { ...o, accept: e.target.checked };
                  setIcp({ ...icp, org_types: next });
                }}
              />
              <input
                className="input flex-1"
                value={o.label}
                onChange={(e) => {
                  const next = [...icp.org_types];
                  next[i] = { ...o, label: e.target.value };
                  setIcp({ ...icp, org_types: next });
                }}
              />
              <input
                className="input flex-1"
                placeholder="Nota (opcional)"
                value={o.note ?? ""}
                onChange={(e) => {
                  const next = [...icp.org_types];
                  next[i] = { ...o, note: e.target.value };
                  setIcp({ ...icp, org_types: next });
                }}
              />
              <button
                className="btn-secondary text-danger-fg"
                onClick={() => {
                  setIcp({ ...icp, org_types: icp.org_types.filter((_, idx) => idx !== i) });
                }}
              >
                <IconTrash size={14} />
              </button>
            </div>
          ))}
          <button
            className="btn-secondary"
            onClick={() => {
              setIcp({
                ...icp,
                org_types: [
                  ...icp.org_types,
                  { key: `custom_${Date.now()}`, label: "Nuevo tipo", accept: true }
                ]
              });
            }}
          >
            <IconPlus size={14} /> Añadir tipo
          </button>
        </div>
      </section>

      <SignalList
        title="Señales digitales fuertes"
        helper="Una sola es suficiente para aprobar la empresa."
        items={icp.signals_strong}
        onChange={(v) => setIcp({ ...icp, signals_strong: v })}
      />
      <SignalList
        title="Señales digitales medias"
        helper="Se necesitan 2 o más para aprobar."
        items={icp.signals_medium}
        onChange={(v) => setIcp({ ...icp, signals_medium: v })}
      />
      <SignalList
        title="No es suficiente"
        helper="No aprobar solo por esto."
        items={icp.signals_weak}
        onChange={(v) => setIcp({ ...icp, signals_weak: v })}
      />

      <section className="card">
        <h2 className="font-semibold mb-1">Filtro 3 · Reglas de volumen</h2>
        <p className="text-xs text-ink-muted mb-3">Rangos por número de empleados.</p>
        <div className="space-y-2">
          {icp.size_rules.map((r, i) => (
            <div key={i} className="flex items-center gap-3 text-sm">
              <input
                type="number"
                className="input w-24"
                value={r.min}
                onChange={(e) => {
                  const next = [...icp.size_rules];
                  next[i] = { ...r, min: Number(e.target.value) };
                  setIcp({ ...icp, size_rules: next });
                }}
              />
              <span className="text-ink-muted">→</span>
              <input
                type="number"
                className="input w-24"
                placeholder="∞"
                value={r.max ?? ""}
                onChange={(e) => {
                  const next = [...icp.size_rules];
                  const v = e.target.value;
                  next[i] = { ...r, max: v === "" ? null : Number(v) };
                  setIcp({ ...icp, size_rules: next });
                }}
              />
              <select
                className="input w-36"
                value={r.decision}
                onChange={(e) => {
                  const next = [...icp.size_rules];
                  next[i] = { ...r, decision: e.target.value as SizeRule["decision"] };
                  setIcp({ ...icp, size_rules: next });
                }}
              >
                <option value="approve">approve</option>
                <option value="reject">reject</option>
              </select>
              <input
                className="input flex-1"
                placeholder="Nota"
                value={r.note ?? ""}
                onChange={(e) => {
                  const next = [...icp.size_rules];
                  next[i] = { ...r, note: e.target.value };
                  setIcp({ ...icp, size_rules: next });
                }}
              />
              <button
                className="btn-secondary text-danger-fg"
                onClick={() =>
                  setIcp({ ...icp, size_rules: icp.size_rules.filter((_, idx) => idx !== i) })
                }
              >
                <IconTrash size={14} />
              </button>
            </div>
          ))}
          <button
            className="btn-secondary"
            onClick={() =>
              setIcp({
                ...icp,
                size_rules: [...icp.size_rules, { min: 0, max: null, decision: "approve" }]
              })
            }
          >
            <IconPlus size={14} /> Añadir regla
          </button>
        </div>
      </section>

      <section className="card">
        <h2 className="font-semibold mb-1">Mix recomendado de pipeline</h2>
        <p className="text-xs text-ink-muted mb-3">Distribución por tamaño en cada batch.</p>
        <div className="space-y-2">
          {icp.pipeline_mix.map((m, i) => (
            <div key={i} className="flex items-center gap-3 text-sm">
              <input
                className="input flex-1"
                value={m.label}
                onChange={(e) => {
                  const next = [...icp.pipeline_mix];
                  next[i] = { ...m, label: e.target.value };
                  setIcp({ ...icp, pipeline_mix: next });
                }}
              />
              <input
                type="number"
                className="input w-24"
                value={m.share}
                onChange={(e) => {
                  const next = [...icp.pipeline_mix];
                  next[i] = { ...m, share: Number(e.target.value) };
                  setIcp({ ...icp, pipeline_mix: next });
                }}
              />
              <span className="text-ink-muted text-xs">%</span>
              <input
                className="input w-40"
                placeholder="velocidad"
                value={m.velocity}
                onChange={(e) => {
                  const next = [...icp.pipeline_mix];
                  next[i] = { ...m, velocity: e.target.value };
                  setIcp({ ...icp, pipeline_mix: next });
                }}
              />
              <button
                className="btn-secondary text-danger-fg"
                onClick={() =>
                  setIcp({ ...icp, pipeline_mix: icp.pipeline_mix.filter((_, idx) => idx !== i) })
                }
              >
                <IconTrash size={14} />
              </button>
            </div>
          ))}
          <button
            className="btn-secondary"
            onClick={() =>
              setIcp({
                ...icp,
                pipeline_mix: [...icp.pipeline_mix, { label: "", share: 0, velocity: "" }]
              })
            }
          >
            <IconPlus size={14} /> Añadir banda
          </button>
        </div>
      </section>

      <section className="card">
        <h2 className="font-semibold mb-1">Competidores a monitorear</h2>
        <p className="text-xs text-ink-muted mb-3">
          Si un prospecto ya externaliza con uno de ellos, fit inmediato.
        </p>
        <div className="space-y-2">
          {icp.competitors.map((c, i) => (
            <div key={i} className="flex items-center gap-3 text-sm">
              <input
                className="input flex-1"
                value={c.name}
                onChange={(e) => {
                  const next = [...icp.competitors];
                  next[i] = { ...c, name: e.target.value };
                  setIcp({ ...icp, competitors: next });
                }}
              />
              <input
                className="input flex-1"
                placeholder="Nota"
                value={c.note ?? ""}
                onChange={(e) => {
                  const next = [...icp.competitors];
                  next[i] = { ...c, note: e.target.value };
                  setIcp({ ...icp, competitors: next });
                }}
              />
              <button
                className="btn-secondary text-danger-fg"
                onClick={() =>
                  setIcp({ ...icp, competitors: icp.competitors.filter((_, idx) => idx !== i) })
                }
              >
                <IconTrash size={14} />
              </button>
            </div>
          ))}
          <button
            className="btn-secondary"
            onClick={() =>
              setIcp({ ...icp, competitors: [...icp.competitors, { name: "", note: "" }] })
            }
          >
            <IconPlus size={14} /> Añadir competidor
          </button>
        </div>
      </section>

      <section className="card">
        <h2 className="font-semibold mb-3">Notas adicionales</h2>
        <textarea
          className="input min-h-[100px]"
          value={icp.notes}
          onChange={(e) => setIcp({ ...icp, notes: e.target.value })}
        />
      </section>
    </div>
  );
}

function SignalList(props: {
  title: string;
  helper: string;
  items: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <section className="card">
      <h2 className="font-semibold mb-1">{props.title}</h2>
      <p className="text-xs text-ink-muted mb-3">{props.helper}</p>
      <div className="space-y-2">
        {props.items.map((s, i) => (
          <div key={i} className="flex items-center gap-3 text-sm">
            <input
              className="input flex-1"
              value={s}
              onChange={(e) => {
                const next = [...props.items];
                next[i] = e.target.value;
                props.onChange(next);
              }}
            />
            <button
              className="btn-secondary text-danger-fg"
              onClick={() => props.onChange(props.items.filter((_, idx) => idx !== i))}
            >
              <IconTrash size={14} />
            </button>
          </div>
        ))}
        <button className="btn-secondary" onClick={() => props.onChange([...props.items, ""])}>
          <IconPlus size={14} /> Añadir
        </button>
      </div>
    </section>
  );
}
