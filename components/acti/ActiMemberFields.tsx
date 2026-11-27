"use client";

import { PLAN_IDS, STATUS_IDS, STATUS_LABEL, DEFAULT_CONFIG, type ActiPlanId, type ActiStatus } from "@/lib/acti/plans";

// Campos "Socio ACTI" (equipo BullsEye), en la creación de cliente y en
// Configuración → Cliente. Controlado: el padre guarda el estado.

export type ActiMemberValue = {
  is_acti: boolean;
  plan: ActiPlanId;
  status: ActiStatus;
  joined_at: string;
  trial_start: string;
  trial_end: string;
  kam_email: string;
  notes: string;
};

export const emptyActiValue = (): ActiMemberValue => ({
  is_acti: false,
  plan: "freemium",
  status: "en_prueba",
  joined_at: new Date().toISOString().slice(0, 10),
  trial_start: "",
  trial_end: "",
  kam_email: "",
  notes: "",
});

export function ActiMemberFields({ value, onChange }: { value: ActiMemberValue; onChange: (v: ActiMemberValue) => void }) {
  const set = <K extends keyof ActiMemberValue>(k: K, v: ActiMemberValue[K]) => onChange({ ...value, [k]: v });

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
        <input
          type="checkbox"
          checked={value.is_acti}
          onChange={(e) => set("is_acti", e.target.checked)}
          className="h-4 w-4"
        />
        <span className="font-medium">Socio ACTI</span>
        <span className="text-xs text-ink-muted">— sus usuarios del portal ven la experiencia ACTI · Red de Negocios</span>
      </label>

      {value.is_acti && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label block mb-1">Plan ACTI</label>
            <select
              className="input"
              value={value.plan}
              onChange={(e) => {
                const plan = e.target.value as ActiPlanId;
                onChange({ ...value, plan, status: plan === "freemium" ? "en_prueba" : value.status === "en_prueba" ? "activo" : value.status });
              }}
            >
              {PLAN_IDS.map((p) => (
                <option key={p} value={p}>{DEFAULT_CONFIG.plans[p].name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label block mb-1">Estado</label>
            <select className="input" value={value.status} onChange={(e) => set("status", e.target.value as ActiStatus)}>
              {STATUS_IDS.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label block mb-1">Fecha de alta en ACTI</label>
            <input type="date" className="input" value={value.joined_at} onChange={(e) => set("joined_at", e.target.value)} />
          </div>
          <div>
            <label className="label block mb-1">KAM (correo, opcional)</label>
            <input type="email" className="input" value={value.kam_email} placeholder="Sin KAM en Freemium"
              onChange={(e) => set("kam_email", e.target.value)} />
          </div>
          {value.plan === "freemium" && (
            <>
              <div>
                <label className="label block mb-1">Inicio de la prueba</label>
                <input type="date" className="input" value={value.trial_start} onChange={(e) => set("trial_start", e.target.value)} />
                <p className="text-[11px] text-ink-muted mt-1">Vacío = la fecha de alta.</p>
              </div>
              <div>
                <label className="label block mb-1">Término de la prueba</label>
                <input type="date" className="input" value={value.trial_end} onChange={(e) => set("trial_end", e.target.value)} />
                <p className="text-[11px] text-ink-muted mt-1">Vacío = inicio + 90 días (según la configuración del plan).</p>
              </div>
            </>
          )}
          {(value.plan === "crece" || value.plan === "acelera") && (
            <p className="sm:col-span-2 text-xs text-ink-muted">
              Este plan incluye Peitho: activa «Incluir Peitho» en Configuración → Cliente para que el socio vea el análisis de sus reuniones.
            </p>
          )}
          <div className="sm:col-span-2">
            <label className="label block mb-1">Notas internas</label>
            <textarea className="input" rows={2} value={value.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>
      )}
    </div>
  );
}

// Cuerpo para PUT /api/acti-equipo/members/[clientId]
export function actiValueToBody(v: ActiMemberValue) {
  return {
    is_acti: v.is_acti,
    plan: v.plan,
    status: v.status,
    joined_at: v.joined_at || null,
    trial_start: v.trial_start || null,
    trial_end: v.trial_end || null,
    kam_email: v.kam_email || null,
    notes: v.notes || null,
  };
}
