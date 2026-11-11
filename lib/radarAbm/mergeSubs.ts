// Pulso ABM — vista "Todos los clientes" de una cuenta con varios clientes en
// el mismo HubSpot (ej. Nisum Chile / Colombia / Perú y KI Technologies).
// Junta los informes de cada cliente en uno solo, en el navegador. Los ids se
// marcan con el cliente (sufijo "@<n>") porque una misma empresa puede estar
// en dos clientes con status distinto; el sufijo conserva los prefijos
// "nc:" / "mt:" que usa el sync.
import type { RadarDataset } from "./types";

export const ALL_SUBS = "__todos__";
export const ALL_SUBS_LABEL = "Todos los clientes";

export function mergeDatasets(parts: { name: string; ds: RadarDataset }[], label = ALL_SUBS_LABEL): RadarDataset | null {
  const list = parts.filter((p) => p.ds);
  if (!list.length) return null;
  if (list.length === 1) return list[0].ds;
  const tag = (i: number) => (v: number | string | undefined | null) => (v === undefined || v === null || v === "" ? v : `${v}@${i}`) as any;
  const first = list[0].ds;
  const out: RadarDataset = {
    ...first,
    client: {
      ...first.client,
      name: label,
      universe: 0, sdrs: [], companies: [], contacts: [], meetings: [], deals: [], activities: [], callEvals: [],
      pipeline: false, deep: false, meetingsTotal: false, wishlistOnly: true,
    },
    warnings: [],
  };
  const c = out.client;
  const sdrs = new Set<string>();
  list.forEach(({ name, ds }, i) => {
    const t = tag(i), cl = ds.client;
    c.universe += cl.universe || 0;
    (cl.sdrs ?? []).forEach((s) => sdrs.add(s));
    c.pipeline = c.pipeline || cl.pipeline;
    c.deep = c.deep || cl.deep;
    c.meetingsTotal = c.meetingsTotal || !!cl.meetingsTotal;
    c.wishlistOnly = !!c.wishlistOnly && !!cl.wishlistOnly;
    c.companies.push(...cl.companies.map((x) => ({ ...x, id: t(x.id) })));
    c.contacts.push(...cl.contacts.map((x) => ({ ...x, id: t(x.id), co: t(x.co), refBy: t(x.refBy) })));
    c.meetings.push(...cl.meetings.map((x) => ({ ...x, id: t(x.id), co: t(x.co), ct: t(x.ct) })));
    c.deals.push(...cl.deals.map((x) => ({ ...x, co: t(x.co), ct: t(x.ct) })));
    c.activities!.push(...(cl.activities ?? []).map((x) => ({ ...x, id: t(x.id), co: t(x.co), ct: t(x.ct) })));
    c.callEvals!.push(...(cl.callEvals ?? []));
    if (cl.refCases && !c.refCases?.includes(cl.refCases)) c.refCases = [c.refCases, cl.refCases].filter(Boolean).join("\n");
    out.warnings!.push(...(ds.warnings ?? []).map((w) => `${name}: ${w}`));
    if (ds.period[0] < out.period[0]) out.period = [ds.period[0], out.period[1]];
    if (ds.period[1] > out.period[1]) out.period = [out.period[0], ds.period[1]];
    if (ds.generated > out.generated) out.generated = ds.generated;
    // La sincronización más antigua manda (avisa si alguna quedó atrás)
    if (ds.syncedAt && (!out.syncedAt || ds.syncedAt < out.syncedAt)) out.syncedAt = ds.syncedAt;
  });
  c.sdrs = Array.from(sdrs).sort();
  if (!c.activities!.length) delete c.activities;
  if (!c.meetingsTotal) delete c.meetingsTotal;
  if (!c.wishlistOnly) delete c.wishlistOnly;
  return out;
}
