"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClientListItem, MeetingListItem } from "@/lib/peithoBackend";
import InlineClientSelect from "@/components/InlineClientSelect";
import ScoreBadge from "@/components/ScoreBadge";

const STATUS_LABEL: Record<MeetingListItem["status"], string> = {
  scheduled: "Agendada",
  captured: "Capturada",
  analyzed: "Analizada",
  no_show: "No show",
};

// timeZone explícito — bug real (08-09-2026): sin esto, toLocaleString usa
// la zona del entorno donde corre el Server Component (Vercel = UTC), no la
// de Chile, y mostraba "7:30 p.m." para una reunión que en realidad era a
// las 16:30 hora de Chile (el dato en la base sí estaba correcto).
function formatDate(value: string | null): string {
  if (!value) return "Sin fecha";
  return new Date(value).toLocaleString("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Santiago",
  });
}

// Muestra el nombre real de la empresa (excel de metas) en vez del dominio
// crudo cuando está disponible, y lo linkea a ese dominio como sitio web — no
// hay una columna de URL propia en el excel, pero empresa_contraparte ya ES
// un dominio (derivado del calendario/email), así que sirve como base del
// link sin necesitar un dato nuevo. stopPropagation para no disparar el
// click-through a la página de detalle que tiene la fila entera.
function EmpresaCell({
  nombre,
  dominio,
}: {
  nombre: string | null | undefined;
  dominio: string | null | undefined;
}) {
  const label = nombre ?? dominio;
  if (!label) return <span className="text-gray-300">—</span>;
  if (!dominio || !dominio.includes(".")) return <>{label}</>;
  return (
    <a
      href={`https://${dominio}`}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="hover:underline"
      style={{ color: "#251762" }}
    >
      {label}
    </a>
  );
}

// Escala distinta a ScoreBadge (1-5, no 1-10 — prediccion_exito.puntaje mide
// probabilidad de cierre del deal, no desempeño del vendedor). Mismos
// umbrales proporcionales (>=80% verde, >=50% amarillo, resto rojo).
function PrediccionBadge({ puntaje }: { puntaje: number | null | undefined }) {
  if (puntaje == null) return <span className="text-gray-300">—</span>;
  const [bg, color] =
    puntaje >= 4 ? ["#E6F6EE", "#1F8A5C"] : puntaje >= 3 ? ["#FBF1DF", "#B4740E"] : ["#FBE7E4", "#C0392B"];
  return (
    <span
      className="text-xs font-bold px-2.5 py-0.5 rounded-lg"
      style={{ background: bg, color }}
    >
      {puntaje}/5
    </span>
  );
}

// Pedido explícito del usuario (09-10-2026): además de Desempeño/Predicción,
// ahora también se puede ordenar por los 3 Fit Score.
type SortField = "start_time" | "puntaje" | "prediccion_exito" | "fit_empresa" | "fit_contacto" | "fit_rol_contacto";

// start_time es un string ISO (no un número) — se convierte a timestamp acá
// para poder reusar el mismo comparador genérico que ya usaban puntaje/
// prediccion_exito. Sin fecha, va al final tanto en asc como en desc (-Infinity
// para que "menor" en asc la mande al final visualmente al invertir con desc).
function sortValue(meeting: MeetingListItem, field: SortField): number {
  if (field === "start_time") {
    return meeting.start_time ? new Date(meeting.start_time).getTime() : -Infinity;
  }
  return meeting[field] ?? -1;
}

// Flecha de orden reusada por todas las columnas ordenables — misma UI que
// antes, solo parametrizada por qué campo controla.
function SortArrow({ active, dir }: { active: boolean; dir: "asc" | "desc" | null }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      style={{
        transform: active && dir === "asc" ? "rotate(180deg)" : undefined,
        opacity: active && dir ? 1 : 0.5,
      }}
    >
      <polyline points="7 10 12 15 17 10" />
    </svg>
  );
}

// `detailBasePath` habilita el click-through a la página de detalle (ej.
// "/reuniones/pasadas") — se omite en páginas que todavía no tienen detalle
// (Módulo 1, pendiente).
// `showPuntaje` agrega las columnas ordenables "Cargo", "Fit empresa/contacto/rol",
// "Desempeño" (desempeno_vendedor, 1-10) y "Predicción de éxito" (prediccion_exito,
// 1-5) — solo tiene sentido en "Reuniones pasadas" (en futuras nunca hay
// análisis todavía). El nombre del prop quedó igual para no tocar los dos
// lugares que ya lo pasan (ReunionesPasadasView.tsx) — ahora controla todas
// esas columnas juntas, no solo la vieja "Puntaje".
export default function MeetingsTable({
  meetings,
  detailBasePath,
  showClientColumn = false,
  showPuntaje = false,
  clients,
}: {
  meetings: MeetingListItem[];
  detailBasePath?: string;
  // Fase E — solo tiene sentido para admin (viendo varios clientes a la vez);
  // un usuario "client" ya sabe que todo lo que ve es suyo.
  showClientColumn?: boolean;
  showPuntaje?: boolean;
  // Si viene (solo el admin la trae), la columna Cliente es editable inline
  // con InlineClientSelect en vez de solo texto — pedido explícito del
  // usuario para poder clasificar de corrido las reuniones sin cliente sin
  // entrar al detalle de cada una.
  clients?: ClientListItem[];
}) {
  const router = useRouter();
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc" | null>(null);

  const sorted = useMemo(() => {
    if (!sortDir || !sortField) return meetings;
    return [...meetings].sort((a, b) => {
      const av = sortValue(a, sortField);
      const bv = sortValue(b, sortField);
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [meetings, sortField, sortDir]);

  function toggleSort(field: SortField) {
    if (sortField !== field) {
      setSortField(field);
      // Fecha: primer clic muestra la más próxima primero ("de más reciente
      // a más lejano", pedido explícito del usuario) — al revés del resto de
      // las columnas ordenables, donde el primer clic muestra el valor más
      // alto primero (más intuitivo para un puntaje).
      setSortDir(field === "start_time" ? "asc" : "desc");
      return;
    }
    setSortDir((prev) => {
      const first = field === "start_time" ? "asc" : "desc";
      const second = field === "start_time" ? "desc" : "asc";
      if (prev === first) return second;
      if (prev === second) {
        setSortField(null);
        return null;
      }
      return first;
    });
  }

  function SortableHeader({ field, label }: { field: SortField; label: string }) {
    return (
      <button onClick={() => toggleSort(field)} className="flex items-center gap-1 hover:text-gray-700">
        {label}
        <SortArrow active={sortField === field} dir={sortDir} />
      </button>
    );
  }

  if (meetings.length === 0) {
    return <p className="text-sm text-gray-500">No hay reuniones para mostrar todavía.</p>;
  }

  // Empresa (09-10-2026, pedido explícito del usuario) es ahora la primera
  // columna y queda fija (`sticky left-0`) al desplazar la tabla hacia la
  // derecha — hay varias columnas nuevas (Cargo, Fit rol) y la tabla ya no
  // entra completa en pantalla, así que sin esto se perdía de vista a qué
  // empresa correspondía cada fila al scrollear. `group`/`group-hover` en la
  // fila para que la celda fija adopte el mismo hover que el resto de la
  // fila (un td con bg propio no hereda el hover:bg-gray-50 del <tr>).
  const stickyCellClass =
    "sticky left-0 z-10 bg-white group-hover:bg-gray-50 shadow-[4px_0_8px_-6px_rgba(0,0,0,0.12)]";

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
            <th className={`px-4 py-3 font-medium whitespace-nowrap ${stickyCellClass}`}>Empresa</th>
            <th className="px-4 py-3 font-medium whitespace-nowrap">
              <SortableHeader field="start_time" label="Fecha" />
            </th>
            <th className="px-4 py-3 font-medium whitespace-nowrap">Ejecutivo</th>
            <th className="px-4 py-3 font-medium whitespace-nowrap">Contraparte</th>
            {showPuntaje && <th className="px-4 py-3 font-medium whitespace-nowrap">Cargo</th>}
            {showClientColumn && <th className="px-4 py-3 font-medium whitespace-nowrap">Cliente</th>}
            {showPuntaje && (
              <>
                <th className="px-4 py-3 font-medium whitespace-nowrap">
                  <SortableHeader field="fit_empresa" label="Fit empresa" />
                </th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">
                  <SortableHeader field="fit_contacto" label="Fit cargo" />
                </th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">
                  <SortableHeader field="fit_rol_contacto" label="Fit rol" />
                </th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">
                  <SortableHeader field="puntaje" label="Desempeño" />
                </th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">
                  <SortableHeader field="prediccion_exito" label="Predicción de éxito" />
                </th>
              </>
            )}
            <th className="px-4 py-3 font-medium whitespace-nowrap">Estado</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((meeting) => (
            <tr
              key={meeting.id}
              onClick={detailBasePath ? () => router.push(`${detailBasePath}/${meeting.id}`) : undefined}
              className={`group border-b border-gray-50 last:border-0 hover:bg-gray-50 ${
                detailBasePath ? "cursor-pointer" : ""
              }`}
            >
              <td className={`px-4 py-3 whitespace-nowrap font-medium text-gray-900 ${stickyCellClass}`}>
                <EmpresaCell nombre={meeting.empresa_nombre} dominio={meeting.empresa_contraparte} />
              </td>
              <td className="px-4 py-3 whitespace-nowrap">{formatDate(meeting.start_time)}</td>
              <td className="px-4 py-3 whitespace-nowrap">
                {
                  // Bug real (30-09-2026, Autogermana/Crossnet): esta columna
                  // mezclaba dos cosas distintas — `ejecutivo` (quien de
                  // BullsEye sincronizó el evento, ej. la SDR que agenda la
                  // cita) y `client_executive_name`/`cliente_sales_manager`
                  // (el ejecutivo REAL del cliente que atiende la reunión,
                  // resuelto contra el roster). En el flujo de invitación al
                  // bot, casi siempre hay un BullsEye no-opcional en el
                  // evento (la SDR) aunque el roster ya haya resuelto bien al
                  // ejecutivo del cliente — `ejecutivo` no null tapaba
                  // siempre al dato más útil. El detalle de la reunión ya
                  // mostraba ambos por separado (el email crudo en el
                  // encabezado, el ejecutivo del cliente en la ficha) — acá
                  // se prioriza el del cliente, igual que adentro.
                  meeting.client_executive_name ??
                    meeting.cliente_sales_manager ??
                    meeting.ejecutivo ??
                    "—"
                }
              </td>
              <td className="px-4 py-3 whitespace-nowrap">{meeting.contacto_nombre ?? meeting.contraparte ?? "—"}</td>
              {showPuntaje && (
                <td className="px-4 py-3 whitespace-nowrap text-gray-500">{meeting.contacto_cargo ?? "—"}</td>
              )}
              {showClientColumn && (
                <td className="px-4 py-3 whitespace-nowrap">
                  {clients ? (
                    <InlineClientSelect meetingId={meeting.id} clients={clients} initialClientId={meeting.client_id} />
                  ) : (
                    meeting.cliente_bullseye ?? "—"
                  )}
                </td>
              )}
              {showPuntaje && (
                <>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <ScoreBadge puntaje={meeting.fit_empresa} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <ScoreBadge puntaje={meeting.fit_contacto} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <ScoreBadge puntaje={meeting.fit_rol_contacto} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <ScoreBadge puntaje={meeting.puntaje} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <PrediccionBadge puntaje={meeting.prediccion_exito} />
                  </td>
                </>
              )}
              <td className="px-4 py-3 whitespace-nowrap">{STATUS_LABEL[meeting.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
