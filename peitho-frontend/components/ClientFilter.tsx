"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { ClientListItem } from "@/lib/peithoBackend";

// Solo lo ve el admin (Fase E) — filtra la lista de reuniones por cliente de
// BullsEye. Un usuario "client" no lo necesita: el backend ya le muestra
// únicamente las suyas.
export default function ClientFilter({ clients }: { clients: ClientListItem[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get("client_id") ?? "";

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("client_id", value);
    else params.delete("client_id");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <select
      value={current}
      onChange={handleChange}
      className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2"
      style={{ ["--tw-ring-color" as string]: "#62E0D8" }}
    >
      <option value="">Todos los clientes</option>
      {clients.map((client) => (
        <option key={client.id} value={client.id}>
          {client.name}
        </option>
      ))}
    </select>
  );
}
