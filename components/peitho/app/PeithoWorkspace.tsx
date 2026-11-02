"use client";

import { useEffect, useMemo, useState } from "react";
import type { ClientExecutive, MeetingListItem, PeithoSession } from "./types";
import { PeithoContext, peithoApiFor, usePeitho } from "./context";
import PanelDeControlView from "./PanelDeControlView";
import ReunionesFuturasView from "./ReunionesFuturasView";
import ReunionesPasadasView from "./ReunionesPasadasView";
import MeetingDetail from "./MeetingDetail";
import PeithoUsersManager from "./PeithoUsersManager";

// Peitho dentro del portal de BullsEye (Pulso ABM → Peitho y Oportunidades →
// Peitho), para clientes con "Incluir Peitho" = Sí. Mismas vistas que
// app.peithob2b.com (componentes portados de peitho-frontend) con los datos
// del cliente vía el proxy del portal:
//   portal del cliente → base "/api/portal/peitho/proxy"
//   app interna        → base "/api/clients/<id>/peitho/proxy" (+ pestaña Usuarios)

type Tab = "panel" | "futuras" | "pasadas" | "usuarios";

function useList<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    load()
      .then((d) => active && setData(d))
      .catch((e) => active && setError(e instanceof Error ? e.message : "Error"));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error };
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Peitho respondió ${res.status}`);
  return body as T;
}

export default function PeithoWorkspace({ base, internal }: { base: string; internal: boolean }) {
  const api = useMemo(() => peithoApiFor(base), [base]);
  const [tab, setTab] = useState<Tab>("pasadas");
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const ctx = useMemo(() => ({ api, openMeeting: setMeetingId, refresh: () => setReloadKey((k) => k + 1) }), [api]);

  const me = useList<PeithoSession>(() => api("/me").then(json<PeithoSession>), [api]);
  const tabs: [Tab, string][] = [
    ["panel", "Panel de control"],
    ["futuras", "Reuniones futuras"],
    ["pasadas", "Reuniones pasadas"],
    ...(internal ? ([["usuarios", "Usuarios de Peitho"]] as [Tab, string][]) : []),
  ];

  return (
    <PeithoContext.Provider value={ctx}>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <img src="/peitho/logo.png" alt="Peitho" className="h-10 w-auto" />
          <div className="text-sm text-gray-500">
            Feedback automático de reuniones{me.data?.clientName ? ` · ${me.data.clientName}` : ""}
          </div>
        </div>

        {me.error && tab !== "usuarios" && (
          <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl">
            No pudimos conectar con Peitho: {me.error}
          </div>
        )}

        <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
          {tabs.map(([k, label]) => (
            <button
              key={k}
              onClick={() => {
                setTab(k);
                setMeetingId(null);
              }}
              className={`px-4 py-2 text-sm border-b-2 -mb-px whitespace-nowrap ${tab === k ? "border-[#251762] text-[#251762] font-medium" : "border-transparent text-gray-500"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {meetingId ? (
          <MeetingDetail meetingId={meetingId} onBack={() => setMeetingId(null)} />
        ) : tab === "panel" ? (
          <PanelDeControlView isAdmin={false} clients={[]} />
        ) : tab === "futuras" ? (
          <Meetings scope="upcoming" reloadKey={reloadKey} />
        ) : tab === "pasadas" ? (
          <Meetings scope="past" reloadKey={reloadKey} peithoClientId={me.data?.clientId ?? null} />
        ) : (
          <PeithoUsersManager base={base} />
        )}
      </div>
    </PeithoContext.Provider>
  );
}

function Meetings({ scope, reloadKey, peithoClientId = null }: { scope: "upcoming" | "past"; reloadKey: number; peithoClientId?: string | null }) {
  const { api } = usePeitho();
  const meetings = useList<MeetingListItem[]>(() => api(`/meetings?scope=${scope}`).then(json<MeetingListItem[]>), [api, scope, reloadKey]);
  // Roster de ejecutivos del cliente: el filtro "Ejecutivo" de Reuniones pasadas usa solo esos nombres
  const executives = useList<ClientExecutive[]>(
    () => (scope === "past" && peithoClientId ? api(`/clients/${peithoClientId}/executives`).then(json<ClientExecutive[]>) : Promise.resolve([])),
    [api, scope, peithoClientId]
  );

  if (meetings.error) return <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl">{meetings.error}</div>;
  if (!meetings.data) return <p className="text-sm text-gray-500">Cargando reuniones…</p>;
  return scope === "upcoming" ? (
    <ReunionesFuturasView meetings={meetings.data} detailBasePath="peitho" showClientColumn={false} />
  ) : (
    <ReunionesPasadasView meetings={meetings.data} detailBasePath="peitho" showClientColumn={false} executives={executives.data ?? []} />
  );
}

