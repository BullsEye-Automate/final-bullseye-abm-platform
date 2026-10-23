"use client";

import Link from "next/link";
import { useClient, ALL_CLIENTS } from "@/lib/clientContext";
import WishlistWorkspace from "@/components/wishlist/WishlistWorkspace";

// Empresas (prospección): el equipo busca empresas con filtros o recomendadas
// por IA para el cliente elegido y se las PROPONE (el cliente las aprueba en
// su portal). Ve además las pendientes de aprobación, las aprobadas para
// prospectar (incluidas las del flujo anterior) y las rechazadas.
export default function EmpresasPage() {
  const { currentClient } = useClient();
  const clientId = currentClient && currentClient.id !== ALL_CLIENTS.id ? currentClient.id : null;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: "#251762" }}>Empresas</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-3xl">
            Encuentra empresas para {clientId ? <strong>{currentClient?.name}</strong> : "el cliente"} y propónselas: aparecen en su portal para
            aprobar. Las aprobadas se crean en su Lemlist y la IA busca sus contactos (ver Contactos).
          </p>
        </div>
        <Link href="/empresas/anterior" className="text-xs text-gray-400 hover:text-[#251762]">Versión anterior →</Link>
      </div>
      {clientId ? (
        <WishlistWorkspace key={clientId} operatorClientId={clientId} />
      ) : (
        <div className="text-sm text-gray-500 bg-white rounded-2xl border border-gray-100 p-6">Elige un cliente en el menú de la izquierda.</div>
      )}
    </div>
  );
}
