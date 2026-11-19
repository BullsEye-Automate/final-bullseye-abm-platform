// Lotes de carga de la wishlist (pedido de BullsEye, 19-nov-2026; por ahora
// solo dentro del Centro de prospección: no se lleva a HubSpot ni a Lemlist).
// Cada empresa de client_wishlist pertenece a un lote, que dice de dónde vino
// (origen) y en qué carga entró. El lote va en snapshot.batch al insertar;
// las filas anteriores sin batch se asignan a un lote derivado (origen + día
// + quién), así lo ya cargado queda ordenado sin escribir nada en la base.
// Sin dependencias de Node: lo usan las APIs y el navegador.

export type LotKind = "ia" | "equipo" | "cliente" | "cliente_equipo" | "centro";

export const LOT_KIND_LABEL: Record<LotKind, string> = {
  ia: "Recomendada por la IA",
  equipo: "Propuesta del equipo",
  cliente: "Listado del cliente",
  cliente_equipo: "Listado del cliente cargado por el equipo",
  centro: "Pasada desde el Centro",
};

export const LOT_KIND_SHORT: Record<LotKind, string> = {
  ia: "IA",
  equipo: "Equipo",
  cliente: "Cliente",
  cliente_equipo: "Cliente (cargado por el equipo)",
  centro: "Centro",
};

// Lo que se guarda en snapshot.batch
export type LotTag = { id: string; kind: LotKind; name?: string | null; file?: string | null; note?: string | null; by?: string | null; at?: string | null };

type Snap = { batch?: LotTag; uploaded?: boolean; loadedBy?: string; centro?: unknown; facts?: { label: string; value: string }[] } | null | undefined;

// Día de Chile (AAAA-MM-DD)
export function chileDayOf(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
// Lunes de la semana del día
export function mondayOf(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const w = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - ((w + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const person = (email: string | null | undefined) => (email ?? "").split(/[@\s·]/)[0].toLowerCase().replace(/[^a-z0-9._-]/g, "") || "sin-autor";

// Id de lote para las cargas que no traen uno propio: IA = una por semana;
// propuestas del equipo y del cliente en el portal = una por día y persona.
export function autoLotId(kind: LotKind, createdAt: string, by: string | null | undefined): string {
  const day = chileDayOf(createdAt);
  if (kind === "ia") return `ia:${mondayOf(day)}`;
  return `${kind}:${day}:${person(by)}`;
}

// Origen de una fila de la wishlist (para las que no traen batch)
export function kindOf(row: { origin?: string | null; snapshot?: Snap }, fromReco = false): LotKind {
  const s = row.snapshot ?? {};
  if (s.batch?.kind) return s.batch.kind;
  if (s.centro) return "centro";
  if (s.uploaded) return s.loadedBy ? "cliente_equipo" : "cliente";
  if (row.origin === "bullseye") return fromReco ? "ia" : "equipo";
  return "cliente";
}

export function lotOf(row: { origin?: string | null; snapshot?: Snap; created_at: string; requested_by_email?: string | null }, fromReco = false): LotTag {
  const b = row.snapshot?.batch;
  if (b?.id) return b;
  const kind = kindOf(row, fromReco);
  return { id: autoLotId(kind, row.created_at, row.requested_by_email), kind, by: row.requested_by_email ?? null, at: row.created_at };
}

// País de una empresa: el de la tarjeta (facts) o el del dominio
const TLD_COUNTRY: Record<string, string> = { cl: "Chile", pe: "Perú", mx: "México", co: "Colombia", ar: "Argentina", br: "Brasil", ec: "Ecuador", uy: "Uruguay", py: "Paraguay", bo: "Bolivia", pa: "Panamá", gt: "Guatemala", es: "España", cr: "Costa Rica", do: "República Dominicana" };
export function countryOf(row: { domain?: string | null; snapshot?: Snap }): string | null {
  const f = (row.snapshot?.facts ?? []).find((x) => /^pa[ií]s/i.test(x.label ?? ""));
  if (f?.value) return f.value.split(/[,;]/)[0].trim();
  const tld = (row.domain ?? "").toLowerCase().split(".").pop() ?? "";
  return TLD_COUNTRY[tld] ?? null;
}

// País del lote: el que tiene más de la mitad de las empresas con país; si no, "Varios"
export function lotCountry(countries: (string | null)[]): string | null {
  const known = countries.filter((c): c is string => !!c);
  if (!known.length) return null;
  const n = new Map<string, number>();
  for (const c of known) n.set(c, (n.get(c) ?? 0) + 1);
  const [top, cnt] = Array.from(n.entries()).sort((a, b) => b[1] - a[1])[0];
  return cnt / known.length > 0.5 ? top : "Varios países";
}

export function fmtDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const mes = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"][m - 1];
  return `${d}-${mes}${y !== new Date().getFullYear() ? `-${y}` : ""}`;
}

// Nombre del lote: el que se le dio al cargar o uno armado con origen, país y fecha
export function lotName(lot: LotTag, country: string | null, firstAt: string): string {
  if (lot.name?.trim()) return lot.name.trim();
  const day = chileDayOf(lot.at || firstAt);
  const when = lot.kind === "ia" ? `semana del ${fmtDay(mondayOf(day))}` : fmtDay(day);
  return [LOT_KIND_SHORT[lot.kind], country, when].filter(Boolean).join(" · ");
}
