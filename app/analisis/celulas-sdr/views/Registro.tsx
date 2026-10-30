"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { fmt, isExcludedSdr, makeFilter, pct } from "@/lib/celulasSdr/engine";
import { addDays, dayShort, monthEnd, monthStart, shiftMonth, weekStart } from "@/lib/celulasSdr/calendar";
import type { MeetingRecord, MeetingRecordsResponse, MeetingStatus } from "@/lib/celulasSdr/types";
import { CardH, KGrid, Pending, Seg, useCells, type KCard } from "../components/ui";

// ─── Registro de reuniones ──────────────────────────────────────────────────
// Espejo de solo lectura de la pestaña API Reuniones, con filtros. Por
// defecto: este mes por fecha de la reunión. Respeta además los filtros
// globales de célula, SDR, cliente y país. Sin teléfono ni correo del
// prospecto (ver lib/celulasSdr/server/records.ts).

type Preset = "hoy" | "ayer" | "sem" | "semp" | "mes" | "mesp" | "rango";
type SortK = "md" | "sd" | "sdr" | "client" | "company" | "st";

const ST_LABEL: Record<MeetingStatus, string> = { held: "Realizada", pending: "Pendiente", resch: "Reagendar", noshow: "No-show" };
const ST_CLS: Record<MeetingStatus, string> = { held: "g", pending: "", resch: "y", noshow: "r" };
const PAGE = 100;

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
const isOpp = (v: string) => ["si", "yes"].includes(norm(v));

function presetRange(p: Preset, today: string): [string, string] {
  const m = today.slice(0, 7);
  switch (p) {
    case "hoy": return [today, today];
    case "ayer": return [addDays(today, -1), addDays(today, -1)];
    case "sem": { const w = weekStart(today); return [w, addDays(w, 6)]; }
    case "semp": { const w = addDays(weekStart(today), -7); return [w, addDays(w, 6)]; }
    case "mesp": { const pm = shiftMonth(m, -1); return [monthStart(pm), monthEnd(pm)]; }
    default: return [monthStart(m), monthEnd(m)];
  }
}

export function ViewRegistro() {
  const { M, f } = useCells();
  const today = M.today;
  const [preset, setPreset] = useState<Preset>("mes");
  const [field, setField] = useState<"md" | "sd">("md");
  const [range, setRange] = useState<[string, string]>(() => presetRange("mes", today));
  const [data, setData] = useState<MeetingRecordsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [sts, setSts] = useState<MeetingStatus[]>([]);
  const [origin, setOrigin] = useState("");
  const [opp, setOpp] = useState<"" | "si" | "no">("");
  const [q, setQ] = useState("");
  const [todo, setTodo] = useState(false);
  const [sort, setSort] = useState<{ k: SortK; d: 1 | -1 }>({ k: "md", d: -1 });
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

  const pickPreset = (p: Preset) => {
    setPreset(p);
    if (p !== "rango") setRange(presetRange(p, today));
  };

  useEffect(() => {
    const [from, to] = range;
    if (!from || !to || from > to) return;
    let cancel = false;
    setLoading(true);
    setErr(null);
    fetch(`/api/celulas-sdr/records?from=${from}&to=${to}&field=${field}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.error) throw new Error(j.error || `Error ${r.status}`);
        if (!cancel) setData(j);
      })
      .catch((e) => !cancel && setErr((e as Error).message))
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
  }, [range, field]);

  useEffect(() => setPage(0), [range, field, sts, origin, opp, q, todo, f, sort]);

  const sdrName = (k: string) => M.SD[k]?.name ?? data?.sdrNames[k] ?? k;
  const clientName = (c: string | null) => (c ? M.CL[c]?.name ?? data?.clientNames[c] ?? "—" : "—");

  const d = useMemo(() => {
    if (!data) return null;
    const fl = makeFilter(M, f);
    const qq = norm(q);
    const base = data.rows.filter((r) => !isExcludedSdr(r.sdr) && fl.sdrOk(r.sdr) && fl.cOk(r.client, r.country));
    const origins = [...new Set(base.map((r) => r.origin).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
    const rows = base.filter((r) =>
      (!sts.length || sts.includes(r.st)) &&
      (!origin || r.origin === origin) &&
      (!opp || (opp === "si" ? isOpp(r.opp) : !isOpp(r.opp))) &&
      (!todo || (r.st === "pending" && !!r.md && r.md < today)) &&
      (!qq || norm(`${r.company} ${r.contact} ${r.title} ${r.comment}`).includes(qq)));
    const val = (r: MeetingRecord): string => {
      switch (sort.k) {
        case "sdr": return sdrName(r.sdr);
        case "client": return clientName(r.client);
        case "company": return r.company;
        case "st": return ST_LABEL[r.st];
        case "sd": return r.sd ?? "";
        default: return `${r.md ?? ""} ${r.hour ?? ""}`;
      }
    };
    rows.sort((a, b) => val(a).localeCompare(val(b), "es") * sort.d);
    const n = (st: MeetingStatus) => rows.filter((r) => r.st === st).length;
    const held = n("held"), noshow = n("noshow");
    const late = base.filter((r) => r.st === "pending" && !!r.md && r.md < today).length;
    return { rows, origins, held, noshow, pending: n("pending"), resch: n("resch"), opps: rows.filter((r) => r.st === "held" && isOpp(r.opp)).length, late };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, M, f, sts, origin, opp, q, todo, sort, today]);

  const toggleSt = (s: MeetingStatus) => setSts((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]));
  const th = (k: SortK, l: string, cls = "l") => (
    <th className={`${cls} s ${sort.k === k ? "on" : ""}`} onClick={() => setSort((x) => ({ k, d: x.k === k ? ((-x.d) as 1 | -1) : k === "md" || k === "sd" ? -1 : 1 }))}>
      {l}{sort.k === k ? (sort.d === 1 ? " ▴" : " ▾") : ""}
    </th>
  );

  const cards: KCard[] = d ? [
    { ic: "cal", l: "Reuniones", v: fmt(d.rows.length), sub: field === "md" ? "Por fecha de la reunión" : "Por fecha de agendamiento", hl: true },
    { ic: "check", l: "Realizadas", v: fmt(d.held) },
    { ic: "clock", l: "Pendientes", v: fmt(d.pending) },
    { ic: "repeat", l: "Reagendar", v: fmt(d.resch) },
    { ic: "x", l: "No-show", v: fmt(d.noshow) },
    { ic: "users", l: "Asistencia", v: pct(d.held + d.noshow ? d.held / (d.held + d.noshow) : null), sub: "Realizadas ÷ (realizadas + no-show)" },
    { ic: "zap", l: "Oportunidades", v: fmt(d.opps), sub: "Realizadas con Propuesta/Oportunidad = Si" },
  ] : [];

  const pages = d ? Math.max(1, Math.ceil(d.rows.length / PAGE)) : 1;
  const shown = d ? d.rows.slice(page * PAGE, page * PAGE + PAGE) : [];

  return (
    <>
      <div className="cs-card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <Seg<"md" | "sd"> value={field} opts={[["md", "Fecha de la reunión"], ["sd", "Fecha de agendamiento"]]} onChange={setField} />
          <Seg<Preset> value={preset} opts={[["hoy", "Hoy"], ["ayer", "Ayer"], ["sem", "Esta semana"], ["semp", "Semana pasada"], ["mes", "Este mes"], ["mesp", "Mes pasado"], ["rango", "Rango"]]} onChange={pickPreset} />
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            Desde <input type="date" className="cs-select" style={{ paddingRight: 11 }} value={range[0]} onChange={(e) => { setPreset("rango"); setRange([e.target.value, range[1]]); }} />
            hasta <input type="date" className="cs-select" style={{ paddingRight: 11 }} value={range[1]} onChange={(e) => { setPreset("rango"); setRange([range[0], e.target.value]); }} />
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
          {(Object.keys(ST_LABEL) as MeetingStatus[]).map((s) => (
            <button key={s} className={`cs-tag ${sts.includes(s) ? ST_CLS[s] || "p" : ""}`} style={{ cursor: "pointer", border: sts.includes(s) ? "1px solid currentColor" : "1px solid transparent" }} onClick={() => toggleSt(s)}>{ST_LABEL[s]}</button>
          ))}
          <select className={`cs-select ${origin ? "act" : ""}`} value={origin} onChange={(e) => setOrigin(e.target.value)}>
            <option value="">Todos los orígenes</option>
            {d?.origins.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <select className={`cs-select ${opp ? "act" : ""}`} value={opp} onChange={(e) => setOpp(e.target.value as "" | "si" | "no")}>
            <option value="">Oportunidad: todas</option>
            <option value="si">Con oportunidad</option>
            <option value="no">Sin oportunidad</option>
          </select>
          <input className="cs-select" style={{ paddingRight: 11, minWidth: 220 }} placeholder="Buscar empresa, contacto, cargo o comentario" value={q} onChange={(e) => setQ(e.target.value)} />
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={todo} onChange={(e) => setTodo(e.target.checked)} /> Solo por actualizar
          </label>
        </div>
        <p className="cs-note">Espejo de solo lectura de la pestaña API Reuniones (se sincroniza cada hora en horario laboral). Los filtros de célula, SDR, cliente y país de arriba también aplican.</p>
      </div>

      {err ? <div className="cs-banner err">{err}</div> : null}
      {!data || !d ? (
        <div className="cs-card"><Pending>{loading ? "Cargando reuniones…" : "Sin datos"}</Pending></div>
      ) : (
        <>
          {d.late > 0 && !todo ? (
            <div className="cs-banner warn" style={{ cursor: "pointer" }} onClick={() => setTodo(true)}>
              <span>⚠️ {d.late} {d.late === 1 ? "reunión ya pasó y sigue" : "reuniones ya pasaron y siguen"} en "Pendiente" en este rango: hay que actualizar su estado en la planilla. Clic para verlas.</span>
            </div>
          ) : null}
          {data.truncated ? <div className="cs-banner warn">El rango tiene demasiadas reuniones: se muestran las primeras 5.000. Acota las fechas.</div> : null}
          <KGrid cards={cards} />
          <div className="cs-card cs-mt" style={{ opacity: loading ? 0.6 : 1 }}>
            <CardH t={`Detalle de reuniones (${fmt(d.rows.length)})`} p="Clic en un encabezado para ordenar y en una fila para ver el comentario completo" />
            <div className="cs-tw">
              <table>
                <thead>
                  <tr>
                    {th("md", "Fecha reunión")}<th className="l">Hora</th>{th("sd", "Agendada el")}{th("sdr", "SDR")}{th("client", "Cliente")}{th("company", "Empresa")}
                    <th className="l">Contacto</th><th className="l">Cargo</th><th className="l">País</th>{th("st", "Estado")}<th className="l">Oportunidad</th><th className="l">Origen</th><th className="l">Comentario</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const late = r.st === "pending" && !!r.md && r.md < today;
                    return (
                      <Fragment key={r.id}>
                        <tr className="click" onClick={() => setOpen(open === r.id ? null : r.id)}>
                          <td className="l">{r.md ? dayShort(r.md) : <span className="cs-tag r">Sin fecha</span>}</td>
                          <td className="l">{r.hour ?? "—"}</td>
                          <td className="l">{r.sd ? dayShort(r.sd) : "—"}</td>
                          <td className="l">{sdrName(r.sdr)}</td>
                          <td className="l">{clientName(r.client)}</td>
                          <td className="l"><b>{r.company || "—"}</b></td>
                          <td className="l">{r.contact || "—"}</td>
                          <td className="l" style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }} title={r.title}>{r.title || "—"}</td>
                          <td className="l">{r.country ?? "—"}</td>
                          <td className="l"><span className={`cs-tag ${late ? "r" : ST_CLS[r.st]}`}>{ST_LABEL[r.st]}{late ? " · por actualizar" : ""}</span></td>
                          <td className="l">{r.opp || "—"}</td>
                          <td className="l">{r.origin || "—"}</td>
                          <td className="l" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>{r.comment || <span className="cs-muted">—</span>}</td>
                        </tr>
                        {open === r.id ? (
                          <tr><td className="l fb" colSpan={13} style={{ maxWidth: "none", background: "var(--surface-3)" }}>
                            <b>{r.company}</b>{r.contact ? ` · ${r.contact}` : ""}{r.title ? ` (${r.title})` : ""}<br />
                            {r.comment ? r.comment : <span className="cs-muted">Sin comentario en la planilla.</span>}
                          </td></tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                  {!shown.length ? <tr><td className="l cs-muted" colSpan={13}>No hay reuniones con estos filtros.</td></tr> : null}
                </tbody>
              </table>
            </div>
            {pages > 1 ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", marginTop: 10, fontSize: 13 }}>
                <button className="cs-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button>
                <span>Página {page + 1} de {pages}</span>
                <button className="cs-btn" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Siguiente</button>
              </div>
            ) : null}
          </div>
        </>
      )}
    </>
  );
}
