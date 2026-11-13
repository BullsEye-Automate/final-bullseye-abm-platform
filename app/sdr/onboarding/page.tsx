"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconAlertTriangle,
  IconArchive,
  IconArrowLeft,
  IconCalendar,
  IconLoader2,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconRoad,
  IconSettings,
  IconUsersGroup,
} from "@tabler/icons-react";
import { injectOnboarding } from "@/lib/onboardingSdr/bridge";

// Onboarding SDR (90 días): la ruta por semanas de cada SDR nuevo, con el
// diseño original (content/onboarding-sdr/onboarding.html) en un iframe
// aislado. El avance vive en la base (sdr_onboardings), así el SDR, su líder,
// RRHH y la habilitadora ven lo mismo desde cualquier computador. Ver
// CLAUDE.md → "Onboarding SDR".

type Viewer = { email: string; editorRoles: string[]; admin: boolean; editor: boolean };
type TeamRow = {
  id: string;
  email: string;
  name: string | null;
  leader: string | null;
  ingreso: string | null;
  clientes: string[];
  active: boolean;
  ok: number;
  total: number;
  espera: number;
  late: number;
  superadas: number;
  stages: number;
  day: number | null;
  current: number;
};
type Home = { viewer: Viewer; mine: { id: string; active: boolean } | null; suggestedIngreso: string | null; team?: TeamRow[]; leaders?: string[]; catalog: { id: string; n: string }[] };
type Detail = { onb: any; meta: { id: string; email: string; name: string | null; leader: string | null; active: boolean } };
type Roles = { lider: string[]; rrhh: string[]; hab: string[]; admin: string[] };

const STAGE_NAMES = ["Antes de entrar", "Semana 1 · Inducción", "Semana 1 · Capacitación", "Semana 2", "Mes 1", "Mes 2", "Mes 3"];

function nextMonday(): string {
  const d = new Date();
  do d.setDate(d.getDate() + 1);
  while (d.getDay() !== 1);
  return d.toISOString().slice(0, 10);
}
const fmtDay = (iso: string | null) =>
  iso ? new Date(iso + "T12:00:00").toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "numeric" }) : "—";

export default function OnboardingSdrPage() {
  const [home, setHome] = useState<Home | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"ruta" | "equipo" | "configurar">("ruta");
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [html, setHtml] = useState("");
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const loadHome = useCallback(async (archived = showArchived) => {
    try {
      const r = await fetch(`/api/onboarding-sdr${archived ? "?archived=1" : ""}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "No se pudo cargar el onboarding");
      setHome(d);
      return d as Home;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, [showArchived]);

  // Primera carga: el SDR abre su ruta; las editoras, el equipo. ?id= abre uno.
  useEffect(() => {
    void (async () => {
      const [d] = await Promise.all([loadHome(false), fetch("/api/onboarding-sdr/html").then((r) => r.text()).then(setHtml)]);
      if (!d) return;
      const id = new URLSearchParams(window.location.search).get("id");
      if (id) setOpenId(id);
      else if (d.viewer.editor) setView("equipo");
      else if (d.mine) setOpenId(d.mine.id);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadDetail = useCallback(async (id: string, fresh = false) => {
    setLoadingDetail(true);
    setError(null);
    try {
      const r = await fetch(`/api/onboarding-sdr/${id}${fresh ? "?fresh=1" : ""}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "No se pudo cargar el onboarding");
      setDetail(d);
      setView("ruta");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (openId) void loadDetail(openId);
  }, [openId, loadDetail]);

  // El iframe se arma una sola vez por onboarding: los cambios posteriores se
  // le mandan por postMessage (si no, se recargaría en cada clic).
  const srcDoc = useMemo(() => (html && detail ? injectOnboarding(html, detail.onb) : ""), [html, detail]);

  // Cambios desde el iframe → API → estado oficial de vuelta al iframe.
  useEffect(() => {
    if (!detail) return;
    const id = detail.meta.id;
    let queue = Promise.resolve();
    function post(msg: unknown) {
      iframeRef.current?.contentWindow?.postMessage(msg, "*");
    }
    function onMessage(e: MessageEvent) {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const m = e.data as { source?: string; type?: string; role?: string; op?: unknown };
      if (m?.source !== "onboarding-sdr" || m.type !== "op") return;
      // En orden, uno a la vez (dos clics rápidos no se pisan).
      queue = queue.then(async () => {
        try {
          const r = await fetch(`/api/onboarding-sdr/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: m.role, op: m.op }),
          });
          const d = await r.json();
          if (!r.ok) {
            post({ source: "onboarding-host", type: "error", msg: d.error || "No se pudo guardar" });
            // Vuelve al estado guardado.
            const g = await fetch(`/api/onboarding-sdr/${id}`).then((x) => x.json());
            if (g?.onb) post({ source: "onboarding-host", type: "state", state: g.onb.state, academias: g.onb.academias });
            return;
          }
          post({ source: "onboarding-host", type: "state", state: d.state, academias: d.academias });
        } catch {
          post({ source: "onboarding-host", type: "error", msg: "Sin conexión: el cambio no se guardó" });
        }
      });
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [detail]);

  async function startMine(ingreso: string) {
    setError(null);
    const r = await fetch("/api/onboarding-sdr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ingreso }) });
    const d = await r.json();
    if (!r.ok) return setError(d.error || "No se pudo crear el onboarding");
    await loadHome();
    setOpenId(d.id);
  }

  function backToTeam() {
    setOpenId(null);
    setDetail(null);
    setView("equipo");
    void loadHome();
  }

  if (!home) {
    return (
      <div className="space-y-6">
        <Header />
        {error ? <ErrorCard msg={error} /> : <Loading />}
      </div>
    );
  }

  const v = home.viewer;
  const viewingOther = detail && detail.meta.email !== v.email;

  return (
    <div className="space-y-6">
      <Header
        right={
          <div className="flex flex-wrap gap-2">
            {detail && view === "ruta" && (
              <button className="btn-secondary flex items-center gap-1.5 text-sm" onClick={() => void loadDetail(detail.meta.id, true)} title="Vuelve a leer el avance y el calendario">
                <IconRefresh size={15} /> Actualizar
              </button>
            )}
          </div>
        }
      />

      {v.editor && (
        <div className="flex gap-1 border-b border-[#EEEAF6]">
          {([
            ["equipo", "Equipo", IconUsersGroup],
            ["ruta", detail ? (viewingOther ? `Ruta de ${detail.meta.name || detail.meta.email}` : "Mi ruta") : "Ruta", IconRoad],
            ["configurar", "Configurar", IconSettings],
          ] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              disabled={key === "ruta" && !detail}
              onClick={() => (key === "equipo" ? backToTeam() : setView(key))}
              className={`px-3 py-2 text-sm flex items-center gap-1.5 border-b-2 -mb-px disabled:opacity-40 ${view === key ? "border-brand text-brand font-medium" : "border-transparent text-ink-muted"}`}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
      )}

      {error && <ErrorCard msg={error} />}

      {view === "equipo" && v.editor && (
        <TeamView
          team={home.team ?? []}
          leaders={home.leaders ?? []}
          catalog={home.catalog}
          showArchived={showArchived}
          onToggleArchived={(on) => {
            setShowArchived(on);
            void loadHome(on);
          }}
          onOpen={(id) => (openId === id ? void loadDetail(id) : setOpenId(id))}
          onChanged={() => void loadHome()}
        />
      )}

      {view === "configurar" && v.editor && <RolesView admin={v.admin} />}

      {view === "ruta" && (
        <>
          {!detail && !loadingDetail && !v.editor && !home.mine && <StartCard suggested={home.suggestedIngreso} onStart={startMine} />}
          {!detail && !loadingDetail && !v.editor && home.mine && !home.mine.active && (
            <div className="card text-sm text-ink-muted">Tu onboarding está archivado. Pídele a tu líder de célula que lo reactive.</div>
          )}
          {loadingDetail && <Loading />}
          {detail && !loadingDetail && (
            <>
              {viewingOther && (
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <button className="text-brand flex items-center gap-1 hover:underline" onClick={backToTeam}>
                    <IconArrowLeft size={15} /> Volver al equipo
                  </button>
                  <span className="text-ink-muted">
                    {detail.meta.email}
                    {detail.meta.leader ? ` · Célula de ${detail.meta.leader}` : ""}
                    {!detail.meta.active ? " · archivado" : ""}
                  </span>
                </div>
              )}
              <CalendarNotice cal={detail.onb.cal} admin={v.admin} />
              <div className="card p-0 overflow-hidden">
                <iframe
                  key={detail.meta.id}
                  ref={iframeRef}
                  title="Onboarding SDR"
                  srcDoc={srcDoc}
                  className="w-full block"
                  style={{ height: "85vh", border: 0 }}
                  sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Header({ right }: { right?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="label">SDR</div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <IconRoad size={24} /> Onboarding SDR
        </h1>
        <p className="text-sm text-ink-muted mt-1">Tu ruta de 90 días en BullsEye: avance guardado, conectado con tu Google Calendar y con el entrenamiento de tus clientes.</p>
      </div>
      {right}
    </header>
  );
}

function Loading() {
  return (
    <div className="card flex items-center gap-3 text-ink-muted">
      <IconLoader2 size={18} className="animate-spin" /> Cargando…
    </div>
  );
}

function ErrorCard({ msg }: { msg: string }) {
  return (
    <div className="card text-danger-fg flex items-center gap-2 text-sm">
      <IconAlertTriangle size={16} /> {msg}
    </div>
  );
}

function CalendarNotice({ cal, admin }: { cal: { status: string; msg?: string } | undefined; admin: boolean }) {
  if (!cal || cal.status !== "error") return null;
  return (
    <div className="card text-sm text-warning-fg bg-warning-bg/30 flex items-start gap-2">
      <IconCalendar size={16} className="shrink-0 mt-0.5" />
      <span>
        {cal.msg}
        {!admin && " La ruta funciona igual; solo no se muestran los eventos del calendario."}
      </span>
    </div>
  );
}

function StartCard({ suggested, onStart }: { suggested: string | null; onStart: (ingreso: string) => Promise<void> }) {
  const [date, setDate] = useState(suggested ?? nextMonday());
  const [busy, setBusy] = useState(false);
  return (
    <div className="card space-y-3 max-w-xl">
      <h2 className="font-semibold text-lg">¡Bienvenido a BullsEye! Comencemos tu onboarding</h2>
      <p className="text-sm text-ink-muted">
        Tu ruta de 90 días queda guardada con tu correo: puedes avanzar desde cualquier computador y tu líder de célula ve el mismo avance. Los eventos del onboarding de tu Google Calendar
        aparecen junto a cada hito.
      </p>
      <label className="block text-sm">
        <span className="font-medium">Fecha de ingreso (día 1)</span>
        <input type="date" className="input mt-1 block" value={date} onChange={(e) => setDate(e.target.value)} />
        {suggested && <span className="text-xs text-ink-subtle">Tomada del evento «Bienvenida» de tu calendario.</span>}
      </label>
      <button
        className="btn-primary flex items-center gap-2"
        disabled={busy || !date}
        onClick={async () => {
          setBusy(true);
          await onStart(date);
          setBusy(false);
        }}
      >
        {busy ? <IconLoader2 size={16} className="animate-spin" /> : <IconRoad size={16} />} Comenzar mi onboarding
      </button>
    </div>
  );
}

function TeamView({
  team,
  leaders,
  catalog,
  showArchived,
  onToggleArchived,
  onOpen,
  onChanged,
}: {
  team: TeamRow[];
  leaders: string[];
  catalog: { id: string; n: string }[];
  showArchived: boolean;
  onToggleArchived: (on: boolean) => void;
  onOpen: (id: string) => void;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", leader: "", ingreso: nextMonday(), c1: "", c2: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Edición en la tabla: nombre, líder directo y fecha de ingreso.
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ name: "", leader: "", ingreso: "" });
  const [saving, setSaving] = useState(false);

  function startEdit(r: TeamRow) {
    setEditId(r.id);
    setEdit({ name: r.name ?? "", leader: r.leader ?? "", ingreso: r.ingreso ?? "" });
  }

  async function saveEdit() {
    if (!editId) return;
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch(`/api/onboarding-sdr/${editId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meta: edit }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "No se pudo guardar");
      setEditId(null);
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/onboarding-sdr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email, name: form.name, leader: form.leader, ingreso: form.ingreso, clientes: [form.c1, form.c2].filter(Boolean) }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "No se pudo crear");
      setAdding(false);
      setForm({ email: "", name: "", leader: "", ingreso: nextMonday(), c1: "", c2: "" });
      onChanged();
      onOpen(d.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function archive(row: TeamRow) {
    if (!confirm(row.active ? `¿Archivar el onboarding de ${row.name || row.email}? Deja de aparecer en el equipo (no se borra nada).` : `¿Reactivar el onboarding de ${row.name || row.email}?`)) return;
    await fetch(`/api/onboarding-sdr/${row.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !row.active }) });
    onChanged();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">Cada SDR nuevo crea su onboarding al entrar a SDR → Onboarding SDR con su correo. También puedes crearlo antes de su ingreso.</p>
        <div className="flex items-center gap-3">
          <label className="text-sm flex items-center gap-1.5 text-ink-muted">
            <input type="checkbox" checked={showArchived} onChange={(e) => onToggleArchived(e.target.checked)} /> Ver archivados
          </label>
          <button className="btn-primary flex items-center gap-1.5 text-sm" onClick={() => setAdding((x) => !x)}>
            <IconPlus size={15} /> Nuevo SDR
          </button>
        </div>
      </div>

      {adding && (
        <div className="card space-y-3">
          <h2 className="font-semibold">Crear el onboarding de un SDR nuevo</h2>
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            <label>
              Correo corporativo
              <input className="input mt-1 w-full" placeholder="inicialapellido@bullseye-abm.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
            <label>
              Nombre (si aún no está en la Maestra)
              <input className="input mt-1 w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label>
              Líder directo (si no, se toma de la Maestra)
              <input className="input mt-1 w-full" list="onb-leaders" placeholder="Elige o escribe" value={form.leader} onChange={(e) => setForm({ ...form, leader: e.target.value })} />
            </label>
            <label>
              Fecha de ingreso (día 1)
              <input type="date" className="input mt-1 w-full" value={form.ingreso} onChange={(e) => setForm({ ...form, ingreso: e.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(["c1", "c2"] as const).map((k, i) => (
                <label key={k}>
                  Cliente {i + 1}
                  <select className="input mt-1 w-full" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })}>
                    <option value="">Sin asignar</option>
                    {catalog.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.n}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>
          {err && <p className="text-sm text-danger-fg">{err}</p>}
          <button className="btn-primary flex items-center gap-2" disabled={busy || !form.email} onClick={() => void create()}>
            {busy && <IconLoader2 size={16} className="animate-spin" />} Crear onboarding
          </button>
        </div>
      )}

      <datalist id="onb-leaders">
        {leaders.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>
      {err && !adding && <p className="text-sm text-danger-fg">{err}</p>}
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-muted border-b border-[#EEEAF6]">
              <th className="px-4 py-2 font-medium">SDR</th>
              <th className="px-4 py-2 font-medium">Líder directo</th>
              <th className="px-4 py-2 font-medium">Ingreso</th>
              <th className="px-4 py-2 font-medium">Etapa actual</th>
              <th className="px-4 py-2 font-medium">Hitos</th>
              <th className="px-4 py-2 font-medium text-right">Por confirmar</th>
              <th className="px-4 py-2 font-medium text-right">Atrasados</th>
              <th className="px-4 py-2 font-medium">Clientes</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {team.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-ink-muted">
                  Todavía no hay onboardings. Crea uno con «Nuevo SDR» o pídele al SDR que entre a esta página.
                </td>
              </tr>
            )}
            {team.map((r) =>
              editId === r.id ? (
                <tr key={r.id} className="border-b border-[#EEEAF6] bg-brand-tint/40">
                  <td className="px-4 py-2">
                    <input className="input w-full text-sm" placeholder="Nombre" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                    <div className="text-xs text-ink-subtle mt-1">{r.email}</div>
                  </td>
                  <td className="px-4 py-2">
                    <input className="input w-full text-sm" list="onb-leaders" placeholder="Elige o escribe" value={edit.leader} onChange={(e) => setEdit({ ...edit, leader: e.target.value })} />
                  </td>
                  <td className="px-4 py-2">
                    <input type="date" className="input text-sm" value={edit.ingreso} onChange={(e) => setEdit({ ...edit, ingreso: e.target.value })} />
                  </td>
                  <td colSpan={6} className="px-4 py-2 text-right whitespace-nowrap">
                    <button className="btn-primary text-sm inline-flex items-center gap-1.5 mr-2" disabled={saving} onClick={() => void saveEdit()}>
                      {saving && <IconLoader2 size={14} className="animate-spin" />} Guardar
                    </button>
                    <button className="btn-secondary text-sm" onClick={() => setEditId(null)}>
                      Cancelar
                    </button>
                  </td>
                </tr>
              ) : (
              <tr key={r.id} className={`border-b border-[#EEEAF6] last:border-0 hover:bg-brand-tint/40 cursor-pointer ${r.active ? "" : "opacity-60"}`} onClick={() => onOpen(r.id)}>
                <td className="px-4 py-2">
                  <div className="font-medium">{r.name || r.email}</div>
                  {r.name && <div className="text-xs text-ink-subtle">{r.email}</div>}
                </td>
                <td className="px-4 py-2">{r.leader ?? "—"}</td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {fmtDay(r.ingreso)}
                  {r.day != null && <div className="text-xs text-ink-subtle">{r.day < 1 ? `faltan ${1 - r.day} días` : `día ${r.day}`}</div>}
                </td>
                <td className="px-4 py-2">{r.superadas >= r.stages ? "Terminado" : STAGE_NAMES[r.current] ?? "—"}</td>
                <td className="px-4 py-2 min-w-[140px]">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-[#EEEAF6] overflow-hidden">
                      <div className="h-full bg-brand" style={{ width: `${r.total ? (r.ok / r.total) * 100 : 0}%` }} />
                    </div>
                    <span className="tabular-nums text-xs">
                      {r.ok}/{r.total}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{r.espera || "—"}</td>
                <td className={`px-4 py-2 text-right tabular-nums ${r.late ? "text-danger-fg font-medium" : ""}`}>{r.late || "—"}</td>
                <td className="px-4 py-2 text-xs">{r.clientes.join(", ") || "—"}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <button
                    className="text-ink-muted hover:text-brand mr-3"
                    title="Editar nombre, líder directo y fecha de ingreso"
                    onClick={(e) => {
                      e.stopPropagation();
                      startEdit(r);
                    }}
                  >
                    <IconPencil size={16} />
                  </button>
                  <button
                    className="text-ink-muted hover:text-brand"
                    title={r.active ? "Archivar" : "Reactivar"}
                    onClick={(e) => {
                      e.stopPropagation();
                      void archive(r);
                    }}
                  >
                    <IconArchive size={16} />
                  </button>
                </td>
              </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const ROLE_INFO: { key: keyof Roles; label: string; help: string }[] = [
  { key: "lider", label: "Líderes de célula", help: "Confirman los hitos de doble verificación, marcan las compuertas y confirman cada etapa superada." },
  { key: "rrhh", label: "RRHH", help: "Confirman los hitos de antes de entrar (carta oferta, agenda, accesos) y pueden marcar los Pit Stops." },
  { key: "hab", label: "Habilitadora comercial", help: "Confirma las capacitaciones y reforzamientos de herramientas, la auditoría de call-scoring y las clínicas." },
  { key: "admin", label: "Administradoras", help: "Tienen los tres roles y editan esta lista." },
];

function RolesView({ admin }: { admin: boolean }) {
  const [roles, setRoles] = useState<Record<string, string> | null>(null);
  const [cal, setCal] = useState<{ clientId: string | null; email: string | null; scope: string } | null>(null);
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/onboarding-sdr/roles")
      .then((r) => r.json())
      .then((d) => {
        if (d.roles) setRoles(Object.fromEntries(Object.entries(d.roles as Roles).map(([k, v]) => [k, v.join("\n")])));
        setCal(d.calendar ?? null);
      });
  }, []);

  async function save() {
    if (!roles) return;
    setBusy(true);
    setMsg(null);
    const body = Object.fromEntries(Object.entries(roles).map(([k, v]) => [k, v.split(/[\s,;]+/).filter(Boolean)]));
    const r = await fetch("/api/onboarding-sdr/roles", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    setBusy(false);
    if (!r.ok) return setMsg(d.error || "No se pudo guardar");
    setRoles(Object.fromEntries(Object.entries(d.roles as Roles).map(([k, v]) => [k, v.join("\n")])));
    setMsg("Guardado");
  }

  async function runTest() {
    setTesting(true);
    setTest(null);
    const d = await fetch("/api/onboarding-sdr/roles?test=1").then((r) => r.json()).catch(() => null);
    setTest(d?.test ?? { ok: false, msg: "No se pudo probar" });
    setTesting(false);
  }

  if (!roles) return <Loading />;
  return (
    <div className="space-y-4 max-w-3xl">
    {admin && cal && (
      <div className="card space-y-3">
        <div>
          <h2 className="font-semibold flex items-center gap-2"><IconCalendar size={18} /> Conectar Google Calendar</h2>
          <p className="text-sm text-ink-muted">
            En admin.google.com → Seguridad → Controles de API → Delegación de todo el dominio → <b>Agregar nuevo</b>, pega estos dos datos y pulsa Autorizar. Además, en Google Cloud (proyecto de la cuenta de servicio) habilita la <b>Google Calendar API</b>.
          </p>
        </div>
        <CopyField label="ID de cliente" value={cal.clientId ?? "No se encontró: falta GOOGLE_SERVICE_ACCOUNT_JSON en Vercel"} />
        <CopyField label="Alcances de OAuth" value={cal.scope} />
        {cal.email && <p className="text-xs text-ink-subtle">Cuenta de servicio: {cal.email}</p>}
        <div className="flex items-center gap-3">
          <button className="btn-secondary flex items-center gap-2 text-sm" disabled={testing} onClick={() => void runTest()}>
            {testing && <IconLoader2 size={15} className="animate-spin" />} Probar con mi calendario
          </button>
          {test && <span className={`text-sm ${test.ok ? "text-success-fg" : "text-danger-fg"}`}>{test.msg}</span>}
        </div>
      </div>
    )}
    <div className="card space-y-4">
      <div>
        <h2 className="font-semibold">Quién confirma en el onboarding</h2>
        <p className="text-sm text-ink-muted">Un correo por línea. Cualquier otra persona que entre con su correo es SDR y solo ve su propio onboarding.</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        {ROLE_INFO.map((r) => (
          <label key={r.key} className="text-sm space-y-1">
            <span className="font-medium">{r.label}</span>
            <textarea
              className="input w-full font-mono text-xs"
              rows={4}
              disabled={!admin}
              value={roles[r.key] ?? ""}
              onChange={(e) => setRoles({ ...roles, [r.key]: e.target.value })}
            />
            <span className="block text-xs text-ink-subtle">{r.help}</span>
          </label>
        ))}
      </div>
      {admin ? (
        <div className="flex items-center gap-3">
          <button className="btn-primary flex items-center gap-2" disabled={busy} onClick={() => void save()}>
            {busy && <IconLoader2 size={16} className="animate-spin" />} Guardar
          </button>
          {msg && <span className="text-sm text-ink-muted">{msg}</span>}
        </div>
      ) : (
        <p className="text-xs text-ink-subtle">Solo una administradora puede cambiar esta lista.</p>
      )}
    </div>
    </div>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="text-sm">
      <div className="font-medium mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 px-3 py-2 rounded-lg bg-brand-tint text-xs break-all">{value}</code>
        <button
          className="btn-secondary text-xs"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
    </div>
  );
}
