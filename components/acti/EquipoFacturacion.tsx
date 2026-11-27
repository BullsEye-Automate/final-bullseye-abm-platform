"use client";

import { useEffect, useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";

// ACTI · Facturación (equipo BullsEye): mes por socio (cerrado o en vivo),
// revenue share de ACTI (10% de la base), cierre del mes con la UF y
// reuniones en revisión (el socio dijo que no se realizó).

type Row = {
  clientId: string; clientName: string; plan: string; closed: boolean; baseUf: number; variableUf: number; totalUf: number;
  meetingsCharged: number; meetingsNoShow: number; meetingsDisputed: number; revenueShareUf: number; totalClp: number | null;
  revenueShareClp: number | null; ufValue: number | null; ufDate: string | null;
};
type Dispute = { meeting_id: string; comentario: string | null; disputa_at: string | null; meetings: { empresa: string; fecha_reunion: string | null } | null; clients: { name: string } | null };
type Data = {
  month: string; closed: boolean; rows: Row[]; disputes: Dispute[]; canClose: boolean;
  totals: { baseUf: number; variableUf: number; totalUf: number; revenueShareUf: number; meetingsCharged: number; meetingsNoShow: number; meetingsDisputed: number };
};

const uf = (n: number) => n.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const clp = (n: number | null) => (n === null ? "—" : `$${Math.round(n).toLocaleString("es-CL")}`);

function monthsBack(n: number) {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(x.toISOString().slice(0, 7));
  }
  return out;
}

export default function EquipoFacturacion() {
  const months = monthsBack(12);
  const [month, setMonth] = useState(months[0]);
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ufInput, setUfInput] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => {
    setData(null); setErr(null);
    fetch(`/api/acti-equipo/facturacion?month=${month}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => (j.error ? setErr(j.error) : setData(j)))
      .catch(() => setErr("No se pudo cargar"));
  };
  useEffect(load, [month]); // eslint-disable-line react-hooks/exhaustive-deps

  async function post(body: Record<string, unknown>) {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/acti-equipo/facturacion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setMsg(j.error ?? "No se pudo completar");
    if (body.action === "cerrar") setMsg(`Mes cerrado: ${j.closed} socios, ${uf(j.totalUf)} UF${j.uf ? ` con UF ${clp(j.uf)}` : " (sin valor UF)"}.`);
    load();
  }

  const isPast = month < months[0];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select className="input w-auto" value={month} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        {data && <span className="badge" style={{ background: data.closed ? "#E1F5EE" : "#FAEEDA", color: data.closed ? "#0F6E56" : "#854F0B" }}>{data.closed ? "Cerrado" : isPast ? "Sin cerrar" : "Mes en curso (en vivo)"}</span>}
      </div>
      {err && <div className="card text-danger-fg">{err}</div>}
      {!data && !err && <div className="card flex items-center gap-2 text-ink-muted"><IconLoader2 size={16} className="animate-spin" /> Cargando…</div>}
      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="card"><div className="label">Facturación total</div><div className="text-2xl font-bold text-ink">{uf(data.totals.totalUf)} UF</div></div>
            <div className="card"><div className="label">Base</div><div className="text-2xl font-bold text-ink">{uf(data.totals.baseUf)} UF</div></div>
            <div className="card"><div className="label">Variable ({data.totals.meetingsCharged} reuniones)</div><div className="text-2xl font-bold text-ink">{uf(data.totals.variableUf)} UF</div></div>
            <div className="card"><div className="label">Revenue share ACTI</div><div className="text-2xl font-bold text-ink">{uf(data.totals.revenueShareUf)} UF</div></div>
          </div>

          <div className="card p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-muted border-b border-[#E5E2F0]">
                  <th className="p-3">Socio</th><th className="p-3">Plan</th><th className="p-3 text-right">Base</th><th className="p-3 text-right">Reuniones</th>
                  <th className="p-3 text-right">No-show</th><th className="p-3 text-right">En revisión</th><th className="p-3 text-right">Total UF (con IVA)</th>
                  <th className="p-3 text-right">Total CLP</th><th className="p-3 text-right">Revenue share ACTI</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-ink-muted">Sin socios en este mes.</td></tr>}
                {data.rows.map((r) => (
                  <tr key={r.clientId} className="border-b border-[#F0EEF6] last:border-0">
                    <td className="p-3 font-medium text-ink">{r.clientName}</td>
                    <td className="p-3 capitalize">{r.plan}</td>
                    <td className="p-3 text-right">{uf(r.baseUf)}</td>
                    <td className="p-3 text-right">{r.meetingsCharged}</td>
                    <td className="p-3 text-right">{r.meetingsNoShow}</td>
                    <td className="p-3 text-right">{r.meetingsDisputed || "—"}</td>
                    <td className="p-3 text-right">{uf(r.totalUf)}</td>
                    <td className="p-3 text-right">{clp(r.totalClp)}</td>
                    <td className="p-3 text-right">{uf(r.revenueShareUf)} UF <span className="text-ink-muted">{r.revenueShareClp !== null ? `· ${clp(r.revenueShareClp)}` : ""}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {isPast && data.canClose && (
            <div className="card flex flex-wrap items-end gap-3">
              <div>
                <label className="label block mb-1">Valor UF (opcional)</label>
                <input className="input w-40" placeholder="Del último día del mes" value={ufInput} onChange={(e) => setUfInput(e.target.value)} />
              </div>
              <button className="btn-primary" disabled={busy} onClick={() => post({ action: "cerrar", month, uf: ufInput ? Number(ufInput.replace(/\./g, "").replace(",", ".")) : undefined })}>
                {data.closed ? "Volver a cerrar el mes" : "Cerrar el mes"}
              </button>
              <span className="text-xs text-ink-muted">Congela los montos con los precios actuales. Sin valor, se usa la UF del último día del mes (mindicador.cl). Se cierra solo los días 1 a 5.</span>
            </div>
          )}
          {msg && <div className="text-sm text-ink">{msg}</div>}

          <div className="card">
            <h3 className="font-semibold text-ink mb-2">Reuniones en revisión</h3>
            <p className="text-xs text-ink-muted mb-3">El socio indicó que no se realizaron pero la planilla dice que sí. No se cobran hasta resolverlas.</p>
            {data.disputes.length === 0 ? (
              <p className="text-sm text-ink-muted">No hay reuniones en revisión.</p>
            ) : (
              <ul className="divide-y divide-[#F0EEF6]">
                {data.disputes.map((d) => (
                  <li key={d.meeting_id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>
                      <b>{d.clients?.name ?? "—"}</b> · {d.meetings?.empresa ?? "—"} · {d.meetings?.fecha_reunion ?? "—"}
                      {d.comentario && <span className="text-ink-muted"> — «{d.comentario}»</span>}
                    </span>
                    <span className="flex gap-2">
                      <button className="btn-secondary" disabled={busy} onClick={() => post({ action: "disputa", meetingId: d.meeting_id, decision: "cobrar" })}>Sí se realizó: cobrar</button>
                      <button className="btn-secondary" disabled={busy} onClick={() => post({ action: "disputa", meetingId: d.meeting_id, decision: "no_cobrar" })}>No cobrar</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
