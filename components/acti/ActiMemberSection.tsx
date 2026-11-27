"use client";

import { useEffect, useState } from "react";
import { ActiMemberFields, actiValueToBody, emptyActiValue, type ActiMemberValue } from "./ActiMemberFields";

// Sección "Socio ACTI" en Configuración → Cliente (equipo BullsEye).
export default function ActiMemberSection({ clientId }: { clientId: string }) {
  const [value, setValue] = useState<ActiMemberValue>(emptyActiValue());
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    setMsg(null);
    fetch(`/api/acti-equipo/members/${clientId}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        const m = j.member;
        setValue(
          m
            ? {
                is_acti: true,
                plan: m.plan,
                status: m.status,
                joined_at: m.joined_at ?? "",
                trial_start: m.trial_start ?? "",
                trial_end: m.trial_end ?? "",
                kam_email: m.kam_email ?? "",
                notes: m.notes ?? "",
              }
            : emptyActiValue()
        );
      })
      .catch(() => {})
      .finally(() => alive && setLoaded(true));
    return () => { alive = false; };
  }, [clientId]);

  async function save() {
    setSaving(true);
    setMsg(null);
    const res = await fetch(`/api/acti-equipo/members/${clientId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(actiValueToBody(value)),
    });
    const j = await res.json().catch(() => ({}));
    setSaving(false);
    setMsg(res.ok
      ? { ok: true, text: value.is_acti ? "Guardado. Sus usuarios del portal ven la experiencia ACTI." : "Guardado. El cliente ya no es socio ACTI." }
      : { ok: false, text: j.error ?? "No se pudo guardar" });
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-ink">Socio ACTI</h2>
        {value.is_acti && <span className="badge" style={{ background: "rgba(98,224,216,0.18)", color: "#1FA39B" }}>ACTI</span>}
      </div>
      {!loaded ? (
        <p className="text-sm text-ink-muted">Cargando…</p>
      ) : (
        <>
          <ActiMemberFields value={value} onChange={setValue} />
          <div className="flex items-center gap-3 mt-4">
            <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
            {msg && <span className={`text-sm ${msg.ok ? "text-success-fg" : "text-danger-fg"}`}>{msg.text}</span>}
          </div>
        </>
      )}
    </div>
  );
}
