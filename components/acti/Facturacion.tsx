"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// ACTI · Facturación del socio: detalle del mes (base, reuniones realizadas,
// no-shows sin cargo, IVA y total en UF y CLP) e historial. En Freemium, $0 y
// la invitación a cambiar de plan.

type Line = { id: string; empresa: string; fecha: string | null; estado: "cobrada" | "no_show" | "en_revision" | "sin_cargo" };
type Bill = {
  month: string;
  free: boolean;
  baseUf: number;
  perMeetingUf: number;
  meetingsCharged: number;
  meetingsDone: number;
  meetingsNoShow: number;
  meetingsDisputed: number;
  variableUf: number;
  subtotalUf: number;
  ivaPct: number;
  ivaUf: number;
  totalUf: number;
  lines: Line[];
  closed: boolean;
  ufValue: number | null;
  ufDate: string | null;
  totalClp: number | null;
};
type Data = { current: Bill; history: Bill[]; planName: string };

const uf = (n: number) => `${n.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} UF`;
const clp = (n: number | null) => (n === null ? "—" : `$${Math.round(n).toLocaleString("es-CL")}`);
const clpOf = (ufAmount: number, b: Bill) => (b.ufValue ? clp(ufAmount * b.ufValue) : "—");
const monthLabel = (m: string) => {
  const [y, mm] = m.split("-").map(Number);
  const s = new Date(Date.UTC(y, mm - 1, 1)).toLocaleDateString("es-CL", { month: "long", year: "numeric", timeZone: "UTC" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const LINE: Record<Line["estado"], { label: string; cls: string }> = {
  cobrada: { label: "Se cobra", cls: "ok" },
  no_show: { label: "No asistió · sin cargo", cls: "" },
  en_revision: { label: "En revisión · sin cargo por ahora", cls: "warn" },
  sin_cargo: { label: "Sin cargo", cls: "" },
};

export default function Facturacion() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/acti/facturacion", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => (j.error ? setErr(j.error) : setData(j)))
      .catch(() => setErr("No se pudo cargar la facturación"));
  }, []);

  if (err) return <div className="acti-banner warn">{err}</div>;
  if (!data) return <div className="acti-card acti-empty">Cargando…</div>;
  const b = data.current;

  if (b.free) {
    return (
      <div className="acti-stack" style={{ gap: 16 }}>
        <section className="acti-card acti-stat">
          <div className="v">$0</div>
          <div className="l">Tu plan {data.planName} está incluido en la membresía ACTI</div>
          <div className="b">No tienes cobros este mes.</div>
        </section>
        <div className="acti-banner">
          <span><b>¿Quieres reuniones todos los meses?</b> Con un plan pagado tienes reuniones garantizadas, prioridad en la prospección y, desde Crece, KAM dedicado y Peitho.</span>
          <Link href="/acti/mi-plan" className="acti-btn sm">Ver planes</Link>
        </div>
        {data.history.length > 0 && <History list={data.history} />}
      </div>
    );
  }

  return (
    <div className="acti-stack" style={{ gap: 16 }}>
      <section className="acti-card">
        <div className="acti-between" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{monthLabel(b.month)} · plan {data.planName}</h2>
          <span className="acti-tag">{b.closed ? "Cerrado" : "Mes en curso (estimado)"}</span>
        </div>
        <div className="acti-tw">
          <table>
            <thead><tr><th>Concepto</th><th className="r" style={{ textAlign: "right" }}>UF</th><th style={{ textAlign: "right" }}>CLP</th></tr></thead>
            <tbody>
              <tr><td>Base mensual</td><td style={{ textAlign: "right" }}>{uf(b.baseUf)}</td><td style={{ textAlign: "right" }}>{clpOf(b.baseUf, b)}</td></tr>
              <tr>
                <td>Reuniones realizadas: {b.meetingsCharged} × {uf(b.perMeetingUf)}</td>
                <td style={{ textAlign: "right" }}>{uf(b.variableUf)}</td><td style={{ textAlign: "right" }}>{clpOf(b.variableUf, b)}</td>
              </tr>
              <tr><td>No asistió el prospecto: {b.meetingsNoShow} (sin cargo)</td><td style={{ textAlign: "right" }}>{uf(0)}</td><td style={{ textAlign: "right" }}>$0</td></tr>
              {b.meetingsDisputed > 0 && (
                <tr><td>En revisión: {b.meetingsDisputed} (sin cargo mientras se revisa)</td><td style={{ textAlign: "right" }}>{uf(0)}</td><td style={{ textAlign: "right" }}>$0</td></tr>
              )}
              <tr><td>Subtotal</td><td style={{ textAlign: "right" }}>{uf(b.subtotalUf)}</td><td style={{ textAlign: "right" }}>{clpOf(b.subtotalUf, b)}</td></tr>
              <tr><td>IVA ({b.ivaPct}%)</td><td style={{ textAlign: "right" }}>{uf(b.ivaUf)}</td><td style={{ textAlign: "right" }}>{clpOf(b.ivaUf, b)}</td></tr>
            </tbody>
            <tfoot>
              <tr><td style={{ fontWeight: 700 }}>Total</td><td style={{ textAlign: "right", fontWeight: 700 }}>{uf(b.totalUf)}</td><td style={{ textAlign: "right", fontWeight: 700 }}>{clp(b.totalClp)}</td></tr>
            </tfoot>
          </table>
        </div>
        <p className="acti-tiny acti-muted" style={{ margin: "8px 0 0" }}>
          {b.ufValue ? `UF del ${b.ufDate}: ${clp(b.ufValue)}. ` : ""}
          {b.closed ? "" : "El total se confirma al cierre del mes con la UF del último día."}
        </p>
      </section>

      {b.lines.length > 0 && (
        <section className="acti-card">
          <h2>Reuniones del mes</h2>
          <ul className="acti-list">
            {b.lines.map((l) => (
              <li key={l.id} className="acti-between">
                <span><b style={{ fontWeight: 600 }}>{l.empresa}</b> <span className="acti-small acti-muted">· {l.fecha ?? "—"}</span></span>
                <span className={`acti-tag ${LINE[l.estado].cls}`}>{LINE[l.estado].label}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <History list={data.history} />
    </div>
  );
}

function History({ list }: { list: Bill[] }) {
  return (
    <section className="acti-card">
      <h2>Historial</h2>
      {list.length === 0 ? (
        <div className="acti-empty">Aún no hay meses cerrados.</div>
      ) : (
        <div className="acti-tw">
          <table>
            <thead><tr><th>Mes</th><th>Reuniones cobradas</th><th>No-shows</th><th style={{ textAlign: "right" }}>Total UF</th><th style={{ textAlign: "right" }}>Total CLP</th></tr></thead>
            <tbody>
              {list.map((h) => (
                <tr key={h.month}>
                  <td>{monthLabel(h.month)}</td>
                  <td>{h.meetingsCharged}</td>
                  <td>{h.meetingsNoShow}</td>
                  <td style={{ textAlign: "right" }}>{uf(h.totalUf)}</td>
                  <td style={{ textAlign: "right" }}>{clp(h.totalClp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
