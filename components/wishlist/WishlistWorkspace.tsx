"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  IconSparkles,
  IconSearch,
  IconHeart,
  IconBriefcase,
  IconBan,
  IconLoader2,
  IconPlus,
  IconX,
  IconExternalLink,
  IconCheck,
  IconTrash,
  IconChevronDown,
  IconUpload,
  IconBuildingPlus,
  IconEyeOff,
  IconArrowBackUp,
  IconSend,
  IconClock,
  IconThumbDown,
} from "@tabler/icons-react";
import {
  FILTER_GROUPS,
  type UnifiedFilterDef,
  type UnifiedFilterKey,
  type UnifiedFilters,
} from "@/lib/unifiedFilterDefs";

// Wishlist de empresas: la usa el cliente en su portal (/portal/wishlist) y el
// equipo de BullsEye en Empresas (modo operador, con el cliente elegido).
// Mismas APIs /api/portal/*: en modo operador se agrega ?client_id= y al
// "agregar" una empresa queda como PROPUESTA que el cliente aprueba en su portal.

type Workspace = { clientId: string | null; operator: boolean };
const WorkspaceCtx = createContext<Workspace>({ clientId: null, operator: false });

function useWorkspace() {
  const ws = useContext(WorkspaceCtx);
  const url = useCallback(
    (path: string) => (ws.clientId ? `${path}${path.includes("?") ? "&" : "?"}client_id=${ws.clientId}` : path),
    [ws.clientId]
  );
  // Memoizado: el objeto se usa en dependencias de useEffect/useCallback; uno
  // nuevo en cada render dispara las cargas en bucle infinito
  return useMemo(() => ({ ...ws, url }), [ws, url]);
}

// ── Tipos ────────────────────────────────────────────────────────────────

type Card = {
  ref: string;
  name: string;
  domain: string | null;
  linkedin_url: string | null;
  facts: { label: string; value: string }[];
  fit_score?: number | null;
  fit_reason?: string | null;
  existing_client?: boolean;
};
type Option = { value: string; label: string };
type Catalog = { available: UnifiedFilterKey[]; options: Partial<Record<UnifiedFilterKey, Option[]>> };
type Cursor = { phase: string; hsOffset: number; lemPage: number };

type WishlistItem = {
  id: string;
  company_name: string;
  domain: string | null;
  mode: "manual" | "ai";
  fit_score: number | null;
  fit_reason: string | null;
  status: "proposed" | "rejected_by_client" | "new" | "in_lemlist" | "in_progress" | "contacts_found" | "discarded";
  origin?: "client" | "bullseye";
  snapshot?: { facts?: { label: string; value: string }[] } | null;
  client_reject_reason?: string | null;
  requested_by_email: string | null;
  created_at: string;
};

const STATUS_LABEL: Record<WishlistItem["status"], { text: string; cls: string }> = {
  proposed: { text: "Esperando aprobación del cliente", cls: "bg-amber-50 text-amber-700" },
  rejected_by_client: { text: "Rechazada por el cliente", cls: "bg-gray-100 text-gray-500" },
  new: { text: "Recibida", cls: "bg-amber-50 text-amber-700" },
  in_lemlist: { text: "Recibida por prospección", cls: "bg-blue-50 text-blue-700" },
  in_progress: { text: "En prospección", cls: "bg-indigo-50 text-indigo-700" },
  contacts_found: { text: "Contactos encontrados", cls: "bg-green-50 text-green-700" },
  discarded: { text: "Descartada", cls: "bg-gray-100 text-gray-500" },
};

type Tab = "ai" | "search" | "proposals" | "rejected" | "wishlist" | "worked" | "omitted" | "exclusions";

// Clave para no repetir una empresa que aparece en las dos bases
const dedupeKey = (c: { name: string; domain: string | null }) => c.domain ?? c.name.trim().toLowerCase();

// ── Página ───────────────────────────────────────────────────────────────

export default function WishlistWorkspace({ operatorClientId }: { operatorClientId?: string }) {
  const workspace = useMemo<Workspace>(() => ({ clientId: operatorClientId ?? null, operator: !!operatorClientId }), [operatorClientId]);
  return (
    <WorkspaceCtx.Provider value={workspace}>
      <WorkspaceTabs />
    </WorkspaceCtx.Provider>
  );
}

function WorkspaceTabs() {
  const ws = useWorkspace();
  const [tab, setTab] = useState<Tab>("ai");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [wishlist, setWishlist] = useState<WishlistItem[]>([]);

  const loadWishlist = useCallback(async () => {
    const r = await fetch(ws.url("/api/portal/wishlist"), { cache: "no-store" });
    if (r.ok) setWishlist((await r.json()).items);
  }, [ws.url]);

  useEffect(() => {
    fetch(ws.url("/api/portal/wishlist/options"), { cache: "no-store" })
      .then(async (r) => (r.ok ? setCatalog(await r.json()) : setCatalogError("No pudimos cargar los filtros")))
      .catch(() => setCatalogError("No pudimos cargar los filtros"));
    loadWishlist();
  }, [loadWishlist, ws.url]);

  const proposed = wishlist.filter((i) => i.status === "proposed");
  const rejected = wishlist.filter((i) => i.status === "rejected_by_client");
  const own = wishlist.filter((i) => i.status !== "proposed" && i.status !== "rejected_by_client");
  const count = (n: number) => (n ? ` (${n})` : "");

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = ws.operator
    ? [
        { key: "ai", label: "Recomendadas por IA", icon: <IconSparkles size={16} /> },
        { key: "search", label: "Buscar empresas", icon: <IconSearch size={16} /> },
        { key: "proposals", label: `Pendientes de aprobación${count(proposed.length)}`, icon: <IconClock size={16} /> },
        { key: "worked", label: "Aprobadas para prospectar", icon: <IconBriefcase size={16} /> },
        { key: "rejected", label: `Rechazadas por el cliente${count(rejected.length)}`, icon: <IconThumbDown size={16} /> },
        { key: "omitted", label: "Descartadas", icon: <IconEyeOff size={16} /> },
        { key: "exclusions", label: "Lista de exclusión", icon: <IconBan size={16} /> },
      ]
    : [
        { key: "ai", label: "Recomendadas por IA", icon: <IconSparkles size={16} /> },
        { key: "search", label: "Buscar empresas", icon: <IconSearch size={16} /> },
        ...(proposed.length ? [{ key: "proposals" as Tab, label: `Propuestas de BullsEye (${proposed.length})`, icon: <IconSend size={16} /> }] : []),
        { key: "wishlist", label: `Mi wishlist${count(own.length)}`, icon: <IconHeart size={16} /> },
        { key: "worked", label: "Empresas trabajadas", icon: <IconBriefcase size={16} /> },
        { key: "omitted", label: "Empresas omitidas", icon: <IconEyeOff size={16} /> },
        { key: "exclusions", label: "Lista de exclusión", icon: <IconBan size={16} /> },
      ];

  return (
    <div>
      {!ws.operator && (
        <>
          <h1 className="text-2xl font-semibold" style={{ color: "#251762" }}>Wishlist de empresas</h1>
          <p className="text-sm text-gray-500 mt-1 mb-6 max-w-3xl">
            Encuentra las empresas que quieres que prospectemos. Cada una muestra qué tan bien calza con tu ICP y por qué.
            Al agregarla a tu wishlist, el equipo de prospección de BullsEye la recibe de inmediato.
          </p>
        </>
      )}

      <div className="flex gap-1 border-b border-gray-200 mb-6 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 -mb-px whitespace-nowrap ${tab === t.key ? "border-[#251762] text-[#251762] font-medium" : "border-transparent text-gray-500"}`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {(tab === "ai" || tab === "search") && !catalog && !catalogError && (
        <div className="flex items-center gap-2 text-sm text-gray-500"><IconLoader2 className="animate-spin" size={18} /> Preparando filtros…</div>
      )}
      {(tab === "ai" || tab === "search") && catalogError && <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl">{catalogError}</div>}

      {tab === "ai" && catalog && <AiTab catalog={catalog} onAdded={loadWishlist} />}
      {tab === "search" && catalog && <SearchTab catalog={catalog} onAdded={loadWishlist} />}
      {tab === "proposals" && <ProposalsTab items={proposed} onChange={loadWishlist} />}
      {tab === "rejected" && <RejectedTab items={rejected} />}
      {tab === "wishlist" && <WishlistTab items={own} onChange={loadWishlist} />}
      {tab === "worked" && <WorkedTab />}
      {tab === "omitted" && <OmittedTab />}
      {tab === "exclusions" && <ExclusionsTab />}
    </div>
  );
}

// ── Hook de búsqueda paginada ────────────────────────────────────────────

// Búsqueda con filtros (paginada, sin fit automático)
function useCompanySearch() {
  const ws = useWorkspace();
  const [cards, setCards] = useState<Card[]>([]);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsFilters, setNeedsFilters] = useState(false);
  const seen = useRef(new Set<string>());

  async function run(filters: UnifiedFilters, reset: boolean) {
    setLoading(true);
    setError(null);
    if (reset) {
      seen.current = new Set();
      setCards([]);
      setNeedsFilters(false);
    }
    const r = await fetch(ws.url("/api/portal/wishlist/search"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filters, cursor: reset ? null : cursor }),
    });
    const j = await r.json().catch(() => null);
    setLoading(false);
    if (!r.ok || !j) {
      // Sin JSON = la función no alcanzó a responder (timeout / caída)
      setError(j?.error ?? "La búsqueda tardó más de lo esperado. Intenta nuevamente en unos segundos.");
      return;
    }
    const fresh = (j.cards as Card[]).filter((c) => {
      const k = dedupeKey(c);
      if (seen.current.has(k)) return false;
      seen.current.add(k);
      return true;
    });
    setCards((prev) => (reset ? fresh : [...prev, ...fresh]));
    setCursor(j.cursor);
    setHasMore(!!j.has_more);
    setNeedsFilters(!!j.needs_filters);
  }

  const removeCard = (ref: string) => setCards((c) => c.filter((x) => x.ref !== ref));
  return { cards, setCards, hasMore, loading, error, needsFilters, run, removeCard };
}

// ── Recomendadas por IA ──────────────────────────────────────────────────
// Las recomendaciones quedan guardadas en el servidor hasta que el cliente las
// agrega u omite: al volver siguen ahí y no se vuelven a pagar. "Generar"
// pide tandas (una por llamada) hasta juntar la cantidad elegida; cada tanda
// sigue donde quedó la anterior.

const AI_TARGETS = [10, 25, 50, 100, 200];

function AiTab({ catalog, onAdded }: { catalog: Catalog; onAdded: () => void }) {
  const ws = useWorkspace();
  const [cards, setCards] = useState<Card[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [appliedFilters, setAppliedFilters] = useState<UnifiedFilters | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [target, setTarget] = useState(25);
  const [progress, setProgress] = useState<{ got: number; target: number; round: number; scanned: number } | null>(null);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lowFitHidden, setLowFitHidden] = useState(0);
  const [existingHidden, setExistingHidden] = useState(0);
  const [sort, setSort] = useState<SortMode>("fit");
  const stopRef = useRef(false);

  const load = useCallback(async () => {
    const r = await fetch(ws.url("/api/portal/wishlist/recommendations"));
    const j = await r.json().catch(() => null);
    setLoaded(true);
    if (!r.ok || !j) return setError(j?.error ?? "No pudimos cargar tus recomendaciones");
    if (j.icp_missing) return setError("Tu ICP todavía no está cargado. Complétalo en “ICP y buyer persona”.");
    setCards(j.items ?? []);
    setAppliedFilters(j.applied_filters ?? null);
    setExhausted(!!j.exhausted);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function generate(reset: boolean) {
    stopRef.current = false;
    setStopping(false);
    setError(null);
    if (reset) setExhausted(false);
    // Tope de tandas: en promedio ~1 de cada 3–6 empresas pasa el 60% de fit
    const maxRounds = Math.ceil(target / 5) + 2;
    let got = 0;
    let scanned = 0;
    let emptyStreak = 0;
    let failures = 0;
    let first = reset;
    setProgress({ got: 0, target, round: 0, scanned: 0 });
    for (let round = 1; round <= maxRounds && got < target && !stopRef.current; round++) {
      setProgress({ got, target, round, scanned });
      const r = await fetch(ws.url("/api/portal/wishlist/recommendations"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: first }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j) {
        // Una tanda fallida (timeout) no pierde lo ya guardado: se reintenta una vez
        failures++;
        if (failures >= 2) {
          setError(j?.error ?? "La búsqueda se interrumpió. Lo encontrado quedó guardado; puedes seguir generando.");
          break;
        }
        continue;
      }
      first = false;
      failures = 0;
      if (j.applied_filters) setAppliedFilters(j.applied_filters);
      setLowFitHidden((n) => n + (j.low_fit_hidden ?? 0));
      setExistingHidden((n) => n + (j.existing_clients_hidden ?? 0));
      scanned += j.scanned ?? 0;
      const fresh = (j.cards ?? []) as Card[];
      setCards((prev) => {
        const keys = new Set(prev.map(dedupeKey));
        return [...prev, ...fresh.filter((c) => !keys.has(dedupeKey(c)))];
      });
      got += fresh.length;
      setProgress({ got, target, round, scanned });
      if (j.exhausted) {
        setExhausted(true);
        break;
      }
      emptyStreak = fresh.length ? 0 : emptyStreak + 1;
      if (emptyStreak >= 4) break;
    }
    setProgress(null);
    setStopping(false);
  }

  const generating = !!progress;
  const removeCard = (ref: string) => setCards((c) => c.filter((x) => x.ref !== ref));

  if (!loaded) return <IconLoader2 className="animate-spin text-gray-400 mx-auto mt-6" />;

  return (
    <div>
      <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-semibold flex items-center gap-2" style={{ color: "#251762" }}>
              <IconSparkles size={18} style={{ color: "#62E0D8" }} /> Recomendaciones según tu ICP
            </h2>
            <p className="text-xs text-gray-500 mt-1 max-w-xl">
              {cards.length
                ? `Tienes ${cards.length} recomendaciones por revisar. Quedan guardadas hasta que las agregues u omitas.`
                : "Analizamos tu perfil de cliente ideal y te mostramos solo empresas con fit de 60% o más, con la razón."}{" "}
              Nunca incluimos empresas de tu lista de exclusión ni las que ya estamos trabajando.
            </p>
          </div>
          {!generating && !exhausted && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-600 flex items-center gap-1.5">
                Buscar
                <select value={target} onChange={(e) => setTarget(Number(e.target.value))} className="border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-sm">
                  {AI_TARGETS.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                {cards.length ? "más" : "empresas"}
              </label>
              <button onClick={() => generate(false)} className="px-4 py-2 rounded-xl text-white text-sm font-medium" style={{ background: "#251762" }}>
                {cards.length ? "Generar más" : "Generar recomendaciones"}
              </button>
            </div>
          )}
          {!generating && exhausted && (
            <div className="text-right">
              <div className="text-xs text-gray-500 mb-1.5">Ya revisamos todas las empresas que calzan con los criterios de tu ICP.</div>
              <button onClick={() => generate(true)} className="px-4 py-2 rounded-xl text-sm border border-gray-200 bg-white">
                Buscar con nuevos criterios
              </button>
            </div>
          )}
        </div>
        {!generating && target >= 100 && !exhausted && (
          <p className="text-[11px] text-gray-400 mt-3">
            Para {target} empresas la búsqueda puede tomar varios minutos. Mantén esta pestaña abierta; puedes detenerla cuando quieras y lo encontrado queda guardado.
          </p>
        )}
        {progress && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-gray-600 mb-1.5">
              <span className="flex items-center gap-1.5">
                <IconLoader2 className="animate-spin" size={14} />
                {progress.got} de {progress.target} empresas con buen fit · tanda {progress.round}
                {progress.scanned ? ` · ${progress.scanned} analizadas` : ""}
              </span>
              <button
                onClick={() => { stopRef.current = true; setStopping(true); }}
                disabled={stopping}
                className="px-3 py-1 rounded-lg border border-gray-200 bg-white text-gray-700 disabled:opacity-50"
              >
                {stopping ? "Deteniendo…" : "Detener"}
              </button>
            </div>
            <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, (progress.got / progress.target) * 100)}%`, background: "#62E0D8" }} />
            </div>
          </div>
        )}
      </div>

      {appliedFilters && <AppliedFilters filters={appliedFilters} catalog={catalog} />}
      {cards.length > 0 && (
        <ResultsToolbar sort={sort} onSort={setSort}>
          {(lowFitHidden > 0 || existingHidden > 0) && (
            <span className="text-xs text-gray-500">
              {lowFitHidden > 0 ? `${lowFitHidden} descartadas por fit menor a 60%.` : ""}
              {existingHidden > 0 ? ` ${existingHidden} ya son tus clientes según tu ICP: las pasamos a tu Lista de exclusión.` : ""}
            </span>
          )}
        </ResultsToolbar>
      )}
      {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl mb-4">{error}</div>}
      <CardGrid cards={sortCards(cards, sort)} mode="ai" onAdded={(ref) => { removeCard(ref); onAdded(); }} />
      {!generating && cards.length === 0 && (lowFitHidden > 0 || exhausted) && !error && (
        <div className="text-sm text-gray-500 mt-4">No encontramos nuevas empresas con buen fit en esta búsqueda.</div>
      )}
      {!generating && <ManualRequest onAdded={onAdded} />}
    </div>
  );
}

function AppliedFilters({ filters, catalog }: { filters: UnifiedFilters; catalog: Catalog }) {
  const defs = FILTER_GROUPS.flatMap((g) => g.filters);
  const chips = defs.flatMap((d) => {
    const v = filters[d.key];
    const values = Array.isArray(v) ? v : typeof v === "string" && v ? [v] : [];
    return values.map((val) => ({ label: d.label, value: catalog.options[d.key]?.find((o) => o.value === val)?.label ?? val }));
  });
  if (!chips.length) return null;
  return (
    <div className="mb-4 text-xs text-gray-500 flex flex-wrap items-center gap-1.5">
      <span>Criterios usados según tu ICP:</span>
      {chips.map((c, i) => (
        <span key={i} className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-700">{c.label}: {c.value}</span>
      ))}
    </div>
  );
}

// ── Buscar empresas (filtros a la izquierda) ─────────────────────────────

function SearchTab({ catalog, onAdded }: { catalog: Catalog; onAdded: () => void }) {
  const ws = useWorkspace();
  const [filters, setFilters] = useState<UnifiedFilters>({});
  const [searched, setSearched] = useState(false);
  const s = useCompanySearch();

  const [sort, setSort] = useState<SortMode>("relevance");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scoring, setScoring] = useState<Set<string>>(new Set());

  // Calcula el fit solo de las empresas que el cliente pide (de a una o seleccionadas)
  async function revealFit(refs: string[]) {
    const list = s.cards.filter((c) => refs.includes(c.ref) && c.fit_score === undefined);
    if (!list.length) return;
    setScoring((prev) => new Set([...Array.from(prev), ...list.map((c) => c.ref)]));
    for (let i = 0; i < list.length; i += 24) {
      const chunk = list.slice(i, i + 24);
      const r = await fetch(ws.url("/api/portal/wishlist/score"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cards: chunk.map(({ ref, name, domain, facts }) => ({ ref, name, domain, facts })) }),
      });
      const j = r.ok ? await r.json().catch(() => ({})) : {};
      const scores = ((j as { scores?: Record<string, { fit_score: number; fit_reason: string; existing_client?: boolean }> }).scores ?? {});
      const refsDone = new Set(chunk.map((c) => c.ref));
      // Clientes actuales: el servidor ya los pasó a la lista de exclusión; se
      // muestran un momento con el aviso y luego salen de los resultados
      const existing = Object.entries(scores).filter(([, v]) => v.existing_client).map(([k]) => k);
      if (existing.length) setTimeout(() => s.setCards((prev) => prev.filter((c) => !existing.includes(c.ref))), 4000);
      s.setCards((prev) =>
        prev.map((c) =>
          scores[c.ref]
            ? { ...c, fit_score: scores[c.ref].fit_score, fit_reason: scores[c.ref].fit_reason, existing_client: !!scores[c.ref].existing_client }
            : refsDone.has(c.ref) && c.fit_score === undefined
              ? { ...c, fit_score: null }
              : c
        )
      );
      setScoring((prev) => {
        const n = new Set(prev);
        chunk.forEach((c) => n.delete(c.ref));
        return n;
      });
    }
    setSelected(new Set());
  }

  const toggleSelect = (ref: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(ref)) n.delete(ref);
      else n.add(ref);
      return n;
    });
  const pendingRefs = s.cards.filter((c) => c.fit_score === undefined).map((c) => c.ref);
  const allPendingSelected = pendingRefs.length > 0 && pendingRefs.every((r) => selected.has(r));

  async function search(reset: boolean) {
    setSearched(true);
    if (reset) setSelected(new Set());
    await s.run(filters, reset);
  }

  const activeCount = Object.values(filters).filter((v) => (Array.isArray(v) ? v.length : !!v)).length;

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
      <aside className="space-y-3">
        {FILTER_GROUPS.map((g) => {
          const items = g.filters.filter((f) => catalog.available.includes(f.key));
          if (!items.length) return null;
          return <FilterGroup key={g.title} title={g.title} defs={items} catalog={catalog} filters={filters} setFilters={setFilters} />;
        })}
        <div className="flex gap-2 sticky bottom-0 bg-[#F7F8FC] py-2">
          <button
            onClick={() => search(true)}
            disabled={s.loading}
            className="flex-1 py-2.5 rounded-xl text-white text-sm font-medium disabled:opacity-50"
            style={{ background: "#251762" }}
          >
            {s.loading && !s.cards.length ? "Buscando…" : "Buscar empresas"}
          </button>
          {activeCount > 0 && (
            <button onClick={() => setFilters({})} className="px-3 py-2.5 rounded-xl text-sm border border-gray-200 bg-white text-gray-600">
              Limpiar
            </button>
          )}
        </div>
      </aside>

      <section className="min-w-0">
        {!searched && (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-sm text-gray-500">
            Elige los filtros a la izquierda y presiona <strong>Buscar empresas</strong>.
          </div>
        )}
        {s.cards.length > 0 && (
          <ResultsToolbar sort={sort} onSort={setSort}>
            {pendingRefs.length > 0 && (
              <>
                <label className="flex items-center gap-1.5 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={allPendingSelected}
                    onChange={() => setSelected(allPendingSelected ? new Set() : new Set(pendingRefs))}
                  />
                  Seleccionar todas
                </label>
                <button
                  onClick={() => revealFit(Array.from(selected))}
                  disabled={!selected.size}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-white disabled:opacity-40"
                  style={{ background: "#251762" }}
                >
                  <IconSparkles size={13} /> Calcular fit{selected.size ? ` (${selected.size})` : ""}
                </button>
              </>
            )}
          </ResultsToolbar>
        )}
        {s.error && <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl mb-4">{s.error}</div>}
        <CardGrid
          cards={sortCards(s.cards, sort)}
          mode="manual"
          onAdded={(ref) => { s.removeCard(ref); setSelected((p) => { const n = new Set(p); n.delete(ref); return n; }); onAdded(); }}
          fitControls={{ selected, scoring, onToggle: toggleSelect, onReveal: (ref) => revealFit([ref]) }}
        />
        {s.loading && <IconLoader2 className="animate-spin text-gray-400 mx-auto mt-6" />}
        {searched && !s.loading && s.cards.length === 0 && !s.error && (
          <div className="text-sm text-gray-500 bg-white rounded-2xl border border-gray-100 p-6">
            No encontramos empresas nuevas con esos filtros. Prueba ampliarlos o solicita una empresa puntual abajo.
          </div>
        )}
        {searched && !s.loading && s.needsFilters && (
          <div className="text-sm text-gray-500 mt-4">Agrega al menos un filtro para ver más empresas.</div>
        )}
        {s.hasMore && !s.loading && (
          <div className="mt-6 text-center">
            <button onClick={() => search(false)} className="px-4 py-2 rounded-xl text-sm border border-gray-200 bg-white">Ver más empresas</button>
          </div>
        )}
        {searched && !s.loading && <ManualRequest onAdded={onAdded} />}
      </section>
    </div>
  );
}

function FilterGroup({
  title,
  defs,
  catalog,
  filters,
  setFilters,
}: {
  title: string;
  defs: UnifiedFilterDef[];
  catalog: Catalog;
  filters: UnifiedFilters;
  setFilters: React.Dispatch<React.SetStateAction<UnifiedFilters>>;
}) {
  const used = defs.filter((d) => {
    const v = filters[d.key];
    return Array.isArray(v) ? v.length > 0 : !!v;
  }).length;
  const [open, setOpen] = useState(title === "Información de la empresa" || title === "Ubicación" || title === "Tamaño y finanzas");

  return (
    <div className="bg-white rounded-2xl border border-gray-100">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold" style={{ color: "#251762" }}>
        <span>{title}{used ? <span className="ml-2 text-[10px] rounded-full bg-[#251762] text-white px-1.5 py-0.5">{used}</span> : null}</span>
        <IconChevronDown size={16} className={`transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-gray-100 divide-y divide-gray-50">
          {defs.map((d) => (
            <FilterRow
              key={d.key}
              def={d}
              options={catalog.options[d.key] ?? []}
              value={filters[d.key]}
              onChange={(v) => setFilters((f) => ({ ...f, [d.key]: v }))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterRow({
  def,
  options,
  value,
  onChange,
}: {
  def: UnifiedFilterDef;
  options: Option[];
  value: string | string[] | undefined;
  onChange: (v: string | string[]) => void;
}) {
  const list = Array.isArray(value) ? value : [];
  const text = typeof value === "string" ? value : "";
  const active = def.control === "text" || def.control === "longtext" ? !!text : list.length > 0;
  const [open, setOpen] = useState(active);
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;

  return (
    <div className="px-4 py-2.5">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between text-[13px] text-gray-700">
        <span className={active ? "font-medium text-[#251762]" : ""}>{def.label}</span>
        {open ? <IconX size={14} className="text-gray-400" /> : <IconPlus size={14} className="text-gray-400" />}
      </button>
      {!open && list.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {list.map((v) => <span key={v} className="text-[11px] rounded-full bg-[#251762] text-white px-2 py-0.5">{labelOf(v)}</span>)}
        </div>
      )}
      {open && (
        <div className="mt-2">
          {def.control === "text" && (
            <input value={text} onChange={(e) => onChange(e.target.value)} placeholder={def.hint} className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-[#62E0D8]" />
          )}
          {def.control === "longtext" && (
            <textarea value={text} onChange={(e) => onChange(e.target.value)} placeholder={def.hint} rows={3} className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-[#62E0D8]" />
          )}
          {def.control === "tags" && <TagInput values={list} onChange={onChange} placeholder={def.hint ?? "Escribe y presiona Enter"} />}
          {def.control === "select" && <OptionPicker options={options} selected={list} onChange={onChange} />}
        </div>
      )}
    </div>
  );
}

function TagInput({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const parts = draft.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length) onChange(Array.from(new Set([...values, ...parts])));
    setDraft("");
  };
  return (
    <div>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        onBlur={add}
        placeholder={placeholder}
        className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-[#62E0D8]"
      />
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {values.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 text-[11px] rounded-full bg-[#251762] text-white px-2 py-0.5">
              {v}<button onClick={() => onChange(values.filter((x) => x !== v))}><IconX size={11} /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function OptionPicker({ options, selected, onChange }: { options: Option[]; selected: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState("");
  const shown = useMemo(
    () => options.filter((o) => !selected.includes(o.value) && o.label.toLowerCase().includes(q.toLowerCase())).slice(0, 60),
    [options, selected, q]
  );
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  return (
    <div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {selected.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 text-[11px] rounded-full bg-[#251762] text-white px-2 py-0.5">
              {labelOf(v)}<button onClick={() => onChange(selected.filter((x) => x !== v))}><IconX size={11} /></button>
            </span>
          ))}
        </div>
      )}
      {options.length > 8 && (
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm mb-1.5 outline-none focus:border-[#62E0D8]" />
      )}
      <div className="max-h-44 overflow-y-auto flex flex-col">
        {shown.map((o) => (
          <button key={o.value} onClick={() => onChange([...selected, o.value])} className="text-left text-[12px] text-gray-700 px-2 py-1 rounded hover:bg-gray-50">
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Solicitar una empresa que no apareció ────────────────────────────────

function ManualRequest({ onAdded }: { onAdded: () => void }) {
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", website: "", linkedin_url: "", comment: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await fetch(ws.url("/api/portal/wishlist"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manual: form }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: j.error ?? "No se pudo enviar" });
    setMsg({ ok: true, text: ws.operator ? `“${form.name}” quedó propuesta al cliente.` : `“${form.name}” quedó en tu wishlist.` });
    setForm({ name: "", website: "", linkedin_url: "", comment: "" });
    onAdded();
  }

  return (
    <div className="mt-8 bg-white rounded-2xl border border-dashed border-gray-200 p-5">
      {!open ? (
        <button onClick={() => setOpen(true)} className="flex items-center gap-2 text-sm text-[#251762]">
          <IconBuildingPlus size={18} /> ¿No encuentras una empresa? <span className="underline">{ws.operator ? "Propónla a mano" : "Solicítala aquí"}</span>
        </button>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div className="text-sm font-medium" style={{ color: "#251762" }}>Solicitar una empresa</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nombre de la empresa *" className="border border-gray-200 rounded-xl px-3 py-2 text-sm" />
            <input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="Sitio web (ej: empresa.cl)" className="border border-gray-200 rounded-xl px-3 py-2 text-sm" />
            <input value={form.linkedin_url} onChange={(e) => setForm({ ...form, linkedin_url: e.target.value })} placeholder="LinkedIn de la empresa" className="border border-gray-200 rounded-xl px-3 py-2 text-sm" />
          </div>
          <textarea value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} rows={2} placeholder="Comentario para el equipo (opcional): por qué te interesa, a quién apuntar…" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
          <div className="flex items-center gap-3">
            <button disabled={busy} className="px-4 py-2 rounded-xl text-white text-sm disabled:opacity-50" style={{ background: "#251762" }}>
              {busy ? "Enviando…" : ws.operator ? "Proponer al cliente" : "Agregar a mi wishlist"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-500">Cancelar</button>
            <span className="text-xs text-gray-400">Necesitamos el sitio web o el LinkedIn.</span>
          </div>
          {msg && <div className={`text-sm ${msg.ok ? "text-green-700" : "text-red-600"}`}>{msg.text}</div>}
        </form>
      )}
    </div>
  );
}

// ── Orden de resultados ──────────────────────────────────────────────────

type SortMode = "relevance" | "fit";

// "Mayor fit": de mayor a menor; las que aún no tienen fit van al final
function sortCards(cards: Card[], sort: SortMode): Card[] {
  if (sort === "relevance") return cards;
  return [...cards].sort((a, b) => (b.fit_score ?? -1) - (a.fit_score ?? -1));
}

function ResultsToolbar({ sort, onSort, children }: { sort: SortMode; onSort: (s: SortMode) => void; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div className="flex flex-wrap items-center gap-3">{children}</div>
      <label className="flex items-center gap-2 text-xs text-gray-600">
        Ordenar por
        <select value={sort} onChange={(e) => onSort(e.target.value as SortMode)} className="border border-gray-200 rounded-lg px-2 py-1 bg-white text-xs">
          <option value="relevance">Relevancia</option>
          <option value="fit">Mayor fit</option>
        </select>
      </label>
    </div>
  );
}

// ── Tarjetas de empresa ──────────────────────────────────────────────────

type FitControls = {
  selected: Set<string>;
  scoring: Set<string>;
  onToggle: (ref: string) => void;
  onReveal: (ref: string) => void;
};

function fitStyle(score: number) {
  if (score >= 80) return { bg: "rgba(34,197,94,0.12)", fg: "#15803d", label: "Fit alto" };
  if (score >= 60) return { bg: "rgba(98,224,216,0.18)", fg: "#0f766e", label: "Fit probable" };
  if (score >= 40) return { bg: "rgba(245,158,11,0.14)", fg: "#b45309", label: "Fit dudoso" };
  return { bg: "rgba(239,68,68,0.10)", fg: "#b91c1c", label: "Bajo fit" };
}

function CardGrid({ cards, mode, onAdded, fitControls }: { cards: Card[]; mode: "manual" | "ai"; onAdded: (ref: string) => void; fitControls?: FitControls }) {
  if (!cards.length) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((c) => <CompanyCard key={c.ref} card={c} mode={mode} onAdded={onAdded} fitControls={fitControls} />)}
    </div>
  );
}

function CompanyCard({ card, mode, onAdded, fitControls }: { card: Card; mode: "manual" | "ai"; onAdded: (ref: string) => void; fitControls?: FitControls }) {
  const ws = useWorkspace();
  const [adding, setAdding] = useState(false);
  const [omitting, setOmitting] = useState(false);
  const [done, setDone] = useState<"added" | "omitted" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  async function add() {
    setAdding(true);
    setError(null);
    const r = await fetch(ws.url("/api/portal/wishlist"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: card.ref, mode, card: { name: card.name, domain: card.domain, linkedin_url: card.linkedin_url, facts: card.facts } }),
    });
    const j = await r.json().catch(() => ({}));
    setAdding(false);
    if (!r.ok) return setError(j.error ?? "No se pudo agregar");
    setDone("added");
    // La tarjeta desaparece de los resultados después de confirmar
    setTimeout(() => onAdded(card.ref), 700);
  }

  // Omitir: no vuelve a aparecer (se puede restaurar en "Empresas omitidas")
  async function omit() {
    setOmitting(true);
    setError(null);
    const r = await fetch(ws.url("/api/portal/omitted"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: card.ref,
        card: { name: card.name, domain: card.domain, linkedin_url: card.linkedin_url, facts: card.facts },
        fit_score: card.fit_score ?? undefined,
        fit_reason: card.fit_reason ?? undefined,
      }),
    });
    const j = await r.json().catch(() => ({}));
    setOmitting(false);
    if (!r.ok) return setError(j.error ?? "No se pudo omitir");
    setDone("omitted");
    setTimeout(() => onAdded(card.ref), 400);
  }

  const facts = expanded ? card.facts : card.facts.slice(0, 4);
  const fit = card.fit_score != null ? fitStyle(card.fit_score) : null;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 flex flex-col">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex gap-2">
          {fitControls && card.fit_score === undefined && !fitControls.scoring.has(card.ref) && (
            <input
              type="checkbox"
              className="mt-1 shrink-0"
              title="Seleccionar para calcular fit"
              checked={fitControls.selected.has(card.ref)}
              onChange={() => fitControls.onToggle(card.ref)}
            />
          )}
          <div className="min-w-0">
          <h3 className="font-semibold text-[15px] truncate" style={{ color: "#251762" }}>{card.name}</h3>
          <div className="flex flex-wrap gap-x-2 text-xs text-gray-500">
            {card.domain && (
              <a href={`https://${card.domain}`} target="_blank" rel="noreferrer" className="hover:text-[#251762] inline-flex items-center gap-1">
                {card.domain} <IconExternalLink size={11} />
              </a>
            )}
            {card.linkedin_url && <a href={card.linkedin_url} target="_blank" rel="noreferrer" className="hover:text-[#251762]">LinkedIn</a>}
          </div>
          </div>
        </div>
        {fit ? (
          <div className="text-right shrink-0 rounded-xl px-2.5 py-1" style={{ background: fit.bg, color: fit.fg }}>
            <div className="text-lg font-bold leading-tight">{card.fit_score}%</div>
            <div className="text-[10px] font-medium">{fit.label}</div>
          </div>
        ) : card.fit_score === undefined && fitControls && !fitControls.scoring.has(card.ref) ? (
          <button
            onClick={() => fitControls.onReveal(card.ref)}
            className="shrink-0 flex items-center gap-1 text-[11px] font-medium rounded-lg px-2 py-1 border border-[#62E0D8] text-[#0f766e] hover:bg-[rgba(98,224,216,0.12)]"
          >
            <IconSparkles size={12} /> Ver fit
          </button>
        ) : card.fit_score === undefined ? (
          <div className="text-[11px] text-gray-400 flex items-center gap-1 shrink-0"><IconLoader2 size={12} className="animate-spin" /> fit…</div>
        ) : (
          <div className="text-[10px] text-gray-400 shrink-0 max-w-[90px] text-right">Sin datos para evaluar</div>
        )}
      </div>

      {card.existing_client && (
        <div className="text-xs rounded-lg bg-amber-50 text-amber-800 px-2.5 py-1.5 mb-2">
          Ya es tu cliente según tu ICP: la pasamos a tu Lista de exclusión.
        </div>
      )}
      {card.fit_reason && <p className="text-[13px] text-gray-700 leading-relaxed mb-3">{card.fit_reason}</p>}

      <dl className="text-xs space-y-1 mb-3">
        {facts.map((f) => (
          <div key={f.label} className="flex gap-2">
            <dt className="text-gray-400 shrink-0 w-24 truncate">{f.label}</dt>
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
        <div className="flex gap-2">
          <button
            onClick={add}
            disabled={adding || omitting || !!done}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-70"
            style={{ background: done === "added" ? "#16a34a" : "#251762" }}
          >
            {done === "added"
              ? <><IconCheck size={15} /> {ws.operator ? "Propuesta" : "Agregada"}</>
              : adding
                ? <IconLoader2 size={15} className="animate-spin" />
                : ws.operator ? <><IconSend size={15} /> Proponer al cliente</> : <><IconPlus size={15} /> Agregar a wishlist</>}
          </button>
          <button
            onClick={omit}
            disabled={adding || omitting || !!done}
            title={ws.operator ? "Descartar: no se propone y no vuelve a aparecer para este cliente" : "No me interesa: no volverá a aparecer"}
            className="flex items-center justify-center gap-1 px-3 py-2 rounded-xl text-sm border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-60"
          >
            {done === "omitted" ? (ws.operator ? "Descartada" : "Omitida") : omitting ? <IconLoader2 size={15} className="animate-spin" /> : <><IconEyeOff size={15} /> {ws.operator ? "Descartar" : "Omitir"}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Propuestas de BullsEye ───────────────────────────────────────────────

function ProposalsTab({ items, onChange }: { items: WishlistItem[]; onChange: () => void }) {
  const ws = useWorkspace();
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(i: WishlistItem, action: "approve" | "reject") {
    let reason: string | null = null;
    if (action === "reject") {
      reason = window.prompt(`¿Por qué no te interesa ${i.company_name}? (opcional)`, "");
      if (reason === null) return;
    }
    setBusy(i.id);
    const r = await fetch(ws.url(`/api/portal/wishlist/${i.id}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, reason }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) alert(j.error ?? "No se pudo guardar");
    onChange();
  }

  if (!items.length) {
    return (
      <div className="text-sm text-gray-500 bg-gray-50 rounded-xl px-4 py-3">
        {ws.operator ? "No hay empresas esperando la aprobación del cliente. Propón desde Recomendadas por IA o Buscar empresas." : "No tienes propuestas pendientes."}
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">
        {ws.operator
          ? "Empresas que propusiste y que el cliente todavía no aprueba en su portal. Al aprobarlas se crean en su Lemlist y la IA busca sus contactos."
          : "El equipo de BullsEye encontró estas empresas para ti. Apruébalas para que las prospectemos o recházalas si no te interesan."}
      </p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((i) => {
          const fit = i.fit_score != null ? fitStyle(i.fit_score) : null;
          return (
            <div key={i.id} className="bg-white rounded-2xl border border-gray-100 p-5 flex flex-col">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <h3 className="font-semibold text-[15px] truncate" style={{ color: "#251762" }}>{i.company_name}</h3>
                  {i.domain && (
                    <a href={`https://${i.domain}`} target="_blank" rel="noreferrer" className="text-xs text-gray-500 hover:text-[#251762] inline-flex items-center gap-1">
                      {i.domain} <IconExternalLink size={11} />
                    </a>
                  )}
                </div>
                {fit && (
                  <div className="text-right shrink-0 rounded-xl px-2.5 py-1" style={{ background: fit.bg, color: fit.fg }}>
                    <div className="text-lg font-bold leading-tight">{i.fit_score}%</div>
                    <div className="text-[10px] font-medium">{fit.label}</div>
                  </div>
                )}
              </div>
              {i.fit_reason && <p className="text-[13px] text-gray-700 leading-relaxed mb-3">{i.fit_reason}</p>}
              <dl className="text-xs space-y-1 mb-3">
                {(i.snapshot?.facts ?? []).slice(0, 4).map((f) => (
                  <div key={f.label} className="flex gap-2">
                    <dt className="text-gray-400 shrink-0 w-24 truncate">{f.label}</dt>
                    <dd className="text-gray-700 line-clamp-2">{f.value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-auto">
                {ws.operator ? (
                  <div className="text-xs text-gray-500">
                    Propuesta el {new Date(i.created_at).toLocaleDateString("es-CL")}{i.requested_by_email ? ` por ${i.requested_by_email}` : ""}
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => decide(i, "approve")}
                      disabled={busy === i.id}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-60"
                      style={{ background: "#251762" }}
                    >
                      {busy === i.id ? <IconLoader2 size={15} className="animate-spin" /> : <><IconCheck size={15} /> Aprobar</>}
                    </button>
                    <button
                      onClick={() => decide(i, "reject")}
                      disabled={busy === i.id}
                      className="flex items-center justify-center gap-1 px-3 py-2 rounded-xl text-sm border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-60"
                    >
                      <IconX size={15} /> Rechazar
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RejectedTab({ items }: { items: WishlistItem[] }) {
  if (!items.length) return <div className="text-sm text-gray-500 bg-gray-50 rounded-xl px-4 py-3">El cliente no ha rechazado propuestas.</div>;
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-gray-500 border-b border-gray-100">
          <tr><th className="p-3">Empresa</th><th className="p-3">Fit</th><th className="p-3">Motivo del cliente</th><th className="p-3">Propuesta</th></tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="border-b border-gray-50 last:border-0 align-top">
              <td className="p-3">
                <div className="font-medium" style={{ color: "#251762" }}>{i.company_name}</div>
                <div className="text-xs text-gray-500">{i.domain ?? "—"}</div>
              </td>
              <td className="p-3">{i.fit_score != null ? `${i.fit_score}%` : "—"}</td>
              <td className="p-3 text-xs text-gray-600 max-w-sm">{i.client_reject_reason || "Sin motivo"}</td>
              <td className="p-3 text-xs text-gray-500 whitespace-nowrap">
                {new Date(i.created_at).toLocaleDateString("es-CL")}
                {i.requested_by_email ? <div>{i.requested_by_email}</div> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Mi wishlist ──────────────────────────────────────────────────────────

function WishlistTab({ items, onChange }: { items: WishlistItem[]; onChange: () => void }) {
  const ws = useWorkspace();
  async function remove(id: string) {
    if (!confirm("¿Quitar esta empresa de tu wishlist?")) return;
    const r = await fetch(ws.url(`/api/portal/wishlist/${id}`), { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) alert(j.error ?? "No se pudo quitar");
    onChange();
  }

  if (!items.length) {
    return <div className="text-sm text-gray-500 bg-gray-50 rounded-xl px-4 py-3">Aún no agregas empresas. Usa las recomendaciones o la búsqueda.</div>;
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-gray-500 border-b border-gray-100">
          <tr><th className="p-3">Empresa</th><th className="p-3">Fit</th><th className="p-3">Estado</th><th className="p-3">Agregada</th><th className="p-3"></th></tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="border-b border-gray-50 last:border-0 align-top">
              <td className="p-3">
                <div className="font-medium" style={{ color: "#251762" }}>{i.company_name}</div>
                <div className="text-xs text-gray-500">{i.domain ?? "—"}{i.mode === "ai" ? " · recomendada por IA" : ""}</div>
              </td>
              <td className="p-3 max-w-xs">
                {i.fit_score != null ? (
                  <>
                    <div className="font-semibold">{i.fit_score}%</div>
                    {i.fit_reason && <div className="text-xs text-gray-500 line-clamp-2">{i.fit_reason}</div>}
                  </>
                ) : "—"}
              </td>
              <td className="p-3"><span className={`text-xs rounded px-2 py-0.5 ${STATUS_LABEL[i.status].cls}`}>{STATUS_LABEL[i.status].text}</span></td>
              <td className="p-3 text-xs text-gray-500 whitespace-nowrap">
                {new Date(i.created_at).toLocaleDateString("es-CL")}
                {i.requested_by_email ? <div>{i.requested_by_email}</div> : null}
              </td>
              <td className="p-3 text-right">
                {(i.status === "new" || i.status === "in_lemlist") && (
                  <button onClick={() => remove(i.id)} className="text-gray-400 hover:text-red-600" title="Quitar"><IconTrash size={16} /></button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Empresas trabajadas ──────────────────────────────────────────────────

type WorkedItem = { name: string; website: string | null; country: string | null; since: string | null; status: string };

function WorkedTab() {
  const ws = useWorkspace();
  const [items, setItems] = useState<WorkedItem[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(ws.url("/api/portal/worked"), { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) setError(j.error ?? "Error al cargar");
        else setItems(j.items);
      })
      .catch(() => setError("Error al cargar"));
  }, []);

  const shown = (items ?? []).filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase()) || (i.website ?? "").includes(q.toLowerCase()));

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">Empresas que el equipo de BullsEye ya está prospectando para ustedes. No vuelven a aparecer en las búsquedas.</p>
      {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl mb-4">{error}</div>}
      {!items && !error && <IconLoader2 className="animate-spin text-gray-400" />}
      {items && (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Buscar entre ${items.length.toLocaleString("es-CL")} empresas…`} className="w-full sm:w-80 border border-gray-200 rounded-xl px-3 py-2 text-sm mb-3 bg-white" />
          {items.length === 0 ? (
            <div className="text-sm text-gray-500 bg-gray-50 rounded-xl px-4 py-3">Todavía no hay empresas en prospección.</div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-gray-500 border-b border-gray-100">
                  <tr><th className="p-3">Empresa</th><th className="p-3">País</th><th className="p-3">Estado</th><th className="p-3">Desde</th></tr>
                </thead>
                <tbody>
                  {shown.slice(0, 500).map((i, idx) => (
                    <tr key={idx} className="border-b border-gray-50 last:border-0">
                      <td className="p-3">
                        <div className="font-medium" style={{ color: "#251762" }}>{i.name}</div>
                        {i.website && <div className="text-xs text-gray-500">{i.website}</div>}
                      </td>
                      <td className="p-3 text-xs text-gray-600">{i.country ?? "—"}</td>
                      <td className="p-3 text-xs">{i.status}</td>
                      <td className="p-3 text-xs text-gray-500">{i.since ? new Date(i.since).toLocaleDateString("es-CL") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shown.length > 500 && <div className="p-3 text-xs text-gray-400">Mostrando 500 de {shown.length.toLocaleString("es-CL")}. Usa el buscador.</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Empresas omitidas ────────────────────────────────────────────────────

type OmittedItem = { id: string; company_name: string; domain: string | null; linkedin_url: string | null; fit_score: number | null; fit_reason: string | null; omitted_by_email: string | null; created_at: string };

function OmittedTab() {
  const ws = useWorkspace();
  const [items, setItems] = useState<OmittedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch(ws.url("/api/portal/omitted"), { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) setError(j.error ?? "Error al cargar");
        else setItems(j.items);
      })
      .catch(() => setError("Error al cargar"));
  }, []);

  async function restore(id: string) {
    const r = await fetch(ws.url(`/api/portal/omitted/${id}`), { method: "DELETE" });
    if (r.ok) setItems((list) => (list ?? []).filter((i) => i.id !== id));
  }

  const shown = (items ?? []).filter((i) => !q || i.company_name.toLowerCase().includes(q.toLowerCase()) || (i.domain ?? "").includes(q.toLowerCase()));

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">
        Empresas que marcaste como “Omitir” en los resultados. No vuelven a aparecer en búsquedas ni recomendaciones.
        Si cambias de opinión, restáuralas.
      </p>
      {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl mb-4">{error}</div>}
      {!items && !error && <IconLoader2 className="animate-spin text-gray-400" />}
      {items && items.length === 0 && <div className="text-sm text-gray-500 bg-gray-50 rounded-xl px-4 py-3">No has omitido empresas.</div>}
      {items && items.length > 0 && (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Buscar entre ${items.length.toLocaleString("es-CL")} empresas…`} className="w-full sm:w-80 border border-gray-200 rounded-xl px-3 py-2 text-sm mb-3 bg-white" />
          <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500 border-b border-gray-100">
                <tr><th className="p-3">Empresa</th><th className="p-3">Fit</th><th className="p-3">Omitida</th><th className="p-3"></th></tr>
              </thead>
              <tbody>
                {shown.slice(0, 500).map((i) => (
                  <tr key={i.id} className="border-b border-gray-50 last:border-0 align-top">
                    <td className="p-3">
                      <div className="font-medium" style={{ color: "#251762" }}>{i.company_name}</div>
                      {i.domain && <div className="text-xs text-gray-500">{i.domain}</div>}
                    </td>
                    <td className="p-3 max-w-xs">
                      {i.fit_score != null ? <div className="font-semibold">{i.fit_score}%</div> : "—"}
                      {i.fit_reason && <div className="text-xs text-gray-500 line-clamp-2">{i.fit_reason}</div>}
                    </td>
                    <td className="p-3 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(i.created_at).toLocaleDateString("es-CL")}
                      {i.omitted_by_email ? <div>{i.omitted_by_email}</div> : null}
                    </td>
                    <td className="p-3 text-right">
                      <button onClick={() => restore(i.id)} className="inline-flex items-center gap-1 text-xs text-[#251762] hover:underline">
                        <IconArrowBackUp size={14} /> Restaurar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length > 500 && <div className="p-3 text-xs text-gray-400">Mostrando 500 de {shown.length.toLocaleString("es-CL")}. Usa el buscador.</div>}
          </div>
        </>
      )}
    </div>
  );
}

// ── Lista de exclusión ───────────────────────────────────────────────────

type ExclusionItem = { id: string; kind: "company" | "keyword"; company_name: string | null; domain: string | null; keyword: string | null; reason: string | null; created_by_email: string | null; created_at: string };

const NAME_HEADERS = /^(empresa|empresas|nombre|razon social|razón social|company|company name|cliente|cuenta|account)$/i;
const DOMAIN_HEADERS = /^(dominio|domain|web|website|sitio|sitio web|url|pagina web|página web)$/i;

// Lee un Excel/CSV y devuelve [{ name, domain }] detectando las columnas
async function parseExclusionFile(file: File): Promise<{ name: string | null; domain: string | null }[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false }) as unknown[][];
  if (!rows.length) return [];
  const header = rows[0].map((h) => String(h ?? "").trim());
  let nameCol = header.findIndex((h) => NAME_HEADERS.test(h));
  let domainCol = header.findIndex((h) => DOMAIN_HEADERS.test(h));
  const hasHeader = nameCol >= 0 || domainCol >= 0;
  if (!hasHeader) {
    // Sin encabezados: la primera columna es el nombre; si parece dominio, va como dominio
    nameCol = 0;
    domainCol = -1;
  }
  const looksLikeDomain = (v: string) => /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(v.replace(/^https?:\/\//, "").replace(/^www\./, ""));
  return rows.slice(hasHeader ? 1 : 0).map((r) => {
    const name = nameCol >= 0 ? String(r[nameCol] ?? "").trim() : "";
    const domain = domainCol >= 0 ? String(r[domainCol] ?? "").trim() : "";
    if (!domain && name && looksLikeDomain(name) && !name.includes(" ")) return { name: null, domain: name };
    return { name: name || null, domain: domain || null };
  }).filter((r) => r.name || r.domain);
}

function ExclusionsTab() {
  const ws = useWorkspace();
  const [items, setItems] = useState<ExclusionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("Ya es cliente");
  const [keyword, setKeyword] = useState("");
  const [company, setCompany] = useState({ name: "", domain: "" });
  const [q, setQ] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await fetch(ws.url("/api/portal/exclusions"), { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setError(j.error ?? "Error al cargar");
    setItems(j.items);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function send(payload: { companies?: { name: string | null; domain: string | null }[]; keywords?: string[] }) {
    setBusy(true);
    setError(null);
    setMsg(null);
    const r = await fetch(ws.url("/api/portal/exclusions"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, reason }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setError(j.error ?? "No se pudo guardar");
    setMsg(j.added ? `${j.added} elemento${j.added > 1 ? "s" : ""} agregado${j.added > 1 ? "s" : ""} a la lista.` : "No había elementos nuevos (ya estaban en la lista).");
    load();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const companies = await parseExclusionFile(file);
      if (!companies.length) return setError("No encontramos empresas en el archivo. Usa una columna “Empresa” y/o “Dominio”.");
      if (companies.length > 5000) return setError("El archivo tiene más de 5.000 filas. Divídelo en partes.");
      await send({ companies });
    } catch {
      setError("No pudimos leer el archivo. Sube un Excel (.xlsx) o CSV.");
    }
  }

  async function remove(id: string) {
    const r = await fetch(ws.url(`/api/portal/exclusions/${id}`), { method: "DELETE" });
    if (r.ok) setItems((list) => (list ?? []).filter((i) => i.id !== id));
  }

  const shown = (items ?? []).filter((i) => {
    if (!q) return true;
    const t = `${i.company_name ?? ""} ${i.domain ?? ""} ${i.keyword ?? ""}`.toLowerCase();
    return t.includes(q.toLowerCase());
  });

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500 max-w-3xl">
        Empresas que no quieres que prospectemos: tus clientes actuales, cuentas que ya trabaja otra persona, etc.
        Nunca aparecerán en las búsquedas ni en las recomendaciones, y el equipo de BullsEye también las omite.
      </p>

      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <label className="block text-sm">
          <span className="text-xs text-gray-500">Motivo (se aplica a lo que agregues)</span>
          <select value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 block border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white">
            <option>Ya es cliente</option>
            <option>La trabaja otra persona o proveedor</option>
            <option>No es de interés</option>
            <option>Otro</option>
          </select>
        </label>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="border border-gray-100 rounded-xl p-4">
            <div className="text-sm font-medium mb-1" style={{ color: "#251762" }}>Subir Excel o CSV</div>
            <p className="text-xs text-gray-500 mb-3">Una columna “Empresa” y/o “Dominio”. Máximo 5.000 filas.</p>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="hidden" />
            <button onClick={() => fileRef.current?.click()} disabled={busy} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm text-white disabled:opacity-50" style={{ background: "#251762" }}>
              {busy ? <IconLoader2 size={15} className="animate-spin" /> : <IconUpload size={15} />} Elegir archivo
            </button>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); if (company.name || company.domain) { send({ companies: [{ name: company.name || null, domain: company.domain || null }] }); setCompany({ name: "", domain: "" }); } }} className="border border-gray-100 rounded-xl p-4 space-y-2">
            <div className="text-sm font-medium" style={{ color: "#251762" }}>Agregar una empresa</div>
            <input value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} placeholder="Nombre" className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm" />
            <input value={company.domain} onChange={(e) => setCompany({ ...company, domain: e.target.value })} placeholder="Sitio web (opcional)" className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm" />
            <button disabled={busy} className="px-3 py-1.5 rounded-lg text-sm border border-gray-200">Agregar</button>
          </form>

          <form onSubmit={(e) => { e.preventDefault(); if (keyword.trim()) { send({ keywords: keyword.split(",").map((k) => k.trim()).filter(Boolean) }); setKeyword(""); } }} className="border border-gray-100 rounded-xl p-4 space-y-2">
            <div className="text-sm font-medium" style={{ color: "#251762" }}>Palabras clave</div>
            <p className="text-xs text-gray-500">Excluye toda empresa cuyo nombre contenga la palabra (ej: “banco”, “municipalidad”).</p>
            <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Separa varias con coma" className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm" />
            <button disabled={busy} className="px-3 py-1.5 rounded-lg text-sm border border-gray-200">Agregar</button>
          </form>
        </div>
        {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl">{error}</div>}
        {msg && <div className="bg-green-50 text-green-700 text-sm px-4 py-3 rounded-xl">{msg}</div>}
      </div>

      {!items && !error && <IconLoader2 className="animate-spin text-gray-400" />}
      {items && items.length > 0 && (
        <div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Buscar en ${items.length.toLocaleString("es-CL")} exclusiones…`} className="w-full sm:w-80 border border-gray-200 rounded-xl px-3 py-2 text-sm mb-3 bg-white" />
          <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500 border-b border-gray-100">
                <tr><th className="p-3">Excluye</th><th className="p-3">Motivo</th><th className="p-3">Agregado</th><th className="p-3"></th></tr>
              </thead>
              <tbody>
                {shown.slice(0, 500).map((i) => (
                  <tr key={i.id} className="border-b border-gray-50 last:border-0">
                    <td className="p-3">
                      {i.kind === "keyword" ? (
                        <span>Nombre contiene <strong>“{i.keyword}”</strong></span>
                      ) : (
                        <>
                          <div className="font-medium" style={{ color: "#251762" }}>{i.company_name ?? i.domain}</div>
                          {i.company_name && i.domain && <div className="text-xs text-gray-500">{i.domain}</div>}
                        </>
                      )}
                    </td>
                    <td className="p-3 text-xs text-gray-600">{i.reason ?? "—"}</td>
                    <td className="p-3 text-xs text-gray-500">{new Date(i.created_at).toLocaleDateString("es-CL")}{i.created_by_email ? ` · ${i.created_by_email}` : ""}</td>
                    <td className="p-3 text-right"><button onClick={() => remove(i.id)} className="text-gray-400 hover:text-red-600" title="Quitar"><IconTrash size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length > 500 && <div className="p-3 text-xs text-gray-400">Mostrando 500 de {shown.length.toLocaleString("es-CL")}. Usa el buscador.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
