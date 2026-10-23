"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconCheck, IconX, IconLoader2, IconSparkles, IconRefresh, IconExternalLink, IconChevronDown, IconBrandLinkedin } from "@tabler/icons-react";

// Contactos de la wishlist con IA (Solicitudes clientes → Contactos IA):
// prospección elige empresas de la wishlist del cliente, la IA busca en el
// Lemlist del cliente los empleados que calzan con su buyer persona (máx. 8
// por empresa) y el equipo aprueba o rechaza cada uno. Aprobar crea el
// contacto en Lemlist y pide email + teléfono. Las revisiones enseñan a la IA.

type Item = {
  id: string;
  company_name: string;
  domain: string | null;
  linkedin_url: string | null;
  status: string;
  lemlist_status: string | null;
  contacts_status: "pending" | "done" | "few_contacts" | "error";
  contacts_found: number;
  contacts_searched_at: string | null;
  contacts_error: string | null;
  contacts_debug: {
    attempts?: { label: string; total: number | null; matched: number; error?: string }[];
    limitation?: number | null;
    candidates?: number;
    prefilter?: { seniority?: string[]; department?: string[] } | null;
    target_countries?: string[];
  } | null;
};

type Contact = {
  id: string;
  wishlist_id: string;
  full_name: string;
  title: string | null;
  linkedin_url: string | null;
  location: string | null;
  seniority: string | null;
  department: string | null;
  fit_score: number;
  buying_role: string | null;
  fit_reason: string | null;
  status: "suggested" | "approved" | "rejected";
  reject_reason: string | null;
  reviewed_by_email: string | null;
  lemlist_contact_id: string | null;
  lemlist_error: string | null;
  enrich_status: "none" | "pending" | "done" | "error";
  email: string | null;
  phone: string | null;
};

const CONTACT_STATUS: Record<Item["contacts_status"], { text: string; cls: string }> = {
  pending: { text: "Sin buscar", cls: "bg-gray-100 text-gray-500" },
  done: { text: "Contactos encontrados", cls: "bg-green-50 text-green-700" },
  few_contacts: { text: "Pocos contactos → Sales Navigator", cls: "bg-amber-50 text-amber-800" },
  error: { text: "Error", cls: "bg-red-50 text-red-700" },
};

const ROLE_LABEL: Record<string, string> = { decisor: "Decisor", influenciador: "Influenciador", usuario: "Usuario", ninguno: "—" };

export default function WishlistContactsTab({ clientId, clientName }: { clientId: string | null; clientName: string | null }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState<{ done: number; total: number; current: string } | null>(null);
  const [limitation, setLimitation] = useState<number | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const stopRef = useRef(false);

  const load = useCallback(async () => {
    if (!clientId) return;
    const r = await fetch(`/api/portal-admin/wishlist-contacts?client_id=${clientId}`, { cache: "no-store" });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) return setError(j?.error ?? "Error al cargar");
    setError(null);
    setItems(j.items);
    setContacts(j.contacts);
  }, [clientId]);

  useEffect(() => {
    setItems(null);
    setSelected(new Set());
    load();
  }, [load]);

  // Emails / teléfonos pendientes: se revisan solos cada 20 s mientras haya
  const pendingEnrich = contacts.some((c) => c.enrich_status === "pending");
  useEffect(() => {
    if (!pendingEnrich || !clientId) return;
    const t = setInterval(async () => {
      await fetch("/api/portal-admin/wishlist-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh", client_id: clientId }),
      });
      load();
    }, 20_000);
    return () => clearInterval(t);
  }, [pendingEnrich, clientId, load]);

  if (!clientId) {
    return <div className="text-sm text-gray-500 bg-white rounded-2xl border border-gray-100 p-6">Elige un cliente arriba para buscar contactos de su wishlist.</div>;
  }

  async function searchSelected() {
    const ids = Array.from(selected);
    stopRef.current = false;
    setError(null);
    for (let i = 0; i < ids.length && !stopRef.current; i++) {
      const it = items?.find((x) => x.id === ids[i]);
      setRunning({ done: i, total: ids.length, current: it?.company_name ?? "" });
      const r = await fetch("/api/portal-admin/wishlist-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "search", wishlist_id: ids[i] }),
      });
      const j = await r.json().catch(() => null);
      if (typeof j?.limitation === "number") setLimitation(j.limitation);
      if (!r.ok && !j) setError(`${it?.company_name}: la búsqueda tardó demasiado`);
      await load();
      setOpen((prev) => new Set([...Array.from(prev), ids[i]]));
    }
    setRunning(null);
    setSelected(new Set());
  }

  async function review(c: Contact, action: "approve" | "reject") {
    let reason: string | null = null;
    if (action === "reject") {
      reason = window.prompt(`¿Por qué no sirve ${c.full_name} (${c.title ?? "sin cargo"})? Opcional — la IA aprende de esto.`, "");
      if (reason === null) return;
    }
    setContacts((prev) => prev.map((x) => (x.id === c.id ? { ...x, status: action === "approve" ? "approved" : "rejected", enrich_status: action === "approve" ? "pending" : x.enrich_status } : x)));
    const r = await fetch("/api/portal-admin/wishlist-contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, contact_id: c.id, reason }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) setError(`${c.full_name}: ${j.error ?? "no se pudo guardar"}`);
    load();
  }

  const toggle = (set: Set<string>, id: string) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  };
  const byCompany = (id: string) => contacts.filter((c) => c.wishlist_id === id);
  const allSelected = !!items?.length && items.every((i) => selected.has(i.id));

  return (
    <div>
      <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-4 text-sm text-gray-600">
        Cuando una empresa de la wishlist de <strong>{clientName}</strong> queda en su Lemlist, la IA busca sola (cada 15 min) los contactos que
        calzan con su buyer persona (máx. 8 por empresa). También puedes elegir empresas y buscar ahora con el botón. Revisa cada uno: al <strong>aprobar</strong> se crea en su Lemlist (lista “Contactos Wishlist BullsEye”) y se buscan
        email y teléfono (créditos de Lemlist). Lo que apruebas o rechazas le enseña a la IA. Con menos de 2 contactos la empresa queda para Sales Navigator.
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(items?.map((i) => i.id)))} />
          Seleccionar todas
        </label>
        {!running ? (
          <button
            onClick={searchSelected}
            disabled={!selected.size}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-sm font-medium disabled:opacity-40"
            style={{ background: "#251762" }}
          >
            <IconSparkles size={15} /> Buscar contactos con IA{selected.size ? ` (${selected.size})` : ""}
          </button>
        ) : (
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <IconLoader2 className="animate-spin" size={16} />
            {running.done + 1} de {running.total}: {running.current}
            <button onClick={() => { stopRef.current = true; }} className="px-3 py-1 rounded-lg border border-gray-200 bg-white text-xs">Detener</button>
          </div>
        )}
        <button onClick={load} className="flex items-center gap-1 text-xs text-gray-500"><IconRefresh size={13} /> Actualizar</button>
        {limitation != null && <span className="text-xs text-gray-400">Búsquedas de Lemlist disponibles hoy: {limitation}</span>}
      </div>

      {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl mb-4">{error}</div>}
      {!items && !error && <IconLoader2 className="animate-spin text-gray-400" />}
      {items?.length === 0 && <div className="text-sm text-gray-400">Este cliente no tiene empresas en su wishlist.</div>}

      <div className="space-y-3">
        {items?.map((i) => {
          const list = byCompany(i.id);
          const st = CONTACT_STATUS[i.contacts_status] ?? CONTACT_STATUS.pending;
          const isOpen = open.has(i.id);
          const approved = list.filter((c) => c.status === "approved").length;
          return (
            <div key={i.id} className="bg-white rounded-2xl border border-gray-100">
              <div className="flex flex-wrap items-center gap-3 p-4">
                <input type="checkbox" checked={selected.has(i.id)} onChange={() => setSelected((s) => toggle(s, i.id))} disabled={!!running} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium" style={{ color: "#251762" }}>{i.company_name}</div>
                  <div className="text-xs text-gray-500 flex flex-wrap gap-x-2">
                    {i.domain && (
                      <a href={`https://${i.domain}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-[#251762]">
                        {i.domain} <IconExternalLink size={10} />
                      </a>
                    )}
                    {i.linkedin_url && <a href={i.linkedin_url} target="_blank" rel="noreferrer" className="hover:text-[#251762]">LinkedIn</a>}
                    {i.lemlist_status !== "ok" && <span className="text-amber-700">Empresa aún no está en Lemlist</span>}
                  </div>
                </div>
                <span className={`text-xs rounded-full px-2.5 py-1 ${st.cls}`}>
                  {st.text}
                  {i.contacts_status !== "pending" && i.contacts_status !== "error" ? ` · ${i.contacts_found}` : ""}
                  {approved ? ` · ${approved} aprobados` : ""}
                </span>
                {(list.length > 0 || i.contacts_debug || i.contacts_error) && (
                  <button onClick={() => setOpen((s) => toggle(s, i.id))} className="text-gray-400">
                    <IconChevronDown size={18} className={isOpen ? "rotate-180 transition" : "transition"} />
                  </button>
                )}
              </div>

              {isOpen && (
                <div className="border-t border-gray-50 px-4 pb-4">
                  {i.contacts_error && <div className="text-xs text-red-600 mt-3">{i.contacts_error}</div>}
                  {i.contacts_debug && (
                    <div className="text-[11px] text-gray-400 mt-3">
                      Búsqueda en Lemlist:{" "}
                      {(i.contacts_debug.attempts ?? []).map((a) => `por ${a.label} → ${a.error ? `error ${a.error}` : `${a.total ?? "?"} resultados, ${a.matched} de la empresa`}`).join(" · ") || "sin intentos"}
                      {i.contacts_debug.prefilter ? ` · pre-filtro: ${[...(i.contacts_debug.prefilter.seniority ?? []), ...(i.contacts_debug.prefilter.department ?? [])].join(", ")}` : ""}
                      {typeof i.contacts_debug.candidates === "number" ? ` · ${i.contacts_debug.candidates} empleados evaluados` : ""}
                      {i.contacts_debug.target_countries?.length ? ` · países del ICP: ${i.contacts_debug.target_countries.join(", ")} (fuera de ellos baja el fit)` : ""}
                    </div>
                  )}
                  {list.length === 0 && i.contacts_status !== "pending" && (
                    <div className="text-sm text-gray-500 mt-3">La IA no encontró contactos que calcen con el buyer persona: buscar en Sales Navigator.</div>
                  )}
                  {list.length > 0 && (
                    <div className="overflow-x-auto mt-3">
                      <table className="w-full text-sm">
                        <thead className="text-left text-xs text-gray-500">
                          <tr>
                            <th className="py-2 pr-3">Contacto</th>
                            <th className="py-2 pr-3">Fit</th>
                            <th className="py-2 pr-3">Por qué</th>
                            <th className="py-2 pr-3">Revisión</th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.map((c) => (
                            <tr key={c.id} className={`border-t border-gray-50 align-top ${c.status === "rejected" ? "opacity-50" : ""}`}>
                              <td className="py-2 pr-3 min-w-[220px]">
                                <div className="font-medium flex items-center gap-1" style={{ color: "#251762" }}>
                                  {c.full_name}
                                  {c.linkedin_url && (
                                    <a href={c.linkedin_url} target="_blank" rel="noreferrer" className="text-[#0a66c2]"><IconBrandLinkedin size={15} /></a>
                                  )}
                                </div>
                                <div className="text-xs text-gray-700">{c.title ?? "—"}</div>
                                <div className="text-[11px] text-gray-400">{[c.seniority, c.department, c.location].filter(Boolean).join(" · ")}</div>
                              </td>
                              <td className="py-2 pr-3 whitespace-nowrap">
                                <div className="font-semibold">{c.fit_score}%</div>
                                <div className="text-[11px] text-gray-500">{ROLE_LABEL[c.buying_role ?? "ninguno"] ?? c.buying_role}</div>
                              </td>
                              <td className="py-2 pr-3 text-xs text-gray-600 max-w-xs">{c.fit_reason}</td>
                              <td className="py-2 pr-3 min-w-[200px]">
                                {c.status === "suggested" && (
                                  <div className="flex gap-1.5">
                                    <button onClick={() => review(c, "approve")} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-white bg-green-600">
                                      <IconCheck size={13} /> Aprobar
                                    </button>
                                    <button onClick={() => review(c, "reject")} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs border border-gray-200 text-gray-600">
                                      <IconX size={13} /> Rechazar
                                    </button>
                                  </div>
                                )}
                                {c.status === "rejected" && (
                                  <div className="text-xs text-gray-500">Rechazado{c.reject_reason ? `: ${c.reject_reason}` : ""}</div>
                                )}
                                {c.status === "approved" && (
                                  <div className="text-xs space-y-0.5">
                                    <div className="text-green-700 font-medium">Aprobado{c.lemlist_contact_id ? " · en Lemlist" : ""}</div>
                                    {c.enrich_status === "pending" && <div className="text-gray-500 flex items-center gap-1"><IconLoader2 size={11} className="animate-spin" /> Buscando email y teléfono…</div>}
                                    {c.email && <div className="text-gray-700">{c.email}</div>}
                                    {c.phone && <div className="text-gray-700">{c.phone}</div>}
                                    {c.enrich_status === "done" && !c.email && !c.phone && <div className="text-gray-400">Lemlist no encontró email ni teléfono</div>}
                                    {c.lemlist_error && <div className="text-red-600">{c.lemlist_error}</div>}
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
