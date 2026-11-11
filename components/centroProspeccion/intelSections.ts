// Inteligencia de la semana y checklist de preparación dentro del Centro.
//  - Resumen: una fila por cliente (prioridad, empresas sugeridas, stock de
//    los SDR, propuestas por decidir).
//  - Clientes: checklist de qué le falta a cada cliente para el motor.
//  - Ficha: la inteligencia del cliente con las propuestas (aprobar = se
//    agrega a la ficha; descartar = queda registrado), recordatorios y
//    calidad de datos.

type Proposal = { id: string; tipo: string; campo: string; texto: string; evidencia: string; casos: number; toca_icp: boolean; estado?: string; decidido_por?: string };
type Result = {
  resumen: string; prioridad: "alta" | "media" | "baja"; empresas_sugeridas: number; motivo_cantidad: string;
  donde_prospectar: string[]; propuestas: Proposal[];
  recordatorios: { empresa: string; contacto: string; cuando: string; motivo: string; sdr: string }[];
  calidad_datos: string[]; minuta: string;
};
type Goal = { mes: string; meta: number; realizadas: number; porRealizar: number; faltan: number; cumplida: boolean; diasHabilesRestantes: number };
type Numbers = { meta?: Goal; sinGestion?: number; diasStock?: number | null; ritmoDiario?: number; reuniones30d?: number; realizadas30d?: number; empresasSinContacto?: number };
type Row = { client_id: string; cliente: string; semana: string; status: string; error: string | null; result: Result; numbers: Numbers; cost_usd: number | null; fichas: { id: string; nombre: string }[] };
type Intel = { semana: string | null; filas: Row[]; error?: string };
type Check = { key: string; label: string; ok: boolean; detail: string; required: boolean };
type Ready = { clientId: string; cliente: string; fichas: string[]; estado: "listo" | "parcial" | "falta"; resumen: string; checks: Check[] };

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const n = (x: number | null | undefined) => (x ?? 0).toLocaleString("es-CL");
const PRIO = { alta: "r", media: "y", baja: "g" } as const;
const TIPO: Record<string, string> = {
  cargo_sumar: "Sumar cargo", cargo_sacar: "Sacar cargo", industria_priorizar: "Priorizar industria", industria_descartar: "Descartar industria",
  exclusion: "Excluir", zona: "Zona", mensaje: "Mensaje", otro: "Otro",
};
const CAMPO: Record<string, string> = { cargos: "Cargos objetivo", industrias: "Industrias objetivo", exclusiones: "Exclusiones", zonas: "Zonas", proximos: "Próximos pasos" };
const card = (title: string, sub: string, body: string) =>
  `<div class="card" style="margin-bottom:16px"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline;margin-bottom:10px"><h3 style="font-family:var(--head);font-size:15px">${esc(title)}</h3><span class="muted" style="font-size:12px">${sub}</span></div>${body}</div>`;
const goalCell = (g?: Goal) => !g ? '<span class="muted">sin meta</span>' : `<b>${n(g.realizadas)}</b> / ${n(g.meta)}${g.cumplida ? ' <span class="pill g">cumplida</span>' : `<div class="muted" style="font-size:11.5px">faltan ${n(g.faltan)} · ${n(g.porRealizar)} por realizar</div>`}`;
const lunes = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-CL", { day: "numeric", month: "long", timeZone: "UTC" }) : "");

export function createIntelSections() {
  let intel: { at: number; p: Promise<Intel | null> } | null = null;
  const getIntel = (fresh = false) => {
    if (!fresh && intel && Date.now() - intel.at < 60_000) return intel.p;
    const p = fetch("/api/centro/inteligencia", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as Promise<Intel | null>;
    intel = { at: Date.now(), p };
    return p;
  };
  const rerender: (() => void)[] = [];
  const refreshAll = () => { void getIntel(true); rerender.splice(0).forEach((f) => f()); };

  const pending = (r: Row) => (r.result?.propuestas ?? []).filter((p) => !p.estado || p.estado === "pendiente");

  // ── Resumen ────────────────────────────────────────────────────────────
  const renderResumen = async (el: HTMLElement, fichaFilter: string, admin: boolean) => {
    const it = await getIntel();
    if (!el.isConnected) return;
    if (!it || it.error) {
      el.innerHTML = it?.error && admin ? card("Inteligencia de la semana", "", `<p class="muted">${esc(it.error)}</p>`) : "";
      return;
    }
    const rows = it.filas.filter((r) => !fichaFilter || r.fichas.some((f) => f.id === fichaFilter));
    if (!rows.length) {
      el.innerHTML = admin && !fichaFilter ? card("Inteligencia de la semana", "", `<p class="muted">Aún no se genera. Se arma sola los viernes para cada cliente listo (ver el checklist en Clientes).</p>`) : "";
      return;
    }
    const rank = { alta: 0, media: 1, baja: 2 } as const;
    rows.sort((a, b) => (a.status === "ok" ? 0 : 1) - (b.status === "ok" ? 0 : 1) || rank[a.result?.prioridad ?? "baja"] - rank[b.result?.prioridad ?? "baja"]);
    const cost = rows.reduce((a, r) => a + Number(r.cost_usd ?? 0), 0);
    el.innerHTML = card(
      `Inteligencia de la semana del ${lunes(it.semana)}`,
      `Stock de los SDR, sus llamadas y notas, señales de Allo, rechazos y feedback${admin ? ` · IA US$${cost.toFixed(2)}` : ""}`,
      `<div class="tw"><table><thead><tr><th class="l">Cliente</th><th>Prioridad</th><th>Meta del mes</th><th>Empresas sugeridas</th><th>Stock SDR</th><th>Por decidir</th><th class="l">Qué hacer</th></tr></thead><tbody>${rows.map((r) => {
        if (r.status !== "ok") return `<tr><td class="l"><b>${esc(r.cliente)}</b></td><td colspan="6" class="l muted">${r.status === "sin_datos" ? "Sin datos suficientes esta semana" : `Error: ${esc(r.error)}`}</td></tr>`;
        const p = pending(r).length;
        const d = r.numbers?.diasStock;
        return `<tr><td class="l"><b>${esc(r.cliente)}</b></td><td><span class="pill ${PRIO[r.result.prioridad]}">${esc(r.result.prioridad)}</span></td><td>${goalCell(r.numbers?.meta)}</td><td><b>${n(r.result.empresas_sugeridas)}</b></td><td>${d == null ? "–" : `${n(d)} días`}<div class="muted" style="font-size:11.5px">${n(r.numbers?.sinGestion)} contactos</div></td><td>${p ? `<b>${n(p)}</b>` : "–"}</td><td class="l" style="white-space:normal;max-width:420px;font-size:12.5px">${esc(r.result.resumen)}</td></tr>`;
      }).join("")}</tbody></table></div><p class="muted" style="font-size:12px;margin-top:8px">Las propuestas de cargos, industrias y exclusiones se aprueban o descartan en la ficha de cada cliente. Las empresas sugeridas se generan solas el domingo en Empresas → Recomendadas por IA.</p>`
    );
    rerender.push(() => { if (el.isConnected) void renderResumen(el, fichaFilter, admin); });
  };

  // ── Clientes: checklist de preparación ─────────────────────────────────
  const renderClientes = async (el: HTMLElement) => {
    el.innerHTML = card("Preparación para el motor de prospección", "Cargando…", "");
    const r = await fetch("/api/centro/preparacion", { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).catch(() => null) as { clientes?: Ready[] } | null;
    if (!el.isConnected) return;
    const list = r?.clientes ?? [];
    if (!list.length) { el.innerHTML = ""; return; }
    const cnt = { listo: 0, parcial: 0, falta: 0 };
    list.forEach((c) => cnt[c.estado]++);
    const pill = { listo: "g", parcial: "y", falta: "r" } as const;
    const lbl = { listo: "Listo", parcial: "Con límites", falta: "Falta" } as const;
    el.innerHTML = card(
      "Preparación para el motor de prospección",
      `${cnt.listo} listos · ${cnt.parcial} con límites · ${cnt.falta} con requisitos faltantes`,
      `<p class="muted" style="font-size:12.5px;margin-bottom:8px">Para que un cliente entre a la inteligencia semanal y a las recomendaciones automáticas necesita: estar activo en la Maestra, tener ficha, ICP en el portal y Pulso ABM sincronizado.</p>
      <div class="tw"><table><thead><tr><th class="l">Cliente</th><th>Estado</th>${list[0].checks.map((c) => `<th title="${esc(c.label)}">${esc(c.label.replace(/ \(.*\)$/, ""))}</th>`).join("")}</tr></thead><tbody>${list.map((c) =>
        `<tr><td class="l"><b>${esc(c.cliente)}</b><div class="muted" style="font-size:11.5px;white-space:normal;max-width:240px">${esc(c.resumen)}</div></td><td><span class="pill ${pill[c.estado]}">${lbl[c.estado]}</span></td>${c.checks.map((k) => `<td title="${esc(k.detail)}">${k.ok ? "✓" : `<span style="color:var(--${k.required ? "bad" : "warn"}-fg, ${k.required ? "#c0392b" : "#b7791f"})">✗</span>`}</td>`).join("")}</tr>`
      ).join("")}</tbody></table></div><p class="muted" style="font-size:12px;margin-top:6px">Pasa el cursor sobre cada marca para ver el detalle.</p>`
    );
  };

  // ── Ficha: propuestas con aprobar / descartar ──────────────────────────
  const renderFicha = async (el: HTMLElement, fid: string, admin: boolean) => {
    const it = await getIntel();
    if (!el.isConnected) return;
    const r = it?.filas.find((x) => x.fichas.some((f) => f.id === fid));
    if (!r) { el.innerHTML = ""; return; }
    if (r.status !== "ok") {
      el.innerHTML = card(`Inteligencia de la semana del ${lunes(r.semana)}`, "", `<p class="muted">${r.status === "sin_datos" ? "Sin datos suficientes esta semana." : `No se pudo generar: ${esc(r.error)}`}</p>${admin ? `<button class="btn sm" data-ci-run>Generar de nuevo</button> <span class="muted" data-ci-msg></span>` : ""}`);
      bindRun(el, r, fid, admin);
      return;
    }
    const res = r.result;
    const props = res.propuestas ?? [];
    const propHtml = props.length
      ? props.map((p) => {
          const done = p.estado && p.estado !== "pendiente";
          return `<div style="border:1px solid var(--line, #e3e1f0);border-radius:10px;padding:10px 12px;margin-bottom:8px" data-ci-prop="${esc(p.id)}">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="tag">${esc(TIPO[p.tipo] ?? p.tipo)}</span><b style="flex:1;min-width:200px">${esc(p.texto)}</b>${p.toca_icp ? `<span class="pill y" title="Al aprobarla se avisa al KAM para validarla con el cliente">Toca el ICP</span>` : ""}</div>
            <div class="muted" style="font-size:12.5px;margin-top:4px">${esc(p.evidencia)} · ${n(p.casos)} casos · se anotaría en «${esc(CAMPO[p.campo] ?? p.campo)}»</div>
            <div style="margin-top:8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">${done
              ? `<span class="pill ${p.estado === "aprobada" ? "g" : ""}">${p.estado === "aprobada" ? "Aprobada y anotada en la ficha" : "Descartada"}</span><span class="muted" style="font-size:12px">${esc(p.decidido_por ?? "")}</span>`
              : `<button class="btn sm pri" data-ci-dec="aprobada">Aprobar y anotar en la ficha</button><button class="btn sm" data-ci-dec="descartada">Descartar</button><span class="muted" style="font-size:12px" data-ci-msg></span>`}</div></div>`;
        }).join("")
      : `<p class="muted">Sin patrones claros esta semana: no hay cambios que proponer a la ficha.</p>`;
    const rec = res.recordatorios?.length
      ? `<h4 style="font-size:13.5px;margin:14px 0 6px">Recordatorios para los SDR (${n(res.recordatorios.length)})</h4><ul style="font-size:12.5px;padding-left:18px">${res.recordatorios.map((x) => `<li><b>${esc(x.empresa)}</b> · ${esc(x.contacto)} · ${esc(x.cuando)} — ${esc(x.motivo)}${x.sdr ? ` <span class="muted">(${esc(x.sdr)})</span>` : ""}</li>`).join("")}</ul><p class="muted" style="font-size:11.5px">Se envían solos al SDR y su líder de célula cuando llega la fecha.</p>`
      : "";
    const cal = res.calidad_datos?.length ? `<h4 style="font-size:13.5px;margin:14px 0 6px">Calidad de los datos entregados</h4><ul style="font-size:12.5px;padding-left:18px">${res.calidad_datos.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
    const min = res.minuta ? `<h4 style="font-size:13.5px;margin:14px 0 6px">Reuniones con el cliente</h4><p style="font-size:12.5px">${esc(res.minuta)}</p>` : "";
    const nb = r.numbers ?? {};
    el.innerHTML = card(
      `Inteligencia de la semana del ${lunes(r.semana)}`,
      `<span class="pill ${PRIO[res.prioridad]}">prioridad ${esc(res.prioridad)}</span>`,
      `<p style="font-size:13.5px">${esc(res.resumen)}</p>
      <div class="kgrid" style="margin:10px 0">
        <div class="kpi hl"><div class="kpi-h">Empresas sugeridas</div><div class="kv">${n(res.empresas_sugeridas)}</div><div class="ksub">${esc(res.motivo_cantidad)}</div></div>
        <div class="kpi"><div class="kpi-h">Meta de reuniones del mes</div><div class="kv">${nb.meta ? `${n(nb.meta.realizadas)} / ${n(nb.meta.meta)}` : "–"}</div><div class="ksub">${nb.meta ? (nb.meta.cumplida ? "Cumplida: se baja el ritmo" : `Faltan ${n(nb.meta.faltan)} · ${n(nb.meta.porRealizar)} por realizar · ${n(nb.meta.diasHabilesRestantes)} días hábiles`) : "Sin meta cargada en Asignación"}</div></div>
        <div class="kpi"><div class="kpi-h">Stock de los SDR</div><div class="kv">${nb.diasStock == null ? "–" : `${n(nb.diasStock)} días`}</div><div class="ksub">${n(nb.sinGestion)} contactos sin gestionar · ${n(nb.ritmoDiario)} por día</div></div>
        <div class="kpi"><div class="kpi-h">Reuniones 30 días</div><div class="kv">${n(nb.reuniones30d)}</div><div class="ksub">${n(nb.realizadas30d)} realizadas</div></div>
      </div>
      ${res.donde_prospectar?.length ? `<p style="font-size:13px"><b>Dónde prospectar:</b> ${res.donde_prospectar.map(esc).join(" · ")}</p>` : ""}
      <h4 style="font-size:13.5px;margin:14px 0 6px">Propuestas para la ficha</h4>${propHtml}${rec}${cal}${min}
      ${admin ? `<div style="margin-top:10px"><button class="btn sm" data-ci-run>Volver a generar</button> <span class="muted" style="font-size:12px" data-ci-msg></span></div>` : ""}`
    );
    el.querySelectorAll<HTMLElement>("[data-ci-prop]").forEach((box) => {
      box.querySelectorAll<HTMLButtonElement>("[data-ci-dec]").forEach((b) => b.addEventListener("click", async () => {
        const msg = box.querySelector<HTMLElement>("[data-ci-msg]");
        box.querySelectorAll<HTMLButtonElement>("button").forEach((x) => (x.disabled = true));
        if (msg) msg.textContent = "Guardando…";
        const res2 = await fetch("/api/centro/inteligencia/decision", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ client_id: r.client_id, semana: r.semana, propuesta: box.dataset.ciProp, decision: b.dataset.ciDec, ficha_id: fid }),
        }).then((x) => x.json()).catch(() => ({ error: "Sin respuesta" }));
        if (res2.error) {
          if (msg) msg.textContent = res2.error;
          box.querySelectorAll<HTMLButtonElement>("button").forEach((x) => (x.disabled = false));
          return;
        }
        refreshAll();
        void renderFicha(el, fid, admin);
      }));
    });
    bindRun(el, r, fid, admin);
  };

  const bindRun = (el: HTMLElement, r: Row, fid: string, admin: boolean) => {
    const b = el.querySelector<HTMLButtonElement>("[data-ci-run]");
    if (!b || !admin) return;
    b.addEventListener("click", async () => {
      const msg = el.querySelector<HTMLElement>("[data-ci-msg]");
      b.disabled = true;
      if (msg) msg.textContent = "Generando (1–2 min)… Las decisiones ya tomadas se mantienen.";
      const res = await fetch("/api/centro/inteligencia", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_id: r.client_id }) })
        .then((x) => x.json()).catch(() => ({ error: "Sin respuesta" }));
      if (res.error) { if (msg) msg.textContent = res.error; b.disabled = false; return; }
      refreshAll();
      void renderFicha(el, fid, admin);
    });
  };

  return { renderResumen, renderClientes, renderFicha };
}
