// PNG vertical del Reporte SDR (1080 px de ancho, pensado para reenviarse
// por WhatsApp). Se dibuja con next/og (Satori) en el servidor, sin
// dependencias nuevas. Regla de Satori: todo <div> con más de un hijo
// necesita display:flex.
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DailySdrReport } from "./data";
import { formatLongDate, formatShortDate, pct, shortName } from "./data";

const W = 1080;
const PAD = 48;
const ROW = 56;
const MROW = 54;

const C = {
  bg: "#f4f2fb", navy: "#251762", ink: "#1c1640", mute: "#6b6590", mute2: "#8a84ab",
  line: "#eeecf6", teal: "#14b8a6", teal2: "#0f9488", bar: "#ddd6fe", mint: "#62E0D8", white: "#ffffff",
};

let fontsCache: { name: string; data: ArrayBuffer; weight: 400 | 700 | 800; style: "normal" }[] | null = null;
async function loadFonts() {
  if (fontsCache) return fontsCache;
  const dir = path.join(process.cwd(), "lib/reporteSdr/fonts");
  const read = async (w: 400 | 700 | 800) => {
    const buf = await readFile(path.join(dir, `outfit-latin-${w}-normal.woff`));
    return { name: "Outfit", data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, weight: w, style: "normal" as const };
  };
  fontsCache = await Promise.all([read(400), read(700), read(800)]);
  return fontsCache;
}

// Nombre de empresa para una sola línea: los que vienen TODO EN MAYÚSCULAS
// se pasan a formato título y los largos se cortan con "…".
function fitCompany(name: string, max: number): string {
  let s = (name || "—").trim();
  if (s.length > 4 && s === s.toUpperCase()) {
    s = s.toLowerCase().replace(/(^|[\s(/-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
  }
  const lim = Math.max(14, max);
  return s.length > lim ? s.slice(0, lim - 1).trimEnd() + "…" : s;
}

export function reportImageHeight(r: DailySdrReport): number {
  const tableH = 34 + 50 + 40 + r.rows.length * ROW + ROW + 34;
  const meetH = 34 + 50 + Math.max(1, r.meetings.length) * MROW + 34;
  return PAD + 190 + 28 + 150 + 28 + tableH + 28 + meetH + 28 + 30 + PAD;
}

export async function renderReportPng(r: DailySdrReport): Promise<Buffer> {
  const H = reportImageHeight(r);
  const maxCalls = Math.max(1, ...r.rows.map((x) => x.calls));
  const T = r.totals;

  const kpi = (value: string | number, label: string, highlight = false) => (
    <div style={{ display: "flex", flexDirection: "column", width: 237, height: 150, borderRadius: 22, padding: "26px 22px", background: highlight ? C.teal : C.white }}>
      <div style={{ fontSize: 56, fontWeight: 800, lineHeight: 1, color: highlight ? C.white : C.ink }}>{String(value)}</div>
      <div style={{ fontSize: 21, marginTop: 12, lineHeight: 1.2, color: highlight ? "#e6fffb" : C.mute }}>{label}</div>
    </div>
  );

  const cell = (text: string, width: number, extra: Record<string, any> = {}) => (
    <div style={{ display: "flex", width, justifyContent: "flex-end", fontSize: 25, ...extra }}>{text}</div>
  );

  const tableRow = (key: string, name: string, calls: number, connected: number, meetings: number, total = false) => (
    <div key={key} style={{ display: "flex", alignItems: "center", height: ROW, borderTop: total ? `2px solid ${C.navy}` : `1px solid ${C.line}` }}>
      <div style={{ display: "flex", width: 290, fontSize: 25, fontWeight: total ? 800 : 700, color: C.ink }}>{name}</div>
      <div style={{ display: "flex", width: 230 }}>
        {total ? null : <div style={{ display: "flex", height: 20, borderRadius: 6, background: C.bar, width: Math.max(3, (calls / maxCalls) * 220) }} />}
      </div>
      {cell(String(calls), 70, { fontWeight: total ? 800 : 700, color: C.ink })}
      {cell(String(connected), 110, { fontWeight: total ? 800 : 400, color: C.ink })}
      {cell(pct(connected, calls), 90, { fontWeight: total ? 800 : 400, color: C.mute })}
      {cell(meetings ? String(meetings) : "·", 118, { fontWeight: 800, color: C.teal2 })}
    </div>
  );

  const head = (text: string, width: number) => (
    <div style={{ display: "flex", width, justifyContent: width === 290 ? "flex-start" : "flex-end", fontSize: 18, fontWeight: 700, color: C.mute2 }}>{text}</div>
  );

  const card = { display: "flex", flexDirection: "column" as const, background: C.white, borderRadius: 28, padding: "34px 36px", marginTop: 28 };

  const el = (
    <div style={{ display: "flex", flexDirection: "column", width: W, height: H, background: C.bg, padding: PAD, fontFamily: "Outfit" }}>
      {/* Encabezado */}
      <div style={{ display: "flex", flexDirection: "column", height: 190, borderRadius: 28, padding: "36px 44px", background: C.navy }}>
        <div style={{ display: "flex", fontSize: 22, fontWeight: 700, letterSpacing: 2, color: C.mint }}>BULLSEYE · REPORTE SDR</div>
        <div style={{ display: "flex", fontSize: 52, fontWeight: 800, color: C.white, marginTop: 8 }}>Llamadas del día</div>
        <div style={{ display: "flex", fontSize: 26, color: "#c9c4e6", marginTop: 6 }}>{`${formatLongDate(r.day)} · corte ${r.cutLabel} hrs`}</div>
      </div>

      {/* KPIs */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 28 }}>
        {kpi(T.calls, "Llamadas")}
        {kpi(T.contacts, "Contactos gestionados")}
        {kpi(T.connected, `Conectadas · ${pct(T.connected, T.calls)}`)}
        {kpi(T.meetings, "Reuniones agendadas", true)}
      </div>

      {/* Por SDR */}
      <div style={card}>
        <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: C.ink, marginBottom: 22 }}>Por SDR</div>
        <div style={{ display: "flex", height: 36 }}>
          {head("SDR", 290)}
          <div style={{ display: "flex", width: 230 }} />
          {head("LLAMADAS", 70)}
          {head("CONECT.", 110)}
          {head("% CON.", 90)}
          {head("REUN.", 118)}
        </div>
        {r.rows.map((x, i) => tableRow(`r${i}`, shortName(x.name), x.calls, x.connected, x.meetings))}
        {tableRow("total", "Total", T.calls, T.connected, T.meetings, true)}
      </div>

      {/* Reuniones */}
      <div style={card}>
        <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: C.ink, marginBottom: 22 }}>Reuniones agendadas hoy</div>
        {r.meetings.length === 0 ? (
          <div style={{ display: "flex", height: MROW, alignItems: "center", fontSize: 24, color: C.mute }}>Sin reuniones agendadas todavía</div>
        ) : (
          r.meetings.map((m, i) => (
            <div key={`m${i}`} style={{ display: "flex", alignItems: "center", height: MROW, borderTop: `1px solid ${C.line}`, fontSize: 24, color: C.ink }}>
              <div style={{ display: "flex", flex: 1, alignItems: "baseline", overflow: "hidden" }}>
                <span style={{ fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}>{shortName(m.sdr)}</span>
                <span style={{ marginLeft: 8, marginRight: 8, flexShrink: 0 }}>·</span>
                <span style={{ whiteSpace: "nowrap" }}>{fitCompany(m.company, 40 - shortName(m.sdr).length)}</span>
                {m.origin ? <span style={{ marginLeft: 10, fontSize: 20, color: C.mute2 }}>{m.origin.replace(/^SDR\s*-\s*/i, "")}</span> : null}
              </div>
              <div style={{ display: "flex", fontWeight: 700, color: C.teal2, marginLeft: 16 }}>{formatShortDate(m.meetingDate)}</div>
            </div>
          ))
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "center", marginTop: 28, fontSize: 19, color: C.mute2 }}>
        Fuente: portal.bullseye-abm.com/analisis/sdr (Allo) · % conexión = llamadas conectadas / llamadas
      </div>
    </div>
  );

  const img = new ImageResponse(el, { width: W, height: H, fonts: await loadFonts() });
  return Buffer.from(await img.arrayBuffer());
}
