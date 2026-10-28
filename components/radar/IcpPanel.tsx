"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { IconLoader2, IconPencil } from "@tabler/icons-react";
import type { IcpFormData } from "@/lib/icp-form";
import type { RadarAudience } from "./RadarReport";

// Pulso ABM → ICP del proyecto: el ICP de empresa y el buyer persona con los
// que BullsEye está prospectando (solo lectura). El cliente propone cambios
// desde /portal/icp; el equipo los edita en Configuración → ICP.

type ClientIcp = { industry: string | null; form: IcpFormData };

const FIELDS: { title: string; rows: [keyof IcpFormData, string][] }[] = [
  {
    title: "Empresa objetivo",
    rows: [
      ["industrias_objetivo", "Industrias objetivo"], ["industrias_excluidas", "Industrias excluidas"], ["tamano_empresa", "Tamaño (empleados)"],
      ["facturacion", "Facturación"], ["geografias", "Geografías"], ["modelo_empresa", "Modelo"], ["etapa_empresa", "Etapa"],
    ],
  },
  {
    title: "Buyer persona (contacto)",
    rows: [
      ["cargos_decisores", "Cargos decisores"], ["cargos_influenciadores", "Cargos influenciadores"], ["cargos_evitar", "Cargos a evitar"],
      ["departamentos", "Departamentos"], ["seniority", "Seniority"], ["perfil_psicografico", "Perfil"],
    ],
  },
  {
    title: "Señales de fit",
    rows: [["senales_positivas", "Señales positivas"], ["senales_negativas", "Señales negativas"], ["tech_stack", "Tecnologías"], ["eventos_disparadores", "Eventos disparadores"]],
  },
];

const valueOf = (v: string | string[] | undefined) => (Array.isArray(v) ? v.filter(Boolean).join(" · ") : (v ?? "").trim());

export default function IcpPanel({ audience, clientId }: { audience: RadarAudience; clientId?: string | null }) {
  const [icps, setIcps] = useState<ClientIcp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState(0);

  useEffect(() => {
    if (audience === "internal" && !clientId) { setIcps([]); return; }
    const url = audience === "portal" ? "/api/portal/radar/icp" : `/api/radar-abm/icp?client_id=${clientId}`;
    setIcps(null);
    fetch(url, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error ?? "No se pudo cargar el ICP");
        setIcps(j.icps ?? []);
        setPick(0);
      })
      .catch((e) => setError(e.message));
  }, [audience, clientId]);

  const editHref = audience === "portal" ? "/portal/icp" : "/configuracion/icp";
  const editLabel = audience === "portal" ? "Proponer cambios al ICP" : "Editar ICP";

  if (error) return <div className="ra-plain-card text-sm text-red-700">{error}</div>;
  if (!icps) return <div className="ra-plain-card text-sm text-gray-500 flex items-center gap-2"><IconLoader2 size={15} className="animate-spin" /> Cargando ICP…</div>;
  if (!icps.length) {
    return (
      <div className="ra-plain-card text-sm text-gray-600">
        Todavía no hay un ICP cargado para este cliente.{" "}
        <Link href={editHref} className="font-medium" style={{ color: "#3D2878" }}>{audience === "portal" ? "Complétalo aquí" : "Cargarlo"}</Link>.
      </div>
    );
  }
  const icp = icps[Math.min(pick, icps.length - 1)];

  return (
    <div className="ra-plain-card">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        {icps.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            {icps.map((x, i) => (
              <button key={i} onClick={() => setPick(i)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${i === pick ? "text-white border-transparent" : "border-gray-200 text-gray-600"}`}
                style={i === pick ? { background: "#251762" } : undefined}>
                {x.industry ?? "ICP general"}
              </button>
            ))}
          </div>
        ) : <span className="text-xs text-gray-500">{icp.industry ?? "ICP general"}</span>}
        <Link href={editHref} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white" style={{ background: "#3D2878" }}>
          <IconPencil size={13} /> {editLabel}
        </Link>
      </div>
      <div className="grid gap-5 md:grid-cols-3">
        {FIELDS.map((g) => {
          const rows = g.rows.map(([k, l]) => [l, valueOf(icp.form[k] as string | string[])] as const).filter(([, v]) => v);
          return (
            <div key={g.title}>
              <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#3D2878" }}>{g.title}</div>
              {rows.length ? (
                <dl className="space-y-2">
                  {rows.map(([l, v]) => (
                    <div key={l}>
                      <dt className="text-[11px] text-gray-500">{l}</dt>
                      <dd className="text-[13px] text-gray-800 whitespace-pre-line">{v}</dd>
                    </div>
                  ))}
                </dl>
              ) : <p className="text-xs text-gray-400">Sin información.</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
