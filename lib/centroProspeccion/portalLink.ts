import { supabaseAdmin } from "@/lib/supabase";
import { readDocs } from "./store";

// Vínculo entre la ficha de un cliente en el Centro de prospección
// (centro_docs, colección "clientes", id tipo "g-talent") y el cliente del
// portal (tabla clients, id uuid + slug tipo "gtalent").
//
// Manda el campo `portalCliente` de la ficha (id o slug del cliente del
// portal). Si no está, se busca por nombre compacto (sin espacios, guiones ni
// tildes): igual > uno empieza con el otro. Un empate deja la ficha sin
// vínculo para no mezclar datos de dos clientes.

export type PortalClient = { id: string; name: string; slug: string | null };
export type Ficha = { id: string; data: Record<string, unknown> };
export type ClientLinks = {
  fichas: Ficha[];
  clients: PortalClient[];
  byFicha: Map<string, PortalClient>;
  fichasByClient: Map<string, Ficha[]>;
};

export const compact = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

function matchClient(f: Ficha, clients: PortalClient[]): PortalClient | null {
  const explicit = compact(f.data.portalCliente);
  if (explicit) {
    return clients.find((c) => compact(c.id) === explicit || compact(c.slug) === explicit) ?? null;
  }
  const keys = [compact(f.id), compact(f.data.nombre)].filter((k) => k.length >= 2);
  const names = (c: PortalClient) => [compact(c.slug), compact(c.name)].filter(Boolean);
  const equal = clients.filter((c) => names(c).some((n) => keys.includes(n)));
  if (equal.length === 1) return equal[0];
  if (equal.length > 1) return null;
  const prefix = clients.filter((c) =>
    names(c).some((n) => keys.some((k) => Math.min(k.length, n.length) >= 3 && (n.startsWith(k) || k.startsWith(n))))
  );
  return prefix.length === 1 ? prefix[0] : null;
}

export async function loadClientLinks(): Promise<ClientLinks> {
  const [docs, clientsRes] = await Promise.all([
    readDocs(["clientes"]),
    supabaseAdmin().from("clients").select("id, name, slug"),
  ]);
  if (clientsRes.error) throw new Error(clientsRes.error.message);
  const clients = (clientsRes.data ?? []) as PortalClient[];
  const fichas: Ficha[] = docs.map((d) => ({ id: d.doc_id, data: d.data ?? {} }));
  const byFicha = new Map<string, PortalClient>();
  const fichasByClient = new Map<string, Ficha[]>();
  for (const f of fichas) {
    const c = matchClient(f, clients);
    if (!c) continue;
    byFicha.set(f.id, c);
    fichasByClient.set(c.id, [...(fichasByClient.get(c.id) ?? []), f]);
  }
  return { fichas, clients, byFicha, fichasByClient };
}
