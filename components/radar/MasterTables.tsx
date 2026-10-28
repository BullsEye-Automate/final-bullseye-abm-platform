"use client";

import { useMemo, useState } from "react";
import { IconDownload, IconFileSpreadsheet } from "@tabler/icons-react";
import type { Model } from "@/lib/radarAbm/engine";
import { CO_ORDER, CT_ORDER } from "@/lib/radarAbm/dictionaries";
import { LEADS, companyStatusLabel, masterCompanyCols, masterContactCols, table } from "@/lib/radarAbm/render";

// §33 y §34 — tablas maestras de empresas y contactos: búsqueda, filtro por
// estado, páginas de 50 y exportación a Excel (las dos hojas) o CSV.

const PAGE = 50;

export default function MasterTables({ M, numbers }: { M: Model; numbers?: (number | string)[] }) {
  const clientName: string = M.cl.name;
  const coCols = useMemo(() => masterCompanyCols(M), [M]);
  const ctCols = useMemo(() => masterContactCols(M), [M]);

  const [qE, setQE] = useState("");
  const [fE, setFE] = useState("");
  const [limE, setLimE] = useState(PAGE);
  const [qC, setQC] = useState("");
  const [fC, setFC] = useState("");
  const [limC, setLimC] = useState(PAGE);

  const coStatuses = useMemo(() => CO_ORDER.filter((r) => M.C.some((c: any) => c.key === r)), [M]);
  const ctStatuses = useMemo(() => CT_ORDER.filter((s) => M.K.some((k: any) => k.st === s)), [M]);

  const rowsE = useMemo(() => {
    const q = qE.toLowerCase();
    return M.C.filter((c: any) => (!fE || c.key === fE) && (!q || [c.n, c.ind, c.sdr, c.pais, c.st].join(" ").toLowerCase().includes(q)));
  }, [M, qE, fE]);
  const rowsC = useMemo(() => {
    const q = qC.toLowerCase();
    return M.K.filter((x: any) => (!fC || x.st === fC) && (!q || [x.n, x.c?.n, x.cargo, x.area, x.sdr].join(" ").toLowerCase().includes(q)));
  }, [M, qC, fC]);

  const sheet = (cols: { h: string; x: (r: any) => any }[], rows: any[]) => [cols.map((c) => c.h), ...rows.map((r) => cols.map((c) => c.x(r)))];
  const fileBase = `Pulso ABM - ${clientName}`.replace(/[\\/:*?"<>|]/g, "");

  async function exportXlsx() {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet(coCols, rowsE)), "Empresas");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet(ctCols, rowsC)), "Contactos");
    XLSX.writeFile(wb, `${fileBase} - tablas maestras.xlsx`);
  }
  async function exportCsv(kind: "emp" | "ct") {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet(kind === "emp" ? sheet(coCols, rowsE) : sheet(ctCols, rowsC));
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${fileBase} - ${kind === "emp" ? "empresas" : "contactos"}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <>
      <section className="s" id="tm-emp">
        <div className="s-h"><span className="no">§{numbers?.[0] ?? 40}</span><h3>Tabla maestra de empresas</h3></div>
        <p className="lead">{LEADS["tm-emp"]}</p>
        <div className="tools">
          <input type="search" value={qE} onChange={(e) => { setQE(e.target.value); setLimE(PAGE); }} placeholder="Buscar empresa, industria, SDR…" aria-label="Buscar empresas" />
          <select className="ra-select" value={fE} onChange={(e) => { setFE(e.target.value); setLimE(PAGE); }} aria-label="Filtrar por estado">
            <option value="">Todos los estados</option>
            {coStatuses.map((r) => <option key={r} value={r}>{companyStatusLabel(r, clientName)}</option>)}
          </select>
          <span className="flag">{rowsE.length} empresas</span>
          <span style={{ flex: 1 }} />
          <button className="ra-btn" onClick={exportXlsx}><IconFileSpreadsheet size={15} /> Exportar a Excel</button>
          <button className="ra-btn" onClick={() => exportCsv("emp")}><IconDownload size={15} /> CSV</button>
        </div>
        <div dangerouslySetInnerHTML={{ __html: table(coCols, rowsE.slice(0, limE)) }} />
        {rowsE.length > limE && (
          <div className="tools" style={{ marginTop: 8 }}>
            <button className="ra-btn" onClick={() => setLimE((l) => l + PAGE)}>Mostrar 50 más ({rowsE.length - limE} restantes)</button>
          </div>
        )}
      </section>
      <section className="s" id="tm-ct">
        <div className="s-h"><span className="no">§{numbers?.[1] ?? 41}</span><h3>Tabla maestra de contactos</h3></div>
        <p className="lead">{LEADS["tm-ct"]}</p>
        <div className="tools">
          <input type="search" value={qC} onChange={(e) => { setQC(e.target.value); setLimC(PAGE); }} placeholder="Buscar contacto, empresa, cargo…" aria-label="Buscar contactos" />
          <select className="ra-select" value={fC} onChange={(e) => { setFC(e.target.value); setLimC(PAGE); }} aria-label="Filtrar por estado">
            <option value="">Todos los estados</option>
            {ctStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <span className="flag">{rowsC.length} contactos</span>
          <span style={{ flex: 1 }} />
          <button className="ra-btn" onClick={() => exportCsv("ct")}><IconDownload size={15} /> CSV</button>
        </div>
        <div dangerouslySetInnerHTML={{ __html: table(ctCols, rowsC.slice(0, limC)) }} />
        {rowsC.length > limC && (
          <div className="tools" style={{ marginTop: 8 }}>
            <button className="ra-btn" onClick={() => setLimC((l) => l + PAGE)}>Mostrar 50 más ({rowsC.length - limC} restantes)</button>
          </div>
        )}
      </section>
    </>
  );
}
