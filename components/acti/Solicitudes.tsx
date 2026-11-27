"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// ACTI · Mis solicitudes: tablero por etapa. Las etapas se derivan del flujo
// real de prospección del portal (no de un estado paralelo).

type Item = {
  id: string;
  company: string;
  domain: string | null;
  stage: string;
  detail: string;
  personas: { areas: string[]; levels: string[]; titles: string };
  requestedAt: string;
  canCancel: boolean;
  meetingDate: string | null;
};
type Data = {
  items: Item[];
  stages: { key: string; label: string }[];
  quota: { limit: number; used: number; blocked: boolean; reason: string | null; period: string };
};

const fmt = (iso: string) => new Date(iso).toLocaleDateString("es-CL", { day: "numeric", month: "short" });

export default function Solicitudes() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () =>
    fetch("/api/acti/solicitudes")
      .then((r) => r.json())
      .then((j) => (j.error ? setErr(j.error) : setData(j)))
      .catch(() => setErr("No se pudo cargar"));
  useEffect(() => { load(); }, []);

  async function cancel(id: string) {
    if (!confirm("¿Cancelar esta solicitud? Se libera el cupo.")) return;
    const r = await fetch(`/api/acti/solicitudes/${id}`, { method: "DELETE" });
    if (!r.ok) setErr((await r.json().catch(() => ({}))).error ?? "No se pudo cancelar");
    load();
  }

  if (err) return <div className="acti-banner warn">{err}</div>;
  if (!data) return <div className="acti-card acti-empty">Cargando…</div>;
  if (!data.items.length) {
    return (
      <div className="acti-card acti-empty">
        <p style={{ margin: "0 0 12px" }}>Aún no pides reuniones.</p>
        <Link className="acti-btn sm" href="/acti/buscar">Buscar cuentas</Link>
      </div>
    );
  }
  return (
    <div className="acti-stack" style={{ gap: 16 }}>
      <div className="acti-small acti-muted">
        {data.quota.used} de {data.quota.limit} empresas {data.quota.period === "trial" ? "de tu prueba" : "de este mes"}.
        {data.quota.blocked && data.quota.reason ? ` ${data.quota.reason}` : ""}
      </div>
      <div className="acti-kb">
        {data.stages.map((st) => {
          const items = data.items.filter((i) => i.stage === st.key);
          return (
            <section key={st.key} className="acti-col" aria-label={st.label}>
              <h3>{st.label}<span className="acti-tag">{items.length}</span></h3>
              {items.map((i) => (
                <div key={i.id} className="acti-kc">
                  <b>{i.company}</b>
                  <div className="acti-muted">{i.detail}{i.meetingDate ? ` · ${fmt(i.meetingDate)}` : ""}</div>
                  {(i.personas.areas.length > 0 || i.personas.levels.length > 0 || i.personas.titles) && (
                    <div className="acti-tiny acti-muted" style={{ marginTop: 4 }}>
                      {[...i.personas.areas, ...i.personas.levels].join(" · ")}{i.personas.titles ? ` · ${i.personas.titles}` : ""}
                    </div>
                  )}
                  <div className="acti-between" style={{ marginTop: 6 }}>
                    <span className="acti-tiny acti-muted">Pedida el {fmt(i.requestedAt)}</span>
                    {i.canCancel && <button className="acti-link" onClick={() => cancel(i.id)}>Cancelar</button>}
                  </div>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
