"use client";

import { useEffect, useState } from "react";
import { DEPTO_OPTS, ETAPA_OPTS, FACTURACION_OPTS, MODELO_OPTS, SENIORITY_OPTS, TAMANO_OPTS, type IcpFormData } from "@/lib/icp-form";
import { decodePersonas, encodePersonas, ICP_KEYS, PROFILE_KEYS, type ExtraPersona, type IcpScope } from "@/lib/acti/icp";

// Formularios del socio ACTI sobre su ICP (el mismo de Sistema → ICP).
// Mi ICP = empresa objetivo, señales, buyer personas y referencias.
// Mi perfil comercial = propuesta de valor, servicios, casos, objeciones…

type Form = Partial<IcpFormData>;

function useIcp(scope: IcpScope) {
  const [form, setForm] = useState<Form | null>(null);
  const [byIndustry, setByIndustry] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/acti/icp")
      .then((r) => r.json())
      .then((j) => {
        if (j.error) return setError(j.error);
        setForm(j.form);
        setByIndustry(!!j.byIndustry);
      })
      .catch(() => setError("No se pudo cargar tu ICP"));
  }, []);

  async function save(fields: Form) {
    setSaving(true);
    setMsg(null);
    const keys = scope === "icp" ? ICP_KEYS : PROFILE_KEYS;
    const payload = Object.fromEntries(keys.map((k) => [k, fields[k] ?? (Array.isArray(fields[k]) ? [] : "")]));
    const r = await fetch("/api/acti/icp", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, fields: payload }),
    });
    const j = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) return setMsg({ ok: false, text: j.error ?? "No se pudo guardar" });
    setForm(j.form);
    setMsg({
      ok: true,
      text: j.changes?.length
        ? "Guardado. Las próximas recomendaciones y el fit de empresas usan tu información actualizada."
        : "No había cambios.",
    });
  }

  return { form, setForm, byIndustry, saving, msg, error, save };
}

function Text({ label, hint, value, onChange, rows = 3 }: { label: string; hint?: string; value: string | undefined; onChange: (v: string) => void; rows?: number }) {
  return (
    <label className="acti-field">
      <span className="acti-field-label">{label}</span>
      {hint && <span className="acti-tiny acti-muted">{hint}</span>}
      {rows <= 1 ? (
        <input type="text" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <textarea rows={rows} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

function Chips({ label, options, value, onChange }: { label: string; options: string[]; value: string[] | undefined; onChange: (v: string[]) => void }) {
  const cur = value ?? [];
  return (
    <div className="acti-field">
      <span className="acti-field-label">{label}</span>
      <div className="acti-chips">
        {options.map((o) => {
          const on = cur.includes(o);
          return (
            <button key={o} type="button" className="acti-chip" data-on={on || undefined} aria-pressed={on}
              onClick={() => onChange(on ? cur.filter((x) => x !== o) : [...cur, o])}>
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SaveBar({ saving, msg, onSave }: { saving: boolean; msg: { ok: boolean; text: string } | null; onSave: () => void }) {
  return (
    <div className="acti-savebar">
      <button className="acti-btn" onClick={onSave} disabled={saving}>{saving ? "Guardando…" : "Guardar cambios"}</button>
      {msg && <span className={`acti-small ${msg.ok ? "acti-ok" : "acti-bad"}`}>{msg.text}</span>}
    </div>
  );
}

function Loading({ error }: { error: string | null }) {
  return <div className="acti-card acti-empty">{error ?? "Cargando…"}</div>;
}

function IndustryNotice() {
  return (
    <div className="acti-banner warn">
      <span>Tu ICP está organizado por industria. Para cambiarlo, pídeselo al equipo de BullsEye.</span>
    </div>
  );
}

export function IcpEditor() {
  const { form, setForm, byIndustry, saving, msg, error, save } = useIcp("icp");
  const [personas, setPersonas] = useState<ExtraPersona[]>([]);
  useEffect(() => { if (form) setPersonas(decodePersonas(form.buyer_personas_extra)); }, [form === null]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!form) return <Loading error={error} />;
  if (byIndustry) return <IndustryNotice />;
  const set = <K extends keyof IcpFormData>(k: K) => (v: IcpFormData[K]) => setForm({ ...form, [k]: v });
  const setP = (i: number, patch: Partial<ExtraPersona>) => setPersonas(personas.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <div className="acti-stack" style={{ gap: 16 }}>
      <section className="acti-card acti-stack">
        <h2 style={{ margin: 0 }}>Empresa objetivo</h2>
        <Text label="Qué hace tu empresa" value={form.descripcion_negocio} onChange={set("descripcion_negocio")} rows={2} />
        <div className="acti-grid2">
          <Text label="Industrias objetivo" value={form.industrias_objetivo} onChange={set("industrias_objetivo")} rows={2} />
          <Text label="Industrias que no te interesan" value={form.industrias_excluidas} onChange={set("industrias_excluidas")} rows={2} />
        </div>
        <Text label="Países y ciudades prioritarios" value={form.geografias} onChange={set("geografias")} rows={1} />
        <Chips label="Tamaño (empleados)" options={TAMANO_OPTS} value={form.tamano_empresa} onChange={set("tamano_empresa")} />
        <Chips label="Facturación anual" options={FACTURACION_OPTS} value={form.facturacion} onChange={set("facturacion")} />
        <Chips label="Modelo de empresa" options={MODELO_OPTS} value={form.modelo_empresa} onChange={set("modelo_empresa")} />
        <Chips label="Etapa de la empresa" options={ETAPA_OPTS} value={form.etapa_empresa} onChange={set("etapa_empresa")} />
        <Text label="Regulaciones que aplican" hint="Ej.: Ley 21.663 de ciberseguridad, normativa CMF, ISO 27001." value={form.regulaciones} onChange={set("regulaciones")} rows={2} />
      </section>

      <section className="acti-card acti-stack">
        <h2 style={{ margin: 0 }}>Señales de compra</h2>
        <div className="acti-grid2">
          <Text label="Señales de que una empresa es buena candidata" value={form.senales_positivas} onChange={set("senales_positivas")} />
          <Text label="Señales de que no lo es" value={form.senales_negativas} onChange={set("senales_negativas")} />
          <Text label="Tecnologías que usan" value={form.tech_stack} onChange={set("tech_stack")} rows={2} />
          <Text label="Eventos que disparan la compra" hint="Ej.: nueva regulación, ronda de inversión, cambio de gerente." value={form.eventos_disparadores} onChange={set("eventos_disparadores")} rows={2} />
        </div>
      </section>

      <section className="acti-card acti-stack">
        <h2 style={{ margin: 0 }}>Buyer personas</h2>
        <p className="acti-small acti-muted" style={{ margin: 0 }}>Tipos de cargo con los que quieres reunirte. Nunca verás nombres antes de que se agende la reunión.</p>
        <h3 style={{ margin: "6px 0 0" }}>Persona principal</h3>
        <div className="acti-grid2">
          <Text label="Cargos que deciden" value={form.cargos_decisores} onChange={set("cargos_decisores")} rows={2} />
          <Text label="Cargos que influyen" value={form.cargos_influenciadores} onChange={set("cargos_influenciadores")} rows={2} />
        </div>
        <Text label="Cargos a evitar" value={form.cargos_evitar} onChange={set("cargos_evitar")} rows={1} />
        <Chips label="Áreas" options={DEPTO_OPTS} value={form.departamentos} onChange={set("departamentos")} />
        <Chips label="Nivel mínimo" options={SENIORITY_OPTS} value={form.seniority} onChange={set("seniority")} />
        <Text label="Qué le preocupa / cómo decide" value={form.perfil_psicografico} onChange={set("perfil_psicografico")} rows={2} />

        {personas.map((p, i) => (
          <div key={i} className="acti-persona">
            <div className="acti-between">
              <h3 style={{ margin: 0 }}>Persona {i + 2}</h3>
              <button type="button" className="acti-btn ghost sm" onClick={() => setPersonas(personas.filter((_, j) => j !== i))}>Quitar</button>
            </div>
            <div className="acti-grid2">
              <Text label="Nombre de la persona" hint="Ej.: Decisor de finanzas" value={p.name} onChange={(v) => setP(i, { name: v })} rows={1} />
              <Text label="Cargos" value={p.titles} onChange={(v) => setP(i, { titles: v })} rows={1} />
              <Text label="Área" value={p.area} onChange={(v) => setP(i, { area: v })} rows={1} />
              <Text label="Nivel" value={p.level} onChange={(v) => setP(i, { level: v })} rows={1} />
            </div>
            <Text label="Qué le duele / qué busca" value={p.pains} onChange={(v) => setP(i, { pains: v })} rows={2} />
          </div>
        ))}
        {personas.length < 6 && (
          <div>
            <button type="button" className="acti-btn ghost sm"
              onClick={() => setPersonas([...personas, { name: "", area: "", level: "", titles: "", pains: "" }])}>
              + Agregar otra buyer persona
            </button>
          </div>
        )}
      </section>

      <section className="acti-card acti-stack">
        <h2 style={{ margin: 0 }}>Clientes de referencia</h2>
        <div className="acti-grid2">
          <Text label="Tus mejores clientes" hint="Los usamos como referencia y no te los recomendamos." value={form.mejores_clientes} onChange={set("mejores_clientes")} />
          <Text label="Clientes que no fueron un buen fit" value={form.peores_clientes} onChange={set("peores_clientes")} />
        </div>
        <Text label="Ticket promedio y ciclo de venta" value={form.ticket_acv} onChange={set("ticket_acv")} rows={1} />
      </section>

      <SaveBar saving={saving} msg={msg} onSave={() => save({ ...form, buyer_personas_extra: encodePersonas(personas) })} />
    </div>
  );
}

export function PerfilEditor() {
  const { form, setForm, byIndustry, saving, msg, error, save } = useIcp("perfil");
  if (!form) return <Loading error={error} />;
  if (byIndustry) return <IndustryNotice />;
  const set = <K extends keyof IcpFormData>(k: K) => (v: IcpFormData[K]) => setForm({ ...form, [k]: v });

  return (
    <div className="acti-stack" style={{ gap: 16 }}>
      <section className="acti-card acti-stack">
        <h2 style={{ margin: 0 }}>Tu oferta</h2>
        <Text label="Propuesta de valor" hint="En una o dos oraciones." value={form.propuesta_valor} onChange={set("propuesta_valor")} rows={2} />
        <Text label="Servicios que ofreces" value={form.servicios} onChange={set("servicios")} />
        <div className="acti-grid2">
          <Text label="Problemas que resuelves" value={form.problemas} onChange={set("problemas")} />
          <Text label="Resultados que entregas" value={form.resultados} onChange={set("resultados")} />
        </div>
        <Text label="Casos de éxito" hint="Cliente, desafío y resultado. Sirven para que el SDR y Peitho los mencionen." value={form.casos_exito} onChange={set("casos_exito")} rows={4} />
        <div className="acti-grid2">
          <Text label="Por qué te eligen (diferenciadores)" value={form.diferenciadores} onChange={set("diferenciadores")} />
          <Text label="Competidores principales" value={form.competidores} onChange={set("competidores")} />
        </div>
      </section>

      <section className="acti-card acti-stack">
        <h2 style={{ margin: 0 }}>Manejo de objeciones</h2>
        <Text label="Objeciones frecuentes y cómo responderlas" hint="Una por línea: objeción → respuesta." value={form.objeciones} onChange={set("objeciones")} rows={5} />
        <Text label="Lo que no se debe ofrecer" hint="Servicios, precios o promesas que el SDR no debe mencionar." value={form.no_ofrecer} onChange={set("no_ofrecer")} />
      </section>

      <SaveBar saving={saving} msg={msg} onSave={() => save(form)} />
    </div>
  );
}
