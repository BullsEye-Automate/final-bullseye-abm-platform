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
};

const ClientContext = createContext<ClientContextValue>({
  clients: [],
  currentClient: null,
  setCurrentClient: () => {},
  loading: true
});

export function ClientProvider({ children }: { children: ReactNode }) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [currentClient, setCurrentClientState] = useState<ClientSummary | null>(null);
  const [loading, setLoading] = useState(true);

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
  }, []);

  function setCurrentClient(client: ClientSummary) {
    setCurrentClientState(client);
    localStorage.setItem("bullseye_client_id", client.id);
  }

  return (
    <ClientContext.Provider value={{ clients, currentClient, setCurrentClient, loading }}>
      {children}
    </ClientContext.Provider>
  );
}

export function useClient() {
  return useContext(ClientContext);
}
