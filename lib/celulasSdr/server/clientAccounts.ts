import { canonicalCountry } from "@/lib/celulasSdr/country";
import { accountId, canonClientName, pickAccount, type ClientAccount } from "@/lib/celulasSdr/accounts";
import type { RawGoal } from "@/lib/celulasSdr/sheets";
import type { Client } from "@/lib/celulasSdr/types";

// Clientes de la app + cuentas (ver lib/celulasSdr/accounts.ts), armados con
// la tabla clients y los nombres de cliente de la pestaña Asignación. Lo
// usan loadBase, el Registro de reuniones y el Evolutivo mensual para que
// los tres separen igual a Nisum Chile / Colombia / Perú, CCCH / CCCH - Valle…

// País al final del nombre de una cuenta ("Nisum Perú" → Perú). Solo países
// conocidos: "CCCH - Valle" no tiene país.
const KNOWN_COUNTRIES = ["chile", "peru", "colombia", "mexico", "argentina", "ecuador", "brasil", "brazil", "uruguay", "paraguay", "bolivia", "panama", "guatemala", "costa rica", "el salvador", "espana", "usa", "venezuela"];
function countryInName(norm: string): string | null {
  const k = KNOWN_COUNTRIES.find((c) => norm === c || norm.endsWith(` ${c}`));
  return k ? canonicalCountry(k) : null;
}

export type ClientDirectory = {
  clients: Map<string, Client>;                 // clientes y cuentas a mostrar
  accounts: ClientAccount[];
  resolveClient: (raw: string, track?: boolean) => Client; // nombre de Asignación → cliente de la app (o name:…)
  goalClientId: (raw: string) => string;        // nombre de Asignación → id de cliente o cuenta
  toAccount: (clientId: string | null, sheetName: string | null | undefined, country: string | null) => string | null;
  unmatched: Set<string>;
};

export function buildClientDirectory(clientRows: { id: string; name: string; slug?: string | null }[], rawGoals: RawGoal[]): ClientDirectory {
  const clientByNorm = new Map<string, Client>();
  const clients = new Map<string, Client>();     // para mostrar (los partidos se reemplazan por sus cuentas)
  const appClients = new Map<string, Client>();  // tabla clients tal cual (para resolver nombres)
  for (const c of clientRows) {
    const cl = { id: c.id, name: c.name };
    clients.set(cl.id, cl);
    appClients.set(cl.id, cl);
    clientByNorm.set(canonClientName(cl.name), cl);
    if (c.slug) clientByNorm.set(canonClientName(c.slug), cl);
  }
  const unmatched = new Set<string>();
  const resolveClient = (raw: string, track = true): Client => {
    const n = canonClientName(raw);
    const exact = clientByNorm.get(n);
    if (exact) return exact;
    const partial = [...clientByNorm.entries()].filter(([k]) => k.startsWith(n) || n.startsWith(k));
    const uniq = [...new Set(partial.map(([, c]) => c.id))];
    if (uniq.length === 1) return appClients.get(uniq[0])!;
    if (track) unmatched.add(raw.trim());
    const id = `name:${n}`;
    if (!clients.has(id)) clients.set(id, { id, name: raw.trim() });
    return clients.get(id)!;
  };

  // Un cliente de la app con varios nombres en Asignación se parte en cuentas
  const namesByClient = new Map<string, Map<string, string>>(); // cliente → norm → nombre
  for (const g of rawGoals) {
    const c = resolveClient(g.client, false);
    const m = namesByClient.get(c.id) ?? new Map<string, string>();
    const norm = canonClientName(g.client);
    if (!m.has(norm)) m.set(norm, g.client.replace(/\(.*?\)/g, "").trim());
    namesByClient.set(c.id, m);
  }
  const accounts: ClientAccount[] = [];
  const byParent = new Map<string, ClientAccount[]>();
  for (const [parent, names] of namesByClient) {
    if (names.size < 2 || parent.startsWith("name:")) continue;
    const parentNorm = canonClientName(appClients.get(parent)?.name ?? "");
    const accs: ClientAccount[] = [...names.entries()].map(([norm, name]) => ({
      id: accountId(parent, norm), parent, name, norm, country: countryInName(norm), isDefault: false,
    }));
    const def = accs.find((a) => a.norm === parentNorm) ?? accs.find((a) => !a.country) ?? accs.find((a) => a.country === "Chile") ?? accs[0];
    def.isDefault = true;
    accounts.push(...accs);
    byParent.set(parent, accs);
    clients.delete(parent);
    for (const a of accs) clients.set(a.id, { id: a.id, name: a.name });
  }

  const goalClientId = (raw: string): string => {
    const c = resolveClient(raw, false);
    const accs = byParent.get(c.id);
    if (!accs) return c.id;
    return (accs.find((a) => a.norm === canonClientName(raw)) ?? pickAccount(accs, raw, null)).id;
  };
  const toAccount = (clientId: string | null, sheetName: string | null | undefined, country: string | null): string | null => {
    if (!clientId) return null;
    const accs = byParent.get(clientId);
    return accs ? pickAccount(accs, sheetName, country).id : clientId;
  };
  return { clients, accounts, resolveClient, goalClientId, toAccount, unmatched };
}
