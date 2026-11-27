"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

// ACTI · Buscar cuentas: Base de empresas (filtros con conteos), Recomendadas
// por IA y Guardadas. El socio ve empresas y tipos de cargo disponibles, nunca
// nombres ni datos de contactos.

type People = { contacts: number; mobiles: number; areas: string[]; levels: string[] };
type Card = {
  ref: string;
  id?: string;
  name: string;
  domain: string | null;
  industry?: string | null;
  country?: string | null;
  city?: string | null;
  employees?: string | null;
  description?: string | null;
  facts?: { label: string; value: string }[];
  people: People;
  fit: { score: number; reason: string } | null;
  saved?: boolean;
  requested?: boolean;
  demand?: number;
};
type Quota = { limit: number; used: number; remaining: number; blocked: boolean; reason: string | null; period: "month" | "trial" };
type Targets = { areas: string[]; levels: string[] };
type FacetCounts = Record<string, { value: string; n: number }[]>;
type Filters = Record<string, string[] | string | boolean | undefined>;

const FACET_GROUPS: { title: string; items: { key: string; label: string }[] }[] = [
  {
    title: "Empresa",
    items: [
      { key: "industry", label: "Industria" },
      { key: "country", label: "País" },
      { key: "city", label: "Ciudad" },
      { key: "size", label: "Tamaño (empleados)" },
      { key: "revenue", label: "Facturación" },
      { key: "tech", label: "Tecnologías" },
    ],
  },
  { title: "Buyer persona", items: [{ key: "area", label: "Área" }, { key: "level", label: "Nivel" }] },
];
const NOT_INTERESTED: [string, string][] = [
  ["ya_cliente", "Ya es mi cliente"],
  ["competencia", "Es competencia o partner"],
  ["tamano", "No calza en tamaño"],
  ["industria", "No es una industria que me interese"],
  ["pais", "No opero en ese país"],
  ["otro", "Otro motivo"],
];
const AREAS = ["Gerencia General", "Tecnología", "Operaciones", "Finanzas", "Comercial", "Marketing", "RRHH"];
const LEVELS = ["C-Level", "Director", "Gerente", "Jefatura"];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? "Ocurrió un error");
  return j as T;
}

export default function BuscarCuentas() {
  const [tab, setTab] = useState<"base" | "ia" | "guardadas">("ia");
  const [quota, setQuota] = useState<Quota | null>(null);
  const [targets, setTargets] = useState<Targets>({ areas: [], levels: [] });
  const [requestFor, setRequestFor] = useState<{ card: Card; origin: string } | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const onRequested = (msg: string) => {
    setToast(msg);
    setVersion((v) => v + 1);
    setTimeout(() => setToast(null), 5000);
  };

  return (
    <div className="acti-stack" style={{ gap: 16 }}>
      {quota && <QuotaBanner quota={quota} />}
      <div className="acti-between">
        <div className="acti-tabs" role="tablist">
          {([["ia", "Recomendadas por IA"], ["base", "Base de empresas"], ["guardadas", "Guardadas"]] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className="acti-tab" data-on={tab === k || undefined} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
        <button className="acti-btn ghost sm" onClick={() => setManualOpen(true)} disabled={quota?.blocked}>¿No la encuentras? Pídela</button>
      </div>
      {toast && <div className="acti-banner">{toast}</div>}

      {tab === "ia" && <Recomendadas key={`ia${version}`} onQuota={setQuota} onTargets={setTargets} targets={targets} quota={quota} onRequest={(card) => setRequestFor({ card, origin: "recomendada" })} />}
      {tab === "base" && <Base key={`b${version}`} onQuota={setQuota} onTargets={setTargets} targets={targets} quota={quota} onRequest={(card) => setRequestFor({ card, origin: "busqueda" })} />}
      {tab === "guardadas" && <Guardadas key={`g${version}`} targets={targets} quota={quota} onRequest={(card) => setRequestFor({ card, origin: "guardada" })} />}

      {requestFor && (
        <RequestModal card={requestFor.card} origin={requestFor.origin} targets={targets} onClose={() => setRequestFor(null)}
          onDone={() => { setRequestFor(null); onRequested(`Listo: pediste reunirte con ${requestFor.card.name}. Síguela en Mis solicitudes.`); }} />
      )}
      {manualOpen && (
        <RequestModal card={null} origin="manual" targets={targets} onClose={() => setManualOpen(false)}
          onDone={(name) => { setManualOpen(false); onRequested(`Listo: pediste reunirte con ${name}. Síguela en Mis solicitudes.`); }} />
      )}
    </div>
  );
}

function QuotaBanner({ quota }: { quota: Quota }) {
  if (quota.blocked) {
    return (
      <div className="acti-banner warn">
        <span>{quota.reason}</span>
        <Link href="/acti/mi-plan" className="acti-btn sm">Ver planes</Link>
      </div>
    );
  }
  return (
    <div className="acti-card" style={{ padding: "12px 16px" }}>
      <div className="acti-between">
        <span className="acti-small">
          Empresas pedidas {quota.period === "trial" ? "en tu prueba" : "este mes"}: <b style={{ fontWeight: 700 }}>{quota.used}</b> de {quota.limit}
        </span>
        <span className="acti-tiny acti-muted">
          {quota.period === "trial" ? "Hasta 20 empresas o 2 reuniones" : "Las necesarias para cumplir tu garantía"}
        </span>
      </div>
      <div className="acti-bar" style={{ marginTop: 8 }}><i style={{ width: `${Math.min(100, (quota.used / Math.max(1, quota.limit)) * 100)}%` }} /></div>
    </div>
  );
}

// ── Tarjeta de empresa ────────────────────────────────────────────────────

function CompanyRow({ card, targets, quota, onRequest, onNotInterested, onToggleSave }: {
  card: Card;
  targets: Targets;
  quota: Quota | null;
  onRequest: (c: Card) => void;
  onNotInterested?: (c: Card) => void;
  onToggleSave?: (c: Card) => void;
}) {
  const meta = [card.industry, [card.city, card.country].filter(Boolean).join(", "), card.employees ? `${card.employees} empleados` : null].filter(Boolean).join(" · ");
  const facts = card.facts?.filter((f) => !["Sitio web", "LinkedIn"].includes(f.label)).slice(0, 3).map((f) => `${f.label}: ${f.value}`).join(" · ");
  const initials = card.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
  return (
    <div className="acti-co">
      <div className="acti-co-logo" aria-hidden="true">{initials}</div>
      <div style={{ minWidth: 0 }}>
        <div className="acti-co-name">
          {card.name}
          {card.domain && <span className="acti-tiny acti-muted"> · {card.domain}</span>}
        </div>
        <div className="acti-co-meta">{meta || facts || "—"}</div>
        {card.fit && <div className="acti-small" style={{ marginBottom: 8 }}>{card.fit.reason}</div>}
        <div className="acti-prof">
          {card.people.contacts > 0 ? (
            <>
              {card.people.areas.slice(0, 4).map((a) => <span key={a} className="p" data-match={targets.areas.includes(a) || undefined}>{a}</span>)}
              {card.people.levels.slice(0, 3).map((l) => <span key={l} className="p" data-match={targets.levels.includes(l) || undefined}>{l}</span>)}
              {card.people.mobiles > 0 && <span className="acti-tag ok">Perfiles con contacto directo</span>}
            </>
          ) : (
            <span className="acti-tiny acti-muted">Sin perfiles identificados aún: BullsEye los busca al pedir la reunión.</span>
          )}
          {!!card.demand && <span className="acti-tag warn">Alta demanda</span>}
        </div>
      </div>
      <div className="acti-co-actions">
        {card.fit ? <span className={`acti-fit ${card.fit.score >= 75 ? "hi" : card.fit.score >= 60 ? "mid" : "lo"}`}>{card.fit.score}% fit</span> : <span className="acti-tiny acti-muted">Sin fit</span>}
        {card.requested ? (
          <span className="acti-tag ok">Solicitada</span>
        ) : (
          <button className="acti-btn sm" onClick={() => onRequest(card)} disabled={quota?.blocked}>Quiero reunirme con ellos</button>
        )}
        <div style={{ display: "flex", gap: 6 }}>
          {onToggleSave && (
            <button className="acti-btn ghost sm" onClick={() => onToggleSave(card)}>{card.saved ? "Quitar de guardadas" : "Guardar empresa"}</button>
          )}
          {onNotInterested && <button className="acti-btn ghost sm" onClick={() => onNotInterested(card)}>No me interesa</button>}
        </div>
      </div>
    </div>
  );
}

async function toggleSave(card: Card) {
  await api("/api/acti/guardadas", { method: card.saved ? "DELETE" : "POST", body: JSON.stringify({ ref: card.ref }) });
}

// ── Recomendadas por IA ──────────────────────────────────────────────────

function Recomendadas({ onQuota, onTargets, targets, quota, onRequest }: {
  onQuota: (q: Quota) => void; onTargets: (t: Targets) => void; targets: Targets; quota: Quota | null; onRequest: (c: Card) => void;
}) {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [icpMissing, setIcpMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [dismiss, setDismiss] = useState<Card | null>(null);

  const load = useCallback(async () => {
    try {
      const j = await api<{ cards: Card[]; icpMissing: boolean; quota: Quota; targets: Targets }>("/api/acti/recomendadas");
      setCards(j.cards); setIcpMissing(j.icpMissing); onQuota(j.quota); onTargets(j.targets);
    } catch (e) { setMsg((e as Error).message); setCards([]); }
  }, [onQuota, onTargets]);
  useEffect(() => { load(); }, [load]);

  async function generate() {
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ found: number; exhausted: boolean }>("/api/acti/recomendadas", { method: "POST", body: JSON.stringify({ action: "generar" }) });
      setMsg(r.found ? `Encontramos ${r.found} empresas nuevas para ti.` : r.exhausted ? "Revisamos toda la base con tu ICP. Ajusta tu ICP para ampliar la búsqueda." : "Esta vuelta no encontró empresas con buen fit. Intenta de nuevo.");
      await load();
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  }

  if (!cards) return <div className="acti-card acti-empty">Cargando recomendaciones…</div>;
  if (icpMissing) return <div className="acti-card acti-empty">Completa <Link href="/acti/icp">Mi ICP</Link> para recibir recomendaciones.</div>;
  return (
    <div className="acti-stack">
      <div className="acti-card acti-between">
        <div>
          <h2 style={{ margin: "0 0 4px" }}>Empresas recomendadas según tu ICP</h2>
          <div className="acti-small acti-muted">Primero las de mejor fit y, entre ellas, las que ya tienen perfiles con contacto directo.</div>
        </div>
        <button className="acti-btn" onClick={generate} disabled={busy || quota?.blocked}>{busy ? "Buscando… (hasta 1 minuto)" : "Buscar más con IA"}</button>
      </div>
      {msg && <div className="acti-note">{msg}</div>}
      <div className="acti-card" style={{ padding: 0 }}>
        {cards.length === 0 ? (
          <div className="acti-empty">Aún no hay recomendaciones. Pulsa «Buscar más con IA».</div>
        ) : cards.map((c) => (
          <CompanyRow key={c.ref} card={c} targets={targets} quota={quota} onRequest={onRequest}
            onNotInterested={setDismiss}
            onToggleSave={async (x) => { await toggleSave(x).catch(() => {}); setCards((cs) => cs?.map((y) => (y.ref === x.ref ? { ...y, saved: !y.saved } : y)) ?? null); }} />
        ))}
      </div>
      {dismiss && <NotInterestedModal card={dismiss} onClose={() => setDismiss(null)} onDone={() => { setCards((cs) => cs?.filter((x) => x.ref !== dismiss.ref) ?? null); setDismiss(null); }} />}
    </div>
  );
}

function NotInterestedModal({ card, onClose, onDone }: { card: Card; onClose: () => void; onDone: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [nota, setNota] = useState("");
  const [err, setErr] = useState<string | null>(null);
  async function send() {
    try {
      await api("/api/acti/recomendadas/no-interesa", { method: "POST", body: JSON.stringify({ id: card.id, motivo, nota }) });
      onDone();
    } catch (e) { setErr((e as Error).message); }
  }
  return (
    <Modal title="No me interesa" onClose={onClose}>
      <p className="acti-small acti-muted" style={{ marginTop: 0 }}>{card.name} no volverá a aparecer. Tu motivo ayuda a mejorar las próximas recomendaciones.</p>
      <div className="acti-chips" style={{ marginBottom: 12 }}>
        {NOT_INTERESTED.map(([k, l]) => <button key={k} className="acti-chip" data-on={motivo === k || undefined} onClick={() => setMotivo(k)}>{l}</button>)}
      </div>
      <textarea rows={2} placeholder="Comentario (opcional)" value={nota} onChange={(e) => setNota(e.target.value)} />
      {err && <p className="acti-small acti-bad">{err}</p>}
      <div className="acti-modal-actions">
        <button className="acti-btn ghost" onClick={onClose}>Cancelar</button>
        <button className="acti-btn" disabled={!motivo} onClick={send}>Confirmar</button>
      </div>
    </Modal>
  );
}

// ── Base de empresas ─────────────────────────────────────────────────────

function Base({ onQuota, onTargets, targets, quota, onRequest }: {
  onQuota: (q: Quota) => void; onTargets: (t: Targets) => void; targets: Targets; quota: Quota | null; onRequest: (c: Card) => void;
}) {
  const [filters, setFilters] = useState<Filters>({});
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ cards: Card[]; total: number } | null>(null);
  const [facets, setFacets] = useState<FacetCounts | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fkey = useMemo(() => JSON.stringify(filters), [filters]);

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr(null);
    api<{ cards: Card[]; total: number; facets: FacetCounts | null; quota: Quota; targets: Targets }>("/api/acti/buscar", {
      method: "POST",
      body: JSON.stringify({ filters, page, facets: page === 0 }),
    })
      .then((j) => {
        if (!alive) return;
        setData({ cards: j.cards, total: j.total });
        if (j.facets) setFacets(j.facets);
        onQuota(j.quota); onTargets(j.targets);
      })
      .catch((e) => alive && setErr((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [fkey, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (key: string, value: string) => {
    const cur = (filters[key] as string[] | undefined) ?? [];
    const next = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
    setPage(0);
    setFilters({ ...filters, [key]: next.length ? next : undefined });
  };
  const activeCount = Object.values(filters).filter((v) => (Array.isArray(v) ? v.length : !!v)).length;
  const pages = data ? Math.ceil(data.total / 24) : 0;

  return (
    <div className="acti-search">
      <aside className="acti-card acti-filters">
        <div className="acti-between" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Filtros</h2>
          {activeCount > 0 && <button className="acti-btn ghost sm" onClick={() => { setFilters({}); setQ(""); setPage(0); }}>Limpiar</button>}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); setPage(0); setFilters({ ...filters, q: q || undefined }); }}>
          <input type="text" placeholder="Buscar por nombre o sitio" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <div className="acti-fg">
          <div className="acti-ftitle">Señales de compra</div>
          <label className="acti-check-row">
            <input type="checkbox" checked={filters.mobile === true} onChange={(e) => { setPage(0); setFilters({ ...filters, mobile: e.target.checked || undefined }); }} />
            <span>Con perfiles de contacto directo</span>
            <small>{facets?.signal?.[0]?.n ?? ""}</small>
          </label>
        </div>
        {FACET_GROUPS.map((g) => (
          <div key={g.title} className="acti-fg">
            <div className="acti-ftitle">{g.title}</div>
            {g.items.map((it) => <FacetList key={it.key} label={it.label} options={facets?.[it.key] ?? []} selected={(filters[it.key] as string[]) ?? []} onToggle={(v) => toggle(it.key, v)} />)}
          </div>
        ))}
        <div className="acti-fg">
          <div className="acti-ftitle">Cargo</div>
          <form onSubmit={(e) => { e.preventDefault(); const v = (e.currentTarget.elements.namedItem("title") as HTMLInputElement).value.trim(); setPage(0); setFilters({ ...filters, title: v || undefined }); }}>
            <input name="title" type="text" placeholder="Ej.: gerente de TI" defaultValue={(filters.title as string) ?? ""} />
          </form>
        </div>
      </aside>

      <div className="acti-stack">
        <div className="acti-between">
          <span className="acti-small acti-muted">
            {loading ? "Buscando…" : data ? `${data.total.toLocaleString("es-CL")} empresas` : ""}
            {" · Primero las que tienen perfiles con contacto directo"}
          </span>
        </div>
        {err && <div className="acti-banner warn">{err}</div>}
        <div className="acti-card" style={{ padding: 0, opacity: loading ? 0.6 : 1 }}>
          {data && data.cards.length === 0 && !loading ? (
            <div className="acti-empty">No hay empresas con estos filtros.</div>
          ) : data?.cards.map((c) => (
            <CompanyRow key={c.ref} card={c} targets={targets} quota={quota} onRequest={onRequest}
              onToggleSave={async (x) => { await toggleSave(x).catch(() => {}); setData((d) => d && { ...d, cards: d.cards.map((y) => (y.ref === x.ref ? { ...y, saved: !y.saved } : y)) }); }} />
          ))}
        </div>
        {pages > 1 && (
          <div className="acti-between">
            <button className="acti-btn ghost sm" disabled={page === 0 || loading} onClick={() => setPage(page - 1)}>Anterior</button>
            <span className="acti-small acti-muted">Página {page + 1} de {pages}</span>
            <button className="acti-btn ghost sm" disabled={page + 1 >= pages || loading} onClick={() => setPage(page + 1)}>Siguiente</button>
          </div>
        )}
      </div>
    </div>
  );
}

function FacetList({ label, options, selected, onToggle }: { label: string; options: { value: string; n: number }[]; selected: string[]; onToggle: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const list = [...selected.filter((s) => !options.some((o) => o.value === s)).map((value) => ({ value, n: 0 })), ...options];
  const shown = open ? list : list.slice(0, 6);
  if (!list.length) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <h3 style={{ marginBottom: 4 }}>{label}</h3>
      {shown.map((o) => (
        <label key={o.value} className="acti-check-row">
          <input type="checkbox" checked={selected.includes(o.value)} onChange={() => onToggle(o.value)} />
          <span>{o.value}</span>
          <small>{o.n ? o.n.toLocaleString("es-CL") : ""}</small>
        </label>
      ))}
      {list.length > 6 && <button className="acti-link" onClick={() => setOpen(!open)}>{open ? "Ver menos" : `Ver ${list.length - 6} más`}</button>}
    </div>
  );
}

// ── Guardadas ────────────────────────────────────────────────────────────

function Guardadas({ targets, quota, onRequest }: { targets: Targets; quota: Quota | null; onRequest: (c: Card) => void }) {
  const [cards, setCards] = useState<Card[] | null>(null);
  useEffect(() => { api<{ cards: Card[] }>("/api/acti/guardadas").then((j) => setCards(j.cards)).catch(() => setCards([])); }, []);
  if (!cards) return <div className="acti-card acti-empty">Cargando…</div>;
  return (
    <div className="acti-card" style={{ padding: 0 }}>
      {cards.length === 0 ? (
        <div className="acti-empty">Aún no guardas empresas. Usa «Guardar empresa» en la búsqueda o en las recomendaciones.</div>
      ) : cards.map((c) => (
        <CompanyRow key={c.ref} card={c} targets={targets} quota={quota} onRequest={onRequest}
          onToggleSave={async (x) => { await toggleSave(x).catch(() => {}); setCards((cs) => cs?.filter((y) => y.ref !== x.ref) ?? null); }} />
      ))}
    </div>
  );
}

// ── Solicitar reunión ────────────────────────────────────────────────────

function RequestModal({ card, origin, targets, onClose, onDone }: {
  card: Card | null; origin: string; targets: Targets; onClose: () => void; onDone: (name: string) => void;
}) {
  const [areas, setAreas] = useState<string[]>(targets.areas);
  const [levels, setLevels] = useState<string[]>(targets.levels);
  const [titles, setTitles] = useState("");
  const [comment, setComment] = useState("");
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const tog = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function send() {
    setBusy(true); setErr(null);
    try {
      await api("/api/acti/solicitudes", {
        method: "POST",
        body: JSON.stringify({
          ...(card ? { ref: card.ref } : { manual: { name, website } }),
          personas: { areas, levels, titles },
          comment,
          origin,
          fit: card?.fit?.score,
        }),
      });
      onDone(card?.name ?? name);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  return (
    <Modal title="Solicitar reunión" onClose={onClose}>
      {card ? (
        <p className="acti-small" style={{ marginTop: 0 }}>Con <b style={{ fontWeight: 600 }}>{card.name}</b>. BullsEye identifica a la persona adecuada y agenda la reunión.</p>
      ) : (
        <div className="acti-stack" style={{ marginBottom: 12 }}>
          <label className="acti-field"><span className="acti-field-label">Empresa</span><input type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="acti-field"><span className="acti-field-label">Sitio web</span><input type="text" placeholder="empresa.cl" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
        </div>
      )}
      <div className="acti-field" style={{ marginBottom: 10 }}>
        <span className="acti-field-label">Área del cargo</span>
        <div className="acti-chips">{AREAS.map((a) => <button key={a} className="acti-chip" data-on={areas.includes(a) || undefined} onClick={() => tog(areas, setAreas, a)}>{a}</button>)}</div>
      </div>
      <div className="acti-field" style={{ marginBottom: 10 }}>
        <span className="acti-field-label">Nivel</span>
        <div className="acti-chips">{LEVELS.map((l) => <button key={l} className="acti-chip" data-on={levels.includes(l) || undefined} onClick={() => tog(levels, setLevels, l)}>{l}</button>)}</div>
      </div>
      <label className="acti-field" style={{ marginBottom: 10 }}>
        <span className="acti-field-label">Cargos específicos (opcional)</span>
        <input type="text" placeholder="Ej.: Gerente de Ciberseguridad, CIO" value={titles} onChange={(e) => setTitles(e.target.value)} />
      </label>
      <label className="acti-field">
        <span className="acti-field-label">¿Por qué te interesa? (opcional)</span>
        <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
      </label>
      {err && <p className="acti-small acti-bad">{err}</p>}
      <div className="acti-modal-actions">
        <button className="acti-btn ghost" onClick={onClose}>Cancelar</button>
        <button className="acti-btn" disabled={busy || (!card && (!name.trim() || !website.trim()))} onClick={send}>{busy ? "Enviando…" : "Solicitar reunión"}</button>
      </div>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="acti-modal-bg" onClick={onClose}>
      <div className="acti-card acti-modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="acti-between" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="acti-btn ghost sm" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
