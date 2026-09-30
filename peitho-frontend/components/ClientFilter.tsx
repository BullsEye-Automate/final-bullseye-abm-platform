"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { ClientListItem } from "@/lib/peithoBackend";
import SearchableSelect from "@/components/SearchableSelect";

// Solo lo ve el admin (Fase E) — filtra la lista de reuniones por cliente de
// BullsEye. Un usuario "client" no lo necesita: el backend ya le muestra
// únicamente las suyas.
export default function ClientFilter({ clients }: { clients: ClientListItem[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get("client_id") ?? "";

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("client_id", value);
    else params.delete("client_id");
    router.push(`${pathname}?${params.toString()}`);
  }

  const options = [
    { value: "", label: "Todos los clientes" },
    { value: "sin_cliente", label: "Sin cliente asignado" },
    ...clients.map((client) => ({ value: client.id, label: client.name })),
  ];

  return (
    <SearchableSelect
      options={options}
      value={current}
      onChange={handleChange}
      className="w-56"
      placeholder="Buscar cliente..."
    />
  );
}
