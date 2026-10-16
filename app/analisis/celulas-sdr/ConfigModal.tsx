"use client";

import { useMemo, useState } from "react";
import { DEFAULT_CONFIG, type CellsConfig } from "@/lib/celulasSdr/types";
import { fmt, monthGoal, makeFilter, type Model } from "@/lib/celulasSdr/engine";
import { monthLabel } from "@/lib/celulasSdr/calendar";

// Campos de "Configurar" (los porcentajes se editan en %, se guardan en 0-1).
const CF: [keyof CellsConfig, string, boolean][] = [
  ["green", "Umbral verde (%)", true], ["yellow", "Umbral amarillo (%)", true],
  ["callGoal", "Meta diaria de llamadas por SDR", false], ["actGoal", "Meta diaria de actividades por SDR", false],
  ["noshowMax", "No-show máximo (%)", true], ["connectMin", "Conexión mínima (%)", true], ["connectTarget", "Conexión objetivo (%)", true],
  ["attendTarget", "Asistencia objetivo (%)", true], ["oppTarget", "Reunión → opp objetivo (%)", true],
  ["cap", "Tope de sobrecumplimiento por cliente (%)", true], ["qTarget", "Meta de puntaje de llamadas (pts)", false],
  ["qGood", "Calificación buena (verde) desde (pts)", false], ["qReg", "Calificación regular (amarillo) desde (pts)", false],
];

export default function ConfigModal({
  M, month, cfg, oppValues, onClose, onSave, saving, updatedBy, updatedAt,
}: {
  M: Model; month: string; cfg: CellsConfig; oppValues: string[];
  onClose: () => void; onSave: (c: CellsConfig) => void; saving: boolean;
  updatedBy: string | null; updatedAt: string | null;
}) {
  const [draft, setDraft] = useState<CellsConfig>(() => ({ ...cfg, clientWeights: { ...cfg.clientWeights }, oppValues: [...cfg.oppValues] }));
  const set = (k: keyof CellsConfig, v: any) => setDraft((d) => ({ ...d, [k]: v }));

  const goalsMonth = useMemo(() => M.goals.filter((g) => g.month === month), [M, month]);
  const sdrGoals = useMemo(() => {
    const by = new Map<string, number>();
    goalsMonth.forEach((g) => by.set(g.sdr, (by.get(g.sdr) ?? 0) + g.goal));
    return [...by.entries()].map(([k, g]) => ({ s: M.SD[k], g })).filter((x) => x.s).sort((a, b) => a.s.name.localeCompare(b.s.name, "es"));
  }, [M, goalsMonth]);
  const clientGoals = useMemo(() => {
    const by = new Map<string, { goal: number; sdrs: Set<string> }>();
    goalsMonth.forEach((g) => {
      const x = by.get(g.client) ?? { goal: 0, sdrs: new Set<string>() };
      x.goal += g.goal;
      x.sdrs.add(M.SD[g.sdr]?.short ?? g.sdr);
      by.set(g.client, x);
    });
    return [...by.entries()].map(([id, x]) => ({ c: M.CL[id], ...x })).filter((x) => x.c).sort((a, b) => b.goal - a.goal);
  }, [M, goalsMonth]);
  const weightOf = (id: string) => (draft.clientWeights[id] ?? M.CL[id]?.baseWeight ?? 0);
  const wsum = clientGoals.reduce((s, x) => s + weightOf(x.c.id), 0);
  const total = monthGoal(M, makeFilter(M, { leader: "", sdr: "", client: "", country: "" }), month);

  return (
    <div className="cs-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cs-mbox">
        <div className="cs-ch">
          <div>
            <h2>Configurar metas y umbrales</h2>
            <p>Se guardan para todos los usuarios.{updatedAt ? ` Última edición: ${new Date(updatedAt).toLocaleString("es-CL")}${updatedBy ? ` por ${updatedBy}` : ""}.` : ""}</p>
          </div>
          <button className="cs-btn" onClick={onClose}>Cerrar</button>
        </div>
        <div className="cs-fgrid">
          {CF.map(([k, l, p]) => (
            <label key={k}>
              {l}
              <input type="number" min={0} step={p ? 1 : 5} value={p ? Math.round((draft[k] as number) * 100) : (draft[k] as number)}
                onChange={(e) => { const v = parseFloat(e.target.value); if (isFinite(v)) set(k, p ? v / 100 : v); }} />
            </label>
          ))}
        </div>
        <label style={{ display: "block", margin: "4px 0 14px", fontSize: 12.5, color: "#6B6884", fontWeight: 500 }}>
          Cumplimiento del mes calculado contra
          <select className="cs-select" style={{ display: "block", marginTop: 6, width: "100%" }} value={draft.goalBase} onChange={(e) => set("goalBase", e.target.value)}>
            <option value="mes">La meta completa del mes (como en los reportes del equipo)</option>
            <option value="fecha">La meta proporcional a los días hábiles transcurridos</option>
          </select>
        </label>

        <h3 style={{ fontSize: 15, marginTop: 6, fontWeight: 600 }}>Qué cuenta como oportunidad</h3>
        <p className="cs-note" style={{ marginTop: 4 }}>Reunión realizada cuya columna Propuesta/Oportunidad tiene alguno de estos valores.</p>
        <div className="cs-chips" style={{ margin: "8px 0 14px" }}>
          {oppValues.map((v) => {
            const on = draft.oppValues.includes(v);
            return (
              <button key={v} className={`cs-chip ${on ? "on" : ""}`} style={{ paddingLeft: 12 }}
                onClick={() => set("oppValues", on ? draft.oppValues.filter((x) => x !== v) : [...draft.oppValues, v])}>
                {on ? "✓ " : ""}{v}
              </button>
            );
          })}
        </div>

        <h3 style={{ fontSize: 15, marginTop: 6, fontWeight: 600 }}>Metas de {monthLabel(month)} por SDR</h3>
        <p className="cs-note" style={{ marginTop: 4 }}>Solo lectura: se toman de la pestaña &quot;Asignación&quot; de la planilla de metas (meta interna). Total: <b>{fmt(total)}</b>.</p>
        <div className="cs-tw">
          <table>
            <thead><tr><th className="l">SDR</th><th className="l">Célula</th><th>Meta mensual de reuniones</th></tr></thead>
            <tbody>
              {sdrGoals.map(({ s, g }) => (
                <tr key={s.key}><td className="l"><b>{s.name}</b></td><td className="l cs-muted">{s.group === "leader" ? "Líder (meta propia)" : s.leaderKey ? M.LD[s.leaderKey]?.name : "Sin célula"}</td><td>{fmt(g)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 style={{ fontSize: 15, marginTop: 14, fontWeight: 600 }}>Peso por cliente</h3>
        <p className="cs-note" style={{ marginTop: 4 }}>Por defecto el peso es proporcional a la meta del cliente (suma de las metas de sus SDR). Suma de pesos: <b>{fmt(wsum, 1)}%</b></p>
        <div className="cs-tw">
          <table>
            <thead><tr><th className="l">Cliente</th><th className="l">SDR asignados</th><th>Meta mensual</th><th>Peso (%)</th></tr></thead>
            <tbody>
              {clientGoals.map((x) => (
                <tr key={x.c.id}>
                  <td className="l"><b>{x.c.name}</b></td>
                  <td className="l cs-muted">{[...x.sdrs].join(", ")}</td>
                  <td>{fmt(x.goal)}</td>
                  <td>
                    <input type="number" min={0} step={0.1} value={weightOf(x.c.id)}
                      onChange={(e) => { const v = parseFloat(e.target.value); setDraft((d) => ({ ...d, clientWeights: { ...d.clientWeights, [x.c.id]: isFinite(v) ? v : 0 } })); }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="cs-mfoot">
          <button className="cs-btn ghost" onClick={() => setDraft({ ...DEFAULT_CONFIG, clientWeights: {}, oppValues: [...DEFAULT_CONFIG.oppValues] })}>Restablecer valores</button>
          <button className="cs-btn pri" disabled={saving} onClick={() => onSave(draft)}>{saving ? "Guardando…" : "Guardar cambios"}</button>
        </div>
      </div>
    </div>
  );
}
