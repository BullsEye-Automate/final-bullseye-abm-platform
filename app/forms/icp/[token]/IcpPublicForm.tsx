"use client";

import { useState } from "react";
import {
  IcpFormData,
  EMPTY_FORM,
  TAMANO_OPTS,
  FACTURACION_OPTS,
  MODELO_OPTS,
  ETAPA_OPTS,
  DEPTO_OPTS,
  SENIORITY_OPTS,
  TONO_OPTS,
  IDIOMA_OPTS,
  CTA_OPTS,
  CANALES_OPTS,
  serializeIcpForm,
  deserializeIcpForm,
} from "@/lib/icp-form";

type Props = {
  token: string;
  clientName: string;
  initialContent: string | null;
};

export default function IcpPublicForm({ token, clientName, initialContent }: Props) {
  const [form,    setForm]    = useState<IcpFormData>(
    initialContent ? deserializeIcpForm(initialContent) : EMPTY_FORM
  );
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(!!initialContent);
  const [error,   setError]   = useState<string | null>(null);

  function setField(key: keyof IcpFormData, value: string | string[]) {
    setForm((prev: IcpFormData) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function toggleChip(key: keyof IcpFormData, value: string) {
    const current = form[key] as string[];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    setField(key, next);
  }

  async function handleSubmit() {
    const content = serializeIcpForm(form);
    if (!content.trim()) return;
    setSaving(true);
    setError(null);
    const r = await fetch(`/api/forms/icp/${token}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ content }),
    });
    const j = await r.json();
    setSaving(false);
    if (!r.ok || j.error) {
      setError(j.error ?? "Error al guardar. Intenta nuevamente.");
      return;
    }
    setSaved(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const hasContent = Object.values(form).some((v) =>
    Array.isArray(v) ? v.length > 0 : (v as string).trim().length > 0
  );

  return (
    <div style={{ fontFamily: "'Outfit', sans-serif", background: "#F7F8FC", minHeight: "100vh" }}>
      {/* ── Header ── */}
      <header style={{ background: "#fff", borderBottom: "1px solid #EEF0F7", padding: "20px 40px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#251762", letterSpacing: -0.3 }}>
            Bulls<span style={{ color: "#62E0D8" }}>Eye</span>
          </div>
          <span style={{ color: "#C8CCE0", fontSize: 18 }}>·</span>
          <span style={{ fontSize: 13, color: "#8B90AA" }}>ICP Formulario</span>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#251762" }}>
            {clientName}
          </div>
          <div style={{ fontSize: 11, color: "#8B90AA" }}>Formulario confidencial</div>
        </div>
      </header>

      {/* ── Banner ── */}
      <div style={{ background: "linear-gradient(135deg,#251762 0%,#3a2485 100%)", padding: "32px 40px", borderBottom: "3px solid #62E0D8" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "#fff", marginBottom: 8, letterSpacing: -0.5 }}>
          ICP — <span style={{ color: "#62E0D8" }}>Ideal Customer Profile</span>
        </h1>
        <p style={{ color: "rgba(255,255,255,0.65)", fontSize: 14, maxWidth: 600, lineHeight: 1.7 }}>
          Esta información es la base de toda la estrategia de prospección. Mientras más específico seas, mejores serán los leads que encontremos para <strong style={{ color: "#fff" }}>{clientName}</strong>.
        </p>
        {saved && (
          <div style={{ marginTop: 16, display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(98,224,216,0.15)", color: "#62E0D8", padding: "8px 16px", borderRadius: 8, border: "1px solid rgba(98,224,216,0.3)", fontSize: 13, fontWeight: 500 }}>
            ✓ ICP guardado — el equipo BullsEye ya puede verlo
          </div>
        )}
      </div>

      {/* ── Formulario ── */}
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "36px 40px 80px" }}>
        {error && (
          <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626", padding: "12px 16px", borderRadius: 10, fontSize: 13, marginBottom: 24 }}>
            {error}
          </div>
        )}

        {/* Sección 1 */}
        <PSection num={1} title="DATOS DEL CLIENTE" desc="Información básica del contacto y la empresa">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <PTextField label="Nombre de la empresa"  value={form.nombre_empresa}  onChange={(v) => setField("nombre_empresa",  v)} placeholder="Ej: Acme Corp" />
            <PTextField label="Nombre del contacto"   value={form.nombre_contacto} onChange={(v) => setField("nombre_contacto", v)} placeholder="Nombre completo" />
            <PTextField label="Cargo"                 value={form.cargo}           onChange={(v) => setField("cargo",           v)} placeholder="Ej: Head of Sales, CEO" />
            <PTextField label="Email de contacto"     value={form.email}           onChange={(v) => setField("email",           v)} placeholder="email@empresa.com" />
          </div>
          <PTextArea label="Descripción breve del negocio" hint="¿A qué se dedica la empresa? ¿Cuál es su producto o servicio principal?" rows={3}
            placeholder="Ej: Somos una plataforma SaaS de gestión de RRHH para empresas medianas en LATAM."
            value={form.descripcion_negocio} onChange={(v) => setField("descripcion_negocio", v)} />
        </PSection>

        {/* Sección 2 */}
        <PSection num={2} title="PERFIL DE EMPRESA OBJETIVO (ICP)" desc="Define el tipo ideal de cliente">
          <PTextArea label="Industrias objetivo" crit hint="Lista en orden de prioridad. Sé específico (no 'tecnología' sino 'SaaS B2B de RRHH')" rows={4}
            placeholder={"1. SaaS B2B con equipo comercial (prioridad alta)\n2. Agencias de marketing con equipo propio"}
            value={form.industrias_objetivo} onChange={(v) => setField("industrias_objetivo", v)} />
          <PTextArea label="Industrias excluidas" crit hint="Sectores donde tu solución NO aplica o has tenido malas experiencias" rows={3}
            placeholder={"- Retail B2C\n- Startups pre-revenue"}
            value={form.industrias_excluidas} onChange={(v) => setField("industrias_excluidas", v)} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <PChipGroup label="Tamaño de empresa (empleados)" options={TAMANO_OPTS}     selected={form.tamano_empresa} onToggle={(v) => toggleChip("tamano_empresa", v)} multi />
            <PChipGroup label="Facturación anual estimada"    options={FACTURACION_OPTS} selected={form.facturacion}    onToggle={(v) => toggleChip("facturacion",    v)} multi />
          </div>
          <PTextArea label="Geografías prioritarias" crit hint="Países, regiones o ciudades en orden de prioridad" rows={3}
            placeholder={"1. Chile (RM + Valparaíso)\n2. México (CDMX)\n3. Colombia (Bogotá)"}
            value={form.geografias} onChange={(v) => setField("geografias", v)} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <PChipGroup label="Modelo de empresa"    options={MODELO_OPTS} selected={form.modelo_empresa} onToggle={(v) => toggleChip("modelo_empresa", v)} multi />
            <PChipGroup label="Etapa de la empresa"  options={ETAPA_OPTS}  selected={form.etapa_empresa}  onToggle={(v) => toggleChip("etapa_empresa",  v)} multi />
          </div>
        </PSection>

        {/* Sección 3 */}
        <PSection num={3} title="SEÑALES DE FIT" desc="El equipo BullsEye busca estas señales en LinkedIn, web y noticias">
          <PTextArea label="Señales positivas de fit" crit hint="¿Qué indica que una empresa NECESITA tu solución? Sé lo más específico posible." rows={5}
            placeholder={"1. Tienen equipo de ventas de 3+ personas\n2. Usan HubSpot o Salesforce\n3. Publicaron vacante de SDR en los últimos 90 días"}
            value={form.senales_positivas} onChange={(v) => setField("senales_positivas", v)} />
          <PTextArea label="Señales negativas / descalificadores" crit hint="¿Qué descalifica a una empresa automáticamente?" rows={4}
            placeholder={"1. Solo tienen 1 vendedor\n2. Venden a consumidores finales (B2C)"}
            value={form.senales_negativas} onChange={(v) => setField("senales_negativas", v)} />
          <PTextArea label="Tech stack / herramientas que usa tu cliente ideal" hint="Indica madurez digital y alineación con tu solución" rows={3}
            placeholder={"CRM: HubSpot, Salesforce\nAutomatización: Outreach, Apollo\nVideoconferencia: Zoom, Teams"}
            value={form.tech_stack} onChange={(v) => setField("tech_stack", v)} />
          <PTextArea label="Eventos disparadores de compra" hint="¿Qué evento hace que busquen tu solución?" rows={3}
            placeholder={"- Expansión a nuevo mercado\n- Contratación de nuevo VP de Ventas\n- Ronda de inversión reciente"}
            value={form.eventos_disparadores} onChange={(v) => setField("eventos_disparadores", v)} />
        </PSection>

        {/* Sección 4 */}
        <PSection num={4} title="BUYER PERSONA — EL CONTACTO QUE CIERRA" desc="A quién contactar dentro de la empresa y cómo piensa">
          <PTextArea label="Cargos decisores (quien aprueba)" crit hint="Los que firman el contrato" rows={3}
            placeholder={"1. CEO / Founder\n2. VP de Ventas / Chief Revenue Officer"}
            value={form.cargos_decisores} onChange={(v) => setField("cargos_decisores", v)} />
          <PTextArea label="Cargos influenciadores (quien recomienda)" hint="Abren la puerta pero no aprueban" rows={3}
            placeholder={"1. Sales Manager / Jefe de ventas\n2. Revenue Ops Manager"}
            value={form.cargos_influenciadores} onChange={(v) => setField("cargos_influenciadores", v)} />
          <PTextArea label="Cargos a evitar" crit hint="Sin poder de compra o bloquean el proceso" rows={2}
            placeholder={"- Pasantes / becarios\n- IT / Sistemas (solo si no tienen influencia en ventas)"}
            value={form.cargos_evitar} onChange={(v) => setField("cargos_evitar", v)} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <PChipGroup label="Departamentos objetivo" options={DEPTO_OPTS}     selected={form.departamentos} onToggle={(v) => toggleChip("departamentos", v)} multi />
            <PChipGroup label="Seniority mínimo"       options={SENIORITY_OPTS} selected={form.seniority}     onToggle={(v) => toggleChip("seniority",     v)} multi />
          </div>
          <PTextArea label="Perfil psicográfico del buyer" hint="¿Cómo piensa? ¿Qué le quita el sueño? ¿Compra por ROI, referidos, innovación?" rows={4}
            placeholder={"Ej: Orientado a métricas, necesita justificar ROI ante el CEO, le frustra el time-to-value largo..."}
            value={form.perfil_psicografico} onChange={(v) => setField("perfil_psicografico", v)} />
        </PSection>

        {/* Sección 5 */}
        <PSection num={5} title="PROPUESTA DE VALOR Y DIFERENCIADORES" desc="Para construir mensajes que resuenen con el contexto real del negocio">
          <PTextArea label="Propuesta de valor en 1–2 oraciones" crit hint="Sin jerga interna. ¿Qué hace tu solución, para quién, con qué resultado?" rows={3}
            placeholder={"Ej: Ayudamos a empresas B2B con equipos de ventas de 5–30 personas a generar más reuniones calificadas en menos tiempo."}
            value={form.propuesta_valor} onChange={(v) => setField("propuesta_valor", v)} />
          <PTextArea label="Top 3 problemas que resuelves" crit rows={4}
            placeholder={"1. El equipo de ventas pierde tiempo en leads no calificados\n2. No tienen proceso de outbound estructurado"}
            value={form.problemas} onChange={(v) => setField("problemas", v)} />
          <PTextArea label="Top 3 resultados que entregas" hint="Con números si los tienes" rows={4}
            placeholder={"1. +40% en reuniones calificadas en el primer mes\n2. Pipeline predecible desde semana 3"}
            value={form.resultados} onChange={(v) => setField("resultados", v)} />
          <PTextArea label="Principales competidores" rows={3}
            placeholder={"Directos: Empresa A, Empresa B\nIndirectos: Agencias de marketing, contratar SDR interno"}
            value={form.competidores} onChange={(v) => setField("competidores", v)} />
          <PTextArea label="Por qué te eligen vs. la competencia" hint="Lo que dicen tus mejores clientes, no tu marketing" rows={3}
            placeholder={"Ej: 'Nos eligieron porque combinamos estrategia + ejecución. No son solo una herramienta.'"}
            value={form.diferenciadores} onChange={(v) => setField("diferenciadores", v)} />
        </PSection>

        {/* Sección 6 */}
        <PSection num={6} title="OUTREACH — TONO Y MENSAJES" desc="Cómo comunicar para generar conversaciones reales">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <PChipGroup label="Tono de comunicación" crit options={TONO_OPTS}   selected={form.tono}   onToggle={(v) => toggleChip("tono",   v)} />
            <PChipGroup label="Idioma del outreach"       options={IDIOMA_OPTS} selected={form.idioma} onToggle={(v) => toggleChip("idioma", v)} multi />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <PChipGroup label="CTA del primer contacto" options={CTA_OPTS}     selected={form.cta_primer_contacto} onToggle={(v) => toggleChip("cta_primer_contacto", v)} />
            <PChipGroup label="Canales preferidos"      options={CANALES_OPTS} selected={form.canales}             onToggle={(v) => toggleChip("canales",             v)} multi />
          </div>
          <PTextArea label="Mensajes que han funcionado (ejemplos reales)" hint="Pega 1–2 emails o mensajes LinkedIn que generaron respuesta positiva. Sin datos personales." rows={6}
            placeholder={"Ejemplo email que funcionó:\nAsunto: [Nombre empresa] + prospección personalizada\nHola [Nombre], vi que están contratando SDRs en LinkedIn..."}
            value={form.mensajes_exitosos} onChange={(v) => setField("mensajes_exitosos", v)} />
          <PTextArea label="Objeciones frecuentes y cómo responderlas" hint="Las que aparecen antes de la primera llamada" rows={4}
            placeholder={"'Ya tenemos una agencia' → ...\n'No tenemos presupuesto' → ...\n'Mándame información por email' → ..."}
            value={form.objeciones} onChange={(v) => setField("objeciones", v)} />
        </PSection>

        {/* Sección 7 */}
        <PSection num={7} title="CLIENTES ACTUALES COMO REFERENCIA" desc="Los mejores clientes son la mejor referencia para el equipo BullsEye">
          <PTextArea label="Top 3–5 mejores clientes actuales o pasados" crit hint="Nombre/tipo, industria, tamaño, por qué fueron tan buenos clientes." rows={5}
            placeholder={"1. Empresa A — SaaS B2B RRHH, 80 empleados — pagaron sin negociar, escalaron a plan mayor\n2. Empresa B — Fintech, 200 emp. — compra por ROI, ciclo de venta rápido"}
            value={form.mejores_clientes} onChange={(v) => setField("mejores_clientes", v)} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <PTextArea label="Peores clientes / mal fit" hint="¿Qué tenían en común? ¿Qué señales ignoraste?" rows={4}
              placeholder={"1. Fundador que hace todo solo\n2. Sector muy regulado, ciclo > 6 meses"}
              value={form.peores_clientes} onChange={(v) => setField("peores_clientes", v)} />
            <PTextArea label="Ticket / ACV y ciclo de venta" hint="Valor anual del contrato y tiempo desde primer contacto a cierre" rows={4}
              placeholder={"Ticket mínimo: $X/mes\nTicket promedio: $X/mes\n\nCiclo típico: X semanas"}
              value={form.ticket_acv} onChange={(v) => setField("ticket_acv", v)} />
          </div>
        </PSection>

        {/* ── Botón enviar ── */}
        <div style={{ marginTop: 32, display: "flex", justifyContent: "center" }}>
          <button
            onClick={handleSubmit}
            disabled={saving || !hasContent}
            style={{
              background: saving || !hasContent ? "#C8CCE0" : "#251762",
              color:  "#fff",
              border: "none",
              borderRadius: 10,
              padding: "14px 40px",
              fontSize: 15,
              fontWeight: 600,
              fontFamily: "'Outfit', sans-serif",
              cursor: saving || !hasContent ? "not-allowed" : "pointer",
              boxShadow: "0 4px 16px rgba(37,23,98,0.25)",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              transition: "all 0.15s",
            }}
          >
            {saving ? "Guardando…" : saved ? "✓ Actualizar ICP" : "Enviar a BullsEye"}
          </button>
        </div>

        {saved && (
          <p style={{ textAlign: "center", marginTop: 16, fontSize: 13, color: "#8B90AA" }}>
            El equipo BullsEye recibirá tu ICP y comenzará la prospección.
            Puedes volver a este link en cualquier momento para actualizar la información.
          </p>
        )}
      </div>

      {/* ── Footer ── */}
      <footer style={{ borderTop: "1px solid #EEF0F7", padding: "16px 40px", display: "flex", justifyContent: "space-between", fontSize: 11, color: "#8B90AA" }}>
        <span>Bulls<span style={{ color: "#62E0D8" }}>Eye</span> — Documento confidencial · No compartir sin autorización</span>
        <span>bullseye-abm.com</span>
      </footer>
    </div>
  );
}

// ── Subcomponentes de UI (inline styles para independencia del layout) ──

function PSection({ num, title, desc, children }: {
  num: number; title: string; desc: string; children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 24, background: "#fff", borderRadius: 16, border: "1px solid #EEF0F7", overflow: "hidden" }}>
      <div style={{ background: "#251762", padding: "16px 24px", display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ width: 28, height: 28, borderRadius: "50%", background: "#62E0D8", color: "#251762", fontSize: 13, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {num}
        </span>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, color: "#fff", letterSpacing: 0.2 }}>{title}</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 1 }}>{desc}</div>
        </div>
      </div>
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 18 }}>
        {children}
      </div>
    </div>
  );
}

function PTextField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: "#4A4E6B", marginBottom: 5 }}>{label}</div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width: "100%", fontFamily: "'Outfit',sans-serif", fontSize: 13, color: "#1a1533", background: "#F7F8FC", border: "1.5px solid #EEF0F7", borderRadius: 10, padding: "10px 14px", outline: "none", boxSizing: "border-box" }}
        onFocus={(e) => (e.currentTarget.style.borderColor = "#62E0D8")}
        onBlur={(e)  => (e.currentTarget.style.borderColor = "#EEF0F7")}
      />
    </label>
  );
}

function PTextArea({ label, value, onChange, rows = 3, placeholder, hint, crit }: {
  label: string; value: string; onChange: (v: string) => void;
  rows?: number; placeholder?: string; hint?: string; crit?: boolean;
}) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 500, color: "#4A4E6B", marginBottom: 4 }}>
        {label}
        {crit && (
          <span style={{ fontSize: 9, fontWeight: 700, background: "rgba(37,23,98,0.08)", color: "#251762", border: "1px solid rgba(37,23,98,0.15)", padding: "2px 7px", borderRadius: 3, letterSpacing: 0.5, textTransform: "uppercase" }}>
            Crítico
          </span>
        )}
      </div>
      {hint && <div style={{ fontSize: 11, color: "#8B90AA", marginBottom: 6, lineHeight: 1.5 }}>{hint}</div>}
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width: "100%", fontFamily: "'Outfit',sans-serif", fontSize: 13, color: "#1a1533", background: "#F7F8FC", border: "1.5px solid #EEF0F7", borderRadius: 10, padding: "10px 14px", resize: "vertical", outline: "none", lineHeight: 1.6, boxSizing: "border-box" }}
        onFocus={(e) => (e.currentTarget.style.borderColor = "#62E0D8")}
        onBlur={(e)  => (e.currentTarget.style.borderColor = "#EEF0F7")}
      />
    </label>
  );
}

function PChipGroup({ label, options, selected, onToggle, multi, crit }: {
  label: string; options: string[]; selected: string[];
  onToggle: (v: string) => void; multi?: boolean; crit?: boolean;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 500, color: "#4A4E6B", marginBottom: 8 }}>
        {label}
        {crit && (
          <span style={{ fontSize: 9, fontWeight: 700, background: "rgba(37,23,98,0.08)", color: "#251762", border: "1px solid rgba(37,23,98,0.15)", padding: "2px 7px", borderRadius: 3, letterSpacing: 0.5, textTransform: "uppercase" }}>
            Crítico
          </span>
        )}
        {!multi && <span style={{ fontSize: 10, color: "#C8CCE0", fontWeight: 400 }}>(elige uno)</span>}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
        {options.map((opt) => {
          const active = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onToggle(opt)}
              style={{
                padding: "5px 12px",
                borderRadius: 20,
                fontSize: 12,
                fontWeight: 400,
                fontFamily: "'Outfit',sans-serif",
                cursor: "pointer",
                border: "1.5px solid transparent",
                background: active ? "#251762" : "#EEF0F7",
                color:      active ? "#fff"    : "#4A4E6B",
                transition: "all 0.15s",
              }}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
