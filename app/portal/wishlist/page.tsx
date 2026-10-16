"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconSparkles,
  IconFilter,
  IconHeart,
  IconLoader2,
  IconPlus,
  IconX,
  IconExternalLink,
  IconCheck,
  IconTrash,
} from "@tabler/icons-react";

// ── Tipos ────────────────────────────────────────────────────────────────

type Source = "hubspot" | "lemlist";
type Mode = "ai" | "manual";

type Card = {
  source: Source;
  key: string;
  name: string;
  domain: string | null;
  linkedin_url: string | null;
  facts: { label: string; value: string }[];
  fit_score?: number | null;
  fit_reason?: string | null;
};

type PoolProp = { name: string; label: string; type: string; options: { value: string; label: string }[]; filled_count: number };
type LemlistDef = { filterId: string; description: string; type: string; values?: string[] };
type Options = {
  hubspot: { available: boolean; reason?: string; total: number; properties: PoolProp[] };
  lemlist: { available: boolean; reason?: string; filters?: LemlistDef[] };
};

// Filtro en edición (formato común para ambas fuentes)
type DraftFilter = { id: string; field: string; values: string[]; min?: string; max?: string };

type WishlistItem = {
  id: string;
  company_name: string;
  domain: string | null;
  source: Source;
  mode: Mode;
  fit_score: number | null;
  fit_reason: string | null;
  status: "new" | "in_lemlist" | "in_progress" | "contacts_found" | "discarded";
  requested_by_email: string | null;
  created_at: string;
};

const STATUS_LABEL: Record<WishlistItem["status"], { text: string; cls: string }> = {
  new: { text: "Recibida", cls: "bg-amber-50 text-amber-700" },
  in_lemlist: { text: "En Lemlist", cls: "bg-blue-50 text-blue-700" },
  in_progress: { text: "En prospección", cls: "bg-indigo-50 text-indigo-700" },
  contacts_found: { text: "Contactos encontrados", cls: "bg-green-50 text-green-700" },
  discarded: { text: "Descartada", cls: "bg-gray-100 text-gray-500" },
};

const SOURCE_LABEL: Record<Source, string> = { hubspot: "Base BullsEye", lemlist: "Base Lemlist" };

// ── Página ───────────────────────────────────────────────────────────────

export default function PortalWishlistPage() {
  const [tab, setTab] = useState<"ai" | "manual" | "wishlist">("ai");
  const [options, setOptions] = useState<Options | null>(null);
  const [source, setSource] = useState<Source>("hubspot");
  const [wishlist, setWishlist] = useState<WishlistItem[]>([]);

  const loadWishlist = useCallback(async () => {
    const r = await fetch("/api/portal/wishlist", { cache: "no-store" });
    if (r.ok) setWishlist((await r.json()).items);
  }, []);

  useEffect(() => {
    fetch("/api/portal/wishlist/options", { cache: "no-store" })
      .then((r) => r.json())
      .then((o: Options) => {
        setOptions(o);
        if (!o.hubspot?.available && o.lemlist?.available) setSource("lemlist");
      })
      .catch(() => {});
    loadWishlist();
  }, [loadWishlist]);

  return (
    <div>
      <h1 className="text-2xl font-semibold" style={{ color: "#251762" }}>Wishlist de empresas</h1>
      <p className="text-sm text-gray-500 mt-1 mb-6 max-w-3xl">
        Encuentra las empresas que quieres que prospectemos. Cada una muestra qué tan bien calza con tu ICP y por qué.
        Al agregarla a tu wishlist, el equipo de prospección de BullsEye la recibe de inmediato.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 mb-6">
        <div className="flex gap-1">
          <TabButton active={tab === "ai"} onClick={() => setTab("ai")} icon={<IconSparkles size={16} />}>Recomendadas por IA</TabButton>
          <TabButton active={tab === "manual"} onClick={() => setTab("manual")} icon={<IconFilter size={16} />}>Buscar con filtros</TabButton>
          <TabButton active={tab === "wishlist"} onClick={() => setTab("wishlist")} icon={<IconHeart size={16} />}>
            Mi wishlist{wishlist.length ? ` (${wishlist.length})` : ""}
          </TabButton>
        </div>
        {tab !== "wishlist" && options && (
          <div className="flex items-center gap-1 text-xs pb-2">
            {(["hubspot", "lemlist"] as Source[]).map((s) => {
              const avail = options[s]?.available;
              return (
                <button
                  key={s}
                  disabled={!avail}
                  title={avail ? undefined : options[s]?.reason}
                  onClick={() => setSource(s)}
                  className={`px-3 py-1.5 rounded-full ${source === s ? "bg-[#251762] text-white" : "bg-gray-100 text-gray-600"} disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  {SOURCE_LABEL[s]}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {!options && tab !== "wishlist" && <IconLoader2 className="animate-spin text-gray-400" />}
      {options && tab !== "wishlist" && !options[source]?.available && (
        <div className="text-sm text-gray-500 bg-gray-50 rounded-xl px-4 py-3">{options[source]?.reason}</div>
      )}

      {options && options[source]?.available && tab === "ai" && (
        <AiTab key={source} source={source} onAdded={loadWishlist} />
      )}
      {options && options[source]?.available && tab === "manual" && (
        <ManualTab key={source} source={source} options={options} onAdded={loadWishlist} />
      )}
      {tab === "wishlist" && <WishlistTab items={wishlist} onChange={loadWishlist} />}
    </div>
  );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 -mb-px ${active ? "border-[#251762] text-[#251762] font-medium" : "border-transparent text-gray-500"}`}
    >
      {icon}
      {children}
    </button>
  );
}

// ── Recomendadas por IA ──────────────────────────────────────────────────

function AiTab({ source, onAdded }: { source: Source; onAdded: () => void }) {
  const [cards, setCards] = useState<Card[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  async function run(nextPage: number) {
    setLoading(true);
    setError(null);
    setStarted(true);
    const r = await fetch("/api/portal/wishlist/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, mode: "ai", page: nextPage }),
    });
    const j = await r.json().catch(() => ({}));
    setLoading(false);
    if (!r.ok) return setError(j.error ?? "No pudimos generar recomendaciones");
    setCards((prev) => (nextPage === 0 ? j.cards : [...prev, ...j.cards]));
    setPage(nextPage);
    setHasMore(!!j.has_more);
  }

  return (
    <div>
      {!started && (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
          <IconSparkles className="mx-auto mb-3" size={28} style={{ color: "#62E0D8" }} />
          <h2 className="font-semibold mb-1" style={{ color: "#251762" }}>Recomendaciones según tu ICP</h2>
          <p className="text-sm text-gray-500 mb-5 max-w-md mx-auto">
            Analizamos tu perfil de cliente ideal, buscamos en la {SOURCE_LABEL[source]} y te mostramos las empresas con mejor fit,
            con su porcentaje y la razón.
          </p>
          <button onClick={() => run(0)} className="px-5 py-2.5 rounded-xl text-white text-sm font-medium" style={{ background: "#251762" }}>
            Generar recomendaciones
          </button>
        </div>
      )}
      {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl mb-4">{error}</div>}
      <CardGrid cards={cards} mode="ai" onAdded={(key) => { setCards((c) => c.filter((x) => x.key !== key)); onAdded(); }} />
      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-500 mt-6">
          <IconLoader2 className="animate-spin" size={18} /> Analizando empresas contra tu ICP… (puede tomar unos segundos)
        </div>
      )}
      {started && !loading && cards.length === 0 && !error && (
        <div className="text-sm text-gray-500 mt-4">No encontramos nuevas empresas para recomendarte en esta base.</div>
      )}
      {started && !loading && hasMore && (
        <div className="mt-6 text-center">
          <button onClick={() => run(page + 1)} className="px-4 py-2 rounded-xl text-sm border border-gray-200 bg-white">Ver más recomendaciones</button>
        </div>
      )}
    </div>
  );
}

// ── Buscar con filtros ───────────────────────────────────────────────────

type FieldDef = { id: string; label: string; kind: "multi" | "range" | "text"; options: { value: string; label: string }[] };

function ManualTab({ source, options, onAdded }: { source: Source; options: Options; onAdded: () => void }) {
  const fields: FieldDef[] = useMemo(() => {
    if (source === "hubspot") {
      return options.hubspot.properties.map((p) => ({
        id: p.name,
        label: `${p.label} (${p.filled_count.toLocaleString("es-CL")})`,
        kind: p.type === "number" ? "range" : "multi",
        options: p.options,
      }));
    }
    return (options.lemlist.filters ?? []).map((f) => ({
      id: f.filterId,
      label: f.description || f.filterId,
      kind: f.values?.length ? "multi" : "text",
      options: (f.values ?? []).map((v) => ({ value: v, label: v })),
    }));
  }, [source, options]);

  const [filters, setFilters] = useState<DraftFilter[]>([]);
  const [query, setQuery] = useState("");
  const [cards, setCards] = useState<Card[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toApiFilters() {
    return filters
      .map((f) => {
        const def = fields.find((d) => d.id === f.field);
        if (!def) return null;
        if (source === "lemlist") return { filterId: f.field, in: f.values };
        if (def.kind === "range") return { property: f.field, op: "range", min: f.min ?? null, max: f.max ?? null };
        return { property: f.field, op: "in", values: f.values };
      })
      .filter(Boolean);
  }

  // Calcula el fit de los resultados que se acaban de mostrar
  async function scoreCards(list: Card[]) {
    const pending = list.filter((c) => c.fit_score === undefined);
    if (!pending.length) return;
    const r = await fetch("/api/portal/wishlist/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, cards: pending }),
    });
    const j = r.ok ? await r.json().catch(() => ({})) : {};
    const scores = ((j as { scores?: Record<string, { fit_score: number; fit_reason: string }> }).scores ?? {});
    const pendingKeys = new Set(pending.map((c) => c.key));
    // Las que no se pudieron puntuar quedan en null (sin indicador de carga)
    setCards((prev) =>
      prev.map((c) =>
        scores[c.key]
          ? { ...c, fit_score: scores[c.key].fit_score, fit_reason: scores[c.key].fit_reason }
          : pendingKeys.has(c.key) && c.fit_score === undefined
            ? { ...c, fit_score: null }
            : c
      )
    );
  }

  async function search(nextPage: number) {
    setLoading(true);
    setError(null);
    const r = await fetch("/api/portal/wishlist/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, mode: "manual", filters: toApiFilters(), query, page: nextPage }),
    });
    const j = await r.json().catch(() => ({}));
    setLoading(false);
    if (!r.ok) return setError(j.error ?? "Error en la búsqueda");
    const newCards: Card[] = j.cards;
    setCards((prev) => (nextPage === 0 ? newCards : [...prev, ...newCards]));
    setTotal(j.total ?? null);
    setPage(nextPage);
    setHasMore(!!j.has_more);
    scoreCards(newCards);
  }

  const unused = fields.filter((f) => !filters.some((x) => x.field === f.id));

  return (
    <div>
      <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-6 space-y-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search(0)}
          placeholder="Nombre o dominio (opcional)"
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-[#62E0D8]"
        />
        {filters.map((f) => {
          const def = fields.find((d) => d.id === f.field);
          if (!def) return null;
          const update = (patch: Partial<DraftFilter>) => setFilters((list) => list.map((x) => (x.id === f.id ? { ...x, ...patch } : x)));
          return (
            <div key={f.id} className="flex flex-wrap items-start gap-3 border border-gray-100 rounded-xl p-3">
              <div className="text-sm font-medium text-gray-700 w-full sm:w-56 pt-1.5">{def.label}</div>
              <div className="flex-1 min-w-[220px]">
                {def.kind === "range" ? (
                  <div className="flex items-center gap-2 text-sm">
                    <input type="number" placeholder="Mín." value={f.min ?? ""} onChange={(e) => update({ min: e.target.value })} className="w-28 border border-gray-200 rounded-lg px-2 py-1.5" />
                    <span className="text-gray-400">a</span>
                    <input type="number" placeholder="Máx." value={f.max ?? ""} onChange={(e) => update({ max: e.target.value })} className="w-28 border border-gray-200 rounded-lg px-2 py-1.5" />
                  </div>
                ) : def.kind === "text" ? (
                  <input
                    placeholder="Valores separados por coma"
                    value={f.values.join(", ")}
                    onChange={(e) => update({ values: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) })}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                  />
                ) : (
                  <MultiSelect options={def.options} selected={f.values} onChange={(values) => update({ values })} />
                )}
              </div>
              <button onClick={() => setFilters((list) => list.filter((x) => x.id !== f.id))} className="text-gray-400 hover:text-red-600 pt-1.5" title="Quitar filtro">
                <IconX size={16} />
              </button>
            </div>
          );
        })}
        <div className="flex flex-wrap items-center gap-3">
          <select
            value=""
            onChange={(e) => e.target.value && setFilters((l) => [...l, { id: crypto.randomUUID(), field: e.target.value, values: [] }])}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
          >
            <option value="">+ Agregar filtro…</option>
            {unused.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
          <button
            onClick={() => search(0)}
            disabled={loading}
            className="px-5 py-2 rounded-xl text-white text-sm font-medium disabled:opacity-50"
            style={{ background: "#251762" }}
          >
            {loading && page === 0 ? "Buscando…" : "Buscar"}
          </button>
          {total != null && <span className="text-xs text-gray-500">{total.toLocaleString("es-CL")} empresas encontradas (sin las que ya pediste)</span>}
        </div>
      </div>

      {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl mb-4">{error}</div>}
      <CardGrid cards={cards} mode="manual" onAdded={(key) => { setCards((c) => c.filter((x) => x.key !== key)); onAdded(); }} />
      {hasMore && !loading && (
        <div className="mt-6 text-center">
          <button onClick={() => search(page + 1)} className="px-4 py-2 rounded-xl text-sm border border-gray-200 bg-white">Ver más</button>
        </div>
      )}
      {loading && page > 0 && <IconLoader2 className="animate-spin text-gray-400 mx-auto mt-6" />}
    </div>
  );
}

function MultiSelect({ options, selected, onChange }: { options: { value: string; label: string }[]; selected: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState("");
  const shown = options.filter((o) => !selected.includes(o.value) && o.label.toLowerCase().includes(q.toLowerCase())).slice(0, 40);
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  return (
    <div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 text-xs rounded-full px-2.5 py-1 bg-[#251762] text-white">
              {labelOf(v)}
              <button onClick={() => onChange(selected.filter((x) => x !== v))}><IconX size={12} /></button>
            </span>
          ))}
        </div>
      )}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar opción…" className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm mb-1.5" />
      <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
        {shown.map((o) => (
          <button key={o.value} onClick={() => onChange([...selected, o.value])} className="text-xs rounded-full px-2.5 py-1 bg-gray-100 text-gray-700 hover:bg-gray-200">
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Tarjetas de empresa ──────────────────────────────────────────────────

function fitStyle(score: number) {
  if (score >= 80) return { bg: "rgba(34,197,94,0.12)", fg: "#15803d", label: "Fit alto" };
  if (score >= 60) return { bg: "rgba(98,224,216,0.18)", fg: "#0f766e", label: "Fit probable" };
  if (score >= 40) return { bg: "rgba(245,158,11,0.14)", fg: "#b45309", label: "Fit dudoso" };
  return { bg: "rgba(239,68,68,0.10)", fg: "#b91c1c", label: "Bajo fit" };
}

function CardGrid({ cards, mode, onAdded }: { cards: Card[]; mode: Mode; onAdded: (key: string) => void }) {
  if (!cards.length) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((c) => <CompanyCard key={`${c.source}:${c.key}`} card={c} mode={mode} onAdded={onAdded} />)}
    </div>
  );
}

function CompanyCard({ card, mode, onAdded }: { card: Card; mode: Mode; onAdded: (key: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  async function add() {
    setAdding(true);
    setError(null);
    const r = await fetch("/api/portal/wishlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: card.source, key: card.key, mode, card: card.source === "lemlist" ? card : undefined }),
    });
    const j = await r.json().catch(() => ({}));
    setAdding(false);
    if (!r.ok) return setError(j.error ?? "No se pudo agregar");
    setDone(true);
    // La tarjeta desaparece de los resultados después de confirmar
    setTimeout(() => onAdded(card.key), 700);
  }

  const facts = expanded ? card.facts : card.facts.slice(0, 4);
  const fit = card.fit_score != null ? fitStyle(card.fit_score) : null;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 flex flex-col">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-[15px] truncate" style={{ color: "#251762" }}>{card.name}</h3>
          {card.domain && (
            <a href={`https://${card.domain}`} target="_blank" rel="noreferrer" className="text-xs text-gray-500 hover:text-[#251762] inline-flex items-center gap-1">
              {card.domain} <IconExternalLink size={11} />
            </a>
          )}
        </div>
        {fit ? (
          <div className="text-right shrink-0 rounded-xl px-2.5 py-1" style={{ background: fit.bg, color: fit.fg }}>
            <div className="text-lg font-bold leading-tight">{card.fit_score}%</div>
            <div className="text-[10px] font-medium">{fit.label}</div>
          </div>
        ) : card.fit_score === undefined ? (
          <div className="text-[11px] text-gray-400 flex items-center gap-1 shrink-0">
            <IconLoader2 size={12} className="animate-spin" /> fit…
          </div>
        ) : null}
      </div>

      {card.fit_reason && <p className="text-[13px] text-gray-700 leading-relaxed mb-3">{card.fit_reason}</p>}

      <dl className="text-xs space-y-1 mb-3">
        {facts.map((f) => (
          <div key={f.label} className="flex gap-2">
            <dt className="text-gray-400 shrink-0 w-28 truncate">{f.label}</dt>
            <dd className="text-gray-700 line-clamp-2">{f.value}</dd>
          </div>
        ))}
      </dl>
      {card.facts.length > 4 && (
        <button onClick={() => setExpanded((e) => !e)} className="text-xs text-[#251762] mb-3 self-start">
          {expanded ? "Ver menos" : `Ver ${card.facts.length - 4} datos más`}
        </button>
      )}

      <div className="mt-auto">
        {error && <div className="text-xs text-red-600 mb-2">{error}</div>}
        <button
          onClick={add}
          disabled={adding || done}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-70"
          style={{ background: done ? "#16a34a" : "#251762" }}
        >
          {done ? <><IconCheck size={15} /> Agregada</> : adding ? <IconLoader2 size={15} className="animate-spin" /> : <><IconPlus size={15} /> Agregar a wishlist</>}
        </button>
      </div>
    </div>
  );
}

// ── Mi wishlist ──────────────────────────────────────────────────────────

function WishlistTab({ items, onChange }: { items: WishlistItem[]; onChange: () => void }) {
  async function remove(id: string) {
    if (!confirm("¿Quitar esta empresa de tu wishlist?")) return;
    const r = await fetch(`/api/portal/wishlist/${id}`, { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) alert(j.error ?? "No se pudo quitar");
    onChange();
  }

  if (!items.length) {
    return <div className="text-sm text-gray-500 bg-gray-50 rounded-xl px-4 py-3">Aún no agregas empresas. Usa las recomendaciones o la búsqueda con filtros.</div>;
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-gray-500 border-b border-gray-100">
          <tr>
            <th className="p-3">Empresa</th>
            <th className="p-3">Fit</th>
            <th className="p-3">Estado</th>
            <th className="p-3">Agregada</th>
            <th className="p-3"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="border-b border-gray-50 last:border-0 align-top">
              <td className="p-3">
                <div className="font-medium" style={{ color: "#251762" }}>{i.company_name}</div>
                <div className="text-xs text-gray-500">{i.domain ?? "—"} · {SOURCE_LABEL[i.source]}{i.mode === "ai" ? " · IA" : ""}</div>
              </td>
              <td className="p-3 max-w-xs">
                {i.fit_score != null ? (
                  <>
                    <div className="font-semibold">{i.fit_score}%</div>
                    {i.fit_reason && <div className="text-xs text-gray-500 line-clamp-2">{i.fit_reason}</div>}
                  </>
                ) : "—"}
              </td>
              <td className="p-3">
                <span className={`text-xs rounded px-2 py-0.5 ${STATUS_LABEL[i.status].cls}`}>{STATUS_LABEL[i.status].text}</span>
              </td>
              <td className="p-3 text-xs text-gray-500 whitespace-nowrap">
                {new Date(i.created_at).toLocaleDateString("es-CL")}
                {i.requested_by_email ? <div>{i.requested_by_email}</div> : null}
              </td>
              <td className="p-3 text-right">
                {i.status === "new" && (
                  <button onClick={() => remove(i.id)} className="text-gray-400 hover:text-red-600" title="Quitar">
                    <IconTrash size={16} />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
