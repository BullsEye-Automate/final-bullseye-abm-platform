// Secciones del portal dentro del Centro de prospección (fases 2-3).
// Completa los marcadores data-cp-view (uno por vista), data-cp-ficha y
// data-cp-queue que deja el código del Centro (build_legacy.py):
//  - Resumen: tablero de la prospección automática del portal por cliente.
//  - Solicitudes: pedidos que los clientes hacen desde su portal.
//  - Plan semanal: resultados de la semana en el portal (metas por resultado).
//  - Cuentas: cruce de las cuentas aprobadas con la wishlist del portal y paso
//    de las que faltan (solo el administrador del Centro, con confirmación).
//  - Ficha: estado del cliente en el portal. «Mi semana»: cola por cliente.
// Todo lee datos salvo el botón de pasar cuentas, que usa el mismo flujo de un
// listado subido por el cliente.

type Counts = { propuestas: number; revisados: number; aprobados: number; manuales: number; busquedas: number };
type Week = { rows: ({ clienteId: string; email: string } & Counts)[]; linked: Record<string, string | null> };
type Kpis = {
  propuestas: number; pedidasCliente: number; aprobadas: number; rechazadas: number; tasaAprobacion: number | null;
  prospectadas: number; contactosAuto: number; contactosManuales: number; contactosAprobados: number;
  conEmail: number; conTelefono: number; esperandoCliente: number; esperandoClienteDias: number | null;
  porProspectar: number; erroresLemlist: number; busquedaManual: number; activas: number;
};
type FichaSummary = Kpis & { clientId: string; cliente: string; porRevisar: number };
type Pedido = { id: string; clienteId: string | null; cliente: string; empresa: string; tipo: "pedida" | "rechazada"; fecha: string; motivo: string | null };
type Summary = { dias: number; porFicha: Record<string, FichaSummary>; totales: Kpis; porRevisarTotal: number; pedidos: Pedido[]; migration_missing: boolean };

const TTL = 60_000;
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const n = (x: number | null | undefined) => (x ?? 0).toLocaleString("es-CL");
const pct = (x: number | null | undefined) => (x == null ? "–" : `${Math.round(x * 100)}%`);
// La tasa de aprobación del Dashboard ya viene de 0 a 100
const pct100 = (x: number | null | undefined) => (x == null ? "–" : `${Math.round(x)}%`);
const fecha = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("es-CL", { day: "numeric", month: "short", timeZone: "America/Santiago" });
};

// Abre una página del portal con el cliente ya elegido (mismo selector que
// usa todo el portal: localStorage "bullseye_client_id")
function goPortal(path: string, clientId: string) {
  try { localStorage.setItem("bullseye_client_id", clientId); } catch { /* sin almacenamiento */ }
  window.location.href = path;
}

const kpiBox = (t: string, v: string, sub = "", hl = false) =>
  `<div class="kpi ${hl ? "hl" : ""}"><div class="kpi-h">${esc(t)}</div><div class="kv">${v}</div><div class="ksub">${sub}</div></div>`;

const card = (title: string, sub: string, body: string) =>
  `<div class="card" style="margin-bottom:16px"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline;margin-bottom:10px"><h3 style="font-family:var(--head);font-size:15px">${esc(title)}</h3><span class="muted" style="font-size:12px">${sub}</span></div>${body}</div>`;

export function createPortalSections(week: (wk: string) => Promise<Week | null>) {
  let summary: { at: number; p: Promise<Summary | null> } | null = null;
  const getSummary = (): Promise<Summary | null> => {
    if (summary && Date.now() - summary.at < TTL) return summary.p;
    const p: Promise<Summary | null> = fetch("/api/centro/portal-summary?days=30", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    summary = { at: Date.now(), p };
    return p;
  };

  // Un cliente del portal puede tener varias fichas (Nisum Chile / Colombia / Perú)
  const byClient = (s: Summary, cli: string) => {
    const seen = new Map<string, { fichas: string[]; d: FichaSummary }>();
    for (const [fid, d] of Object.entries(s.porFicha)) {
      if (cli && fid !== cli) continue;
      const e = seen.get(d.clientId);
      if (e) e.fichas.push(fid);
      else seen.set(d.clientId, { fichas: [fid], d });
    }
    return Array.from(seen.values());
  };

  const bindGo = (el: HTMLElement) => {
    el.querySelectorAll<HTMLElement>("[data-cp-go]").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.preventDefault();
        goPortal(b.dataset.cpGo ?? "/dashboard", b.dataset.cpClient ?? "");
      })
    );
  };
  const goBtn = (label: string, path: string, clientId: string, pri = false) =>
    `<button class="btn sm ${pri ? "pri" : ""}" data-cp-go="${esc(path)}" data-cp-client="${esc(clientId)}">${esc(label)}</button>`;

  // ── Resumen: un solo tablero ───────────────────────────────────────────
  const renderResumen = async (el: HTMLElement, cli: string) => {
    el.innerHTML = card("Prospección en el portal", "Cargando…", "");
    const s = await getSummary();
    if (!el.isConnected) return;
    if (!s) { el.innerHTML = card("Prospección en el portal", "", `<p class="muted">No se pudo leer el portal.</p>`); return; }
    const rows = byClient(s, cli).sort((a, b) =>
      b.d.porRevisar + b.d.busquedaManual + b.d.esperandoCliente - (a.d.porRevisar + a.d.busquedaManual + a.d.esperandoCliente));
    const t = cli && rows[0] ? { ...rows[0].d } : { ...s.totales, porRevisar: s.porRevisarTotal };
    const kpis = `<div class="kgrid" style="margin-bottom:14px">
      ${kpiBox("Contactos por revisar", n(t.porRevisar), "Sugeridos por la IA, esperan a una prospectora", true)}
      ${kpiBox("Búsqueda manual", n(t.busquedaManual), "Empresas con pocos contactos automáticos")}
      ${kpiBox("Contactos aprobados", n(t.contactosAprobados), `${n(t.contactosManuales)} agregados a mano · ${n(t.conTelefono)} con teléfono`)}
      ${kpiBox("Aprobación del cliente", pct100(t.tasaAprobacion), `${n(t.aprobadas)} aprobadas · ${n(t.rechazadas)} rechazadas de las propuestas`)}
      ${kpiBox("Esperando al cliente", n(t.esperandoCliente), t.esperandoClienteDias != null ? `La más antigua lleva ${n(t.esperandoClienteDias)} días` : "Propuestas sin respuesta")}
    </div>`;
    const table = rows.length
      ? `<div class="tw"><table><thead><tr><th class="l">Cliente</th><th>Por revisar</th><th>Búsqueda manual</th><th>Esperando cliente</th><th>Propuestas</th><th>Aprobación</th><th>Contactos aprobados</th><th>Sin Lemlist</th><th></th></tr></thead><tbody>${rows
          .map(({ d }) => `<tr><td class="l"><b>${esc(d.cliente)}</b></td><td>${d.porRevisar ? `<b>${n(d.porRevisar)}</b>` : "–"}</td><td>${d.busquedaManual ? `<b>${n(d.busquedaManual)}</b>` : "–"}</td><td>${n(d.esperandoCliente)}</td><td>${n(d.propuestas)}</td><td>${pct100(d.tasaAprobacion)}</td><td>${n(d.contactosAprobados)}</td><td>${d.erroresLemlist ? `<span class="pill r">${n(d.erroresLemlist)}</span>` : "–"}</td><td style="white-space:nowrap">${goBtn("Contactos", "/contactos", d.clientId)} ${goBtn("Empresas", "/empresas", d.clientId)}</td></tr>`)
          .join("")}</tbody></table></div>`
      : `<p class="muted">${cli ? "Esta ficha no está vinculada a un cliente del portal." : "Aún no hay clientes con prospección en el portal."}</p>`;
    el.innerHTML = card(
      cli && rows[0] ? `Prospección en el portal · ${rows[0].d.cliente}` : "Prospección en el portal",
      `Últimos ${n(s.dias)} días · cola actual · mismo cálculo del Dashboard`,
      kpis + table + (s.migration_missing ? `<p class="muted" style="margin-top:8px">Falta una migración de prospección en el portal: algunas cifras pueden venir en cero.</p>` : "")
    );
    bindGo(el);
  };

  // ── Solicitudes: una sola bandeja ───────────────────────────────────────
  const renderSolicitudes = async (el: HTMLElement, cli: string) => {
    const s = await getSummary();
    if (!el.isConnected || !s) { el.innerHTML = ""; return; }
    const list = s.pedidos.filter((p) => !cli || p.clienteId === cli);
    if (!list.length) { el.innerHTML = ""; return; }
    const shown = list.slice(0, 40);
    const clientIdOf = (p: Pedido) => (p.clienteId && s.porFicha[p.clienteId]?.clientId) || "";
    el.innerHTML = card(
      "Pedidos de clientes desde el portal",
      `${n(list.length)} en los últimos ${n(s.dias)} días`,
      `<div class="tw"><table><thead><tr><th class="l">Fecha</th><th class="l">Cliente</th><th class="l">Empresa</th><th class="l">Qué pasó</th><th></th></tr></thead><tbody>${shown
        .map((p) => `<tr><td class="l">${fecha(p.fecha)}</td><td class="l">${esc(p.cliente)}</td><td class="l">${esc(p.empresa)}</td><td class="l" style="white-space:normal;max-width:340px">${
          p.tipo === "rechazada"
            ? `<span class="pill r">Rechazó la propuesta</span>${p.motivo ? ` <span class="muted">${esc(p.motivo)}</span>` : ""}`
            : `<span class="pill g">La pidió el cliente</span> <span class="muted">aprobada para prospectar</span>`
        }</td><td>${clientIdOf(p) ? goBtn("Ver en Empresas", "/empresas", clientIdOf(p)) : ""}</td></tr>`)
        .join("")}</tbody></table></div>${list.length > shown.length ? `<p class="muted" style="margin-top:8px">Y ${n(list.length - shown.length)} más en Empresas.</p>` : ""}`
    );
    bindGo(el);
  };

  // ── Plan semanal: metas por resultado ──────────────────────────────────
  const renderPlan = async (el: HTMLElement, cli: string, wk: string) => {
    if (!wk) { el.innerHTML = ""; return; }
    const w = await week(wk);
    if (!el.isConnected || !w) { el.innerHTML = ""; return; }
    const rows = w.rows.filter((r) => !cli || r.clienteId === cli);
    // Por correo (sin repetir clientes con varias fichas: se toma una ficha por cliente)
    const seen = new Set<string>();
    const per = new Map<string, Counts>();
    for (const r of rows) {
      const key = `${r.email}|${w.linked[r.clienteId] ?? r.clienteId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const c = per.get(r.email) ?? { propuestas: 0, revisados: 0, aprobados: 0, manuales: 0, busquedas: 0 };
      c.propuestas += r.propuestas; c.revisados += r.revisados; c.aprobados += r.aprobados; c.manuales += r.manuales; c.busquedas += r.busquedas;
      per.set(r.email, c);
    }
    const tot = Array.from(per.values()).reduce(
      (a, c) => ({ propuestas: a.propuestas + c.propuestas, revisados: a.revisados + c.revisados, aprobados: a.aprobados + c.aprobados, manuales: a.manuales + c.manuales, busquedas: a.busquedas + c.busquedas }),
      { propuestas: 0, revisados: 0, aprobados: 0, manuales: 0, busquedas: 0 }
    );
    const kpis = `<div class="kgrid" style="margin-bottom:${per.size ? 14 : 0}px">
      ${kpiBox("Contactos aprobados", n(tot.aprobados), tot.revisados ? `${pct(tot.aprobados / tot.revisados)} de ${n(tot.revisados)} revisados` : "Revisados en Contactos esta semana", true)}
      ${kpiBox("Agregados a mano", n(tot.manuales), "Desde Búsqueda manual")}
      ${kpiBox("Búsquedas manuales cerradas", n(tot.busquedas), "Empresas con pocos contactos resueltas")}
      ${kpiBox("Empresas propuestas", n(tot.propuestas), "Enviadas al cliente desde Empresas")}
    </div>`;
    const table = per.size
      ? `<div class="tw"><table><thead><tr><th class="l">Prospectora</th><th>Aprobados</th><th>Revisados</th><th>A mano</th><th>Búsquedas cerradas</th><th>Propuestas</th></tr></thead><tbody>${Array.from(per.entries())
          .sort((a, b) => b[1].aprobados - a[1].aprobados)
          .map(([em, c]) => `<tr><td class="l">${esc(em)}</td><td><b>${n(c.aprobados)}</b></td><td>${n(c.revisados)}</td><td>${n(c.manuales)}</td><td>${n(c.busquedas)}</td><td>${n(c.propuestas)}</td></tr>`)
          .join("")}</tbody></table></div>`
      : "";
    el.innerHTML = card("Resultados en el portal esta semana", "Se cuentan solos desde Empresas, Contactos y Búsqueda manual", kpis + table);
  };

  // ── Cuentas: un solo universo de empresas ──────────────────────────────
  const renderCuentas = async (el: HTMLElement, cli: string) => {
    if (!cli) {
      el.innerHTML = card("Cuentas y wishlist del portal", "", `<p class="muted">Elige un cliente en el filtro de arriba para cruzar sus cuentas aprobadas con su wishlist del portal.</p>`);
      return;
    }
    el.innerHTML = card("Cuentas y wishlist del portal", "Cargando…", "");
    const r = await fetch(`/api/centro/cuentas-portal?clienteId=${encodeURIComponent(cli)}`, { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (!el.isConnected) return;
    if (!r) { el.innerHTML = card("Cuentas y wishlist del portal", "", `<p class="muted">No se pudo cruzar con el portal.</p>`); return; }
    if (!r.linked) { el.innerHTML = card("Cuentas y wishlist del portal", "", `<p class="muted">Esta ficha no está vinculada a un cliente del portal.</p>`); return; }
    const faltan = r.faltan as number;
    const btn = faltan && r.puedePasar
      ? `<div class="actions" style="margin-top:10px"><button class="btn pri" data-cp-pass="1">Pasar las ${n(faltan)} sin tocar al portal</button><span class="muted" style="font-size:12.5px" data-cp-pass-msg></span></div>`
      : "";
    el.innerHTML = card(
      `Cuentas y wishlist del portal · ${r.cliente}`,
      "Un solo universo de empresas por cliente",
      `<p style="font-size:13.5px">${n(r.aprobadas)} cuentas aprobadas por el cliente en el Centro: <b>${n(r.enWishlist)}</b> ya están en su wishlist del portal, <b>${n(r.enHubspot)}</b> ya se trabajan en HubSpot (asignadas a un SDR) y <b>${n(faltan)}</b> nadie las ha tocado.</p>
       ${r.enHubspot ? `<p class="muted" style="font-size:12.5px;margin-top:4px">Las de HubSpot siguen su gestión ahí y no se pasan. Ejemplos: ${esc((r.enHubspotEjemplos || []).join(", "))}${r.enHubspot > (r.enHubspotEjemplos || []).length ? "…" : ""}</p>` : ""}
       ${faltan ? `<p class="muted" style="font-size:12.5px;margin-top:4px">Al pasarlas quedan como «Aprobadas para prospectar» en Empresas (igual que un listado subido por el cliente): se envían a su Lemlist y la búsqueda automática de contactos las toma. No se borra nada del Centro.</p>` : ""}${btn}`
    );
    const b = el.querySelector<HTMLButtonElement>("[data-cp-pass]");
    const msg = el.querySelector<HTMLElement>("[data-cp-pass-msg]");
    if (!b || !msg) return;
    let armed = false;
    b.addEventListener("click", async () => {
      if (!armed) {
        armed = true;
        b.textContent = `Confirmar: pasar ${n(faltan)} cuentas`;
        msg.textContent = "Se envían al Lemlist del cliente. Toca de nuevo para confirmar.";
        return;
      }
      b.disabled = true;
      let added = 0, left = faltan, guard = 0;
      const errs: string[] = [];
      while (left > 0 && guard++ < 200) {
        msg.textContent = `Pasando… ${n(added)} de ${n(faltan)}`;
        const res = await fetch("/api/centro/cuentas-portal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clienteId: cli }) })
          .then((x) => x.json()).catch(() => null);
        if (!res || res.error) { errs.push(res?.error ?? "Sin respuesta"); break; }
        added += res.added; left = res.remaining;
        if (res.errors?.length) errs.push(...res.errors);
        if (!res.added) break; // nada avanzó: se corta para no repetir
      }
      msg.textContent = `Listo: ${n(added)} cuentas pasadas al portal${left ? `, ${n(left)} sin pasar` : ""}.${errs.length ? ` Errores: ${errs.slice(0, 3).join(" · ")}` : ""}`;
      b.textContent = "Hecho";
    });
  };

  // ── Ficha y cola de «Mi semana» ─────────────────────────────────────────
  const renderFicha = async (el: HTMLElement, fid: string) => {
    const s = await getSummary();
    if (!el.isConnected) return;
    const d = s?.porFicha[fid];
    if (!d) { el.innerHTML = ""; return; }
    el.innerHTML = `<div class="card" style="padding:12px 14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:10px 0"><div style="flex:1;min-width:220px"><b>En el portal: ${n(d.activas)} empresas en prospección</b><div class="muted" style="font-size:12.5px">${n(d.porRevisar)} contactos por revisar · ${n(d.busquedaManual)} en búsqueda manual · ${n(d.esperandoCliente)} propuestas esperando al cliente · aprobación ${pct100(d.tasaAprobacion)} (30 días)</div></div>${goBtn("Contactos", "/contactos", d.clientId)} ${goBtn("Empresas", "/empresas", d.clientId, true)}</div>`;
    bindGo(el);
  };

  const renderQueue = async (el: HTMLElement, fid: string) => {
    const s = await getSummary();
    if (!el.isConnected) return;
    const d = s?.porFicha[fid];
    if (!d || !(d.porRevisar || d.busquedaManual)) { el.innerHTML = ""; return; }
    const parts = [
      d.porRevisar ? goBtn(`${n(d.porRevisar)} contactos por revisar`, "/contactos", d.clientId) : "",
      d.busquedaManual ? goBtn(`${n(d.busquedaManual)} búsquedas manuales`, "/busqueda-manual", d.clientId) : "",
    ].filter(Boolean).join(" ");
    el.innerHTML = `<div class="mw-n" style="margin-top:6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap"><span class="tag">Tu cola en el portal</span>${parts}</div>`;
    bindGo(el);
  };

  const scan = (root: HTMLElement) => {
    root.querySelectorAll<HTMLElement>("[data-cp-view]:not([data-cp-done])").forEach((el) => {
      el.dataset.cpDone = "1";
      const view = el.dataset.cpView ?? "";
      const cli = el.dataset.cli ?? "";
      // Arriba de la vista, para que se vea primero (en el plan queda al final,
      // después de «Mi semana» y la tabla del equipo)
      const host = el.parentElement;
      if (view !== "plan" && host && host.firstChild !== el) host.insertBefore(el, host.firstChild);
      if (view === "resumen") void renderResumen(el, cli);
      else if (view === "solicitudes") void renderSolicitudes(el, cli);
      else if (view === "plan") void renderPlan(el, cli, el.dataset.sem ?? "");
      else if (view === "cuentas") void renderCuentas(el, cli);
      else if (view === "clientes") { /* la ficha muestra su propio resumen */ }
    });
    root.querySelectorAll<HTMLElement>("[data-cp-ficha]:not([data-cp-done])").forEach((el) => {
      el.dataset.cpDone = "1";
      void renderFicha(el, el.dataset.cpFicha ?? "");
    });
    root.querySelectorAll<HTMLElement>("[data-cp-queue]:not([data-cp-done])").forEach((el) => {
      el.dataset.cpDone = "1";
      void renderQueue(el, el.dataset.cpQueue ?? "");
    });
  };

  return { scan };
}
