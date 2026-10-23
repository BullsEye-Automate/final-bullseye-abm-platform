"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { IconBrandLinkedin, IconLoader2, IconSparkles, IconHistory } from "@tabler/icons-react";
import { useClient, ALL_CLIENTS } from "@/lib/clientContext";
import WishlistContactsTab from "@/components/portalAdmin/WishlistContactsTab";

// Contactos (prospección): los contactos que la IA encuentra en el Lemlist del
// cliente para sus empresas aprobadas (revisión humana → Lemlist + HubSpot) y,
// aparte, los contactos del flujo anterior (solo lectura).
export default function ContactosPage() {
  const { currentClient } = useClient();
  const clientId = currentClient && currentClient.id !== ALL_CLIENTS.id ? currentClient.id : null;
  const [tab, setTab] = useState<"ia" | "history">("ia");

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: "#251762" }}>Contactos</h1>
          <p className="text-sm text-gray-500 mt-1">Contactos de las empresas aprobadas para prospectar{clientId ? ` de ${currentClient?.name}` : ""}.</p>
        </div>
        <Link href="/contactos/anterior" className="text-xs text-gray-400 hover:text-[#251762]">Versión anterior →</Link>
      </div>

      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {([
          ["ia", "Contactos IA", <IconSparkles key="i" size={16} />],
          ["history", "Contactos anteriores", <IconHistory key="h" size={16} />],
        ] as const).map(([key, label, icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 -mb-px ${tab === key ? "border-[#251762] text-[#251762] font-medium" : "border-transparent text-gray-500"}`}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {tab === "ia" && <WishlistContactsTab clientId={clientId} clientName={currentClient?.name ?? null} />}
      {tab === "history" && <HistoryContacts clientId={clientId} />}
    </div>
  );
}

type HistoryContact = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  linkedin_url: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  fit_score: number | null;
  hubspot_contact_id: string | null;
  company_name: string | null;
  created_at: string;
};

const HISTORY_STATUS: Record<string, string> = { pending: "Pendiente", enriched: "Enriquecido", contacted: "Contactado", replied: "Respondió" };

function HistoryContacts({ clientId }: { clientId: string | null }) {
  const [items, setItems] = useState<HistoryContact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!clientId) return;
    setItems(null);
    fetch(`/api/prospeccion/contacts-history?client_id=${clientId}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok || !j) return setError(j?.error ?? "Error al cargar");
        setError(null);
        setItems(j.contacts);
      })
      .catch(() => setError("Error al cargar"));
  }, [clientId]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!items || !t) return items;
    return items.filter((c) =>
      [c.first_name, c.last_name, c.job_title, c.company_name, c.email].some((v) => v?.toLowerCase().includes(t))
    );
  }, [items, q]);

  if (!clientId) return <div className="text-sm text-gray-500 bg-white rounded-2xl border border-gray-100 p-6">Elige un cliente en el menú de la izquierda.</div>;
  if (error) return <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl">{error}</div>;
  if (!filtered) return <IconLoader2 className="animate-spin text-gray-400" />;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, cargo, empresa o email" className="border border-gray-200 rounded-xl px-3 py-2 text-sm w-80 max-w-full" />
        <span className="text-xs text-gray-400">{filtered.length} contactos del flujo anterior (solo lectura)</span>
      </div>
      {filtered.length === 0 ? (
        <div className="text-sm text-gray-400">No hay contactos.</div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500 border-b border-gray-100">
              <tr><th className="p-3">Contacto</th><th className="p-3">Empresa</th><th className="p-3">Datos</th><th className="p-3">Fit</th><th className="p-3">Estado</th></tr>
            </thead>
            <tbody>
              {filtered.slice(0, 500).map((c) => (
                <tr key={c.id} className="border-b border-gray-50 last:border-0 align-top">
                  <td className="p-3 min-w-[200px]">
                    <div className="font-medium flex items-center gap-1" style={{ color: "#251762" }}>
                      {[c.first_name, c.last_name].filter(Boolean).join(" ") || "—"}
                      {c.linkedin_url && <a href={c.linkedin_url} target="_blank" rel="noreferrer" className="text-[#0a66c2]"><IconBrandLinkedin size={15} /></a>}
                    </div>
                    <div className="text-xs text-gray-600">{c.job_title ?? "—"}</div>
                  </td>
                  <td className="p-3 text-gray-700">{c.company_name ?? "—"}</td>
                  <td className="p-3 text-xs text-gray-600">
                    {c.email && <div>{c.email}</div>}
                    {c.phone && <div>{c.phone}</div>}
                    {c.hubspot_contact_id && <div className="text-gray-400">En HubSpot</div>}
                  </td>
                  <td className="p-3">{c.fit_score != null ? `${c.fit_score}%` : "—"}</td>
                  <td className="p-3 text-xs">{HISTORY_STATUS[c.status] ?? c.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 500 && <div className="text-xs text-gray-400 p-3">Mostrando 500 de {filtered.length}. Usa el buscador para encontrar uno puntual.</div>}
        </div>
      )}
    </div>
  );
}
