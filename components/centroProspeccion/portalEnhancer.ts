import { createPortalSections } from "./portalSections";

// Completa los marcadores que el código del Centro deja vacíos
// (ver scripts/centro-prospeccion/build_legacy.py, "Enganches del portal"):
//  - [data-cp-icp="<ficha>"]: ICP vigente del portal dentro de la ficha.
//  - [data-cp-auto="<ficha>|<correo>|<semana>"]: lo hecho en Empresas,
//    Contactos y Búsqueda manual esa semana (tabla del plan y «Mi semana»).
// El Centro vuelve a dibujar sus vistas con innerHTML, así que se observa el
// contenedor y se completan los marcadores nuevos. Solo lee datos.

type Counts = { propuestas: number; revisados: number; aprobados: number; manuales: number; busquedas: number };
type Week = { rows: ({ clienteId: string; email: string } & Counts)[]; linked: Record<string, string | null> };

const TTL = 60_000;
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const n = (x: number) => x.toLocaleString("es-CL");
const plural = (x: number, one: string, many: string) => `${n(x)} ${x === 1 ? one : many}`;

export function startPortalEnhancer(root: HTMLElement): () => void {
  const weeks = new Map<string, { at: number; p: Promise<Week | null> }>();
  const icps = new Map<string, { at: number; p: Promise<{ linked: boolean; client?: { name: string }; icp?: string } | null> }>();

  const week = (wk: string): Promise<Week | null> => {
    const hit = weeks.get(wk);
    if (hit && Date.now() - hit.at < TTL) return hit.p;
    const p: Promise<Week | null> = fetch(`/api/centro/portal-auto?semana=${encodeURIComponent(wk)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    weeks.set(wk, { at: Date.now(), p });
    return p;
  };
  const icp = (id: string) => {
    const hit = icps.get(id);
    if (hit && Date.now() - hit.at < 5 * TTL) return hit.p;
    const p = fetch(`/api/centro/icp?clienteId=${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    icps.set(id, { at: Date.now(), p });
    return p;
  };

  const fillIcp = async (el: HTMLElement) => {
    const id = el.dataset.cpIcp ?? "";
    el.innerHTML = `<div class="muted" style="font-size:12.5px">Cargando el ICP del portal…</div>`;
    const res = await icp(id);
    if (!el.isConnected) return;
    if (!res) { el.innerHTML = `<div class="muted" style="font-size:12.5px">No se pudo leer el ICP del portal.</div>`; return; }
    if (!res.linked) {
      el.innerHTML = `<div class="muted" style="font-size:12.5px">Esta ficha no está vinculada a un cliente del portal, así que la IA de Empresas y Contactos no la usa.</div>`;
      return;
    }
    const body = (res.icp ?? "").trim();
    el.innerHTML =
      `<details class="ctx"><summary>ICP vigente del portal · ${esc(res.client?.name)}</summary>` +
      `<div class="ctx-body">${body ? esc(body) : '<span class="muted">El cliente aún no tiene ICP cargado en el portal.</span>'}</div>` +
      `<div class="muted" style="font-size:12px;padding:0 14px 12px">Se edita en el portal (Sistema → ICP). Este ICP y esta ficha son lo que usa la IA de Empresas y Contactos para recomendar.</div></details>`;
  };

  const fillAuto = async (el: HTMLElement) => {
    const [cli, email, wk] = (el.dataset.cpAuto ?? "").split("|");
    const row = el.dataset.cpMode === "row";
    if (!cli || !wk) return;
    const data = await week(wk);
    if (!el.isConnected) return;
    if (!data) { el.textContent = row ? "" : "–"; return; }
    if (!data.linked?.[cli]) {
      el.innerHTML = row ? "" : `<span class="muted" title="La ficha no está vinculada a un cliente del portal">Sin vínculo</span>`;
      return;
    }
    const c = data.rows.find((r) => r.clienteId === cli && r.email === (email || "").toLowerCase());
    const total = c ? c.revisados + c.manuales + c.propuestas + c.busquedas : 0;
    if (!c || !total) { el.innerHTML = row ? "" : `<span class="muted">–</span>`; return; }
    const parts = [
      c.aprobados || c.revisados ? `${plural(c.aprobados, "contacto aprobado", "contactos aprobados")}${c.revisados ? ` de ${n(c.revisados)} revisados` : ""}` : "",
      c.manuales ? `${plural(c.manuales, "agregado", "agregados")} a mano` : "",
      c.busquedas ? plural(c.busquedas, "búsqueda manual cerrada", "búsquedas manuales cerradas") : "",
      c.propuestas ? plural(c.propuestas, "empresa propuesta", "empresas propuestas") : "",
    ].filter(Boolean);
    if (row) {
      el.innerHTML = `<div class="mw-n" style="margin-top:4px"><span class="tag p">En el portal</span> ${esc(parts.join(" · "))}</div>`;
    } else {
      const short = [
        c.aprobados ? `${n(c.aprobados)} aprob.` : "",
        c.busquedas ? `${n(c.busquedas)} búsq.` : "",
        c.propuestas ? `${n(c.propuestas)} prop.` : "",
      ].filter(Boolean).join(" · ") || `${n(c.revisados)} revis.`;
      el.innerHTML = `<span title="${esc(parts.join(" · "))}">${esc(short)}</span>`;
    }
  };

  const sections = createPortalSections(week);
  const scan = () => {
    sections.scan(root);
    root.querySelectorAll<HTMLElement>("[data-cp-icp]:not([data-cp-done])").forEach((el) => {
      el.dataset.cpDone = "1";
      void fillIcp(el);
    });
    root.querySelectorAll<HTMLElement>("[data-cp-auto]:not([data-cp-done])").forEach((el) => {
      el.dataset.cpDone = "1";
      void fillAuto(el);
    });
  };

  let raf = 0;
  const obs = new MutationObserver(() => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; scan(); });
  });
  obs.observe(root, { childList: true, subtree: true });
  // El modal de ficha vive dentro del mismo contenedor (#modal)
  scan();
  return () => { obs.disconnect(); if (raf) cancelAnimationFrame(raf); };
}
