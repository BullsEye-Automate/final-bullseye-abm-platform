"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type ClientSummary = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
};

// Cliente especial que representa "todos los clientes"
export const ALL_CLIENTS: ClientSummary = {
  id: "__all__",
  name: "Todos los clientes",
  slug: "__all__",
  logo_url: null,
};

type ClientContextValue = {
  clients: ClientSummary[];
  currentClient: ClientSummary | null;
  setCurrentClient: (client: ClientSummary) => void;
  loading: boolean;
  // Ids de los clientes con Status Cliente = Activo en la Maestra (null = aún
  // no se sabe o no se pudo leer: se muestran todos). Lo usa el selector del menú.
  activeIds: Set<string> | null;
  activeReady: boolean;      // ya se consultó la Maestra (con o sin éxito)
};

const ClientContext = createContext<ClientContextValue>({
  clients: [],
  currentClient: null,
  setCurrentClient: () => {},
  loading: true,
  activeIds: null,
  activeReady: false,
});

export function ClientProvider({ children }: { children: ReactNode }) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [currentClient, setCurrentClientState] = useState<ClientSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeIds, setActiveIds] = useState<Set<string> | null>(null);
  const [activeReady, setActiveReady] = useState(false);

  useEffect(() => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then(({ clients: data }: { clients: ClientSummary[] }) => {
        const list = data ?? [];
        setClients(list);
        // Restaura el cliente guardado en localStorage
        const savedId = localStorage.getItem("bullseye_client_id");
        if (savedId === ALL_CLIENTS.id) {
          setCurrentClientState(ALL_CLIENTS);
        } else if (savedId) {
          const found = list.find((c) => c.id === savedId);
          if (found) setCurrentClientState(found);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
    // Activos en la Maestra (pedido de BullsEye 27-nov-2026: el selector del
    // menú muestra solo esos; los demás quedan detrás de «Ver inactivos»)
    fetch("/api/clients?active=true")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { clients?: ClientSummary[]; masterOk?: boolean } | null) => {
        if (j?.clients?.length && j.masterOk !== false) setActiveIds(new Set(j.clients.map((c) => c.id)));
      })
      .catch(() => {})
      .finally(() => setActiveReady(true));
  }, []);

  function setCurrentClient(client: ClientSummary) {
    setCurrentClientState(client);
    localStorage.setItem("bullseye_client_id", client.id);
  }

  return (
    <ClientContext.Provider value={{ clients, currentClient, setCurrentClient, loading, activeIds, activeReady }}>
      {children}
    </ClientContext.Provider>
  );
}

export function useClient() {
  return useContext(ClientContext);
}
